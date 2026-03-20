import type {
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

interface ApiRequestOptions {
	method?: string;
	body?: unknown;
}

/**
 * Format an API error message, handling FastAPI's nested detail structure.
 *
 * FastAPI wraps HTTPException dict details in {"detail": {"detail": "...", "code": "..."}}.
 * For 402 (plan limit) errors, the inner object contains structured info:
 *   { detail: string, code: string, period?: string, limit?: number, used?: number, needed?: number }
 */
function formatApiError(
	statusCode: number,
	body?: { detail?: unknown },
	fallbackMessage?: string,
): string {
	const rawDetail = body?.detail;

	// Handle nested dict detail from FastAPI HTTPException
	if (typeof rawDetail === 'object' && rawDetail !== null) {
		const inner = rawDetail as Record<string, unknown>;
		// Inner detail contains the human-readable message
		const message = typeof inner.detail === 'string' ? inner.detail : undefined;
		const code = inner.code as string | undefined;

		if (statusCode === 402 && message) {
			// Plan limit error — format with context
			const parts = [message];
			if (inner.limit != null && inner.used != null) {
				parts.push(`(${inner.used}/${inner.limit} used)`);
			} else if (inner.limit != null && inner.requested != null) {
				parts.push(`(requested ${inner.requested}, limit ${inner.limit})`);
			}
			if (code) {
				parts.push(`[${code}]`);
			}
			return `Plan limit: ${parts.join(' ')}`;
		}

		if (message) {
			return `Entity Enricher API error (${statusCode}): ${message}`;
		}
	}

	// Simple string detail
	if (typeof rawDetail === 'string') {
		return `Entity Enricher API error (${statusCode}): ${rawDetail}`;
	}

	// Array detail (FastAPI 422 validation errors)
	if (Array.isArray(rawDetail)) {
		const messages = rawDetail.map((e: { loc?: string[]; msg?: string }) =>
			`${(e.loc ?? []).join('.')}: ${e.msg ?? 'unknown'}`,
		);
		return `Entity Enricher API error (${statusCode}): ${messages.join('; ')}`;
	}

	return `Entity Enricher API error (${statusCode}): ${fallbackMessage ?? 'Unknown error'}`;
}

/**
 * Extract status code, response body, and fallback message from n8n httpRequest errors.
 *
 * n8n's httpRequest helper wraps errors in various structures depending on version:
 * - `err.statusCode` or parsed from `err.message` ("Request failed with status code 400")
 * - `err.response.body` (parsed JSON body)
 * - `err.cause.response.body` (newer n8n versions)
 * - `err.description` (sometimes set by n8n)
 */
function extractErrorInfo(error: unknown): {
	statusCode: number;
	body?: { detail?: unknown };
	fallbackMessage?: string;
} {
	const err = error as Record<string, unknown>;

	// Status code: try multiple paths
	let statusCode = (err.statusCode ?? err.httpCode ?? 0) as number;

	// Parse status from message as fallback: "Request failed with status code 400"
	if (!statusCode && typeof err.message === 'string') {
		const match = err.message.match(/status code (\d+)/);
		if (match) statusCode = parseInt(match[1], 10);
	}

	// Response body: try multiple paths (n8n structures vary)
	const response = err.response as Record<string, unknown> | undefined;
	const cause = err.cause as Record<string, unknown> | undefined;
	const causeResponse = cause?.response as Record<string, unknown> | undefined;

	let body = (response?.body ?? causeResponse?.body) as { detail?: unknown } | undefined;

	// Some n8n versions put parsed JSON directly on the error
	if (!body && err.detail) {
		body = { detail: err.detail };
	}

	// Try to parse body if it's a string (raw JSON)
	if (typeof body === 'string') {
		try { body = JSON.parse(body) as { detail?: unknown }; } catch { /* ignore */ }
	}

	const fallbackMessage = (err.description ?? err.message ?? 'Unknown error') as string;

	return { statusCode, body, fallbackMessage };
}

/**
 * Make an authenticated API request to Entity Enricher.
 * Works in both execute and loadOptions contexts.
 */
export async function apiRequest(
	context: IExecuteFunctions | ILoadOptionsFunctions,
	path: string,
	options: ApiRequestOptions = {},
): Promise<unknown> {
	const credentials = await context.getCredentials('entityEnricherApi');
	const baseUrl = (credentials.baseUrl as string).replace(/\/$/, '');
	const apiKey = credentials.apiKey as string;

	const requestOptions: IHttpRequestOptions = {
		method: (options.method ?? 'GET') as IHttpRequestOptions['method'],
		url: `${baseUrl}${path}`,
		headers: {
			'X-API-Key': apiKey,
			'Content-Type': 'application/json',
		},
		json: true,
	};

	if (options.body !== undefined) {
		requestOptions.body = options.body as string;
	}

	try {
		return await context.helpers.httpRequest(requestOptions);
	} catch (error: unknown) {
		const { statusCode, body, fallbackMessage } = extractErrorInfo(error);
		const message = formatApiError(statusCode, body, fallbackMessage);

		if ('getNode' in context) {
			throw new NodeOperationError(
				(context as IExecuteFunctions).getNode(),
				message,
			);
		}
		throw new Error(message);
	}
}

/**
 * Get resolved credentials (baseUrl + apiKey) for direct use (e.g., SSE streaming).
 */
export async function getCredentialValues(
	context: IExecuteFunctions,
): Promise<{ baseUrl: string; apiKey: string }> {
	const credentials = await context.getCredentials('entityEnricherApi');
	return {
		baseUrl: (credentials.baseUrl as string).replace(/\/$/, ''),
		apiKey: credentials.apiKey as string,
	};
}
