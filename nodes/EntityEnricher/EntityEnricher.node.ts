import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { apiRequest } from './helpers/api';
import type { EnrichmentOptionsResponse, ProfileLimits, SavedSchema } from './helpers/types';
import { extractSearchKeys } from './helpers/validation';
import * as addAttachment from './operations/addAttachment';
import * as batchEnrich from './operations/batchEnrich';
import * as deleteAttachment from './operations/deleteAttachment';
import * as enrichEntity from './operations/enrichEntity';
import * as getOptions from './operations/getOptions';
import * as getRecord from './operations/getRecord';
import * as getSchemaDetails from './operations/getSchemaDetails';
import * as listRecords from './operations/listRecords';
import * as listSchemas from './operations/listSchemas';
import * as mergeResults from './operations/mergeResults';

export class EntityEnricher implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Entity Enricher',
		name: 'entityEnricher',
		icon: 'file:entity-enricher.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
		description: 'Enrich entities with multi-model LLM fusion, multilingual output, and expertise-driven strategies',
		documentationUrl: 'https://entityenricher.ai/docs/integrations/n8n',
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Agents & Tools', 'Tools'],
			},
			alias: ['enrichment', 'translation', 'llm', 'data enrichment', 'multi-model', 'fusion', 'entity'],
			resources: {
				primaryDocumentation: [
					{ url: 'https://entityenricher.ai/docs/integrations/n8n' },
				],
				credentialDocumentation: [
					{ url: 'https://entityenricher.ai/docs/platform/api-keys' },
				],
			},
		},
		defaults: {
			name: 'Entity Enricher',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'entityEnricherApi',
				required: true,
			},
		],
		properties: [
			// ─── Connection Info ───
			{
				displayName: 'Connected To',
				name: 'connectionInfo',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getConnectionInfo' },
				default: '',
				noDataExpression: true,
				description: 'Shows the organization and API key linked to the configured credentials',
			},

			// ─── Resource ───
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Enrichment', value: 'enrichment' },
					{ name: 'Schema', value: 'schema' },
					{ name: 'Record', value: 'record' },
					{ name: 'Attachment', value: 'attachment' },
					{ name: 'Fusion', value: 'fusion' },
					{ name: 'Configuration', value: 'configuration' },
				],
				default: 'enrichment',
			},

			// ─── Operations ───
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['enrichment'] } },
				options: [
					{
						name: 'Enrich Entity',
						value: 'enrichEntity',
						description: 'Enrich a single entity with one or more LLM models',
						action: 'Enrich a single entity',
					},
					{
						name: 'Batch Enrich',
						value: 'batchEnrich',
						description: 'Enrich all input entities in a single batch',
						action: 'Batch enrich entities',
					},
				],
				default: 'enrichEntity',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['schema'] } },
				options: [
					{
						name: 'List Schemas',
						value: 'listSchemas',
						description: 'List all saved schemas',
						action: 'List all saved schemas',
					},
					{
						name: 'Get Schema Details',
						value: 'getSchemaDetails',
						description: 'Get a schema with its full content and search keys',
						action: 'Get schema details',
					},
				],
				default: 'listSchemas',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['record'] } },
				options: [
					{
						name: 'List Records',
						value: 'listRecords',
						description: 'List enrichment records with optional filters',
						action: 'List enrichment records',
					},
					{
						name: 'Get Record',
						value: 'getRecord',
						description: 'Retrieve an enrichment record by ID',
						action: 'Get an enrichment record',
					},
				],
				default: 'listRecords',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['attachment'] } },
				options: [
					{
						name: 'Add Attachment',
						value: 'addAttachment',
						description: 'Upload a file to use as source material in an enrichment',
						action: 'Add an attachment',
					},
					{
						name: 'Delete Attachment',
						value: 'deleteAttachment',
						description: 'Remove an attachment from the server by ID',
						action: 'Delete an attachment',
					},
				],
				default: 'addAttachment',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['fusion'] } },
				options: [
					{
						name: 'Merge Results',
						value: 'mergeResults',
						description: 'Merge multiple enrichment results with optional LLM arbitration',
						action: 'Merge enrichment results',
					},
				],
				default: 'mergeResults',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['configuration'] } },
				options: [
					{
						name: 'Get Options',
						value: 'getOptions',
						description: 'Get available models, languages, and strategies',
						action: 'Get enrichment options',
					},
				],
				default: 'getOptions',
			},

			// ─── Enrichment Parameters ───

			// Schema (for enrichment + batch)
			{
				displayName: 'Schema',
				name: 'schemaId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getSchemas',
				},
				required: true,
				default: '',
				description: 'Target schema defining the enrichment output structure',
				hint: 'Don\'t have a schema? <a href="https://entityenricher.ai/schema-editor" target="_blank">Create one in Schema Editor</a>',
				displayOptions: {
					show: {
						resource: ['enrichment'],
						operation: ['enrichEntity', 'batchEnrich'],
					},
				},
			},

			// Models (multi-select for enrichment + batch)
			{
				displayName: 'Models',
				name: 'models',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getModels',
				},
				required: true,
				default: [],
				description: 'LLM models to use for enrichment. Select 2+ for multi-model fusion.',
				hint: 'Need more models? <a href="https://entityenricher.ai/api-keys/ai-provider" target="_blank">Add API keys</a> to enable additional providers.',
				displayOptions: {
					show: {
						resource: ['enrichment'],
						operation: ['enrichEntity', 'batchEnrich'],
					},
				},
			},

			// Attachment IDs (optional, for enrichment + batch)
			{
				displayName: 'Attachment IDs',
				name: 'attachmentIds',
				type: 'string',
				default: '',
				placeholder: 'uuid1, uuid2',
				description: 'Comma-separated attachment UUIDs (from Add Attachment) to use as source material for the enrichment',
				displayOptions: {
					show: {
						resource: ['enrichment'],
						operation: ['enrichEntity', 'batchEnrich'],
					},
				},
			},

			// Schema ID (get schema details)
			{
				displayName: 'Schema',
				name: 'schemaIdDetail',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getSchemas',
				},
				required: true,
				default: '',
				description: 'Schema to retrieve full details for',
				hint: 'Don\'t have a schema? <a href="https://entityenricher.ai/schema-editor" target="_blank">Create one in Schema Editor</a>',
				displayOptions: {
					show: {
						resource: ['schema'],
						operation: ['getSchemaDetails'],
					},
				},
			},

			// Record ID (get record)
			{
				displayName: 'Record ID',
				name: 'recordId',
				type: 'string',
				required: true,
				default: '',
				description: 'UUID of the enrichment record to retrieve',
				hint: '={{$parameter["recordId"] ? \'<a href="https://entityenricher.ai/records/\' + $parameter["recordId"] + \'" target="_blank">View record in Entity Enricher</a>\' : \'Find record IDs in the <a href="https://entityenricher.ai/records" target="_blank">Records page</a>\'}}',
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['getRecord'],
					},
				},
			},

			// ─── Attachment Parameters ───

			// Binary property (add attachment)
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				required: true,
				default: 'data',
				description: 'Name of the binary property on the input item that holds the file to upload',
				hint: 'Connect a node that outputs a file (e.g. HTTP Request with response format "File", or Read Binary File)',
				displayOptions: {
					show: {
						resource: ['attachment'],
						operation: ['addAttachment'],
					},
				},
			},
			{
				displayName: 'File Name Override',
				name: 'fileNameOverride',
				type: 'string',
				default: '',
				description: 'Optional filename to use instead of the binary property\'s own file name. The extension matters — the server sniffs the format.',
				displayOptions: {
					show: {
						resource: ['attachment'],
						operation: ['addAttachment'],
					},
				},
			},

			// Attachment ID (delete attachment)
			{
				displayName: 'Attachment ID',
				name: 'attachmentId',
				type: 'string',
				required: true,
				default: '',
				description: 'UUID of the attachment to delete (returned by Add Attachment)',
				displayOptions: {
					show: {
						resource: ['attachment'],
						operation: ['deleteAttachment'],
					},
				},
			},

			// Result IDs (fusion)
			{
				displayName: 'Result IDs',
				name: 'resultIds',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'uuid1, uuid2',
				description: 'Comma-separated enrichment record UUIDs to merge (minimum 2)',
				displayOptions: {
					show: {
						resource: ['fusion'],
						operation: ['mergeResults'],
					},
				},
			},

			// ─── List Records Parameters ───
			{
				displayName: 'Limit',
				name: 'recordLimit',
				type: 'number',
				default: 20,
				description: 'Maximum number of records to return (1-100)',
				typeOptions: { minValue: 1, maxValue: 100 },
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['listRecords'],
					},
				},
			},
			{
				displayName: 'Record Type',
				name: 'recordType',
				type: 'options',
				default: '',
				description: 'Filter by record type',
				options: [
					{ name: 'All Types', value: '' },
					{ name: 'Enrichment', value: 'enrichment' },
					{ name: 'Schema Generation', value: 'schema_generation' },
					{ name: 'Schema Edit', value: 'schema_edit' },
					{ name: 'Playground', value: 'playground' },
				],
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['listRecords'],
					},
				},
			},
			{
				displayName: 'Success Only',
				name: 'successOnly',
				type: 'boolean',
				default: false,
				description: 'Whether to return only successful records',
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['listRecords'],
					},
				},
			},

			// ─── Enrichment Options ───

			// Languages
			{
				displayName: 'Languages',
				name: 'languages',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getLanguages',
				},
				default: ['en'],
				description: 'Languages for multilingual fields. At least one language must be selected.',
				displayOptions: {
					show: {
						resource: ['enrichment'],
						operation: ['enrichEntity', 'batchEnrich'],
					},
				},
			},

			// Strategy
			{
				displayName: 'Strategy',
				name: 'strategy',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getStrategies',
				},
				default: 'multi_expertise',
				description: 'Enrichment strategy. Multi-expertise runs parallel calls per domain for best results.',
				displayOptions: {
					show: {
						resource: ['enrichment'],
						operation: ['enrichEntity', 'batchEnrich'],
					},
				},
			},

			// Classification Model (optional)
			{
				displayName: 'Classification Model',
				name: 'classificationModel',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getClassificationModels',
				},
				default: '',
				description: 'Optional model for pre-flight entity type classification. Prevents hallucination on mismatched entities.',
				displayOptions: {
					show: {
						resource: ['enrichment'],
						operation: ['enrichEntity', 'batchEnrich'],
					},
				},
			},

			// Arbitration Model (optional, for enrichment + fusion)
			{
				displayName: 'Arbitration Model',
				name: 'arbitrationModel',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getArbitrationModels',
				},
				default: '',
				description: 'Model for LLM-based conflict resolution when merging multi-model results. Leave empty for rule-based merging.',
				displayOptions: {
					show: {
						resource: ['enrichment', 'fusion'],
						operation: ['enrichEntity', 'batchEnrich', 'mergeResults'],
					},
				},
			},

			// Web Search (auto-disabled when no selected model supports it)
			{
				displayName: 'Web Search',
				name: 'enableWebSearch',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getWebSearchOptions',
					loadOptionsDependsOn: ['models'],
				},
				default: 'off',
				description: 'Enable provider builtin web search for models that support it. Locked off when no selected model supports web search.',
				displayOptions: {
					show: {
						resource: ['enrichment'],
						operation: ['enrichEntity', 'batchEnrich'],
					},
				},
			},

			// Advanced Options — structured-output controls, hidden under a
			// collapsed "Add option" group (capability-gated dropdowns inside).
			{
				displayName: 'Advanced Options',
				name: 'advancedOptions',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: {
					show: {
						resource: ['enrichment'],
						operation: ['enrichEntity', 'batchEnrich'],
					},
				},
				options: [
					// Response Schema (auto-disabled when no selected model supports it)
					{
						displayName: 'Response Schema',
						name: 'enableResponseSchema',
						type: 'options',
						typeOptions: {
							loadOptionsMethod: 'getResponseSchemaOptions',
							loadOptionsDependsOn: ['models'],
						},
						default: 'on',
						description: 'Use the provider response-schema channel (NativeOutput) for models that support it. On by default; locked off when no selected model supports it. Capable models otherwise fall back to tool-call output.',
					},
					// Strict Structured Output (auto-disabled when no selected model supports it)
					{
						displayName: 'Strict Structured Output',
						name: 'enableStrictStructuredOutput',
						type: 'options',
						typeOptions: {
							loadOptionsMethod: 'getStrictStructuredOutputOptions',
							loadOptionsDependsOn: ['models'],
						},
						default: 'off',
						description: 'Constrain decoding to the schema (no drift) on whichever structured channel is used, for models that support it. Off by default; locked off when no selected model supports strict structured output.',
					},
				],
			},

			// Timeout
			{
				displayName: 'Timeout (ms)',
				name: 'timeout',
				type: 'number',
				default: 300000,
				description: 'Inactivity timeout in milliseconds. The timer resets each time a progress event is received, so large batches won\'t time out as long as entities keep completing. The job is cancelled if no event arrives within this period.',
				displayOptions: {
					show: {
						resource: ['enrichment'],
						operation: ['enrichEntity', 'batchEnrich'],
					},
				},
			},

			// Include Per-Model Results
			{
				displayName: 'Include Per-Model Results',
				name: 'includePerModelResults',
				type: 'boolean',
				default: false,
				description: 'Whether to output individual model results in addition to the fused result',
				displayOptions: {
					show: {
						resource: ['enrichment'],
						operation: ['enrichEntity'],
					},
				},
			},

			// Include Enrichment Metadata
			{
				displayName: 'Include Enrichment Metadata',
				name: 'includeEnrichmentMetadata',
				type: 'boolean',
				default: false,
				description: 'Whether to include enrichment metadata (cost, tokens, fusion details, record IDs) alongside the result. When off, output contains only the enriched data.',
				displayOptions: {
					show: {
						resource: ['enrichment'],
						operation: ['enrichEntity', 'batchEnrich'],
					},
				},
			},
		],
	};

	methods = {
		loadOptions: {
			async getConnectionInfo(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const options = await apiRequest(
					this, '/api/enrichment/options',
				) as EnrichmentOptionsResponse;

				const parts: string[] = [];
				if (options.organization_name) {
					parts.push(options.organization_name);
				}
				if (options.api_key_name && options.api_key_role) {
					parts.push(`Key "${options.api_key_name}" (${options.api_key_role})`);
				}
				const modelCount = options.models?.length ?? 0;
				parts.push(`${modelCount} model(s)`);

				return [{ name: parts.join(' · '), value: 'connected' }];
			},

			async getSchemas(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('entityEnricherApi');
				const baseUrl = (credentials.baseUrl as string).replace(/\/$/, '');
				const response = await apiRequest(this, '/api/schema/saved') as { schemas: SavedSchema[] };
				const schemas = response.schemas;

				if (!schemas.length) {
					return [{
						name: 'No schemas found - create one in Schema Editor',
						value: '',
						description: `${baseUrl}/schema-editor`,
					}];
				}

				return schemas.map((s) => ({
					name: s.is_pinned ? `[Pinned] ${s.name}` : s.name,
					value: s.id,
					description: s.tags.length ? `Tags: ${s.tags.join(', ')}` : undefined,
				}));
			},

			async getModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('entityEnricherApi');
				const baseUrl = (credentials.baseUrl as string).replace(/\/$/, '');
				const options = await apiRequest(
					this, '/api/enrichment/options',
				) as EnrichmentOptionsResponse;

				const available = options.models.filter(
					(m) => m.is_available && !m.processing_disabled?.enrichment,
				);

				const modelOptions: INodePropertyOptions[] = [];

				// Show plan limit notice if applicable
				const limits = extractProfileLimits(options);
				if (limits?.max_models_per_enrichment != null) {
					modelOptions.push({
						name: `Plan limit: max ${limits.max_models_per_enrichment} model(s) per enrichment`,
						value: '__plan_limit_notice__',
						description: 'Selecting more models will be rejected by the server',
					});
				}

				modelOptions.push(...available.map((m) => ({
					name: formatModelLabel(m),
					value: m.key,
					description: m.input_price != null && m.output_price != null
						? `in $${m.input_price.toFixed(2)}/out $${m.output_price.toFixed(2)}`
						: undefined,
				})));

				modelOptions.push({
					name: 'Add more models (manage API keys)',
					value: '',
					description: `${baseUrl}/api-keys/ai-provider`,
				});

				return modelOptions;
			},

			async getClassificationModels(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const options = await apiRequest(
					this, '/api/enrichment/options',
				) as EnrichmentOptionsResponse;

				const available = options.models.filter(
					(m) => m.is_available && !m.processing_disabled?.classification,
				);

				return [
					{ name: '(None)', value: '' },
					...available.map((m) => ({
						name: formatModelLabel(m),
						value: m.key,
					})),
				];
			},

			async getArbitrationModels(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const options = await apiRequest(
					this, '/api/enrichment/options',
				) as EnrichmentOptionsResponse;

				const available = options.models.filter(
					(m) => m.is_available && !m.processing_disabled?.arbitration,
				);

				return [
					{ name: '(None)', value: '' },
					...available.map((m) => ({
						name: formatModelLabel(m),
						value: m.key,
					})),
				];
			},

			async getWebSearchOptions(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				// Read currently-selected models from sibling parameter and intersect
				// with API-reported web-search capability. Lock the dropdown to "Off"
				// when no selected model supports web search.
				let selectedModels: string[] = [];
				try {
					const raw = this.getCurrentNodeParameter('models');
					if (Array.isArray(raw)) {
						selectedModels = raw.filter((v): v is string => typeof v === 'string');
					}
				} catch {
					// Parameter not yet bound — treat as no selection
				}

				const optionsResponse = await apiRequest(
					this, '/api/enrichment/options',
				) as EnrichmentOptionsResponse;

				const supportsByKey = new Map<string, boolean>(
					optionsResponse.models.map((m) => [m.key, !!m.supports_web_search]),
				);

				// When no models picked yet, leave both options enabled so the
				// field becomes usable as soon as the user selects models.
				const anySupports = selectedModels.length === 0
					|| selectedModels.some((k) => supportsByKey.get(k) === true);

				if (!anySupports) {
					return [
						{
							name: 'Off — no selected model supports web search',
							value: 'off',
						},
					];
				}

				return [
					{ name: 'Off', value: 'off' },
					{ name: 'On', value: 'on' },
				];
			},

			async getResponseSchemaOptions(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				// Read currently-selected models from sibling parameter and intersect
				// with API-reported response-schema capability. Lock the dropdown to
				// "Off" when no selected model supports the response-schema channel.
				let selectedModels: string[] = [];
				try {
					const raw = this.getCurrentNodeParameter('models');
					if (Array.isArray(raw)) {
						selectedModels = raw.filter((v): v is string => typeof v === 'string');
					}
				} catch {
					// Parameter not yet bound — treat as no selection
				}

				const optionsResponse = await apiRequest(
					this, '/api/enrichment/options',
				) as EnrichmentOptionsResponse;

				const supportsByKey = new Map<string, boolean>(
					optionsResponse.models.map((m) => [m.key, !!m.supports_response_schema]),
				);

				// When no models picked yet, leave both options enabled so the
				// field becomes usable as soon as the user selects models.
				const anySupports = selectedModels.length === 0
					|| selectedModels.some((k) => supportsByKey.get(k) === true);

				if (!anySupports) {
					return [
						{
							name: 'Off — no selected model supports response schema',
							value: 'off',
						},
					];
				}

				return [
					{ name: 'Off', value: 'off' },
					{ name: 'On', value: 'on' },
				];
			},

			async getStrictStructuredOutputOptions(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				// Read currently-selected models and intersect with API-reported
				// strict-structured-output capability. Lock the dropdown to "Off"
				// when no selected model can constrain decoding to the schema.
				let selectedModels: string[] = [];
				try {
					const raw = this.getCurrentNodeParameter('models');
					if (Array.isArray(raw)) {
						selectedModels = raw.filter((v): v is string => typeof v === 'string');
					}
				} catch {
					// Parameter not yet bound — treat as no selection
				}

				const optionsResponse = await apiRequest(
					this, '/api/enrichment/options',
				) as EnrichmentOptionsResponse;

				const supportsByKey = new Map<string, boolean>(
					optionsResponse.models.map((m) => [m.key, !!m.supports_strict_structured_output]),
				);

				// When no models picked yet, leave both options enabled so the
				// field becomes usable as soon as the user selects models.
				const anySupports = selectedModels.length === 0
					|| selectedModels.some((k) => supportsByKey.get(k) === true);

				if (!anySupports) {
					return [
						{
							name: 'Off — no selected model supports strict structured output',
							value: 'off',
						},
					];
				}

				return [
					{ name: 'Off', value: 'off' },
					{ name: 'On', value: 'on' },
				];
			},

			async getLanguages(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const options = await apiRequest(
					this, '/api/enrichment/options',
				) as EnrichmentOptionsResponse;

				const langOptions: INodePropertyOptions[] = [];

				// Show plan limit notice if applicable
				const limits = extractProfileLimits(options);
				if (limits?.max_languages != null) {
					langOptions.push({
						name: `Plan limit: max ${limits.max_languages} language(s)`,
						value: '__plan_limit_notice__',
						description: 'Selecting more languages will be rejected by the server',
					});
				}

				langOptions.push(...Object.entries(options.languages).map(([code, name]) => ({
					name: `${name} (${code})`,
					value: code,
				})));

				return langOptions;
			},

			async getStrategies(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const options = await apiRequest(
					this, '/api/enrichment/options',
				) as EnrichmentOptionsResponse;

				return (options.strategies ?? []).map((s) => ({
					name: s.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
					value: s.name,
					description: s.description,
				}));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const items = this.getInputData();
		let returnData: INodeExecutionData[] = [];

		// Non-item-dependent operations
		if (resource === 'schema' && operation === 'listSchemas') {
			returnData = await listSchemas.execute(this);
			return [returnData];
		}
		if (resource === 'configuration' && operation === 'getOptions') {
			returnData = await getOptions.execute(this);
			return [returnData];
		}
		if (resource === 'record' && operation === 'listRecords') {
			returnData = await listRecords.execute(this);
			return [returnData];
		}

		// Pre-fetch search keys and profile limits for enrichment operations (once per execution, not per item)
		let searchKeys: string[] | undefined;
		let profileLimits: ProfileLimits | null = null;
		if (resource === 'enrichment') {
			const schemaId = this.getNodeParameter('schemaId', 0) as string;
			if (schemaId) {
				const schema = await apiRequest(this, `/api/schema/saved/${schemaId}`) as {
					schema_content?: {
						root?: { properties?: Record<string, unknown> };
						properties?: Record<string, unknown>;
					};
				};
				const rootProps = schema.schema_content?.root?.properties
					?? schema.schema_content?.properties
					?? {};
				searchKeys = extractSearchKeys(rootProps, '');
			}

			// Fetch profile limits for metadata output (reuses the options endpoint)
			const includeMetadata = this.getNodeParameter('includeEnrichmentMetadata', 0, false) as boolean;
			if (includeMetadata) {
				const options = await apiRequest(this, '/api/enrichment/options') as EnrichmentOptionsResponse;
				profileLimits = extractProfileLimits(options);
			}
		}

		// Batch Enrich processes all items at once
		if (resource === 'enrichment' && operation === 'batchEnrich') {
			returnData = await batchEnrich.execute(this, searchKeys, profileLimits);
			return [returnData];
		}

		// Process each input item
		for (let i = 0; i < items.length; i++) {
			try {
				let results: INodeExecutionData[] = [];

				if (resource === 'enrichment' && operation === 'enrichEntity') {
					results = await enrichEntity.execute(this, i, searchKeys, profileLimits);
				} else if (resource === 'record' && operation === 'getRecord') {
					results = await getRecord.execute(this, i);
				} else if (resource === 'schema' && operation === 'getSchemaDetails') {
					results = await getSchemaDetails.execute(this, i);
				} else if (resource === 'attachment' && operation === 'addAttachment') {
					results = await addAttachment.execute(this, i);
				} else if (resource === 'attachment' && operation === 'deleteAttachment') {
					results = await deleteAttachment.execute(this, i);
				} else if (resource === 'fusion' && operation === 'mergeResults') {
					results = await mergeResults.execute(this, i);
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`Unknown operation: ${resource}/${operation}`,
					);
				}

				returnData.push(...results);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: i,
					});
				} else {
					throw error;
				}
			}
		}

		return [returnData];
	}
}

/**
 * Capability flags shown after the model name in dropdowns.
 *
 * Ordered by "most decision-relevant first" — what users typically pick a
 * model for. We omit `supports_prompt_caching`, `supports_strict_structured_output`,
 * `supports_response_schema`, `supports_tool_choice`, and `supports_audio_output`
 * because they are implementation details rather than selection criteria.
 *
 * Labels are emoji glyphs encoded as Unicode escape sequences so the rendered
 * dropdown matches the web frontend's capability badges (see ModelsPanel) while
 * the source file stays pure ASCII — n8n marketplace / npm publication tooling
 * rejects literal emoji bytes in source. Mapping matches ModelsPanel:
 *   reasoning  -> brain   vision   -> eye
 *   pdf input  -> page    web sch. -> globe
 *   tool calls -> wrench  audio    -> microphone
 *   video      -> camera (no web-frontend equivalent; symmetric choice)
 */
type LLMModelInfo = EnrichmentOptionsResponse['models'][number];

const MODEL_CAPABILITY_LABELS: Array<{ key: keyof LLMModelInfo; label: string }> = [
	{ key: 'supports_reasoning', label: '\u{1F9E0}' },
	{ key: 'supports_vision', label: '\u{1F441}\u{FE0F}' },
	{ key: 'supports_pdf_input', label: '\u{1F4C4}' },
	{ key: 'supports_web_search', label: '\u{1F310}' },
	{ key: 'supports_tool_calls', label: '\u{1F527}' },
	{ key: 'supports_audio_input', label: '\u{1F3A4}' },
	{ key: 'supports_video_input', label: '\u{1F3A5}' },
];

/**
 * Build the dropdown label for a model: display name + capability glyphs.
 *
 * Each capability the model declares contributes one emoji glyph (produced
 * by the Unicode escapes in MODEL_CAPABILITY_LABELS above). Capabilities
 * the model does not declare are omitted; a model with no advertised
 * capabilities renders just its display name.
 */
function formatModelLabel(m: LLMModelInfo): string {
	const base = m.display_name ?? m.key;
	const caps = MODEL_CAPABILITY_LABELS
		.filter(({ key }) => Boolean(m[key]))
		.map(({ label }) => label);
	return caps.length === 0 ? base : `${base} · ${caps.join(' · ')}`;
}

/**
 * Extract profile limits from the enrichment options response.
 *
 * The backend returns limits as `profile_limits` (new) or `feature_flags` (legacy).
 * Both are top-level fields on EnrichmentOptionsResponse.
 */
function extractProfileLimits(
	options: EnrichmentOptionsResponse,
): ProfileLimits | null {
	const raw = (options as Record<string, unknown>).profile_limits
		?? (options as Record<string, unknown>).feature_flags;
	if (!raw || typeof raw !== 'object') return null;
	return raw as ProfileLimits;
}
