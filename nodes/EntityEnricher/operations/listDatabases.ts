import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { apiRequest } from '../helpers/api';

export async function execute(
	context: IExecuteFunctions,
): Promise<INodeExecutionData[]> {
	const schemaId = context.getNodeParameter('schemaId', 0) as string;
	const response = await apiRequest(
		context,
		`/api/schemas/${schemaId}/databases`,
	) as { databases: IDataObject[] };
	return response.databases.map((database) => ({ json: database }));
}
