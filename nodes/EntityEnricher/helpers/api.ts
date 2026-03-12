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
		const err = error as { message?: string; statusCode?: number; response?: { body?: { detail?: string } } };
		const detail = err.response?.body?.detail ?? err.message ?? 'Unknown error';
		const statusCode = err.statusCode ?? 0;

		if ('getNode' in context) {
			throw new NodeOperationError(
				(context as IExecuteFunctions).getNode(),
				`Entity Enricher API error (${statusCode}): ${detail}`,
			);
		}
		throw new Error(`Entity Enricher API error (${statusCode}): ${detail}`);
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
