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
import type { EnrichmentOptionsResponse, SavedSchema } from './helpers/types';
import { extractSearchKeys } from './helpers/validation';
import * as batchEnrich from './operations/batchEnrich';
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
		documentationUrl: 'https://entityenricher.ai/docs',
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Agents & Tools'],
			},
			alias: ['enrichment', 'llm', 'data enrichment', 'multi-model', 'fusion'],
			resources: {
				primaryDocumentation: [
					{ url: 'https://entityenricher.ai/docs' },
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
				description: 'Languages for multilingual fields. English is always included.',
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
					loadOptionsMethod: 'getModelsOptional',
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
					loadOptionsMethod: 'getModelsOptional',
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

			// Timeout
			{
				displayName: 'Timeout (ms)',
				name: 'timeout',
				type: 'number',
				default: 300000,
				description: 'Maximum time to wait for enrichment completion (in milliseconds)',
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
		],
	};

	methods = {
		loadOptions: {
			async getSchemas(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('entityEnricherApi');
				const baseUrl = (credentials.baseUrl as string).replace(/\/$/, '');
				const response = await apiRequest(this, '/api/schema/saved') as { schemas: SavedSchema[] };
				const schemas = response.schemas;

				if (!schemas.length) {
					return [{
						name: '⚠ No schemas found — create one in Schema Editor',
						value: '',
						description: `${baseUrl}/schema-editor`,
					}];
				}

				return schemas.map((s) => ({
					name: s.is_pinned ? `\u2B50 ${s.name}` : s.name,
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

				const available = options.models.filter((m) => m.is_available);

				const modelOptions: INodePropertyOptions[] = available.map((m) => ({
					name: m.display_name ?? m.key,
					value: m.key,
					description: m.input_price != null && m.output_price != null
						? `$${m.input_price}/${m.output_price} per M tokens`
						: undefined,
				}));

				modelOptions.push({
					name: '➕ Add more models (manage API keys)',
					value: '',
					description: `${baseUrl}/api-keys/ai-provider`,
				});

				return modelOptions;
			},

			async getModelsOptional(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const options = await apiRequest(
					this, '/api/enrichment/options',
				) as EnrichmentOptionsResponse;

				return [
					{ name: '(None)', value: '' },
					...options.models
						.filter((m) => m.is_available)
						.map((m) => ({
							name: m.display_name ?? m.key,
							value: m.key,
						})),
				];
			},

			async getLanguages(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const options = await apiRequest(
					this, '/api/enrichment/options',
				) as EnrichmentOptionsResponse;

				return Object.entries(options.languages).map(([code, name]) => ({
					name: `${name} (${code})`,
					value: code,
				}));
			},

			async getStrategies(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const options = await apiRequest(
					this, '/api/enrichment/options',
				) as EnrichmentOptionsResponse;

				return options.strategies.map((s) => ({
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

		// Pre-fetch search keys for enrichment operations (once per execution, not per item)
		let searchKeys: string[] | undefined;
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
		}

		// Batch Enrich processes all items at once
		if (resource === 'enrichment' && operation === 'batchEnrich') {
			returnData = await batchEnrich.execute(this, searchKeys);
			return [returnData];
		}

		// Process each input item
		for (let i = 0; i < items.length; i++) {
			try {
				let results: INodeExecutionData[] = [];

				if (resource === 'enrichment' && operation === 'enrichEntity') {
					results = await enrichEntity.execute(this, i, searchKeys);
				} else if (resource === 'record' && operation === 'getRecord') {
					results = await getRecord.execute(this, i);
				} else if (resource === 'schema' && operation === 'getSchemaDetails') {
					results = await getSchemaDetails.execute(this, i);
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
