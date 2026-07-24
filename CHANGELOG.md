# Changelog

## [Unreleased]

### Changed

- **Typed enrichment failure codes** — per-model results (and Batch Enrich per-entity results) now carry an `error_code` when they fail: `model_retired` (the provider retired the model, now auto-deactivated — reselect and retry), `rate_limited`, `context_length_exceeded`, or `provider_timeout`. The synchronous enrichment / schema-generation / sample-generation endpoints return matching HTTP statuses (422 for `model_retired` / `context_length_exceeded`, 429 for `rate_limited`, 504 for `provider_timeout`) instead of a blanket 502. Regenerated API types.


## 1.6.0 (2026-07-21)

### Changed

- **Multi-schema databases** — a schema database can now be linked to several saved schemas (entity types shared between the schemas merge into the same tables, matched by database key). **List Databases** output rows replace the single `saved_schema_id`/`schema_content_hash` fields with a `schemas` array (`saved_schema_id`, `schema_name`, `schema_content_hash`, `linked_at` per linked schema). The `delta_available` webhook payload received by the **Entity Enricher Trigger** now carries `saved_schema_ids` (array); the legacy `saved_schema_id` key remains populated with the first linked schema for one release. **Fetch Database Deltas** responses add `schema_content_hashes` (per-schema version gates) alongside the deprecated single `schema_content_hash`, and delta batches may now include `kind: "schema"` DDL-migration rows (apply their `sql` like any other delta — they FIFO-precede the data rows that need them).
- Regenerated API types from the backend OpenAPI schema.

## 1.5.0 (2026-07-16)

### Features

- **OAuth2 authentication** — new **Entity Enricher OAuth2 API** credential (OAuth 2.1 authorization code + PKCE, rotating refresh tokens) alongside the existing API-key credential. Create an OAuth client in Entity Enricher (**Settings → API Keys → OAuth Clients**, owner role) with your n8n instance's callback URL, paste the client ID into the credential, and click *Connect my account*. The connection acts on your behalf with your own role and is revocable under **API Keys → Connected Apps**. A new **Authentication** parameter on the node selects the credential type (default: API Key, which remains the recommendation for durable service-to-service workflows).
- **Simple and advanced enrichment operations** — the Enrichment resource now offers four operations. **Enrich Entity** and **Batch Enrich** (the simple defaults) show only the essentials: **Schema**, **Upload Input Binary Files**, **Languages**, and **Web Search** — they run with your organization's best model (pinned per-task default, else top benchmark score — the server's `auto` resolution) and automatic strategy, upload every binary file on the input with post-run cleanup, and output clean enriched data without metadata; a clear error explains how to pin a default model when neither a default nor a scoring benchmark exists. **Enrich Entity Advanced** and **Batch Enrich Advanced** expose the full parameter set. Workflows saved before this release keep their exact behavior — their stored operation values resolve to the advanced operations.
- **Inline attachment upload on Enrich Entity and Batch Enrich** — new **Upload Input Binary Files** toggle uploads the input item's binary files as attachments in a single multipart request and feeds their IDs into the enrichment, removing the need for separate Add Attachment / Delete Attachment steps. **Binary Fields to Upload** selects which binary properties to send (empty = all of them, so multiple files on one item become multiple attachments); **Delete Uploaded Attachments After Enrichment** (default on) cleans them up afterwards, even when the enrichment fails. On Batch Enrich, files are gathered from all input items and apply to every entity in the job. With **Include Enrichment Metadata**, the output reports `uploaded_attachment_ids` and `uploaded_attachments_deleted`.
- **Add Attachment uploads multiple files** — the **Input Binary Fields** parameter now accepts a comma-separated list of binary properties (empty = every binary file on the item); all files go out in one multipart request and the operation returns one output item per created attachment. **File Name Override** now applies only to single-file uploads.
- **Benchmark scores in the Models dropdown** — when your organization has scoring-source benchmark scenarios configured, each model option shows a "★ NN" overall-score badge after its name and a `Quality · Speed · Cost` breakdown (0–100, with the scoring-benchmark count) in its description, next to pricing. The dropdown is sorted by overall score (unscored models keep the API order, listed last), mirroring the web app's model picker.

## 1.4.1 (2026-06-06)

### Fixed

- **n8n verification compliance** — set `peerDependencies.n8n-workflow` to `*` (was `>=1.0.0`), as required by `@n8n/scan-community-package` for n8n Cloud verification.

## 1.4.0 (2026-06-06)

### Features

- **Attachment** resource with **Add Attachment** (uploads a binary property from the input item via multipart `POST /api/attachments`, returns its attachment ID) and **Delete Attachment** (`DELETE /api/attachments/{id}`, a handy post-enrichment cleanup step) operations.
- **Attachment IDs** parameter (comma-separated UUIDs) on the Enrich Entity and Batch Enrich actions, wired into the request body as `attachment_ids` so uploaded documents are fed into the enrichment.
- **Response Schema** and **Strict Structured Output** dropdowns on the Enrich Entity and Batch Enrich actions. Each is gated on the selected models' capabilities and locks to a "no selected model supports …" note when none of the chosen models declare the capability (mirroring the web app). Response Schema defaults on; Strict Structured Output defaults off.

### Changed

- Regenerated API types from the backend OpenAPI schema (includes document-attachment + base64/delete endpoints).

## 1.3.4 (2026-05-22)

### Fixed

- **Model price formatting** — round input/output token prices to 2 decimals in the Models dropdown description (e.g. `$0.22/1.65 per M tokens` instead of `$0.22000000000000003/1.6500000000000001 per M tokens`).

## 1.3.3 (2026-05-11)

### Fixed

- **n8n manual review compliance** — removed emoji and symbol characters (⚠, ⭐, ➕) from `loadOptions` display names in Schema, Models, and Languages dropdowns. Pinned schemas now use a `[Pinned]` text prefix; plan-limit and "add more models" entries use plain text labels. Display names and option labels must be plain text per n8n UX guidelines.

## 1.3.0 (2026-05-07)

### Features

- **Web Search** option on Enrich Entity and Batch Enrich actions — opt-in to provider builtin web search (OpenAI Responses, Anthropic, xAI/Grok, Groq, Google, OpenRouter) for selected models that support it. The dropdown auto-locks to "Off — no selected model supports web search" when none of the selected models declare the capability, mirroring the web app behaviour.

## 1.2.3 (2026-05-06)

### Fixed

- Add `email` to `author` field in package.json (required by n8n Creator Portal submission — verification was failing with "Error getting author email from npm")

## 1.2.2 (2026-05-06)

### n8n Cloud Verification Compliance

- Route SSE streaming through `this.helpers.httpRequest` with `encoding: 'stream'` instead of raw `fetch()` (required by `@n8n/scan-community-package`)
- Drop `node:timers` import and timer-based activity timeout (replaced by HTTP-level `timeout` option; verified nodes cannot use `setTimeout`/`clearTimeout`)
- Drop `node:stream` type import (allowlist excludes it; body is typed structurally)
- CI: publish to npm with `--provenance` (mandatory for verification since 2026-05-01)
- CI: mirror the official scanner's ESLint check pre-publish, plus run `@n8n/scan-community-package` against the just-published version as a post-publish gate

## 1.1.0 (2026-03-16)

### Features

- **Clean output by default** — enrichment operations now output only the enriched data fields at the top level (e.g., `{{ $json.company_name }}`), stripping `_arbitration_metadata` for cleaner downstream processing
- **Include Enrichment Metadata** option — toggle to include cost, tokens, fusion details, record IDs, and source models alongside the result (previous default behavior)

## 0.1.0 (2025-03-13)

Initial release of the Entity Enricher n8n community node.

### Features

- **Single entity enrichment** with multi-model support and SSE streaming
- **Batch enrichment** for processing multiple entities in parallel
- **Schema management** — list and inspect saved schemas
- **Record queries** — list and retrieve enrichment results
- **Multi-model fusion** — merge results with optional LLM arbitration
- **Dynamic dropdowns** — schemas, models, languages, and strategies loaded from the API
- **Search key validation** — validates input entities against schema key properties
- **Auto-continue** — automatically resumes past classification mismatch pauses
- **Configurable timeout** with automatic job cancellation
