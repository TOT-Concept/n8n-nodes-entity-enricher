import type { SSEEvent, GenericSSEEvent } from './types';
import { TERMINAL_EVENTS } from './types';

/**
 * Consume an SSE stream from Entity Enricher's job streaming endpoint.
 *
 * Connects to GET /api/llm/stream/{jobId}, parses SSE events (data: {JSON}\n\n format),
 * and collects all events until a terminal event is received.
 *
 * The timeout is activity-based: it resets each time an event is received,
 * so long-running batch jobs won't time out as long as progress continues.
 *
 * Cancels paused jobs (e.g., classification mismatch/unknown/ambiguous) since n8n is non-interactive.
 */
export async function consumeSSEStream(
	baseUrl: string,
	apiKey: string,
	jobId: string,
	timeoutMs: number,
): Promise<SSEEvent[]> {
	const events: SSEEvent[] = [];
	const controller = new AbortController();
	let timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	const resetTimeout = () => {
		clearTimeout(timeoutId);
		timeoutId = setTimeout(() => controller.abort(), timeoutMs);
	};

	try {
		const response = await fetch(`${baseUrl}/api/llm/stream/${jobId}`, {
			method: 'GET',
			headers: {
				'X-API-Key': apiKey,
				'Accept': 'text/event-stream',
			},
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`SSE stream failed (${response.status}): ${await response.text()}`);
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error('No response body for SSE stream');
		}

		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });

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
				resetTimeout();

				// Cancel on classification warning (n8n is non-interactive — don't enrich with hallucinated data)
				if (event.event === 'classification_mismatch_pause') {
					const classification = (event as GenericSSEEvent).classification as
						| { status?: string; entity_description?: string; reasoning?: string }
						| undefined;
					await cancelJob(baseUrl, apiKey, jobId);
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
					reader.cancel();
					return events;
				}
			}
		}

		return events;
	} catch (error: unknown) {
		if ((error as Error).name === 'AbortError') {
			// Timeout — try to cancel the job
			await cancelJob(baseUrl, apiKey, jobId);
			throw new Error(
				`Enrichment timed out after ${Math.round(timeoutMs / 1000)}s of inactivity (no progress event received). Job ${jobId} has been cancelled.`,
			);
		}
		throw error;
	} finally {
		clearTimeout(timeoutId);
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
async function cancelJob(baseUrl: string, apiKey: string, jobId: string): Promise<void> {
	try {
		await fetch(`${baseUrl}/api/llm/cancel/${jobId}`, {
			method: 'POST',
			headers: { 'X-API-Key': apiKey },
		});
	} catch {
		// Best-effort cancellation
	}
}
