import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { apiRequest } from '../helpers/api';
import { consumeSSEStream } from '../helpers/sse';
import type {
	JobStartResponse,
	ProfileLimits,
	SSEEvent,
	SseModelCompleted,
	SseFusionCompleted,
} from '../helpers/types';
import { isModelCompleted, isFusionCompleted } from '../helpers/types';
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
	profileLimits?: ProfileLimits | null,
): Promise<INodeExecutionData[]> {
	// Gather parameters. The simple operation (enrichEntitySimple, the default)
	// exposes only schema, binary upload, languages and web search — every
	// other value is pinned to its default here rather than read, so stale
	// values from a previous advanced configuration can never leak in. The
	// advanced operation keeps the historical 'enrichEntity' value, so
	// workflows saved before the split keep their exact behavior.
	const operation = context.getNodeParameter('operation', itemIndex) as string;
	const simpleMode = operation === 'enrichEntitySimple';
	const schemaId = context.getNodeParameter('schemaId', itemIndex) as string;
	// 'auto' resolves server-side to the org's pinned per-task default model,
	// else its best benchmark-scored model (single model, no fusion).
	const models = simpleMode
		? ['auto']
		: context.getNodeParameter('models', itemIndex) as string[];
	const languages = context.getNodeParameter('languages', itemIndex) as string[];
	const strategy = simpleMode
		? 'auto'
		: context.getNodeParameter('strategy', itemIndex) as string;
	const classificationModel = simpleMode ? '' : context.getNodeParameter(
		'classificationModel', itemIndex, '',
	) as string;
	const arbitrationModel = simpleMode ? '' : context.getNodeParameter(
		'arbitrationModel', itemIndex, '',
	) as string;
	const enableWebSearch = context.getNodeParameter(
		'enableWebSearch', itemIndex, 'off',
	) as 'on' | 'off';
	// Structured-output controls live under the collapsed "Advanced Options" collection.
	const advancedOptions = simpleMode ? {} : context.getNodeParameter(
		'advancedOptions', itemIndex, {},
	) as { enableResponseSchema?: 'on' | 'off'; enableStrictStructuredOutput?: 'on' | 'off' };
	const enableResponseSchema = advancedOptions.enableResponseSchema ?? 'on';
	const enableStrictStructuredOutput = advancedOptions.enableStrictStructuredOutput ?? 'off';
	const timeout = simpleMode
		? 300000
		: context.getNodeParameter('timeout', itemIndex, 300000) as number;
	const includePerModelResults = !simpleMode && (context.getNodeParameter(
		'includePerModelResults', itemIndex, false,
	) as boolean);
	const includeEnrichmentMetadata = !simpleMode && (context.getNodeParameter(
		'includeEnrichmentMetadata', itemIndex, false,
	) as boolean);
	const attachmentIds = simpleMode
		? []
		: (context.getNodeParameter('attachmentIds', itemIndex, '') as string)
			.split(',').map((s) => s.trim()).filter(Boolean);
	const attachInputBinaries = context.getNodeParameter(
		'attachInputBinaries', itemIndex, false,
	) as boolean;
	// Simple mode uploads every binary file on the item and always cleans up.
	const binaryPropertiesToAttach = simpleMode ? '' : context.getNodeParameter(
		'binaryPropertiesToAttach', itemIndex, '',
	) as string;
	const deleteUploadedAttachments = simpleMode || (context.getNodeParameter(
		'deleteUploadedAttachments', itemIndex, true,
	) as boolean);

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

	// Upload input binary files as attachments (merged node: no separate
	// Add Attachment step needed). One multipart request carries all files.
	const uploadedIds: string[] = [];
	if (attachInputBinaries) {
		const propertyNames = resolveBinaryPropertyNames(
			context, itemIndex, binaryPropertiesToAttach, { requireAll: true },
		);
		if (!propertyNames.length) {
			throw new NodeOperationError(
				context.getNode(),
				'"Upload Input Binary Files" is enabled but the input item has no binary data. '
				+ 'Connect a node that outputs a file and make sure intermediate nodes pass '
				+ 'binary data through (on an Edit Fields node, enable "Include Other Input '
				+ 'Fields" — otherwise it strips binary data).',
				{ itemIndex },
			);
		}
		const uploaded = await uploadBinaries(context, itemIndex, propertyNames);
		uploadedIds.push(...uploaded.map((a) => a.id));
	}
	const allAttachmentIds = [...new Set([...attachmentIds, ...uploadedIds])];

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
	if (allAttachmentIds.length) body.attachment_ids = allAttachmentIds;
	if (enableWebSearch === 'on') body.enable_web_search = true;
	// Send both booleans explicitly so an "off" choice is honoured regardless of
	// the backend default (response schema defaults on, strict defaults off).
	body.enable_response_schema = enableResponseSchema === 'on';
	body.enable_strict_structured_output = enableStrictStructuredOutput === 'on';

	// Start the job and consume its SSE stream; node-uploaded attachments are
	// cleaned up afterwards (when enabled) whether the enrichment succeeded or not.
	let events: SSEEvent[];
	try {
		let jobResponse: JobStartResponse;
		try {
			jobResponse = await apiRequest(context, '/api/single/enrich/stream', {
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
					`${(error as Error).message} Alternatively, use the "Enrich Entity Advanced" operation and pick models explicitly.`,
					{ itemIndex },
				);
			}
			// Enhance error with search key context for 400 errors
			if (searchKeys?.length && (error as Error).message?.includes('400')) {
				const inputKeys = Object.keys(parsedEntityData).join(', ');
				throw new NodeOperationError(
					context.getNode(),
					`${(error as Error).message}. Schema expects search keys: [${searchKeys.join(', ')}]. Input has: [${inputKeys}]`,
					{ itemIndex },
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

	// Extract results from events
	return buildOutputItems(
		events, itemIndex, includePerModelResults, includeEnrichmentMetadata, profileLimits,
		uploadedIds.length
			? { ids: uploadedIds, deleted: deleteUploadedAttachments }
			: undefined,
	);
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
	profileLimits?: ProfileLimits | null,
	uploadedAttachments?: UploadedAttachmentsInfo,
): INodeExecutionData[] {
	const uploadedMetadata = uploadedAttachments
		? {
			uploaded_attachment_ids: uploadedAttachments.ids,
			uploaded_attachments_deleted: uploadedAttachments.deleted,
		}
		: {};
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
					...uploadedMetadata,
					...(profileLimits ? { profile_limits: profileLimits } : {}),
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
					...uploadedMetadata,
					...(profileLimits ? { profile_limits: profileLimits } : {}),
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
