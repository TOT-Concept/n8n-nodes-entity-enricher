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

interface WebhookEndpoint {
	id: string;
	url: string;
	events: string[];
}

interface EventCatalog {
	webhooks: Array<{
		key: string;
		label: string;
		types: Array<{ type: string; event: string; description: string }>;
	}>;
}

/** The envelope every platform delivery carries (docs/WEBHOOKS.md). */
interface WebhookBody {
	event?: string;
	webhook?: string;
	type?: string;
	organization?: IDataObject | null;
	data?: IDataObject;
	changes?: IDataObject;
}

/**
 * Delta notifications are not part of the org event catalogue: they are
 * registered on the database LINK by the consuming client, so the node keeps
 * its own constant for them rather than expecting one from /api/webhooks/events.
 */
const DELTA_EVENT = 'delta_available';

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
 * Webhook trigger for Entity Enricher platform events and database deltas.
 *
 * - Platform events (`<subject>.<type>`, see /api/webhooks/events): auto-registers
 *   an org-level webhook endpoint (source 'n8n') subscribed to exactly the one
 *   event this trigger is configured for. Record and schema events accept an
 *   optional schema narrowing.
 * - delta_available: unchanged — registers itself as the webhook of one linked
 *   schema and, on fire, fetches the next window of deltas with a lease. That
 *   subscription lives on the database link, not on the org's endpoint list,
 *   because its subscriber is the consuming client rather than the tenant.
 */
// n8n's scan-community-package forbids usableAsTool on trigger nodes while this
// lint rule demands it (and the INodeTypeDescription type rejects `false`) —
// the scanner is the blocking check, so it wins and the lint rule is silenced.
// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool
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
				displayName: 'Event Name or ID',
				name: 'event',
				type: 'options',
				// Loaded from /api/webhooks/events so a new platform event needs no
				// node release; `delta_available` is appended by the loader because
				// it is the one event that is not in that catalogue.
				typeOptions: { loadOptionsMethod: 'getEvents' },
				required: true,
				default: 'record.created',
				description: 'Which platform event fires this trigger. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Schema Name or ID',
				name: 'schemaId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getSchemas' },
				default: '',
				description: 'Optional: fire only for this schema. Leave empty to receive the event for every schema in the organization. Only applies to record and schema events. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { event: ['record.created', 'schema.updated', 'schema.deleted'] } },
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

			/** The org-scope event catalogue, flattened to one option per event. */
			async getEvents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const catalog = await apiRequest(this, '/api/webhooks/events') as EventCatalog;
				const options: INodePropertyOptions[] = [];
				for (const webhook of catalog.webhooks) {
					for (const type of webhook.types) {
						options.push({
							name: `${webhook.label}: ${type.type}`,
							value: type.event,
							description: type.description,
						});
					}
				}
				// Not part of the org catalogue: its subscriber is the consuming
				// client, registered on the database link (see the class docstring).
				options.push({
					name: 'Database Sync: Deltas Available',
					value: DELTA_EVENT,
					description: 'New SQL deltas are ready for a database sync — emits one item per delta, leased for acknowledgement',
				});
				return options;
			},
		},
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const event = this.getNodeParameter('event') as string;
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				if (event === DELTA_EVENT) {
					const databaseId = this.getNodeParameter('databaseSyncId') as string;
					const link = await resolveLink(this, databaseId);
					return link.webhook_url === webhookUrl;
				}
				const endpoints = await apiRequest(this, '/api/webhooks') as WebhookEndpoint[];
				// The URL identifies the endpoint (it is unique per organization), but
				// the subscription has to match too: re-pointing the same trigger at a
				// different event leaves a stale endpoint that would keep firing.
				return endpoints.some((e) => e.url === webhookUrl && e.events.includes(event));
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const event = this.getNodeParameter('event') as string;
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				if (event === DELTA_EVENT) {
					const databaseId = this.getNodeParameter('databaseSyncId') as string;
					const link = await resolveLink(this, databaseId);
					await apiRequest(this, `/api/databases/${databaseId}/schemas/${link.saved_schema_id}/webhook`, {
						method: 'PUT',
						body: { webhook_url: webhookUrl },
					});
					return true;
				}
				// One n8n webhook URL is one endpoint subscribed to one event, so the
				// runtime needs no client-side filtering: whatever arrives is the event
				// this workflow asked for.
				const schemaId = this.getNodeParameter('schemaId', '') as string;
				await apiRequest(this, '/api/webhooks', {
					method: 'POST',
					body: {
						url: webhookUrl,
						events: [event],
						saved_schema_id: schemaId || null,
						description: `n8n: ${this.getWorkflow().name ?? 'workflow'}`,
						source: 'n8n',
					},
				});
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const event = this.getNodeParameter('event') as string;
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				try {
					if (event === DELTA_EVENT) {
						const databaseId = this.getNodeParameter('databaseSyncId') as string;
						const link = await resolveLink(this, databaseId);
						await apiRequest(this, `/api/databases/${databaseId}/schemas/${link.saved_schema_id}/webhook`, {
							method: 'PUT',
							body: { webhook_url: null },
						});
					} else {
						const query = new URLSearchParams({ url: webhookUrl });
						await apiRequest(this, `/api/webhooks?${query.toString()}`, {
							method: 'DELETE',
						});
					}
				} catch (error) {
					// Deregistration is best-effort: the backend tolerates a dangling
					// endpoint (it auto-disables after repeated failures) and the URL
					// becomes a 404 in n8n anyway.
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
		const body = this.getBodyData() as WebhookBody;

		// No client-side event filtering any more: each endpoint is registered
		// for exactly one event, so a delivery arriving here is by definition the
		// one this workflow subscribed to.
		if (event === DELTA_EVENT) {
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

		// `changes` matters as much as `data` on an `updated` event — it is what
		// says WHICH attribute moved — so the item carries the whole envelope
		// alongside the flattened data fields.
		return {
			workflowData: [[{
				json: {
					...(body.data ?? {}),
					event: body.event,
					webhook: body.webhook,
					type: body.type,
					organization: body.organization,
					...(body.changes ? { changes: body.changes } : {}),
				} as IDataObject,
			}]],
		};
	}
}
