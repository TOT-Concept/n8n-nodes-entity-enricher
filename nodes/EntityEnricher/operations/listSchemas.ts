import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { apiRequest } from '../helpers/api';
import type { SavedSchema } from '../helpers/types';

export async function execute(
	context: IExecuteFunctions,
): Promise<INodeExecutionData[]> {
	const response = await apiRequest(context, '/api/schema/saved') as { schemas: SavedSchema[] };
	const schemas = response.schemas;

	return schemas.map((schema) => ({
		json: schema as unknown as IDataObject,
	}));
}
