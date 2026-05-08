# Changelog

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
