import type { IExecuteFunctions } from 'n8n-workflow';
import type { SSEEvent, GenericSSEEvent } from './types';
import { TERMINAL_EVENTS } from './types';

/**
 * Structural type for the streaming response body returned by n8n's
 * `helpers.httpRequest` with `encoding: 'stream'`. The body is a Node Readable,
 * but importing `node:stream` is forbidden by the n8n verified-community-node
 * scanner so we describe only the surface we use.
 */
type StreamBody = AsyncIterable<Uint8Array> & { destroy: (error?: Error) => void };

/**
 * Consume an SSE stream from Entity Enricher's job streaming endpoint.
 *
 * Connects to GET /api/llm/stream/{jobId} via n8n's HTTP helper (required for
 * verified community nodes — direct fetch/axios usage is rejected by the scanner),
 * parses SSE messages (`data: {JSON}\n\n`), and collects events until a terminal
 * event is received.
 *
 * The `timeoutMs` parameter is passed through as the HTTP-level request timeout.
 * Verified nodes cannot use `setTimeout`, so the previous activity-based reset
 * is replaced by an absolute upper bound; the server-side job manager already
 * terminates jobs that go inactive, so this is the correct trade-off.
 *
 * Cancels paused jobs (e.g., classification mismatch/unknown/ambiguous) since
 * n8n is non-interactive and we must not enrich with hallucinated data.
 */
export async function consumeSSEStream(
	context: IExecuteFunctions,
	jobId: string,
	timeoutMs: number,
): Promise<SSEEvent[]> {
	const credentials = await context.getCredentials('entityEnricherApi');
	const baseUrl = (credentials.baseUrl as string).replace(/\/$/, '');
	const apiKey = credentials.apiKey as string;

	const events: SSEEvent[] = [];
	const controller = new AbortController();
	let stream: StreamBody | undefined;

	try {
		const response = await context.helpers.httpRequest({
			method: 'GET',
			url: `${baseUrl}/api/llm/stream/${jobId}`,
			headers: {
				'X-API-Key': apiKey,
				'X-Client-Origin': 'n8n',
				Accept: 'text/event-stream',
			},
			encoding: 'stream',
			returnFullResponse: true,
			timeout: timeoutMs,
			abortSignal: controller.signal,
		}) as { statusCode: number; body: StreamBody };

		if (response.statusCode < 200 || response.statusCode >= 300) {
			throw new Error(`SSE stream failed (${response.statusCode})`);
		}

		stream = response.body;
		const decoder = new TextDecoder();
		let buffer = '';

		for await (const chunk of stream) {
			buffer += decoder.decode(chunk, { stream: true });

			// Parse SSE messages: each message ends with \n\n or \r\n\r\n
			// Normalize \r\n to \n before splitting (sse-starlette uses \r\n)
			buffer = buffer.replace(/\r\n/g, '\n');
			const messages = buffer.split('\n\n');
			// Keep the last incomplete chunk in the buffer
			buffer = messages.pop() ?? '';

			for (const message of messages) {
				const event = parseSSEMessage(message);
				if (!event) continue;

				events.push(event);

				// Cancel on classification warning (n8n is non-interactive — don't enrich with hallucinated data)
				if (event.event === 'classification_mismatch_pause') {
					const classification = (event as GenericSSEEvent).classification as
						| { status?: string; entity_description?: string; reasoning?: string }
						| undefined;
					await cancelJob(context, baseUrl, apiKey, jobId);
					const status = classification?.status ?? 'unknown';
					const description = classification?.entity_description ?? 'entity';
					const reasoning = classification?.reasoning ?? '';
					throw new Error(
						`Classification ${status}: ${description}. ${reasoning}. ` +
						`Job ${jobId} was cancelled to prevent hallucinated enrichment data.`,
					);
				}

				// Stop on terminal events
				if (TERMINAL_EVENTS.has(event.event)) {
					stream.destroy();
					return events;
				}
			}
		}

		return events;
	} catch (error: unknown) {
		const err = error as Error & { code?: string };
		const message = err.message ?? '';
		const aborted =
			err.name === 'AbortError' ||
			err.code === 'ABORT_ERR' ||
			err.code === 'ECONNABORTED' ||
			/abort|timeout/i.test(message);
		if (aborted) {
			await cancelJob(context, baseUrl, apiKey, jobId);
			throw new Error(
				`Enrichment timed out after ${Math.round(timeoutMs / 1000)}s. Job ${jobId} has been cancelled.`,
			);
		}
		throw error;
	} finally {
		stream?.destroy();
	}
}

/**
 * Parse a single SSE message block into a typed event.
 * SSE format from Entity Enricher: `data: {JSON}\n`
 */
function parseSSEMessage(message: string): SSEEvent | null {
	const lines = message.split('\n');
	let data = '';

	for (const line of lines) {
		if (line.startsWith('data: ')) {
			data += line.slice(6);
		} else if (line.startsWith('data:')) {
			data += line.slice(5);
		}
		// Ignore event:, id:, retry: lines (Entity Enricher doesn't use them)
	}

	if (!data) return null;

	try {
		return JSON.parse(data) as SSEEvent;
	} catch {
		return null;
	}
}

/** Cancel a running job (used on timeout or classification warning). */
async function cancelJob(
	context: IExecuteFunctions,
	baseUrl: string,
	apiKey: string,
	jobId: string,
): Promise<void> {
	try {
		await context.helpers.httpRequest({
			method: 'POST',
			url: `${baseUrl}/api/llm/cancel/${jobId}`,
			headers: { 'X-API-Key': apiKey, 'X-Client-Origin': 'n8n' },
			ignoreHttpStatusErrors: true,
		});
	} catch {
		// Best-effort cancellation
	}
}
