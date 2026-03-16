/**
 * Type definitions for the Entity Enricher n8n connector.
 *
 * Most types are re-exported from the auto-generated OpenAPI schema.
 * Run `npm run generate-api` to regenerate after backend changes.
 *
 * SSE event types use a discriminated union on the `event` field,
 * enabling type-safe access without `as unknown` casts.
 */

// Re-export API types from generated schema
export type {
	EnrichmentOptionsResponse,
	SingleEnrichmentResponse,
	ExpertiseBreakdown,
	FusionResponse,
	ConflictReport,
	FieldConflict,
	SseModelCompleted,
	SseFusionCompleted,
	SseEntityCompleted,
	SseBatchCompleted,
	SseExpertiseCompleted,
	SseJobCompleted,
	SseJobFailed,
	SseJobCancelled,
	SseError,
} from './generated/schema';

import type {
	SseModelCompleted,
	SseFusionCompleted,
	SseEntityCompleted,
	SseBatchCompleted,
	SseJobCompleted,
	SseJobFailed,
	SseJobCancelled,
	SseError,
} from './generated/schema';

// ---------------------------------------------------------------------------
// Types not in OpenAPI schema (connector-only or simplified)
// ---------------------------------------------------------------------------

/** Response from POST /api/single/enrich/stream or /api/batch/start */
export interface JobStartResponse {
	job_id: string;
	message: string;
	total?: number;
}

/** Saved schema summary from GET /api/schema/saved */
export interface SavedSchema {
	id: string;
	name: string;
	tags: string[];
	is_pinned: boolean;
	created_at: string;
	updated_at: string;
}

// ---------------------------------------------------------------------------
// SSE Event Discriminated Union
// ---------------------------------------------------------------------------

/** Any SSE event that the connector needs to handle. */
export type SSEEvent =
	| SseModelCompleted
	| SseFusionCompleted
	| SseEntityCompleted
	| SseBatchCompleted
	| SseJobCompleted
	| SseJobFailed
	| SseJobCancelled
	| SseError
	| GenericSSEEvent;

/** Catch-all for events the connector doesn't need to inspect (e.g. model_started, heartbeat). */
export interface GenericSSEEvent {
	event: string;
	[key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Terminal events set (used by SSE consumer)
// ---------------------------------------------------------------------------

export const TERMINAL_EVENTS = new Set(['completed', 'failed', 'cancelled', 'error']);

// ---------------------------------------------------------------------------
// Type guard helpers
// ---------------------------------------------------------------------------

export function isModelCompleted(e: SSEEvent): e is SseModelCompleted {
	return e.event === 'model_completed';
}

export function isFusionCompleted(e: SSEEvent): e is SseFusionCompleted {
	return e.event === 'fusion_completed';
}

export function isEntityCompleted(e: SSEEvent): e is SseEntityCompleted {
	return e.event === 'entity_completed';
}

export function isBatchCompleted(e: SSEEvent): e is SseBatchCompleted {
	return e.event === 'batch_completed';
}
