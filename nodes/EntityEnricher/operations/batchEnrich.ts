import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { apiRequest } from '../helpers/api';
import { consumeSSEStream } from '../helpers/sse';
import type {
	JobStartResponse,
	ProfileLimits,
	SSEEvent,
	SseEntityCompleted,
	SseFusionCompleted,
} from '../helpers/types';
import { isEntityCompleted, isFusionCompleted } from '../helpers/types';
import { validateEntitySearchKeys } from '../helpers/validation';
import {
	deleteAttachmentsQuietly,
	resolveBinaryPropertyNames,
	uploadBinaries,
} from '../helpers/attachments';

/** Attachments this node uploaded from input binaries, for output metadata. */
interface UploadedAttachmentsInfo {
	ids: string[];
	deleted: boolean;
}

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
	profileLimits?: ProfileLimits | null,
): Promise<INodeExecutionData[]> {
	const items = context.getInputData();

	// Gather parameters from first item (batch-level config). The simple
	// operation (batchEnrichSimple) exposes only schema, binary upload,
	// languages and web search — every other value is pinned to its default
	// here rather than read, so stale values from a previous advanced
	// configuration can never leak in. The advanced operation keeps the
	// historical 'batchEnrich' value, so workflows saved before the split
	// keep their exact behavior.
	const operation = context.getNodeParameter('operation', 0) as string;
	const simpleMode = operation === 'batchEnrichSimple';
	const schemaId = context.getNodeParameter('schemaId', 0) as string;
	// 'auto' resolves server-side to the org's pinned per-task default model,
	// else its best benchmark-scored model (single model, no fusion).
	const models = simpleMode
		? ['auto']
		: context.getNodeParameter('models', 0) as string[];
	const languages = context.getNodeParameter('languages', 0) as string[];
	const strategy = simpleMode
		? 'auto'
		: context.getNodeParameter('strategy', 0) as string;
	const classificationModel = simpleMode ? '' : context.getNodeParameter(
		'classificationModel', 0, '',
	) as string;
	const arbitrationModel = simpleMode ? '' : context.getNodeParameter(
		'arbitrationModel', 0, '',
	) as string;
	const enableWebSearch = context.getNodeParameter(
		'enableWebSearch', 0, 'off',
	) as 'on' | 'off';
	// Structured-output controls live under the collapsed "Advanced Options" collection.
	const advancedOptions = simpleMode ? {} : context.getNodeParameter(
		'advancedOptions', 0, {},
	) as { enableResponseSchema?: 'on' | 'off'; enableStrictStructuredOutput?: 'on' | 'off' };
	const enableResponseSchema = advancedOptions.enableResponseSchema ?? 'on';
	const enableStrictStructuredOutput = advancedOptions.enableStrictStructuredOutput ?? 'off';
	const timeout = simpleMode
		? 300000
		: context.getNodeParameter('timeout', 0, 300000) as number;
	const includeEnrichmentMetadata = !simpleMode && (context.getNodeParameter(
		'includeEnrichmentMetadata', 0, false,
	) as boolean);
	const attachmentIds = simpleMode
		? []
		: (context.getNodeParameter('attachmentIds', 0, '') as string)
			.split(',').map((s) => s.trim()).filter(Boolean);
	const attachInputBinaries = context.getNodeParameter(
		'attachInputBinaries', 0, false,
	) as boolean;
	// Simple mode uploads every binary file on the items and always cleans up.
	const binaryPropertiesToAttach = simpleMode ? '' : context.getNodeParameter(
		'binaryPropertiesToAttach', 0, '',
	) as string;
	const deleteUploadedAttachments = simpleMode || (context.getNodeParameter(
		'deleteUploadedAttachments', 0, true,
	) as boolean);

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

	// Upload input binary files as attachments. Batch attachments are job-wide
	// (the backend feeds them to EVERY entity), so binaries are gathered across
	// all input items — one multipart request per item that carries files.
	const uploadedIds: string[] = [];
	if (attachInputBinaries) {
		for (let i = 0; i < items.length; i++) {
			const propertyNames = resolveBinaryPropertyNames(
				context, i, binaryPropertiesToAttach, { requireAll: false },
			);
			if (!propertyNames.length) continue;
			const uploaded = await uploadBinaries(context, i, propertyNames);
			uploadedIds.push(...uploaded.map((a) => a.id));
		}
		if (!uploadedIds.length) {
			throw new NodeOperationError(
				context.getNode(),
				'"Upload Input Binary Files" is enabled but no input item carries '
				+ (binaryPropertiesToAttach.trim()
					? `binary data in the configured properties (${binaryPropertiesToAttach}). `
					: 'any binary data. ')
				+ 'Connect a node that outputs files and make sure intermediate nodes pass '
				+ 'binary data through (on an Edit Fields node, enable "Include Other Input '
				+ 'Fields" — otherwise it strips binary data).',
			);
		}
	}
	const allAttachmentIds = [...new Set([...attachmentIds, ...uploadedIds])];

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
	if (allAttachmentIds.length) body.attachment_ids = allAttachmentIds;
	if (enableWebSearch === 'on') body.enable_web_search = true;
	// Send both booleans explicitly so an "off" choice is honoured regardless of
	// the backend default (response schema defaults on, strict defaults off).
	body.enable_response_schema = enableResponseSchema === 'on';
	body.enable_strict_structured_output = enableStrictStructuredOutput === 'on';

	// Start the job and consume its SSE stream; node-uploaded attachments are
	// cleaned up afterwards (when enabled) whether the batch succeeded or not.
	let events: SSEEvent[];
	try {
		let jobResponse: JobStartResponse;
		try {
			jobResponse = await apiRequest(context, '/api/batch/start', {
				method: 'POST',
				body,
			}) as JobStartResponse;
		} catch (error) {
			// The simple operation sends models: ['auto']; when the org has no
			// pinned default and no scoring-source benchmark, the server rejects
			// it — explain how to fix instead of surfacing the raw 400.
			if (simpleMode && (error as Error).message?.includes('auto-select')) {
				throw new NodeOperationError(
					context.getNode(),
					`${(error as Error).message} Alternatively, use the "Batch Enrich Advanced" operation and pick models explicitly.`,
				);
			}
			// Enhance error with search key context for 400 errors
			if (searchKeys?.length && (error as Error).message?.includes('400')) {
				const sampleKeys = Object.keys(entities[0] as Record<string, unknown>).join(', ');
				throw new NodeOperationError(
					context.getNode(),
					`${(error as Error).message}. Schema expects search keys: [${searchKeys.join(', ')}]. First entity has: [${sampleKeys}]`,
				);
			}
			throw error;
		}

		// Consume SSE stream
		events = await consumeSSEStream(context, jobResponse.job_id, timeout);
	} finally {
		if (deleteUploadedAttachments && uploadedIds.length) {
			await deleteAttachmentsQuietly(context, uploadedIds);
		}
	}

	// Extract entity_completed events and build output items
	return buildBatchOutputItems(
		events, items.length, includeEnrichmentMetadata, profileLimits,
		uploadedIds.length
			? { ids: uploadedIds, deleted: deleteUploadedAttachments }
			: undefined,
	);
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
	profileLimits?: ProfileLimits | null,
	uploadedAttachments?: UploadedAttachmentsInfo,
): INodeExecutionData[] {
	// Job-wide (batch attachments feed every entity), repeated on each metadata item.
	const uploadedMetadata = uploadedAttachments
		? {
			uploaded_attachment_ids: uploadedAttachments.ids,
			uploaded_attachments_deleted: uploadedAttachments.deleted,
		}
		: {};
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
						...uploadedMetadata,
						...(profileLimits ? { profile_limits: profileLimits } : {}),
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
