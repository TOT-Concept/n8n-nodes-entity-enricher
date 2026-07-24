import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { apiRequest } from '../helpers/api';
import { consumeSSEStream } from '../helpers/sse';
import type { JobStartResponse, SSEEvent, GenericSSEEvent } from '../helpers/types';

/** Sample-generation `model_completed` payload — not part of the OpenAPI schema
 * (the terminal payload is built as a raw dict server-side, not a Pydantic
 * response_model), so this shape is hand-typed rather than generated. */
interface SampleCompletedEvent extends GenericSSEEvent {
	event: 'model_completed';
	success: boolean;
	samples?: IDataObject[];
	samples_requested?: number;
	samples_note?: string;
	error_message?: string;
	determinism_report?: IDataObject;
	attachment_coherence?: IDataObject;
	cost_usd?: number;
	input_tokens?: number;
	output_tokens?: number;
	processing_time_ms?: number;
}

function isSampleCompleted(e: SSEEvent): e is SampleCompletedEvent {
	return e.event === 'model_completed' && 'samples' in e;
}

/**
 * Generate 1..N samples of one entity type via SSE streaming — the entry
 * point of the schema-authoring loop (see docs/SCHEMA_FLOW.md).
 *
 * Flow:
 * 1. POST /api/schema/sample/generate/stream → get job_id
 * 2. Consume SSE stream until completion (auto_answer=true — n8n is
 *    non-interactive, so any attachment-planner clarification questions
 *    resolve to the planner's defaults rather than pausing)
 * 3. Emit one output item per generated sample
 */
export async function execute(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const entityType = context.getNodeParameter('sampleEntityType', itemIndex) as string;
	const sampleCount = context.getNodeParameter('sampleCount', itemIndex, 1) as number;
	const typicalObjects = (context.getNodeParameter('typicalObjects', itemIndex, '') as string)
		.split(',').map((s) => s.trim()).filter(Boolean);
	const fields = (context.getNodeParameter('sampleFields', itemIndex, '') as string)
		.split(',').map((s) => s.trim()).filter(Boolean);
	const namingConvention = context.getNodeParameter(
		'namingConvention', itemIndex, 'auto',
	) as string;
	const attachmentIds = (context.getNodeParameter('sampleAttachmentIds', itemIndex, '') as string)
		.split(',').map((s) => s.trim()).filter(Boolean);
	const extraInstructions = context.getNodeParameter(
		'sampleExtraInstructions', itemIndex, '',
	) as string;
	const enableWebSearch = context.getNodeParameter(
		'sampleEnableWebSearch', itemIndex, 'off',
	) as 'on' | 'off';
	const language = context.getNodeParameter('sampleLanguage', itemIndex, 'en') as string;
	const model = context.getNodeParameter('sampleModel', itemIndex, 'auto') as string;
	const timeout = context.getNodeParameter('sampleTimeout', itemIndex, 300000) as number;

	if (!entityType) {
		throw new NodeOperationError(context.getNode(), 'Entity type is required', { itemIndex });
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
		entity_type: entityType,
		sample_count: sampleCount,
		model,
		naming_convention: namingConvention,
		language,
		auto_answer: true,
	};
	if (typicalObjects.length) body.typical_objects = typicalObjects;
	if (fields.length) body.fields = fields;
	if (attachmentIds.length) body.attachment_ids = attachmentIds;
	if (extraInstructions) body.extra_instructions = extraInstructions;
	if (enableWebSearch === 'on') body.enable_web_search = true;

	const jobResponse = await apiRequest(context, '/api/schema/sample/generate/stream', {
		method: 'POST',
		body,
	}) as JobStartResponse;

	const events = await consumeSSEStream(context, jobResponse.job_id, timeout);
	return buildOutputItems(events, itemIndex, entityType, sampleCount);
}

function buildOutputItems(
	events: SSEEvent[],
	itemIndex: number,
	entityType: string,
	sampleCountRequested: number,
): INodeExecutionData[] {
	const completed = events.find(isSampleCompleted);

	if (!completed) {
		return [{
			json: {
				success: false,
				error_message: 'No sample generation result received',
				entity_type: entityType,
			},
			pairedItem: itemIndex,
		}];
	}

	if (!completed.success || !completed.samples?.length) {
		return [{
			json: {
				success: false,
				error_message: completed.error_message ?? 'Sample generation failed',
				entity_type: entityType,
			},
			pairedItem: itemIndex,
		}];
	}

	return completed.samples.map((sample, i) => ({
		json: {
			success: true,
			sample,
			sample_index: i + 1,
			samples_generated: completed.samples!.length,
			samples_requested: completed.samples_requested ?? sampleCountRequested,
			entity_type: entityType,
			...(i === 0 && completed.determinism_report
				? { determinism_report: completed.determinism_report } : {}),
			...(i === 0 && completed.attachment_coherence
				? { attachment_coherence: completed.attachment_coherence } : {}),
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
