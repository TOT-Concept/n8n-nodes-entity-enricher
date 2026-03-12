import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { apiRequest } from '../helpers/api';
import { extractSearchKeys } from '../helpers/validation';

/**
 * Get full schema details including content and extracted search keys.
 *
 * Useful for building dynamic workflows where downstream nodes need
 * to know the schema structure or search key fields.
 */
export async function execute(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const schemaId = context.getNodeParameter('schemaIdDetail', itemIndex) as string;

	if (!schemaId) {
		throw new NodeOperationError(context.getNode(), 'Schema is required', { itemIndex });
	}

	const schema = await apiRequest(
		context, `/api/schema/saved/${encodeURIComponent(schemaId)}`,
	) as Record<string, unknown>;

	// Extract search keys from schema content
	const schemaContent = schema.schema_content as {
		root?: { properties?: Record<string, unknown> };
		properties?: Record<string, unknown>;
	} | undefined;

	const rootProps = schemaContent?.root?.properties
		?? schemaContent?.properties
		?? {};
	const searchKeys = extractSearchKeys(rootProps, '');

	return [{
		json: {
			...schema as IDataObject,
			_search_keys: searchKeys,
		},
		pairedItem: itemIndex,
	}];
}
