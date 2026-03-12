import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { apiRequest } from '../helpers/api';
import type { FusionResponse } from '../helpers/types';

/**
 * Merge multiple enrichment records using Entity Enricher's fusion engine.
 *
 * POST /api/fusion/merge with record IDs and optional arbitration model.
 */
export async function execute(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const resultIdsRaw = context.getNodeParameter('resultIds', itemIndex) as string;
	const arbitrationModel = context.getNodeParameter(
		'arbitrationModel', itemIndex, '',
	) as string;

	// Parse result IDs (comma-separated or JSON array)
	let resultIds: string[];
	try {
		if (resultIdsRaw.trim().startsWith('[')) {
			resultIds = JSON.parse(resultIdsRaw) as string[];
		} else {
			resultIds = resultIdsRaw.split(',').map((id) => id.trim()).filter(Boolean);
		}
	} catch {
		throw new NodeOperationError(
			context.getNode(),
			'Result IDs must be a comma-separated list or JSON array of UUIDs',
			{ itemIndex },
		);
	}

	if (resultIds.length < 2) {
		throw new NodeOperationError(
			context.getNode(),
			'At least 2 result IDs are required for fusion',
			{ itemIndex },
		);
	}

	const body: Record<string, unknown> = { result_ids: resultIds };
	if (arbitrationModel) body.arbitration_model = arbitrationModel;

	const response = await apiRequest(context, '/api/fusion/merge', {
		method: 'POST',
		body,
	}) as FusionResponse;

	return [{
		json: {
			success: response.success,
			result: response.merged_result,
			record_id: response.record_id,
			cost_usd: response.cost_usd,
			input_tokens: response.input_tokens,
			output_tokens: response.output_tokens,
			processing_time_ms: response.processing_time_ms,
			conflict_report: response.conflict_report
				? {
					total_fields: response.conflict_report.total_fields,
					agreed_fields: response.conflict_report.agreed_fields,
					conflicted_fields: response.conflict_report.conflicted_fields,
					conflicts: response.conflict_report.conflicts,
				}
				: null,
		},
		pairedItem: itemIndex,
	}];
}
