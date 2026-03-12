import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { apiRequest, getCredentialValues } from '../helpers/api';
import { consumeSSEStream } from '../helpers/sse';
import type {
	JobStartResponse,
	SSEEvent,
	SingleEnrichmentResult,
	FusionResult,
} from '../helpers/types';
import { validateEntitySearchKeys } from '../helpers/validation';

/**
 * Enrich a single entity via SSE streaming.
 *
 * Flow:
 * 1. POST /api/single/enrich/stream → get job_id
 * 2. Consume SSE stream until completion
 * 3. Extract final result (fused if multi-model, otherwise last model_completed)
 */
export async function execute(
	context: IExecuteFunctions,
	itemIndex: number,
	searchKeys?: string[],
): Promise<INodeExecutionData[]> {
	// Gather parameters
	const schemaId = context.getNodeParameter('schemaId', itemIndex) as string;
	const models = context.getNodeParameter('models', itemIndex) as string[];
	const languages = context.getNodeParameter('languages', itemIndex) as string[];
	const strategy = context.getNodeParameter('strategy', itemIndex) as string;
	const classificationModel = context.getNodeParameter(
		'classificationModel', itemIndex, '',
	) as string;
	const arbitrationModel = context.getNodeParameter(
		'arbitrationModel', itemIndex, '',
	) as string;
	const timeout = context.getNodeParameter('timeout', itemIndex, 300000) as number;
	const includePerModelResults = context.getNodeParameter(
		'includePerModelResults', itemIndex, false,
	) as boolean;

	// Entity data comes from input item JSON
	const inputItem = context.getInputData()[itemIndex];
	if (!inputItem?.json || Object.keys(inputItem.json).length === 0) {
		throw new NodeOperationError(
			context.getNode(),
			'No entity data: the input item is empty. Connect a previous node that provides entity data.',
			{ itemIndex },
		);
	}
	const parsedEntityData = inputItem.json as Record<string, unknown>;

	if (!schemaId) {
		throw new NodeOperationError(context.getNode(), 'Schema is required', { itemIndex });
	}
	if (!models.length) {
		throw new NodeOperationError(context.getNode(), 'At least one model is required', { itemIndex });
	}

	// Validate input has at least one search key from the schema (case-insensitive, supports nested paths)
	if (searchKeys && searchKeys.length > 0) {
		const error = validateEntitySearchKeys(parsedEntityData, searchKeys);
		if (error) {
			throw new NodeOperationError(context.getNode(), error, { itemIndex });
		}
	}

	// Build request body
	const body: Record<string, unknown> = {
		entity_data: parsedEntityData,
		schema_id: schemaId,
		models,
		languages: languages.length ? languages : ['en'],
		strategy,
	};
	if (classificationModel) body.classification_model = classificationModel;
	if (arbitrationModel) body.arbitration_model = arbitrationModel;

	// Start enrichment job
	const jobResponse = await apiRequest(context, '/api/single/enrich/stream', {
		method: 'POST',
		body,
	}) as JobStartResponse;

	// Consume SSE stream
	const { baseUrl, apiKey } = await getCredentialValues(context);
	const events = await consumeSSEStream(baseUrl, apiKey, jobResponse.job_id, timeout);

	// Extract results from events
	return buildOutputItems(events, itemIndex, includePerModelResults);
}

/**
 * Extract the final enrichment output from SSE events.
 *
 * Priority: fusion_completed > model_completed events.
 * If includePerModelResults is true, also include individual model results.
 */
function buildOutputItems(
	events: SSEEvent[],
	itemIndex: number,
	includePerModelResults: boolean,
): INodeExecutionData[] {
	const modelResults: SingleEnrichmentResult[] = [];
	let fusionResult: FusionResult | null = null;

	for (const event of events) {
		if (event.event === 'model_completed') {
			modelResults.push(event as unknown as SingleEnrichmentResult);
		} else if (event.event === 'fusion_completed') {
			fusionResult = event as unknown as FusionResult;
		} else if (event.event === 'error') {
			// If the stream ended with an error, still try to return partial results
		}
	}

	const outputItems: INodeExecutionData[] = [];

	// Primary output: fused result or best single model result
	if (fusionResult?.success && fusionResult.merged_result) {
		outputItems.push({
			json: {
				result: fusionResult.merged_result,
				record_id: fusionResult.record_id,
				success: true,
				is_fused: true,
				cost_usd: fusionResult.cost_usd ?? sumCosts(modelResults),
				input_tokens: fusionResult.input_tokens ?? sumTokens(modelResults, 'input_tokens'),
				output_tokens: fusionResult.output_tokens ?? sumTokens(modelResults, 'output_tokens'),
				fusion: fusionResult.conflict_report
					? {
						agreed_fields: fusionResult.conflict_report.agreed_fields,
						conflicted_fields: fusionResult.conflict_report.conflicted_fields,
						total_fields: fusionResult.conflict_report.total_fields,
					}
					: null,
				source_models: modelResults.map((r) => r.model),
			},
			pairedItem: itemIndex,
		});
	} else if (modelResults.length > 0) {
		// No fusion — return the first successful model result
		const best = modelResults.find((r) => r.success) ?? modelResults[0];
		outputItems.push({
			json: {
				result: best.result,
				record_id: best.record_id,
				model: best.model,
				success: best.success,
				is_fused: false,
				cost_usd: best.cost_usd,
				input_tokens: best.input_tokens,
				output_tokens: best.output_tokens,
				processing_time_ms: best.processing_time_ms,
				error_message: best.error_message,
			},
			pairedItem: itemIndex,
		});
	} else {
		// No results at all
		outputItems.push({
			json: {
				success: false,
				error_message: 'No enrichment results received',
				result: null,
			},
			pairedItem: itemIndex,
		});
	}

	// Optional: per-model results
	if (includePerModelResults && modelResults.length > 0) {
		for (const result of modelResults) {
			outputItems.push({
				json: {
					_type: 'per_model_result',
					model: result.model,
					success: result.success,
					partial_success: result.partial_success,
					result: result.result,
					record_id: result.record_id,
					cost_usd: result.cost_usd,
					input_tokens: result.input_tokens,
					output_tokens: result.output_tokens,
					processing_time_ms: result.processing_time_ms,
					error_message: result.error_message,
					expertise_breakdown: result.expertise_breakdown,
				},
				pairedItem: itemIndex,
			});
		}
	}

	return outputItems;
}

function sumCosts(results: SingleEnrichmentResult[]): number {
	return results.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);
}

function sumTokens(
	results: SingleEnrichmentResult[],
	field: 'input_tokens' | 'output_tokens',
): number {
	return results.reduce((sum, r) => sum + (r[field] ?? 0), 0);
}

