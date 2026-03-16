import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { apiRequest, getCredentialValues } from '../helpers/api';
import { consumeSSEStream } from '../helpers/sse';
import type {
	JobStartResponse,
	SSEEvent,
	SseEntityCompleted,
	SseFusionCompleted,
} from '../helpers/types';
import { isEntityCompleted, isFusionCompleted } from '../helpers/types';
import { validateEntitySearchKeys } from '../helpers/validation';

/**
 * Batch enrich multiple entities via SSE streaming.
 *
 * All input n8n items are grouped into a single batch API call.
 * Output: one n8n item per entity with enrichment results.
 *
 * Flow:
 * 1. Collect all input items as entities array
 * 2. POST /api/batch/start → get job_id
 * 3. Consume SSE stream, collecting entity_completed events
 * 4. Return one output item per entity
 */
export async function execute(
	context: IExecuteFunctions,
	searchKeys?: string[],
): Promise<INodeExecutionData[]> {
	const items = context.getInputData();

	// Gather parameters from first item (batch-level config)
	const schemaId = context.getNodeParameter('schemaId', 0) as string;
	const models = context.getNodeParameter('models', 0) as string[];
	const languages = context.getNodeParameter('languages', 0) as string[];
	const strategy = context.getNodeParameter('strategy', 0) as string;
	const classificationModel = context.getNodeParameter(
		'classificationModel', 0, '',
	) as string;
	const arbitrationModel = context.getNodeParameter(
		'arbitrationModel', 0, '',
	) as string;
	const timeout = context.getNodeParameter('timeout', 0, 300000) as number;
	const includeEnrichmentMetadata = context.getNodeParameter(
		'includeEnrichmentMetadata', 0, false,
	) as boolean;

	if (!schemaId) {
		throw new NodeOperationError(context.getNode(), 'Schema is required');
	}
	if (!models.length) {
		throw new NodeOperationError(context.getNode(), 'At least one model is required');
	}

	// Collect entities from input items
	const entities = items.map((item) => item.json);
	if (!entities.length) {
		throw new NodeOperationError(context.getNode(), 'No input entities provided');
	}

	// Validate each entity has at least one search key from the schema
	if (searchKeys && searchKeys.length > 0) {
		for (let i = 0; i < entities.length; i++) {
			const error = validateEntitySearchKeys(
				entities[i] as Record<string, unknown>,
				searchKeys,
			);
			if (error) {
				throw new NodeOperationError(
					context.getNode(),
					`Entity at index ${i}: ${error}`,
				);
			}
		}
	}

	// Build request body
	const body: Record<string, unknown> = {
		entities,
		schema_id: schemaId,
		models,
		languages: languages.length ? languages : ['en'],
		strategy,
	};
	if (classificationModel) body.classification_model = classificationModel;
	if (arbitrationModel) body.arbitration_model = arbitrationModel;

	// Start batch job
	const jobResponse = await apiRequest(context, '/api/batch/start', {
		method: 'POST',
		body,
	}) as JobStartResponse;

	// Consume SSE stream
	const { baseUrl, apiKey } = await getCredentialValues(context);
	const events = await consumeSSEStream(baseUrl, apiKey, jobResponse.job_id, timeout);

	// Extract entity_completed events and build output items
	return buildBatchOutputItems(events, items.length, includeEnrichmentMetadata);
}

/**
 * Extract entity results from SSE events.
 * Returns one output item per entity, ordered by entity_index.
 *
 * Fusion results arrive as separate fusion_completed events (with entity_index),
 * so we correlate them with entity_completed events.
 */
function buildBatchOutputItems(
	events: SSEEvent[],
	inputCount: number,
	includeEnrichmentMetadata: boolean,
): INodeExecutionData[] {
	// Collect entity_completed events indexed by entity_index
	const entityResults = new Map<number, SseEntityCompleted>();
	// Collect fusion_completed events indexed by entity_index
	const fusionResults = new Map<number, SseFusionCompleted>();

	for (const event of events) {
		if (isEntityCompleted(event)) {
			entityResults.set(event.entity_index, event);
		} else if (isFusionCompleted(event) && event.entity_index != null) {
			fusionResults.set(event.entity_index, event);
		}
	}

	const outputItems: INodeExecutionData[] = [];

	for (let i = 0; i < inputCount; i++) {
		const entityEvent = entityResults.get(i);

		if (entityEvent) {
			// Determine best result: fused > first successful model
			const fusionResult = fusionResults.get(i);
			const bestModelResult = entityEvent.results?.find((r) => r.success)
				?? entityEvent.results?.[0];

			const fullResult = fusionResult?.success
				? fusionResult.merged_result as IDataObject
				: (bestModelResult?.result as IDataObject) ?? null;
			const { _arbitration_metadata, ...resultData } = (fullResult ?? {}) as IDataObject;

			outputItems.push({
				json: includeEnrichmentMetadata
					? {
						entity_index: i,
						entity_label: entityEvent.entity_label,
						success: entityEvent.success,
						result: fullResult,
						is_fused: !!fusionResult?.success,
						record_ids: entityEvent.results
							?.filter((r) => r.record_id)
							.map((r) => r.record_id) ?? [],
						total_cost_usd: entityEvent.total_cost_usd,
						total_processing_time_ms: entityEvent.total_processing_time_ms,
						model_results: entityEvent.results?.map((r) => ({
							model: r.model,
							success: r.success,
							record_id: r.record_id,
							cost_usd: r.cost_usd,
						})) ?? [],
						fusion: fusionResult?.conflict_report
							? {
								agreed_fields: fusionResult.conflict_report.agreed_fields,
								conflicted_fields: fusionResult.conflict_report.conflicted_fields,
							}
							: null,
						...(fusionResult && !fusionResult.success ? {
							fusion_error: fusionResult.error_message ?? 'Fusion failed',
						} : {}),
					}
					: { ...resultData },
				pairedItem: i,
			});
		} else {
			// No result for this entity
			outputItems.push({
				json: {
					entity_index: i,
					success: false,
					result: null,
					error_message: 'No result received for this entity',
				},
				pairedItem: i,
			});
		}
	}

	return outputItems;
}
