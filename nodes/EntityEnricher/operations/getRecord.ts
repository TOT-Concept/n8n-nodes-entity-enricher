import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { apiRequest } from '../helpers/api';

export async function execute(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const recordId = context.getNodeParameter('recordId', itemIndex) as string;

	if (!recordId) {
		throw new NodeOperationError(context.getNode(), 'Record ID is required');
	}

	const record = await apiRequest(context, `/api/records/${encodeURIComponent(recordId)}`);

	return [{ json: record as IDataObject, pairedItem: itemIndex }];
}
