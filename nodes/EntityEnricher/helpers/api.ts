import type {
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IHttpRequestMethods,
	IWebhookFunctions,
} from 'n8n-workflow';

/** Any n8n context that can read node parameters + credentials and issue HTTP calls. */
export type RequestContext =
	| IExecuteFunctions
	| ILoadOptionsFunctions
	| IHookFunctions
	| IWebhookFunctions;
import { NodeOperationError } from 'n8n-workflow';

interface ApiRequestOptions {
	method?: string;
	body?: unknown;
	/**
	 * Multipart form body. When set, `body` is ignored and the JSON
	 * Content-Type header is dropped so the HTTP client sets the multipart
	 * boundary itself. Used for binary file uploads (Add Attachment).
	 */
	form?: FormData;
}

/** The node's `authentication` parameter values. */
export type AuthenticationType = 'apiKey' | 'oAuth2';

const CREDENTIAL_TYPE_BY_AUTH: Record<AuthenticationType, string> = {
	apiKey: 'entityEnricherApi',
	oAuth2: 'entityEnricherOAuth2Api',
};

/**
 * Resolve the node's selected authentication type.
 * Works in both execute and loadOptions contexts.
 * Nodes saved before the parameter existed default to the API-key credential.
 */
export function getAuthenticationType(
	context: RequestContext,
): AuthenticationType {
	try {
		const value = 'getInputData' in context
			? (context as IExecuteFunctions).getNodeParameter('authentication', 0, 'apiKey')
			: (context as ILoadOptionsFunctions).getNodeParameter('authentication', 'apiKey');
		return value === 'oAuth2' ? 'oAuth2' : 'apiKey';
	} catch {
		return 'apiKey';
	}
}

/** n8n credential type name matching the node's selected authentication. */
export function getCredentialType(context: RequestContext): string {
	return CREDENTIAL_TYPE_BY_AUTH[getAuthenticationType(context)];
}

/**
 * Base URL of the connected Entity Enricher instance.
 * Both credential types carry a `baseUrl` property.
 */
export async function getBaseUrl(context: RequestContext): Promise<string> {
	const credentials = await context.getCredentials(getCredentialType(context));
	return (credentials.baseUrl as string).replace(/\/$/, '');
}

interface FullResponse {
	statusCode: number;
	body: unknown;
	headers: Record<string, string>;
}

/**
 * Mine an error thrown by n8n's HTTP helpers for the HTTP status + body.
 * Error shapes differ between n8n versions / axios layers, so probe all of
 * them; returns undefined for non-HTTP errors (network failure, abort, …).
 */
function extractErrorResponse(error: unknown): FullResponse | undefined {
	const err = error as {
		statusCode?: number | string;
		httpCode?: number | string;
		response?: { statusCode?: number; status?: number; body?: unknown; data?: unknown };
		cause?: { response?: { statusCode?: number; status?: number; body?: unknown; data?: unknown }; statusCode?: number | string };
	};
	const statusCode = Number(
		err.statusCode
		?? err.httpCode
		?? err.response?.statusCode
		?? err.response?.status
		?? err.cause?.response?.statusCode
		?? err.cause?.response?.status
		?? err.cause?.statusCode
		?? NaN,
	);
	if (!Number.isFinite(statusCode) || statusCode < 100) return undefined;
	const body = err.response?.body ?? err.response?.data ?? err.cause?.response?.body ?? err.cause?.response?.data;
	return { statusCode, body, headers: {} };
}

/**
 * Perform an HTTP request with the node's selected credential attached.
 *
 * - API key: the credential's `authenticate` block injects `X-API-Key`;
 *   non-2xx statuses are returned (not thrown) via ignoreHttpStatusErrors.
 * - OAuth2: n8n injects the Bearer token and transparently refreshes it on a
 *   401 — that retry only engages when the request *throws*, so HTTP errors
 *   stay throwing here and are converted back into a FullResponse afterwards.
 *
 * Never throws for HTTP-level errors; network/abort errors propagate.
 */
export async function authenticatedRequest(
	context: RequestContext,
	requestOptions: IHttpRequestOptions,
): Promise<FullResponse> {
	const authType = getAuthenticationType(context);
	const credentialType = CREDENTIAL_TYPE_BY_AUTH[authType];

	if (authType === 'apiKey') {
		return await context.helpers.httpRequestWithAuthentication.call(context, credentialType, {
			...requestOptions,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		}) as FullResponse;
	}

	try {
		return await context.helpers.httpRequestWithAuthentication.call(context, credentialType, {
			...requestOptions,
			returnFullResponse: true,
		}) as FullResponse;
	} catch (error: unknown) {
		const extracted = extractErrorResponse(error);
		if (extracted) return extracted;
		throw error;
	}
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
		// The human-readable text lives in `detail` on plan-limit errors and in
		// `message` on others (e.g. the 400 no_default_model auto-select error).
		const message = typeof inner.detail === 'string'
			? inner.detail
			: (typeof inner.message === 'string' ? inner.message : undefined);
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
	context: RequestContext,
	path: string,
	options: ApiRequestOptions = {},
): Promise<unknown> {
	const baseUrl = await getBaseUrl(context);

	const requestOptions: IHttpRequestOptions = {
		method: (options.method ?? 'GET') as IHttpRequestMethods,
		url: `${baseUrl}${path}`,
		headers: {
			// Auth header (X-API-Key or Bearer) is injected per credential type
			'X-Client-Origin': 'n8n',
			// Content-Type defaults to JSON; dropped below for multipart uploads
			// so the HTTP client can set the boundary itself.
			'Content-Type': 'application/json',
		},
	};

	if (options.form !== undefined) {
		delete (requestOptions.headers as Record<string, string>)['Content-Type'];
		requestOptions.body = options.form;
	} else if (options.body !== undefined) {
		requestOptions.body = JSON.stringify(options.body);
	}

	const response = await authenticatedRequest(context, requestOptions);

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

