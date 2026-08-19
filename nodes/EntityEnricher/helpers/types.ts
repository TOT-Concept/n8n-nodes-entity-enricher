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
	AttachmentUploadResponse,
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

/**
 * Profile limits from the organization's feature profile.
 * Null fields mean unrestricted. Returned by GET /api/enrichment/options.
 *
 * NOTE: The generated schema still uses the old `feature_flags` field name.
 * Once the backend types are regenerated, this can be replaced by the
 * generated `ProfileLimits` type from `EnrichmentOptionsResponse`.
 */
export interface ProfileLimits {
	can_view_prompts?: boolean;
	daily_prompt_limit?: number | null;
	weekly_prompt_limit?: number | null;
	monthly_prompt_limit?: number | null;
	max_record_retention_days?: number | null;
	max_delta_retention_days?: number | null;
	max_concurrent_jobs?: number | null;
	max_models_per_enrichment?: number | null;
	max_languages?: number | null;
}

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

// ---------------------------------------------------------------------------
// Fusion summary
// ---------------------------------------------------------------------------

/**
 * How the merge actually resolved, read off the merged result's internal
 * `_arbitration_metadata` block. `method: 'rule_based'` while an arbitration
 * model was requested means that call failed and the deterministic rules
 * stood — the caller must be able to answer "did my arbiter run?" from the
 * node output alone, as the /enrich/sync `fusion` block now does.
 */
export function arbitrationAudit(mergedResult: unknown): {
	method: string | null;
	arbitration_model: string | null;
} {
	const meta = (mergedResult as { _arbitration_metadata?: Record<string, unknown> } | null)
		?._arbitration_metadata;
	return {
		method: (meta?.method as string | undefined) ?? null,
		arbitration_model: (meta?.arbitration_model as string | undefined) ?? null,
	};
}
