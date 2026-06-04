import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { apiRequest } from '../helpers/api';

/**
 * Delete an attachment from the server by ID.
 *
 * Typically used as a cleanup step after a successful enrichment so source
 * documents are not left on the storage box.
 */
export async function execute(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const attachmentId = context.getNodeParameter('attachmentId', itemIndex) as string;

	if (!attachmentId) {
		throw new NodeOperationError(context.getNode(), 'Attachment ID is required', { itemIndex });
	}

	const response = await apiRequest(
		context,
		`/api/attachments/${encodeURIComponent(attachmentId)}`,
		{ method: 'DELETE' },
	);

	return [{ json: response as IDataObject, pairedItem: itemIndex }];
}
