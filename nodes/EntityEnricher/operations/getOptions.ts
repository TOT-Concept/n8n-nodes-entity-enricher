import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { apiRequest } from '../helpers/api';

export async function execute(
	context: IExecuteFunctions,
): Promise<INodeExecutionData[]> {
	const options = await apiRequest(context, '/api/enrichment/options');

	return [{ json: options as IDataObject }];
}
