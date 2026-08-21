# Changelog

## Unreleased

### Changed — the schema flag `is_key` is now `identifying`

The property-level flag naming the values that identify an object was called `is_key`, which read as "primary key" — the one thing it is not. It never enforced uniqueness (that is `unique_group`), it is not the database row key (that is `database_key`), and it is not caller-owned (that is `preserve`). What it actually selects is the subset of properties whose values *match one instance of a thing to another* — across input and output items, across models during fusion, and against the semantic-ID concept registry. It is now spelled **`identifying`**, beside `database_key` (row identity) and `semantic_id` (concept identity).

The rename is a clean break, applied everywhere at once: schemas returned by the API carry `identifying`, and every stored schema was rewritten. Any workflow reading `is_key` off a schema property (a Code node inspecting Get Schema output, a filter on the flag) must read `identifying` instead. The node's own search-key extraction follows the new flag — and with it, its dead support for the far older `search_key: "search"` spelling is gone.

### Removed — Generate Schema: **Extra Instructions**

The API no longer accepts `extra_instructions` on schema generation, so the field is gone from Generate Schema. The schema's structure is derived deterministically from the input samples, and per-property flags come from dedicated classification calls — free-form guidance had nothing left to steer and could only fight those rules. To shape the schema's *content*, put the guidance on **Generate Sample** (its Extra Instructions field stays); to localize specific properties, set `multilingual` on them after generation in the schema editor. A workflow that had filled the field keeps running — the value is simply no longer sent.

### Added — the fusion summary says which model arbitrated

The `fusion` block on Enrich Entity and Batch Enrichment output carried only counts, so a workflow that passed an **Arbitration Model** could not tell whether that model actually decided the conflicts. It now also carries `method` (`llm` | `rule_based`) and `arbitration_model` (whose decisions were applied). `method: "rule_based"` on a run that requested an arbiter means that call failed and the deterministic rules stood — branch on it instead of assuming.

### Fixed — Enrich Entity no longer leaks `_arbitration_metadata` into `result`

With **Include enrichment metadata** on, the fused `result` still contained the internal `_arbitration_metadata` audit block (it was stripped only on the plain-result path). It is now stripped on both, matching `/api/single/enrich/sync`. Its two useful fields are the `fusion.method` / `fusion.arbitration_model` above.

### Changed — Generate Sample: **Language** defaults to `auto`

The **Language** field of Generate Sample was `en`, so every generated sample came back in English whatever language the workflow was written in. It now defaults to `auto`: the field is omitted from the request, and the API infers the language from the **Entity Type** and **Typical Objects** you wrote (else the attached document's, else English) — field names and values alike. The schema built from that sample then follows the sample's own property names. An explicit code (`en`, `fr`, …) still forces one language as before.

### Added — `examples/` workflows, and a README that matches the node

Six importable workflows under [`examples/`](examples/), with a walkthrough README: single enrichment, batch enrichment, **a PDF as source material**, **a photo → sample → schema**, three samples → a saved schema, and the delta trigger draining into your own PostgreSQL in one transaction (the n8n counterpart of the platform's end-to-end sync test). They ship with placeholders instead of ids and no credentials, and are repo-only — `files` publishes `dist` alone, so nothing changes in the npm package.

The README was refreshed to the node as it stands: it still listed 12 operations and never mentioned **Generate Sample**, **Generate Schema**, the **Database Sync** resource, or the **Entity Enricher Trigger** node at all. It now also documents the `auto` / `expert_domains` strategies, the advanced Options collection, the typed per-model `error_code`s, `usableAsTool`, and the Code node needed between Generate Sample and Generate Schema (the former wraps each sample under `sample`, the latter reads whole input items).

## 3.0.1 (2026-08-06)

Republish of 3.0.0: a stale `v3.0.0` tag on the repository blocked the automated npm publish, so 3.0.0 never reached npm. No code changes beyond the regenerated API types below.

### Changed

- Regenerated API types from the backend OpenAPI schema (sync hosts — managed ee-database provisioning — and sync-client credential preflight endpoints).

## 3.0.0 (2026-08-06)

### Changed — nodes-panel category and search aliases

Per n8n's community-node verification review (v2.2.2), the codex category moves from `AI` (reserved for nodes wired via AI connection types; subcategories are forbidden for community nodes) to `Data & Storage` / `Development`. Discovery is search-driven, so the alias lists grow instead: AI terms (`ai`, `agent`, `structured output`, `knowledge extraction`, …) and database-sync terms (`database sync`, `postgresql`, `mysql`, `sqlite`, `cdc`, `etl`, …) on the main node, and the trigger node gains its first codex block (same categories, delta/webhook aliases). The node remains available as an AI Agent tool via `usableAsTool` — unchanged.

### ⚠ BREAKING — record-level `attempts` replaced by `retries`

**List Records** items no longer carry `attempts` (total LLM call attempts); they carry **`retries`** instead — attempts beyond the first per prompt (`0` when every call succeeded first try), now computed server-side. Expressions reading `attempts` should read `retries` (or `prompt_count + retries` to reconstruct the old total). **Get Record** gains the same record-level `retries` field, plus a per-prompt `retries` next to the unchanged per-prompt `attempts`.

### Added — Generate Schema "Language" option

**Generate Schema** gains an optional **Language** field pinning the language the schema describes *itself* in — type names, property descriptions, expertise labels, enum value descriptions. When left empty, the language is inferred from the samples' property names, as before. Property names themselves always come from the input samples.

### Changed

- Regenerated API types from the backend OpenAPI schema (string `format`/`pattern` property attributes, language-discriminated schemas, unique-conflict reporting, `pk_strategy`, ordered properties).

## 2.2.2 (2026-08-04)

### Changed

- Regenerated API types from the backend OpenAPI schema (record `attempts`/`output_channel` fields, SPA route list). No node behavior changes.

## 2.2.1 (2026-08-04)

### Fixed

- Trigger webhook deregistration failures are now logged instead of being silently swallowed.

## 2.2.0 (2026-08-03)

### Changed

- **Delta trigger registers per linked schema** — a database can aggregate several schemas and each drives its own downstream workflow, so the trigger now registers the `delta_available` webhook on its linked schema instead of on the database. The new optional **Schema (Multi-Schema Databases)** field picks which linked schema to follow; databases holding a single schema resolve it automatically, so existing workflows keep working untouched — only an ambiguous multi-schema database errors and asks for the field.

### Fixed

- n8n verification-portal compliance: credential icons added, themed light/dark node icons, raw errors wrapped in `NodeApiError`/`NodeOperationError`, typed connection literals, `usableAsTool` flags on both nodes, and the OAuth2 client secret field now uses the password type.

## 2.1.0 (2026-07-29)

### Removed — Generate Schema "Strategy" parameter

The single-call (monolithic) schema-generation pipeline was retired server-side; generation always uses the multi-step (staged) pipeline. The **Strategy** dropdown is removed from **Generate Schema** and the `generation_strategy` request field no longer exists. Saved workflows that had it set keep working — the stored value is simply ignored.

### ⚠ BREAKING — per-prompt fields and schema-generation property count renamed

- **Get Record** per-prompt details: `prompt_used` is now `user_prompt`, `system_prompt_used` is now `system_prompt` (`raw_response` is unchanged). Update expressions reading those keys; the values are unchanged.
- **Generate Schema** output: `property_count` is now `sample_property_count` — the count was always taken from the input sample's properties, not from the generated schema, and the name now says so.

### ⚠ BREAKING — record output field `llm_provider_name` is now `model_composite_key`

The field never held a provider name — it holds the model composite key (e.g. `anthropic::claude-sonnet-4-5`), so it is renamed to say what it is. Affects the output of **Get Record** and **List Records** (and any expression reading `llm_provider_name` from a record item). **To migrate:** update expressions to reference `model_composite_key`; the value is unchanged.

### Changed

- **Get Options returns a leaner model list** — the models array is roughly half its previous size. Two changes affect expressions reading it: **capability flags are now present only when true** (a model without `supports_vision` does not support vision — test truthiness, e.g. `{{ $json.supports_vision }}`, rather than comparing to `false`), and **null fields are omitted** rather than sent as `null`. Model entries now carry only picker-relevant fields; the per-model rate budgets (`tpm`/`rpm`), token limits (`max_input_tokens`/`max_output_tokens`), latency figures, extended benchmark scores, pricing variants, `deprecation_date`, `supported_reasoning_efforts` and embedding fields were removed — they were never surfaced by the node and remain available from the platform's model-management API. The node's own dropdowns, capability glyphs and benchmark badges are unaffected. Regenerated API types.

## 2.0.0 (2026-07-27)

### ⚠ BREAKING — "Database" is now "Database Sync"

The feature was named as though Entity Enricher hosted a database for you. It does not: it keeps *your own* PostgreSQL up to date by shipping SQL that a client you run applies. The resource is renamed to match, and **the stored identifiers changed**, so saved workflows using it must be updated by hand:

| Was | Now |
|---|---|
| Resource `database` ("Database") | Resource `databaseSync` ("Database Sync") |
| Operation `listDatabases` ("List Databases") | Operation `listDatabaseSyncs` ("List Database Syncs") |
| Parameter `databaseId` ("Database ID") | Parameter `databaseSyncId` ("Database Sync ID") |
| Trigger parameter `databaseId` | Trigger parameter `databaseSyncId` |

**To migrate:** open each node that used the Database resource, re-select **Database Sync** as the resource and the operation, and re-enter the Database Sync ID. Node parameters are stored by name, so n8n cannot carry the old values over automatically.

Unchanged: the `fetchDeltas` / `ackDeltas` operation values (already accurate), the webhook event values `delta_available` and `rejected_for_database_save`, and every REST path — only the node-facing names moved.

### Added — Generate Schema operation

New **Schema ▸ Generate Schema** operation: every input item is one sample of the same entity type, so the generated schema covers the union of their fields — a field missing or null in any sample becomes `nullable`, and distinct observed values seed the property examples. The generated schema is auto-saved to the organization. Parameters cover model (default `auto`), strategy, semantic IDs, commonality threshold, extra instructions, and timeout.

## 1.6.0 (2026-07-21)

### Added

- **Generate Sample operation** — the Schema resource gains **Generate Sample**: describe an entity type and get generated sample JSON object(s) to review and seed schema generation with.

### Changed

- **Typed enrichment failure codes** — per-model results (and Batch Enrich per-entity results) now carry an `error_code` when they fail: `model_retired` (the provider retired the model, now auto-deactivated — reselect and retry), `rate_limited`, `context_length_exceeded`, or `provider_timeout`. The synchronous enrichment / schema-generation / sample-generation endpoints return matching HTTP statuses (422 for `model_retired` / `context_length_exceeded`, 429 for `rate_limited`, 504 for `provider_timeout`) instead of a blanket 502. Regenerated API types.

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
