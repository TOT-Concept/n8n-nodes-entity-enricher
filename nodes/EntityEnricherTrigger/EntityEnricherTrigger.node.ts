import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	ILoadOptionsFunctions,
	INodePropertyOptions,
} from 'n8n-workflow';
import { apiRequest } from '../EntityEnricher/helpers/api';
import type { SavedSchema } from '../EntityEnricher/helpers/types';

/**
 * Webhook trigger for Entity Enricher schema events and database deltas.
 *
 * - enrichment_result / rejected_for_database_save: auto-registers a
 *   schema-level event subscription (source 'n8n'); fires once per event.
 * - delta_available: registers itself as the database's webhook and, on fire,
 *   fetches the next window of deltas with a lease — emit one item per delta
 *   and finish the workflow with the "Acknowledge Deltas" operation.
 */
export class EntityEnricherTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Entity Enricher Trigger',
		name: 'entityEnricherTrigger',
		icon: 'file:entity-enricher.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Fires on Entity Enricher enrichment events and database deltas',
		defaults: { name: 'Entity Enricher Trigger' },
		inputs: [],
		outputs: ['main'],
		credentials: [
			{
				name: 'entityEnricherApi',
				required: true,
				displayOptions: { show: { authentication: ['apiKey'] } },
			},
			{
				name: 'entityEnricherOAuth2Api',
				required: true,
				displayOptions: { show: { authentication: ['oAuth2'] } },
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'API Key', value: 'apiKey' },
					{ name: 'OAuth2', value: 'oAuth2' },
				],
				default: 'apiKey',
			},
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Enrichment Result',
						value: 'enrichment_result',
						description: 'Every completed enrichment of the schema (with or without a database)',
					},
					{
						name: 'Rejected for Database Save',
						value: 'rejected_for_database_save',
						description: 'Enrichments that failed the database admission gate (missing required fields)',
					},
					{
						name: 'Database Deltas Available',
						value: 'delta_available',
						description: 'New SQL deltas are ready for a database — emits one item per delta, leased for acknowledgement',
					},
				],
				default: 'enrichment_result',
			},
			{
				displayName: 'Schema',
				name: 'schemaId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getSchemas' },
				required: true,
				default: '',
				description: 'Schema whose events fire this trigger',
				displayOptions: { show: { event: ['enrichment_result', 'rejected_for_database_save'] } },
			},
			{
				displayName: 'Database ID',
				name: 'databaseId',
				type: 'string',
				required: true,
				default: '',
				description: 'Schema database whose deltas fire this trigger (from the Database → List Databases operation)',
				displayOptions: { show: { event: ['delta_available'] } },
			},
			{
				displayName: 'Fetch Deltas on Fire',
				name: 'fetchOnFire',
				type: 'boolean',
				default: true,
				description: 'Whether to fetch and lease the pending deltas when notified (one item per delta). Disable to receive only the notification.',
				displayOptions: { show: { event: ['delta_available'] } },
			},
		],
	};

	methods = {
		loadOptions: {
			async getSchemas(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = await apiRequest(this, '/api/schema/saved') as { schemas: SavedSchema[] };
				return response.schemas.map((s) => ({ name: s.name, value: s.id }));
			},
		},
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const event = this.getNodeParameter('event') as string;
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				if (event === 'delta_available') {
					const databaseId = this.getNodeParameter('databaseId') as string;
					const database = await apiRequest(this, `/api/databases/${databaseId}`) as { webhook_url?: string | null };
					return database.webhook_url === webhookUrl;
				}
				const schemaId = this.getNodeParameter('schemaId') as string;
				const subscriptions = await apiRequest(
					this, `/api/schemas/${schemaId}/subscriptions`,
				) as Array<{ url: string }>;
				return subscriptions.some((sub) => sub.url === webhookUrl);
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const event = this.getNodeParameter('event') as string;
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				if (event === 'delta_available') {
					const databaseId = this.getNodeParameter('databaseId') as string;
					await apiRequest(this, `/api/databases/${databaseId}`, {
						method: 'PATCH',
						body: { webhook_url: webhookUrl },
					});
					return true;
				}
				const schemaId = this.getNodeParameter('schemaId') as string;
				await apiRequest(this, `/api/schemas/${schemaId}/subscriptions`, {
					method: 'POST',
					body: { url: webhookUrl, source: 'n8n' },
				});
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const event = this.getNodeParameter('event') as string;
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				try {
					if (event === 'delta_available') {
						const databaseId = this.getNodeParameter('databaseId') as string;
						await apiRequest(this, `/api/databases/${databaseId}`, {
							method: 'PATCH',
							body: { webhook_url: null },
						});
					} else {
						const schemaId = this.getNodeParameter('schemaId') as string;
						const query = new URLSearchParams({ url: webhookUrl });
						await apiRequest(this, `/api/schemas/${schemaId}/subscriptions?${query.toString()}`, {
							method: 'DELETE',
						});
					}
				} catch {
					// Deregistration is best-effort: the backend tolerates dangling
					// subscriptions and the URL becomes a 404 in n8n anyway.
				}
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const event = this.getNodeParameter('event') as string;
		const body = this.getBodyData() as { event?: string; data?: IDataObject };

		// One endpoint receives typed events — drop the ones this trigger
		// isn't configured for (e.g. enrichment_result on a rejection trigger).
		if (event !== 'delta_available' && body.event && body.event !== event) {
			return { noWebhookResponse: false, workflowData: [] };
		}

		if (event === 'delta_available') {
			const fetchOnFire = this.getNodeParameter('fetchOnFire') as boolean;
			const databaseId = this.getNodeParameter('databaseId') as string;
			if (fetchOnFire) {
				const query = new URLSearchParams({ since: '0', claim: 'true', format: 'json' });
				const response = await apiRequest(
					this, `/api/databases/${databaseId}/changes?${query.toString()}`,
				) as { deltas: IDataObject[]; next_cursor: number | null; lease_expires_at: string | null };
				return {
					workflowData: [response.deltas.map((delta) => ({
						json: {
							...delta,
							database_id: databaseId,
							next_cursor: response.next_cursor,
							lease_expires_at: response.lease_expires_at,
						},
					}))],
				};
			}
		}

		return { workflowData: [[{ json: (body.data ?? body) as IDataObject }]] };
	}
}
