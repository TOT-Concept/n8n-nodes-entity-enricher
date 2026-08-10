import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { apiRequest } from '../helpers/api';
import type { RecordInjectionResponse } from '../helpers/generated/schema';

/**
 * Inject stored (or transformed) enrichment output into a schema's database sync.
 *
 * POST /api/records/sync-to-database — blocking, so the workflow gets each
 * entity's outcome in the same item rather than polling a job.
 *
 * This is the second half of the transform round-trip: enrich with Database
 * Sync disabled, reshape the output in intermediate nodes, then send it here.
 * Passing a modified output mints a new record (records are immutable), which
 * the response reports as created_record.
 */
export async function execute(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const recordId = (context.getNodeParameter('recordId', itemIndex, '') as string).trim();
	const savedSchemaId = (context.getNodeParameter('savedSchemaId', itemIndex, '') as string).trim();
	const outputRaw = context.getNodeParameter('structuredOutput', itemIndex, '') as string;

	let structuredOutput: unknown;
	if (typeof outputRaw === 'string' && outputRaw.trim()) {
		try {
			structuredOutput = JSON.parse(outputRaw);
		} catch {
			throw new NodeOperationError(
				context.getNode(),
				'Structured Output must be valid JSON (leave it empty to send the record\'s stored output unchanged)',
				{ itemIndex },
			);
		}
	} else if (outputRaw && typeof outputRaw === 'object') {
		structuredOutput = outputRaw;
	}

	if (!recordId && structuredOutput === undefined) {
		throw new NodeOperationError(
			context.getNode(),
			'Provide a Record ID, a Structured Output, or both',
			{ itemIndex },
		);
	}
	if (!recordId && !savedSchemaId) {
		throw new NodeOperationError(
			context.getNode(),
			'Schema is required when no Record ID is given — nothing else says which contract validates the output',
			{ itemIndex },
		);
	}

	const item: Record<string, unknown> = {};
	if (recordId) item.record_id = recordId;
	if (savedSchemaId) item.saved_schema_id = savedSchemaId;
	if (structuredOutput !== undefined) item.structured_output = structuredOutput;

	const response = await apiRequest(context, '/api/records/sync-to-database', {
		method: 'POST',
		body: { items: [item] },
	}) as RecordInjectionResponse;

	// One item in, one item out: return the entity's own outcome rather than the
	// envelope, so downstream IF nodes can branch on `status` directly.
	const result = response.results?.[0];
	return [{
		json: {
			success: result?.status === 'saved',
			status: result?.status ?? 'rejected',
			reason: result?.reason ?? null,
			record_id: result?.record_id ?? null,
			source_record_id: result?.source_record_id ?? null,
			created_record: result?.created_record ?? false,
			validation_errors: result?.validation_errors ?? [],
			database: result?.database ?? null,
		},
		pairedItem: itemIndex,
	}];
}
