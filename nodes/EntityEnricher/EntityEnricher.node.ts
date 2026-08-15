import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { apiRequest, getBaseUrl } from './helpers/api';
import type { EnrichmentOptionsResponse, ProfileLimits, SavedSchema } from './helpers/types';
import { extractSearchKeys } from './helpers/validation';
import * as addAttachment from './operations/addAttachment';
import * as batchEnrich from './operations/batchEnrich';
import * as deleteAttachment from './operations/deleteAttachment';
import * as enrichEntity from './operations/enrichEntity';
import * as generateSample from './operations/generateSample';
import * as generateSchema from './operations/generateSchema';
import * as getOptions from './operations/getOptions';
import * as getRecord from './operations/getRecord';
import * as getSchemaDetails from './operations/getSchemaDetails';
import * as listRecords from './operations/listRecords';
import * as listSchemas from './operations/listSchemas';
import * as listDatabaseSyncs from './operations/listDatabaseSyncs';
import * as fetchDeltas from './operations/fetchDeltas';
import * as ackDeltas from './operations/ackDeltas';
import * as mergeResults from './operations/mergeResults';
import * as syncRecordsToDatabase from './operations/syncRecordsToDatabase';

export class EntityEnricher implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Entity Enricher',
		name: 'entityEnricher',
		icon: { light: 'file:entity-enricher.svg', dark: 'file:entity-enricher-dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"].replace("Simple", " (simple)")}}',
		description: 'Enrich entities with multi-model LLM fusion, multilingual output, and expertise-driven strategies',
		documentationUrl: 'https://entityenricher.ai/docs/integrations/n8n',
		codex: {
			categories: ['Data & Storage', 'Development'],
			alias: [
				'enrichment', 'translation', 'llm', 'data enrichment', 'multi-model', 'fusion', 'entity',
				'ai', 'agent', 'ai agent', 'structured output', 'knowledge extraction',
				'database sync', 'database replication', 'postgresql', 'mysql', 'sqlite', 'sql', 'cdc', 'etl', 'master data',
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
		defaults: {
			name: 'Entity Enricher',
		},
		inputs: [NodeConnectionTypes.Main],
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
		properties: [
			// ─── Authentication ───
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'API Key',
						value: 'apiKey',
						description: 'Organization access key — acts independently of any user account (recommended for durable service-to-service workflows)',
					},
					{
						name: 'OAuth2',
						value: 'oAuth2',
						description: 'Connect with your Entity Enricher account — acts on your behalf with your own role, revocable under API Keys → Connected Apps',
					},
				],
				default: 'apiKey',
			},

			// ─── Connection Info ───
			{
				displayName: 'Connected To Name or ID',
				name: 'connectionInfo',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getConnectionInfo' },
				default: '',
				noDataExpression: true,
				description: 'Shows the organization and credential linked to the configured connection. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},

			// ─── Resource ───
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Attachment', value: 'attachment' },
					{ name: 'Configuration', value: 'configuration' },
					{ name: 'Database Sync', value: 'databaseSync' },
					{ name: 'Enrichment', value: 'enrichment' },
					{ name: 'Fusion', value: 'fusion' },
					{ name: 'Record', value: 'record' },
					{ name: 'Schema', value: 'schema' },
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
				// The simple operations get NEW values while the advanced ones keep
				// the historical 'enrichEntity' / 'batchEnrich' values — workflows
				// saved before the split resolve to the advanced operations and keep
				// their exact parameter set and behavior.
				options: [
					{
						name: 'Enrich Entity',
						value: 'enrichEntitySimple',
						description: 'Enrich a single entity — pick a schema and Entity Enricher uses your organization\'s best model and strategy automatically',
						action: 'Enrich a single entity',
					},
					{
						name: 'Enrich Entity Advanced',
						value: 'enrichEntity',
						description: 'Enrich a single entity with full control: models, fusion, strategy, classification, structured output',
						action: 'Enrich a single entity advanced',
					},
					{
						name: 'Batch Enrich',
						value: 'batchEnrichSimple',
						description: 'Enrich all input entities in a single batch — pick a schema and Entity Enricher uses your organization\'s best model and strategy automatically',
						action: 'Batch enrich entities',
					},
					{
						name: 'Batch Enrich Advanced',
						value: 'batchEnrich',
						description: 'Enrich all input entities in a single batch with full control: models, fusion, strategy, classification, structured output',
						action: 'Batch enrich entities advanced',
					},
				],
				default: 'enrichEntitySimple',
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
					{
						name: 'Generate Sample',
						value: 'generateSample',
						description: 'Generate 1..N realistic sample JSON objects of one entity type — the entry point of the schema-authoring loop',
						action: 'Generate a sample entity',
					},
					{
						name: 'Generate Schema',
						value: 'generateSchema',
						description: 'Generate and auto-save a JSON schema from the input items — every item is one sample of the same entity type (multi-sample: union of fields, nullable where missing, real observed examples)',
						action: 'Generate a schema from samples',
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
					{
						name: 'Sync Records to Database',
						value: 'syncRecordsToDatabase',
						description: 'Send a stored (or transformed) enrichment output to its schema\'s database sync — re-validated against the published contract, then the admission gate',
						action: 'Sync records to database',
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
				displayOptions: { show: { resource: ['databaseSync'] } },
				options: [
					{
						name: 'List Database Syncs',
						value: 'listDatabaseSyncs',
						description: 'List the database syncs of a schema',
						action: 'List database syncs',
					},
					{
						name: 'Fetch Deltas',
						value: 'fetchDeltas',
						description: 'Fetch the next window of database deltas (SQL + JSON), optionally leasing them',
						action: 'Fetch database deltas',
					},
					{
						name: 'Acknowledge Deltas',
						value: 'ackDeltas',
						description: 'Acknowledge applied deltas up to an ID (releases the lease; may purge per sync options)',
						action: 'Acknowledge database deltas',
					},
				],
				default: 'fetchDeltas',
			},
			{
				displayName: 'Schema Name or ID',
				name: 'schemaId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getSchemas' },
				required: true,
				default: '',
				description: 'Schema whose database syncs to list. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { resource: ['databaseSync'], operation: ['listDatabaseSyncs'] } },
			},
			{
				displayName: 'Database Sync ID',
				name: 'databaseSyncId',
				type: 'string',
				required: true,
				default: '',
				description: 'ID of the database sync (from List Database Syncs or the web app)',
				displayOptions: { show: { resource: ['databaseSync'], operation: ['fetchDeltas', 'ackDeltas'] } },
			},
			{
				displayName: 'Since (Cursor)',
				name: 'since',
				type: 'number',
				default: 0,
				description: 'Return deltas with ID greater than this cursor (0 = from the beginning)',
				displayOptions: { show: { resource: ['databaseSync'], operation: ['fetchDeltas'] } },
			},
			{
				displayName: 'Claim (Lease)',
				name: 'claim',
				type: 'boolean',
				default: true,
				description: 'Whether to lease the returned deltas (FIFO window, requires Acknowledge Deltas). Disable for a replayable read-only fetch.',
				displayOptions: { show: { resource: ['databaseSync'], operation: ['fetchDeltas'] } },
			},
			{
				displayName: 'Acknowledge Up To ID',
				name: 'upToId',
				type: 'number',
				required: true,
				default: 0,
				description: 'Acknowledge every delta with ID lower than or equal to this value (use the highest applied delta ID)',
				displayOptions: { show: { resource: ['databaseSync'], operation: ['ackDeltas'] } },
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

			// The simple operations (enrichEntitySimple / batchEnrichSimple) show
			// only the essentials: schema, binary upload, languages, web search.
			// Everything else is pinned to defaults in the operation code and the
			// server auto-picks model ('auto') + strategy.
			{
				displayName: 'This operation runs with your organization\'s best model (pinned default or top benchmark score) and automatic strategy. Manage defaults in <a href="https://entityenricher.ai/settings/org-defaults" target="_blank">Settings → Organization Defaults</a>, or use the Advanced operation for full control.',
				name: 'simpleModeNotice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: {
						resource: ['enrichment'],
						operation: ['enrichEntitySimple', 'batchEnrichSimple'],
					},
				},
			},

			// Schema (for enrichment + batch)
			{
				displayName: 'Schema Name or ID',
				name: 'schemaId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getSchemas',
				},
				required: true,
				default: '',
				description: 'Target schema defining the enrichment output structure. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				hint: 'Don\'t have a schema? <a href="https://entityenricher.ai/workflow-editor" target="_blank">Create a schema in Entity Enricher</a>',
				displayOptions: {
					show: {
						resource: ['enrichment'],
						operation: ['enrichEntity', 'batchEnrich', 'enrichEntitySimple', 'batchEnrichSimple'],
					},
				},
			},

			// Models (multi-select for enrichment + batch)
			{
				displayName: 'Model Names or IDs',
				name: 'models',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getModels',
				},
				required: true,
				default: [],
				description: 'LLM models to use for enrichment. Select 2+ for multi-model fusion, or pick "Auto — best model" to let Entity Enricher use your organization\'s best-scoring model (single model, no fusion). Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
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
				description: 'Comma-separated attachment UUIDs (from a prior Add Attachment step) to use as source material for the enrichment. Can be combined with "Upload Input Binary Files". For Batch Enrich, attachments apply to every entity in the job.',
				displayOptions: {
					show: {
						resource: ['enrichment'],
						operation: ['enrichEntity', 'batchEnrich'],
					},
				},
			},

			// Upload input binaries as attachments (enrichment + batch)
			{
				displayName: 'Upload Input Binary Files',
				name: 'attachInputBinaries',
				type: 'boolean',
				default: false,
				description: 'Whether to upload the input item\'s binary files as attachments and use them as source material for this enrichment — no separate Add Attachment step needed. For Batch Enrich, files are gathered from all input items and apply to every entity in the job.',
				displayOptions: {
					show: {
						resource: ['enrichment'],
						operation: ['enrichEntity', 'batchEnrich', 'enrichEntitySimple', 'batchEnrichSimple'],
					},
				},
			},
			{
				displayName: 'Binary Fields to Upload',
				name: 'binaryPropertiesToAttach',
				type: 'string',
				default: '',
				placeholder: 'data, document',
				description: 'Comma-separated names of the binary properties to upload. Leave empty to upload every binary file on the item.',
				hint: 'The upstream node must pass binary data through to this node — on an Edit Fields node, enable "Include Other Input Fields" (otherwise it strips binary data)',
				displayOptions: {
					show: {
						resource: ['enrichment'],
						operation: ['enrichEntity', 'batchEnrich'],
						attachInputBinaries: [true],
					},
				},
			},
			{
				displayName: 'Delete Uploaded Attachments After Enrichment',
				name: 'deleteUploadedAttachments',
				type: 'boolean',
				default: true,
				description: 'Whether to delete the attachments this node uploaded once the enrichment finishes (cleanup, even on failure). Attachments referenced via "Attachment IDs" are never deleted.',
				displayOptions: {
					show: {
						resource: ['enrichment'],
						operation: ['enrichEntity', 'batchEnrich'],
						attachInputBinaries: [true],
					},
				},
			},

			// Schema ID (get schema details)
			{
				displayName: 'Schema Name or ID',
				name: 'schemaIdDetail',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getSchemas',
				},
				required: true,
				default: '',
				description: 'Schema to retrieve full details for. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				hint: 'Don\'t have a schema? <a href="https://entityenricher.ai/workflow-editor" target="_blank">Create a schema in Entity Enricher</a>',
				displayOptions: {
					show: {
						resource: ['schema'],
						operation: ['getSchemaDetails'],
					},
				},
			},

			// ─── Generate Sample Parameters ───

			{
				displayName: 'Entity Type',
				name: 'sampleEntityType',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. Pharmaceutical Company',
				description: 'What kind of entity to sample',
				displayOptions: { show: { resource: ['schema'], operation: ['generateSample'] } },
			},
			{
				displayName: 'Sample Count',
				name: 'sampleCount',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 20 },
				default: 1,
				description: 'How many samples of this entity type to generate in one job. The first defines the field set (full pipeline incl. determinism analysis) and names the instances for the remaining slots; the rest are fast parallel follow-up turns that keep the same fields and fill values for their named instance. Forced to 1 whenever Attachment IDs is set.',
				displayOptions: { show: { resource: ['schema'], operation: ['generateSample'] } },
			},
			{
				displayName: 'Typical Instances',
				name: 'typicalObjects',
				type: 'string',
				default: '',
				placeholder: 'e.g. Sanofi, Pfizer',
				description: 'Comma-separated concrete instances to anchor knowledge mode, up to Sample Count, one per generated sample in order — slots beyond the number given are named by the model itself, all in one pass so they stay distinct',
				displayOptions: { show: { resource: ['schema'], operation: ['generateSample'] } },
			},
			{
				displayName: 'Fields',
				name: 'sampleFields',
				type: 'string',
				default: '',
				placeholder: 'e.g. name, headquarters, revenue',
				description: 'Comma-separated field names the sample must include (the model may add others)',
				displayOptions: { show: { resource: ['schema'], operation: ['generateSample'] } },
			},
			{
				displayName: 'Naming Convention',
				name: 'namingConvention',
				type: 'options',
				options: [
					{ name: 'Auto', value: 'auto' },
					{ name: 'Snake_case', value: 'snake_case' },
					{ name: 'camelCase', value: 'camelCase' },
				],
				default: 'auto',
				displayOptions: { show: { resource: ['schema'], operation: ['generateSample'] } },
			},
			{
				displayName: 'Attachment IDs',
				name: 'sampleAttachmentIds',
				type: 'string',
				default: '',
				placeholder: 'e.g. 3fa85f64-..., 7c9e6679-...',
				description: 'Comma-separated attachment UUIDs (from Add Attachment). Switches into source mode: transcribe the document or describe visible photo attributes only. Forces Sample Count to 1.',
				displayOptions: { show: { resource: ['schema'], operation: ['generateSample'] } },
			},
			{
				displayName: 'Extra Instructions',
				name: 'sampleExtraInstructions',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description: 'Free-form guidance appended to the prompt',
				displayOptions: { show: { resource: ['schema'], operation: ['generateSample'] } },
			},
			{
				displayName: 'Enable Web Search',
				name: 'sampleEnableWebSearch',
				type: 'options',
				options: [
					{ name: 'Off', value: 'off' },
					{ name: 'On', value: 'on' },
				],
				default: 'off',
				description: 'Ground knowledge mode with the model\'s builtin web-search tool (ignored in source mode and for models without search support)',
				displayOptions: { show: { resource: ['schema'], operation: ['generateSample'] } },
			},
			{
				displayName: 'Language',
				name: 'sampleLanguage',
				type: 'string',
				default: 'auto',
				description: 'Output language code for field names AND values (e.g. \'en\', \'fr\'). \'auto\' (default) follows the language the Entity Type and Typical Objects are written in, else the attached document\'s, else English.',
				displayOptions: { show: { resource: ['schema'], operation: ['generateSample'] } },
			},
			{
				displayName: 'Model',
				name: 'sampleModel',
				type: 'string',
				default: 'auto',
				description: '\'auto\' (default) lets the server pick the org\'s default sample-generation model',
				displayOptions: { show: { resource: ['schema'], operation: ['generateSample'] } },
			},
			{
				displayName: 'Timeout (Ms)',
				name: 'sampleTimeout',
				type: 'number',
				default: 300000,
				description: 'Maximum time to wait for generation to complete',
				displayOptions: { show: { resource: ['schema'], operation: ['generateSample'] } },
			},

			// ─── Generate Schema Parameters ───

			{
				displayName: 'Every input item is one sample of the SAME entity type. The generated schema covers the union of their fields: a field missing or null in any item becomes nullable, and distinct observed values become the property examples. The schema is auto-saved to your organization.',
				name: 'generateSchemaNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { resource: ['schema'], operation: ['generateSchema'] } },
			},
			{
				displayName: 'Model',
				name: 'schemaGenModel',
				type: 'string',
				default: 'auto',
				description: '\'auto\' (default) lets the server pick the org\'s default schema-generation model',
				displayOptions: { show: { resource: ['schema'], operation: ['generateSchema'] } },
			},
			{
				displayName: 'Generate Semantic IDs',
				name: 'schemaGenSemanticIds',
				type: 'boolean',
				default: false,
				description: 'Whether to add a semantic_id property to every object with a key source (enables embedding-based entity resolution)',
				displayOptions: { show: { resource: ['schema'], operation: ['generateSchema'] } },
			},
			{
				displayName: 'Commonality Threshold',
				name: 'schemaGenCommonalityThreshold',
				type: 'number',
				typeOptions: { minValue: 0.05, maxValue: 1, numberPrecision: 2 },
				default: 0.5,
				description: 'Minimum share (0..1) of the combined field set every input item must cover — mixed entity types fail before any LLM call',
				displayOptions: { show: { resource: ['schema'], operation: ['generateSchema'] } },
			},
			{
				displayName: 'Language',
				name: 'schemaGenLanguage',
				type: 'string',
				default: '',
				description: 'Language the schema describes itself in — type names, descriptions, expertise labels (e.g. \'fr\'). Property names always come from the samples. Empty follows the language the sample\'s property names are written in.',
				displayOptions: { show: { resource: ['schema'], operation: ['generateSchema'] } },
			},
			{
				displayName: 'Timeout (Seconds)',
				name: 'schemaGenTimeout',
				type: 'number',
				typeOptions: { minValue: 10, maxValue: 900 },
				default: 300,
				description: 'Maximum time to wait for generation to complete',
				displayOptions: { show: { resource: ['schema'], operation: ['generateSchema'] } },
			},

			// Record ID (get record)
			{
				displayName: 'Record ID',
				name: 'recordId',
				type: 'string',
				required: true,
				default: '',
				description: 'UUID of the enrichment record to retrieve',
				hint: '={{$parameter["recordId"] ? \'<a href="https://entityenricher.ai/history/\' + $parameter["recordId"] + \'" target="_blank">View record in Entity Enricher</a>\' : \'Find record IDs in <a href="https://entityenricher.ai/history" target="_blank">Entity Enricher</a>\'}}',
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['getRecord'],
					},
				},
			},

			// ─── Attachment Parameters ───

			// Binary properties (add attachment)
			{
				displayName: 'Input Binary Fields',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Comma-separated names of the binary properties on the input item that hold the files to upload (one attachment is created per file, all sent in a single request). Leave empty to upload every binary file on the item.',
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
				description: 'Optional filename to use instead of the binary property\'s own file name. Only applies when uploading a single file. The extension matters — the server sniffs the format.',
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

			// ─── Sync Records to Database Parameters ───
			{
				displayName: 'Record ID',
				name: 'recordId',
				type: 'string',
				default: '',
				placeholder: '={{ $json.record_id }}',
				description: 'Stored record to send — an enrichment record or the fusion of one; any other record type is skipped. Leave empty to send a Structured Output that came from somewhere else (a Schema is then required).',
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['syncRecordsToDatabase'],
					},
				},
			},
			{
				displayName: 'Structured Output (JSON)',
				name: 'structuredOutput',
				type: 'json',
				default: '',
				description: 'Replacement output to send instead of the record\'s stored one — the transform round-trip. Leave empty to send the record unchanged. A modified output mints a NEW record, because records are immutable.',
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['syncRecordsToDatabase'],
					},
				},
			},
			{
				displayName: 'Schema Name or ID',
				name: 'savedSchemaId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getSchemas' },
				default: '',
				description: 'Schema whose published contract validates the output and whose linked databases receive it. Required only when no Record ID is given; otherwise the record\'s own schema is used. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['syncRecordsToDatabase'],
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
					{ name: 'Playground', value: 'playground' },
					{ name: 'Schema Edit', value: 'schema_edit' },
					{ name: 'Schema Generation', value: 'schema_generation' },
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
				displayName: 'Language Names or IDs',
				name: 'languages',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getLanguages',
				},
				default: ['en'],
				description: 'Languages for multilingual fields. At least one language must be selected. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: {
					show: {
						resource: ['enrichment'],
						operation: ['enrichEntity', 'batchEnrich', 'enrichEntitySimple', 'batchEnrichSimple'],
					},
				},
			},

			// Strategy
			{
				displayName: 'Strategy Name or ID',
				name: 'strategy',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getStrategies',
				},
				default: 'auto',
				description: 'Enrichment strategy. Auto (default) lets the server pick the best strategy from your schema shape; multi-expertise runs parallel calls per domain. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: {
					show: {
						resource: ['enrichment'],
						operation: ['enrichEntity', 'batchEnrich'],
					},
				},
			},

			// Classification Model (optional)
			{
				displayName: 'Classification Model Name or ID',
				name: 'classificationModel',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getClassificationModels',
				},
				default: '',
				description: 'Optional model for pre-flight entity type classification. Prevents hallucination on mismatched entities. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: {
					show: {
						resource: ['enrichment'],
						operation: ['enrichEntity', 'batchEnrich'],
					},
				},
			},

			// Arbitration Model (optional, for enrichment + fusion)
			{
				displayName: 'Arbitration Model Name or ID',
				name: 'arbitrationModel',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getArbitrationModels',
				},
				default: '',
				description: 'Model for LLM-based conflict resolution when merging multi-model results. Leave empty for rule-based merging. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: {
					show: {
						resource: ['enrichment', 'fusion'],
						operation: ['enrichEntity', 'batchEnrich', 'mergeResults'],
					},
				},
			},

			// Web Search (auto-disabled when no selected model supports it)
			{
				displayName: 'Web Search Name or ID',
				name: 'enableWebSearch',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getWebSearchOptions',
					loadOptionsDependsOn: ['models'],
				},
				default: 'off',
				description: 'Enable provider builtin web search for models that support it. Locked off when no selected model supports web search. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: {
					show: {
						resource: ['enrichment'],
						operation: ['enrichEntity', 'batchEnrich', 'enrichEntitySimple', 'batchEnrichSimple'],
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
						displayName: 'Response Schema Name or ID',
						name: 'enableResponseSchema',
						type: 'options',
						typeOptions: {
							loadOptionsMethod: 'getResponseSchemaOptions',
							loadOptionsDependsOn: ['models'],
						},
						default: 'on',
						description: 'Use the provider response-schema channel (NativeOutput) for models that support it. On by default; locked off when no selected model supports it. Capable models otherwise fall back to tool-call output. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
					// Strict Structured Output (auto-disabled when no selected model supports it)
					{
						displayName: 'Strict Structured Output Name or ID',
						name: 'enableStrictStructuredOutput',
						type: 'options',
						typeOptions: {
							loadOptionsMethod: 'getStrictStructuredOutputOptions',
							loadOptionsDependsOn: ['models'],
						},
						default: 'off',
						description: 'Constrain decoding to the schema (no drift) on whichever structured channel is used, for models that support it. Off by default; locked off when no selected model supports strict structured output. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
				],
			},

			// Timeout
			{
				displayName: 'Timeout (Ms)',
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
		usableAsTool: true,
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
				const baseUrl = await getBaseUrl(this);
				const response = await apiRequest(this, '/api/schema/saved') as { schemas: SavedSchema[] };
				const schemas = response.schemas;

				if (!schemas.length) {
					return [{
						name: 'No Schemas Found - Create a Schema in Entity Enricher',
						value: '',
						description: `${baseUrl}/workflow-editor`,
					}];
				}

				return schemas.map((s) => ({
					name: s.is_pinned ? `[Pinned] ${s.name}` : s.name,
					value: s.id,
					description: s.tags.length ? `Tags: ${s.tags.join(', ')}` : undefined,
				}));
			},

			async getModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const baseUrl = await getBaseUrl(this);
				const options = await apiRequest(
					this, '/api/enrichment/options',
				) as EnrichmentOptionsResponse;

				const available = options.models.filter(
					(m) => m.is_available && !m.processing_disabled?.enrichment,
				);

				// Benchmarked models first (highest overall enrichment score from the
				// org's scoring-source benchmarks); unscored models keep the API's
				// original order — mirrors the web app's model picker.
				const sorted = available
					.map((m, i) => ({ m, i, score: m.benchmark_scores?.enrichment?.overall ?? null }))
					.sort((a, b) => {
						if (a.score != null && b.score != null && a.score !== b.score) return b.score - a.score;
						if (a.score != null && b.score == null) return -1;
						if (a.score == null && b.score != null) return 1;
						return a.i - b.i;
					})
					.map((x) => x.m);

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

				// Auto entry — the server resolves 'auto' to the org's default model
				// (pinned per-task default, else best blended benchmark score). Only
				// offered when the API reports a resolvable default, since 'auto'
				// would otherwise be rejected with HTTP 400.
				const autoDefault = options.default_models?.enrichment;
				if (autoDefault) {
					modelOptions.push({
						name: `✨ Auto — best model (currently ${autoDefault.display_name ?? autoDefault.key})`,
						value: 'auto',
						description:
							"Let Entity Enricher pick your organization's best-scoring enrichment model. Resolves to a single model — no fusion.",
					});
				}

				modelOptions.push(...sorted.map((m) => {
					const scores = m.benchmark_scores?.enrichment;
					const descriptionParts: string[] = [];
					if (m.input_price != null && m.output_price != null) {
						descriptionParts.push(`in $${m.input_price.toFixed(2)}/out $${m.output_price.toFixed(2)}`);
					}
					const breakdown = formatScoreBreakdown(scores);
					if (breakdown) {
						descriptionParts.push(breakdown);
					}
					return {
						name: formatModelLabel(m, scores?.overall),
						value: m.key,
						description: descriptionParts.length ? descriptionParts.join(' · ') : undefined,
					};
				}));

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
				// The simple operations have no Models field (the server auto-picks
				// the model), so there is nothing to intersect capabilities with —
				// offer both choices; the backend applies web search only to models
				// that support it and silently ignores it otherwise.
				let operation = '';
				try {
					const rawOperation = this.getCurrentNodeParameter('operation');
					if (typeof rawOperation === 'string') operation = rawOperation;
				} catch {
					// Parameter not bound — treat as advanced
				}
				if (operation === 'enrichEntitySimple' || operation === 'batchEnrichSimple') {
					return [
						{ name: 'Off', value: 'off' },
						{
							name: 'On',
							value: 'on',
							description: 'Applied to the auto-selected model when it supports web search; ignored otherwise',
						},
					];
				}

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
							name: 'Off — No Selected Model Supports Web Search',
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
							name: 'Off — No Selected Model Supports Response Schema',
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
							name: 'Off — No Selected Model Supports Strict Structured Output',
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
		if (resource === 'databaseSync') {
			if (operation === 'listDatabaseSyncs') returnData = await listDatabaseSyncs.execute(this);
			else if (operation === 'fetchDeltas') returnData = await fetchDeltas.execute(this);
			else if (operation === 'ackDeltas') returnData = await ackDeltas.execute(this);
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

			// Fetch profile limits for metadata output (reuses the options endpoint).
			// The simple operations always run with clean output (no metadata), even
			// if a stale includeEnrichmentMetadata value lingers from an advanced
			// operation the node was previously configured with.
			const isSimpleOperation = operation === 'enrichEntitySimple' || operation === 'batchEnrichSimple';
			const includeMetadata = !isSimpleOperation
				&& (this.getNodeParameter('includeEnrichmentMetadata', 0, false) as boolean);
			if (includeMetadata) {
				const options = await apiRequest(this, '/api/enrichment/options') as EnrichmentOptionsResponse;
				profileLimits = extractProfileLimits(options);
			}
		}

		// Batch Enrich (simple or advanced) processes all items at once
		if (resource === 'enrichment' && (operation === 'batchEnrich' || operation === 'batchEnrichSimple')) {
			returnData = await batchEnrich.execute(this, searchKeys, profileLimits);
			return [returnData];
		}

		// Generate Schema consumes ALL input items as samples of one entity type
		if (resource === 'schema' && operation === 'generateSchema') {
			returnData = await generateSchema.execute(this);
			return [returnData];
		}

		// Process each input item
		for (let i = 0; i < items.length; i++) {
			try {
				let results: INodeExecutionData[] = [];

				if (resource === 'enrichment' && (operation === 'enrichEntity' || operation === 'enrichEntitySimple')) {
					results = await enrichEntity.execute(this, i, searchKeys, profileLimits);
				} else if (resource === 'record' && operation === 'getRecord') {
					results = await getRecord.execute(this, i);
				} else if (resource === 'schema' && operation === 'getSchemaDetails') {
					results = await getSchemaDetails.execute(this, i);
				} else if (resource === 'schema' && operation === 'generateSample') {
					results = await generateSample.execute(this, i);
				} else if (resource === 'attachment' && operation === 'addAttachment') {
					results = await addAttachment.execute(this, i);
				} else if (resource === 'attachment' && operation === 'deleteAttachment') {
					results = await deleteAttachment.execute(this, i);
				} else if (resource === 'fusion' && operation === 'mergeResults') {
					results = await mergeResults.execute(this, i);
				} else if (resource === 'record' && operation === 'syncRecordsToDatabase') {
					results = await syncRecordsToDatabase.execute(this, i);
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`Unknown operation: ${resource}/${operation}`,
						{ itemIndex: i },
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
					throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
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
 * Build the dropdown label for a model: display name + optional benchmark
 * badge + capability glyphs.
 *
 * When `overallScore` (0..1, the blended benchmark score from the org's
 * scoring-source scenarios) is provided, a "★ NN" badge follows the name.
 * Each capability the model declares contributes one emoji glyph (produced
 * by the Unicode escapes in MODEL_CAPABILITY_LABELS above). Capabilities
 * the model does not declare are omitted; a model with no advertised
 * capabilities renders just its display name.
 */
function formatModelLabel(m: LLMModelInfo, overallScore?: number | null): string {
	const badge = overallScore != null ? ` ★ ${Math.round(overallScore * 100)}` : '';
	const base = `${m.display_name ?? m.key}${badge}`;
	const caps = MODEL_CAPABILITY_LABELS
		.filter(({ key }) => Boolean(m[key]))
		.map(({ label }) => label);
	return caps.length === 0 ? base : `${base} · ${caps.join(' · ')}`;
}

type ModelTaskScores = NonNullable<LLMModelInfo['benchmark_scores']>[string];

/**
 * Quality/Speed/Cost breakdown for a model's benchmark scores, e.g.
 * "Quality 88 · Speed 90 · Cost 55 (2 scoring benchmarks)".
 *
 * Scores are 0..1 from the org's scoring-source benchmark scenarios
 * (speed/cost are peer-relative); rendered as 0-100. Returns null when the
 * model has no score for the task, and omits metrics without a value.
 */
function formatScoreBreakdown(scores: ModelTaskScores | null | undefined): string | null {
	if (!scores) return null;
	const parts: string[] = [];
	if (scores.quality != null) parts.push(`Quality ${Math.round(scores.quality * 100)}`);
	if (scores.speed != null) parts.push(`Speed ${Math.round(scores.speed * 100)}`);
	if (scores.cost != null) parts.push(`Cost ${Math.round(scores.cost * 100)}`);
	if (parts.length === 0) return null;
	const count = scores.scenario_count ?? 0;
	return `${parts.join(' · ')} (${count} scoring benchmark${count === 1 ? '' : 's'})`;
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
