import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { apiRequest } from '../helpers/api';
import { consumeSSEStream } from '../helpers/sse';
import type { JobStartResponse, SSEEvent } from '../helpers/types';
import type { SseJobFailed, SseSampleGenerationJobCompleted } from '../helpers/generated/schema';

function isSampleJobCompleted(e: SSEEvent): e is SseSampleGenerationJobCompleted {
	return e.event === 'completed' && e.job_type === 'sample_generation';
}

function isJobFailed(e: SSEEvent): e is SseJobFailed {
	return e.event === 'failed';
}

/**
 * Generate 1..N samples for one free-text request via SSE streaming — the
 * entry point of the schema-authoring loop (see docs/SCHEMA_FLOW.md).
 *
 * Flow:
 * 1. POST /api/schema/sample/generate/stream → get job_id
 * 2. Consume SSE stream until completion (auto_answer=true — n8n is
 *    non-interactive, so the generator resolves an ambiguous request itself
 *    and any attachment-planner clarification questions resolve to the
 *    planner's defaults rather than pausing)
 * 3. Emit one output item per generated sample
 */
export async function execute(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const request = (context.getNodeParameter('sampleRequest', itemIndex, '') as string).trim();
	const sampleCount = context.getNodeParameter('sampleCount', itemIndex, 1) as number;
	const typicalObjects = (context.getNodeParameter('typicalObjects', itemIndex, '') as string)
		.split(',').map((s) => s.trim()).filter(Boolean);
	const namingConvention = context.getNodeParameter(
		'namingConvention', itemIndex, 'auto',
	) as string;
	const attachmentIds = (context.getNodeParameter('sampleAttachmentIds', itemIndex, '') as string)
		.split(',').map((s) => s.trim()).filter(Boolean);
	const enableWebSearch = context.getNodeParameter(
		'sampleEnableWebSearch', itemIndex, 'off',
	) as 'on' | 'off';
	const language = context.getNodeParameter('sampleLanguage', itemIndex, 'auto') as string;
	const model = context.getNodeParameter('sampleModel', itemIndex, 'auto') as string;
	const timeout = context.getNodeParameter('sampleTimeout', itemIndex, 300000) as number;

	if (!request && !attachmentIds.length) {
		throw new NodeOperationError(
			context.getNode(),
			'Request is required unless Attachment IDs is set — describe what the sample should contain',
			{ itemIndex },
		);
	}
	if (attachmentIds.length && sampleCount > 1) {
		throw new NodeOperationError(
			context.getNode(),
			'Sample Count is forced to 1 whenever Attachment IDs is set — generation is '
			+ 'grounded in one source document, so multiple typical instances don\'t apply.',
			{ itemIndex },
		);
	}

	const body: Record<string, unknown> = {
		request,
		sample_count: sampleCount,
		model,
		naming_convention: namingConvention,
		auto_answer: true,
	};
	// 'auto' (or blank) travels as an omitted field — the API's own "no language
	// requested" value, which is what lets the generator read the language off the
	// request and the schema follow the sample.
	if (language && language.trim().toLowerCase() !== 'auto') body.language = language.trim();
	if (typicalObjects.length) body.typical_objects = typicalObjects;
	if (attachmentIds.length) body.attachment_ids = attachmentIds;
	if (enableWebSearch === 'on') body.enable_web_search = true;

	const jobResponse = await apiRequest(context, '/api/schema/sample/generate/stream', {
		method: 'POST',
		body,
	}) as JobStartResponse;

	const events = await consumeSSEStream(context, jobResponse.job_id, timeout);
	return buildOutputItems(events, itemIndex, sampleCount);
}

function buildOutputItems(
	events: SSEEvent[],
	itemIndex: number,
	sampleCountRequested: number,
): INodeExecutionData[] {
	const failed = events.find(isJobFailed);
	if (failed) {
		// The typed reason (`incoherent_attachments`, `rate_limited`, …) and, on an
		// incoherent-attachments refusal, the verdict that explains it — the job's
		// failure payload rides `result`, a list of one.
		const payload = (Array.isArray(failed.result) ? failed.result[0] : null) as IDataObject | null;
		return [{
			json: {
				success: false,
				error_message: failed.last_error_summary ?? 'Sample generation failed',
				error_code: failed.error_code,
				...(payload?.attachment_coherence
					? { attachment_coherence: payload.attachment_coherence } : {}),
			},
			pairedItem: itemIndex,
		}];
	}

	const completed = events.find(isSampleJobCompleted)?.result[0];
	if (!completed?.samples.length) {
		const cancelled = events.find((e) => e.event === 'cancelled');
		return [{
			json: {
				success: false,
				error_message: cancelled ? 'Sample generation was cancelled' : 'No sample generation result received',
			},
			pairedItem: itemIndex,
		}];
	}

	return completed.samples.map((sample, i) => ({
		json: {
			success: true,
			sample: sample as IDataObject,
			sample_index: i + 1,
			samples_generated: completed.samples.length,
			samples_requested: completed.samples_requested ?? sampleCountRequested,
			// The kind of entity the model read out of the request (or the planner out
			// of the attachment) — what the record is named after.
			object_type: completed.object_type ?? null,
			...(i === 0 && completed.ambiguity_report
				? { ambiguity_report: completed.ambiguity_report as IDataObject } : {}),
			...(i === 0 && completed.attachment_coherence
				? { attachment_coherence: completed.attachment_coherence as IDataObject } : {}),
			...(i === 0 ? {
				cost_usd: completed.cost_usd,
				input_tokens: completed.input_tokens,
				output_tokens: completed.output_tokens,
				processing_time_ms: completed.processing_time_ms,
			} : {}),
		},
		pairedItem: itemIndex,
	}));
}
