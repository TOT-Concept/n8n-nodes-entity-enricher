import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { apiRequest } from '../helpers/api';

export async function execute(
	context: IExecuteFunctions,
): Promise<INodeExecutionData[]> {
	const databaseId = context.getNodeParameter('databaseId', 0) as string;
	const upToId = context.getNodeParameter('upToId', 0) as number;
	const response = await apiRequest(
		context,
		`/api/databases/${databaseId}/ack`,
		{ method: 'POST', body: { up_to_id: upToId } },
	) as IDataObject;
	return [{ json: response }];
}
