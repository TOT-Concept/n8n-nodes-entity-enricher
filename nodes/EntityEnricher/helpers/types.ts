/** LLM model option from GET /api/enrichment/options */
export interface LLMModel {
	key: string;
	display_name: string | null;
	is_available: boolean;
	input_price: number | null;
	output_price: number | null;
	context_length: number | null;
	supports_vision: boolean;
	supports_tool_calls: boolean;
	supports_audio_input: boolean;
	supports_pdf_input: boolean;
	supports_prompt_caching: boolean;
	supports_reasoning: boolean;
}

/** Strategy info from GET /api/enrichment/options */
export interface StrategyInfo {
	name: string;
	description: string;
}

/** Response from GET /api/enrichment/options */
export interface EnrichmentOptionsResponse {
	models: LLMModel[];
	available_models: string[];
	languages: Record<string, string>;
	strategies: StrategyInfo[];
	models_last_updated: string | null;
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

/** Response from POST /api/single/enrich/stream or /api/batch/start */
export interface JobStartResponse {
	job_id: string;
	message: string;
	total?: number;
}

/** Expertise breakdown in enrichment result */
export interface ExpertiseBreakdown {
	key: string;
	name: string;
	success: boolean;
	input_tokens: number | null;
	output_tokens: number | null;
	cost_usd: number | null;
	processing_time_ms: number | null;
}

/** Single model enrichment result (from model_completed SSE event) */
export interface SingleEnrichmentResult {
	model: string;
	success: boolean;
	partial_success?: boolean;
	result: Record<string, unknown> | null;
	error_message: string | null;
	processing_time_ms: number | null;
	input_tokens: number | null;
	output_tokens: number | null;
	cost_usd: number | null;
	record_id: string | null;
	cancelled?: boolean;
	expertise_breakdown?: ExpertiseBreakdown[];
}

/** Conflict report from fusion */
export interface ConflictReport {
	total_fields: number;
	agreed_fields: number;
	conflicted_fields: number;
	conflicts: Array<{
		path: string;
		field_type: string;
		values_by_model: Record<string, unknown>;
		resolved_value: unknown;
		resolution_method: string;
	}>;
}

/** Fusion result (from fusion_completed SSE event) */
export interface FusionResult {
	success: boolean;
	merged_result: Record<string, unknown>;
	conflict_report: ConflictReport | null;
	record_id: string | null;
	processing_time_ms?: number | null;
	input_tokens?: number | null;
	output_tokens?: number | null;
	cost_usd?: number | null;
}

/** Response from POST /api/fusion/merge */
export interface FusionResponse extends FusionResult {
	merged_result: Record<string, unknown>;
}

/** Generic SSE event from the stream */
export interface SSEEvent {
	event: string;
	[key: string]: unknown;
}

/** Entity completed event in batch enrichment */
export interface EntityCompletedEvent extends SSEEvent {
	event: 'entity_completed';
	entity_index: number;
	entity_label: string;
	success: boolean;
	results: SingleEnrichmentResult[];
	fusion?: FusionResult;
	total_cost_usd: number;
	total_processing_time_ms: number;
}

/** Batch completed event */
export interface BatchCompletedEvent extends SSEEvent {
	event: 'batch_completed';
	completed_entities: number;
	failed_entities: number;
	skipped_entities: number;
	total_entities: number;
}

/** Record detail from GET /api/records/{id} */
export interface RecordDetail {
	id: string;
	type: string;
	entity_id: string;
	model_composite_key: string;
	model_name: string;
	structured_output: Record<string, unknown> | null;
	created_at: string;
	cancelled: boolean;
	strategy: string | null;
	[key: string]: unknown;
}
