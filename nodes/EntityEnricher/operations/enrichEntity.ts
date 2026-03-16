import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { apiRequest, getCredentialValues } from '../helpers/api';
import { consumeSSEStream } from '../helpers/sse';
import type {
	JobStartResponse,
	SSEEvent,
	SseModelCompleted,
	SseFusionCompleted,
} from '../helpers/types';
import { isModelCompleted, isFusionCompleted } from '../helpers/types';
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
	const includeEnrichmentMetadata = context.getNodeParameter(
		'includeEnrichmentMetadata', itemIndex, false,
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
	return buildOutputItems(events, itemIndex, includePerModelResults, includeEnrichmentMetadata);
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
	includeEnrichmentMetadata: boolean,
): INodeExecutionData[] {
	const modelResults: SseModelCompleted[] = [];
	let fusionResult: SseFusionCompleted | null = null;

	for (const event of events) {
		if (isModelCompleted(event)) {
			modelResults.push(event);
		} else if (isFusionCompleted(event)) {
			fusionResult = event;
		}
	}

	const outputItems: INodeExecutionData[] = [];

	// Primary output: fused result or best single model result
	if (fusionResult?.success && fusionResult.merged_result) {
		const { _arbitration_metadata, ...resultData } = fusionResult.merged_result as IDataObject;
		outputItems.push({
			json: includeEnrichmentMetadata
				? {
					result: fusionResult.merged_result as IDataObject,
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
				}
				: { ...resultData },
			pairedItem: itemIndex,
		});
	} else if (modelResults.length > 0) {
		// No fusion or fusion failed — return the first successful model result
		const best = modelResults.find((r) => r.success) ?? modelResults[0];
		const result = best.result as IDataObject;
		outputItems.push({
			json: includeEnrichmentMetadata
				? {
					result,
					record_id: best.record_id,
					model: best.model,
					success: best.success,
					is_fused: false,
					cost_usd: best.cost_usd,
					input_tokens: best.input_tokens,
					output_tokens: best.output_tokens,
					processing_time_ms: best.processing_time_ms,
					error_message: best.error_message,
					...(fusionResult && !fusionResult.success ? {
						fusion_error: fusionResult.error_message ?? 'Fusion failed',
					} : {}),
				}
				: { ...result },
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

function sumCosts(results: SseModelCompleted[]): number {
	return results.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);
}

function sumTokens(
	results: SseModelCompleted[],
	field: 'input_tokens' | 'output_tokens',
): number {
	return results.reduce((sum, r) => sum + (r[field] ?? 0), 0);
}
