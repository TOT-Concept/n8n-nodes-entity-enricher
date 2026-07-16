import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { resolveBinaryPropertyNames, uploadBinaries } from '../helpers/attachments';

/**
 * Upload binary files from the input item to Entity Enricher.
 *
 * Reads the named binary properties (or every binary property when the field
 * is left empty), sends them in a single multipart/form-data request to
 * POST /api/attachments, and returns one output item per uploaded file with
 * its metadata (including the `id` to pass in `attachmentIds` of a subsequent
 * Enrich Entity step).
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

	const propertyNames = resolveBinaryPropertyNames(
		context, itemIndex, binaryPropertyName, { requireAll: true },
	);
	if (!propertyNames.length) {
		throw new NodeOperationError(
			context.getNode(),
			'The input item has no binary data. Connect a node that outputs a file '
			+ '(e.g. HTTP Request, Read Binary File).',
			{ itemIndex },
		);
	}
	if (fileNameOverride && propertyNames.length > 1) {
		throw new NodeOperationError(
			context.getNode(),
			'File Name Override only applies when uploading a single file — '
			+ `${propertyNames.length} binary properties resolved (${propertyNames.join(', ')}).`,
			{ itemIndex },
		);
	}

	const uploaded = await uploadBinaries(
		context, itemIndex, propertyNames, fileNameOverride || undefined,
	);

	return uploaded.map((attachment) => ({
		json: attachment as unknown as IDataObject,
		pairedItem: itemIndex,
	}));
}
