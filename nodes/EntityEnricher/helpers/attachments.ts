import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { apiRequest } from './api';
import type { AttachmentUploadResponse } from './types';

/**
 * Resolve which binary properties of an input item to upload.
 *
 * `namesSpec` is a comma-separated list of binary property names; an empty
 * spec means "every binary property on the item".
 *
 * With `requireAll` (single-item operations), a named property missing from
 * the item is an error. Without it (batch: attachments are gathered across
 * all input items), missing names are silently skipped for this item — the
 * caller is expected to fail if nothing resolved across the whole input.
 */
export function resolveBinaryPropertyNames(
	context: IExecuteFunctions,
	itemIndex: number,
	namesSpec: string,
	options: { requireAll: boolean },
): string[] {
	const item = context.getInputData()[itemIndex];
	const available = Object.keys(item.binary ?? {});
	const requested = namesSpec.split(',').map((s) => s.trim()).filter(Boolean);

	if (!requested.length) return available;
	if (!options.requireAll) return requested.filter((name) => available.includes(name));

	const missing = requested.filter((name) => !available.includes(name));
	if (missing.length) {
		throw new NodeOperationError(
			context.getNode(),
			`No binary data found in propert${missing.length > 1 ? 'ies' : 'y'} "${missing.join('", "')}". `
			+ (available.length
				? `Available binary properties: ${available.join(', ')}.`
				: 'The input item has no binary data — connect a node that outputs a file '
				+ '(e.g. HTTP Request, Read Binary File) and make sure intermediate nodes '
				+ 'pass binary data through (on an Edit Fields node, enable "Include Other '
				+ 'Input Fields" — otherwise it strips binary data).'),
			{ itemIndex },
		);
	}
	return requested;
}

/**
 * Upload the given binary properties of an input item to Entity Enricher in a
 * single multipart request (POST /api/attachments accepts several files and
 * returns one response object per file, in order).
 *
 * `fileNameOverride` only makes sense for a single file; callers enforce that.
 */
export async function uploadBinaries(
	context: IExecuteFunctions,
	itemIndex: number,
	propertyNames: string[],
	fileNameOverride?: string,
): Promise<AttachmentUploadResponse[]> {
	const item = context.getInputData()[itemIndex];
	const form = new FormData();

	for (const name of propertyNames) {
		const binary = item.binary?.[name];
		if (!binary) {
			throw new NodeOperationError(
				context.getNode(),
				`No binary data found in property "${name}".`,
				{ itemIndex },
			);
		}
		const buffer = await context.helpers.getBinaryDataBuffer(itemIndex, name);
		const filename = fileNameOverride || binary.fileName || name;
		const contentType = binary.mimeType || 'application/octet-stream';
		// Copy into a fresh ArrayBuffer-backed view so the Blob part type is exact
		// (Node Buffers are typed as ArrayBufferLike, which Blob rejects).
		form.append('files', new Blob([Uint8Array.from(buffer)], { type: contentType }), filename);
	}

	const response = await apiRequest(context, '/api/attachments', {
		method: 'POST',
		form,
	});
	return Array.isArray(response)
		? response as AttachmentUploadResponse[]
		: [response as AttachmentUploadResponse];
}

/**
 * Best-effort deletion of node-uploaded attachments (post-enrichment cleanup).
 * The enrichment already succeeded or failed on its own merits; a leftover
 * attachment must never fail the workflow, so failures are only logged.
 */
export async function deleteAttachmentsQuietly(
	context: IExecuteFunctions,
	ids: string[],
): Promise<void> {
	for (const id of ids) {
		try {
			await apiRequest(
				context,
				`/api/attachments/${encodeURIComponent(id)}`,
				{ method: 'DELETE' },
			);
		} catch (error) {
			context.logger.warn(
				`Entity Enricher: failed to delete uploaded attachment ${id}: ${(error as Error).message}`,
			);
		}
	}
}
