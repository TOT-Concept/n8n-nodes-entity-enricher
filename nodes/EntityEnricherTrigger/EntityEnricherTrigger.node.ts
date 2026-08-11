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
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { apiRequest } from '../EntityEnricher/helpers/api';
import type { SavedSchema } from '../EntityEnricher/helpers/types';

interface DatabaseLink {
	saved_schema_id: string;
	schema_name: string;
	webhook_url?: string | null;
}

/**
 * Which linked schema this trigger subscribes to.
 *
 * Delta webhooks are registered per LINK, not per database: each linked schema
 * drives its own downstream workflow, so a database aggregating several schemas
 * has one endpoint each. The node parameter is optional so workflows built when
 * a database could only hold one schema keep working — with a single link there
 * is nothing to disambiguate.
 */
async function resolveLink(context: IHookFunctions, databaseId: string): Promise<DatabaseLink> {
	const database = await apiRequest(context, `/api/databases/${databaseId}`) as { schemas?: DatabaseLink[] };
	const links = database.schemas ?? [];
	const chosen = context.getNodeParameter('deltaSchemaId', '') as string;
	if (chosen) {
		const link = links.find((l) => l.saved_schema_id === chosen);
		if (!link) {
			throw new NodeOperationError(
				context.getNode(),
				`Schema ${chosen} is not linked to database ${databaseId}`,
			);
		}
		return link;
	}
	if (links.length === 1) return links[0];
	throw new NodeOperationError(
		context.getNode(),
		`Database ${databaseId} feeds ${links.length} schemas and each has its own webhook — ` +
		'pick one in the "Schema (Multi-Schema Databases)" field.',
	);
}

/**
 * Webhook trigger for Entity Enricher schema events and database deltas.
 *
 * - enrichment_result / rejected_for_database_save: auto-registers a
 *   schema-level event subscription (source 'n8n'); fires once per event.
 * - delta_available: registers itself as the webhook of one linked schema and,
 *   on fire, fetches the next window of deltas with a lease — emit one item per
 *   delta and finish the workflow with the "Acknowledge Deltas" operation.
 */
export class EntityEnricherTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Entity Enricher Trigger',
		name: 'entityEnricherTrigger',
		icon: { light: 'file:entity-enricher.svg', dark: 'file:entity-enricher-dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Fires on Entity Enricher enrichment events and database deltas',
		codex: {
			categories: ['Data & Storage', 'Development'],
			alias: [
				'enrichment', 'entity', 'webhook',
				'database sync', 'database replication', 'delta', 'cdc', 'postgresql', 'mysql', 'sqlite',
			],
			resources: {
				primaryDocumentation: [
					{ url: 'https://entityenricher.ai/docs/integrations/n8n' },
				],
				credentialDocumentation: [
					{ url: 'https://entityenricher.ai/docs/platform/api-keys' },
				],
			},
		},
		defaults: { name: 'Entity Enricher Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
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
						description: 'Every completed enrichment of the schema (with or without a database sync)',
					},
					{
						name: 'Rejected for Database Save',
						value: 'rejected_for_database_save',
						description: 'Enrichments that failed the database sync admission gate (missing required fields)',
					},
					{
						name: 'Database Deltas Available',
						value: 'delta_available',
						description: 'New SQL deltas are ready for a database sync — emits one item per delta, leased for acknowledgement',
					},
				],
				default: 'enrichment_result',
			},
			{
				displayName: 'Schema Name or ID',
				name: 'schemaId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getSchemas' },
				required: true,
				default: '',
				description: 'Schema whose events fire this trigger. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { event: ['enrichment_result', 'rejected_for_database_save'] } },
			},
			{
				displayName: 'Database Sync ID',
				name: 'databaseSyncId',
				type: 'string',
				required: true,
				default: '',
				description: 'Database sync whose deltas fire this trigger (from the Database Sync → List Database Syncs operation)',
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
			{
				displayName: 'Schema (Multi-Schema Databases) Name or ID',
				name: 'deltaSchemaId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getSchemas' },
				default: '',
				description: 'Which linked schema this trigger subscribes to. Webhooks are per schema — each drives its own workflow. Leave empty when a single schema feeds the database. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
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
					const databaseId = this.getNodeParameter('databaseSyncId') as string;
					const link = await resolveLink(this, databaseId);
					return link.webhook_url === webhookUrl;
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
					const databaseId = this.getNodeParameter('databaseSyncId') as string;
					const link = await resolveLink(this, databaseId);
					await apiRequest(this, `/api/databases/${databaseId}/schemas/${link.saved_schema_id}/webhook`, {
						method: 'PUT',
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
						const databaseId = this.getNodeParameter('databaseSyncId') as string;
						const link = await resolveLink(this, databaseId);
						await apiRequest(this, `/api/databases/${databaseId}/schemas/${link.saved_schema_id}/webhook`, {
							method: 'PUT',
							body: { webhook_url: null },
						});
					} else {
						const schemaId = this.getNodeParameter('schemaId') as string;
						const query = new URLSearchParams({ url: webhookUrl });
						await apiRequest(this, `/api/schemas/${schemaId}/subscriptions?${query.toString()}`, {
							method: 'DELETE',
						});
					}
				} catch (error) {
					// Deregistration is best-effort: the backend tolerates dangling
					// subscriptions and the URL becomes a 404 in n8n anyway.
					this.logger.warn(
						`Entity Enricher trigger: webhook deregistration failed: ${(error as Error).message}`,
					);
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
			const databaseId = this.getNodeParameter('databaseSyncId') as string;
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
