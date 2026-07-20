import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { apiRequest } from '../helpers/api';

/**
 * Fetch the next FIFO window of database deltas. With claim enabled the rows
 * are leased and must be acknowledged (Acknowledge Deltas operation) before
 * the lease expires; without claim this is a pure replayable cursor read.
 */
export async function execute(
	context: IExecuteFunctions,
): Promise<INodeExecutionData[]> {
	const databaseId = context.getNodeParameter('databaseId', 0) as string;
	const since = context.getNodeParameter('since', 0, 0) as number;
	const claim = context.getNodeParameter('claim', 0, true) as boolean;
	const query = new URLSearchParams({
		since: String(since),
		claim: String(claim),
		format: 'json',
	});
	const response = await apiRequest(
		context,
		`/api/databases/${databaseId}/changes?${query.toString()}`,
	) as { deltas: IDataObject[]; next_cursor: number | null; has_more: boolean; lease_expires_at: string | null };

	return response.deltas.map((delta) => ({
		json: {
			...delta,
			database_id: databaseId,
			next_cursor: response.next_cursor,
			has_more: response.has_more,
			lease_expires_at: response.lease_expires_at,
		},
	}));
}
