import type {
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IHttpRequestMethods,
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
 * Make an authenticated API request to Entity Enricher.
 * Works in both execute and loadOptions contexts.
 *
 * Uses returnFullResponse to reliably access status codes and error bodies,
 * since n8n's default error handling strips the response body on non-2xx.
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
		method: (options.method ?? 'GET') as IHttpRequestMethods,
		url: `${baseUrl}${path}`,
		headers: {
			'X-API-Key': apiKey,
			'Content-Type': 'application/json',
		},
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};

	if (options.body !== undefined) {
		requestOptions.body = JSON.stringify(options.body);
	}

	const response = await context.helpers.httpRequest(requestOptions) as {
		statusCode: number;
		body: unknown;
		headers: Record<string, string>;
	};

	if (response.statusCode >= 200 && response.statusCode < 300) {
		return response.body;
	}

	// Parse body — it may be a string (raw JSON) or already parsed
	let body: { detail?: unknown } | undefined;
	if (typeof response.body === 'string') {
		try { body = JSON.parse(response.body) as { detail?: unknown }; } catch { /* ignore */ }
	} else if (typeof response.body === 'object' && response.body !== null) {
		body = response.body as { detail?: unknown };
	}

	const message = formatApiError(response.statusCode, body);

	if ('getNode' in context) {
		throw new NodeOperationError(
			(context as IExecuteFunctions).getNode(),
			message,
		);
	}
	throw new Error(message);
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
