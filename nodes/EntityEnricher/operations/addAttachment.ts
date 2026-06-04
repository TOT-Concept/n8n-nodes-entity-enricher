import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { apiRequest } from '../helpers/api';
import type { AttachmentUploadResponse } from '../helpers/types';

/**
 * Upload a binary file from the input item to Entity Enricher.
 *
 * Reads the named binary property, sends it as multipart/form-data to
 * POST /api/attachments, and returns the attachment metadata (including the
 * `id` to pass in `attachmentIds` of a subsequent Enrich Entity step).
 */
export async function execute(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const binaryPropertyName = context.getNodeParameter(
		'binaryPropertyName', itemIndex, 'data',
	) as string;
	const fileNameOverride = context.getNodeParameter(
		'fileNameOverride', itemIndex, '',
	) as string;

	const item = context.getInputData()[itemIndex];
	const binary = item.binary?.[binaryPropertyName];
	if (!binary) {
		throw new NodeOperationError(
			context.getNode(),
			`No binary data found in property "${binaryPropertyName}". Connect a node that outputs a file (e.g. HTTP Request, Read Binary File).`,
			{ itemIndex },
		);
	}

	const buffer = await context.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);
	const filename = fileNameOverride || binary.fileName || 'file';
	const contentType = binary.mimeType || 'application/octet-stream';

	const form = new FormData();
	// Copy into a fresh ArrayBuffer-backed view so the Blob part type is exact
	// (Node Buffers are typed as ArrayBufferLike, which Blob rejects).
	form.append('files', new Blob([Uint8Array.from(buffer)], { type: contentType }), filename);

	const response = await apiRequest(context, '/api/attachments', {
		method: 'POST',
		form,
	}) as AttachmentUploadResponse[];

	// The endpoint returns a list (multipart can carry several files); this
	// operation uploads exactly one, so surface the single response object.
	const uploaded = Array.isArray(response) ? response[0] : response;
	return [{ json: uploaded as unknown as IDataObject, pairedItem: itemIndex }];
}
