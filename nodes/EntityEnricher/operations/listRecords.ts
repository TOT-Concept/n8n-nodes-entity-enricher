import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { apiRequest } from '../helpers/api';

/**
 * List enrichment records with optional filters.
 *
 * GET /api/records with query parameters for pagination and filtering.
 * Useful for building reporting or monitoring workflows.
 */
export async function execute(
	context: IExecuteFunctions,
): Promise<INodeExecutionData[]> {
	const limit = context.getNodeParameter('recordLimit', 0, 20) as number;
	const recordType = context.getNodeParameter('recordType', 0, '') as string;
	const successOnly = context.getNodeParameter('successOnly', 0, false) as boolean;

	// Build query parameters
	const params = new URLSearchParams();
	params.set('limit', String(limit));
	if (recordType) params.set('type', recordType);
	if (successOnly) params.set('success', 'true');

	const response = await apiRequest(
		context, `/api/records?${params.toString()}`,
	) as { records: Array<Record<string, unknown>> };

	return (response.records ?? []).map((record) => ({
		json: record as IDataObject,
	}));
}
