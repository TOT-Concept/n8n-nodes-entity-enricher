import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { apiRequest } from '../helpers/api';

/** Response of POST /api/schema/generate/sync (GenerateSchemaResponse). */
interface GenerateSchemaSyncResponse {
	model: string;
	success: boolean;
	schema?: IDataObject;
	suggestions?: string[];
	sample_property_count?: number;
	expertise_count?: number;
	record_id?: string;
	schema_id?: string;
	cost_usd?: number;
	input_tokens?: number;
	output_tokens?: number;
	processing_time_ms?: number;
}

/**
 * Generate a JSON schema from the input items via the blocking sync endpoint.
 *
 * Runs ONCE for the whole input: every input item is one sample of the SAME
 * entity type (multi-sample generation — the schema covers the union of their
 * fields, a field missing/null in any item becomes nullable, and distinct
 * observed values seed the property examples). Items whose field sets diverge
 * below the commonality threshold fail with HTTP 400 before any LLM call.
 */
export async function execute(
	context: IExecuteFunctions,
): Promise<INodeExecutionData[]> {
	const items = context.getInputData();
	const entitySamples = items
		.map((item) => item.json)
		.filter((json) => json && Object.keys(json).length > 0);
	if (!entitySamples.length) {
		throw new NodeOperationError(
			context.getNode(),
			'No sample data: connect a previous node that provides one or more sample objects of the same entity type.',
		);
	}

	const model = context.getNodeParameter('schemaGenModel', 0, 'auto') as string;
	const generateSemanticIds = context.getNodeParameter(
		'schemaGenSemanticIds', 0, false,
	) as boolean;
	const commonalityThreshold = context.getNodeParameter(
		'schemaGenCommonalityThreshold', 0, 0.5,
	) as number;
	const language = context.getNodeParameter('schemaGenLanguage', 0, '') as string;
	const timeoutSeconds = context.getNodeParameter('schemaGenTimeout', 0, 300) as number;

	const body: Record<string, unknown> = {
		entity_samples: entitySamples,
		model,
		generate_semantic_ids: generateSemanticIds,
		sample_commonality_threshold: commonalityThreshold,
		timeout_seconds: timeoutSeconds,
	};
	if (language) body.language = language;

	const response = await apiRequest(context, '/api/schema/generate/sync', {
		method: 'POST',
		body,
	}) as GenerateSchemaSyncResponse;

	return [{
		json: {
			success: response.success,
			schema_id: response.schema_id,
			schema: response.schema,
			suggestions: response.suggestions,
			sample_property_count: response.sample_property_count,
			expertise_count: response.expertise_count,
			samples_used: entitySamples.length,
			record_id: response.record_id,
			model: response.model,
			cost_usd: response.cost_usd,
			input_tokens: response.input_tokens,
			output_tokens: response.output_tokens,
			processing_time_ms: response.processing_time_ms,
		},
		pairedItem: 0,
	}];
}
