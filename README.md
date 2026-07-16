# n8n-nodes-entity-enricher

[![npm version](https://img.shields.io/npm/v/n8n-nodes-entity-enricher.svg)](https://www.npmjs.com/package/n8n-nodes-entity-enricher)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An [n8n](https://n8n.io/) community node that integrates with [Entity Enricher](https://entityenricher.ai) — a multi-model LLM enrichment platform with schema-driven structured output, multilingual support, and automated fusion.

![Single entity enrichment workflow](https://entityenricher.ai/docs/demo-single-enrichment-n8n-connector.gif)

## Installation

### From the n8n UI

1. Go to **Settings > Community Nodes**
2. Click **Install a community node**
3. Enter `n8n-nodes-entity-enricher`
4. Click **Install**

### From the command line

```bash
pnpm install n8n-nodes-entity-enricher
```

## Prerequisites

1. An Entity Enricher instance (cloud or self-hosted)
2. A credential — either an API key (create one in **API Keys > App Access Keys**) or an OAuth2 connection (see below)

### Credential Setup — API Key (recommended for service-to-service)

1. In n8n, go to **Credentials > New Credential**
2. Search for **Entity Enricher API**
3. Enter your API key (format: `ent_XXXXXXXXXXXX`)
4. Set the Base URL (default: `https://entityenricher.ai`)

The credential is verified against the API on save. An organization access key acts independently of any user account, so workflows keep running even if the person who created the key changes role or leaves the organization.

### Credential Setup — OAuth2

Connect with your Entity Enricher account instead of a static key. The connection acts on your behalf with your own role and is revocable anytime under Entity Enricher → **API Keys → Connected Apps**.

1. In n8n, go to **Credentials > New Credential** and search for **Entity Enricher OAuth2 API**
2. Copy the **OAuth Redirect URL** n8n displays on the credential
3. In Entity Enricher, go to **Settings → API Keys → OAuth Clients** (owner role required), create a client with that redirect URL, and copy its **Client ID**
4. Paste the Client ID into the n8n credential (set the Base URL if you self-host) and click **Connect my account**

The flow is OAuth 2.1 authorization code + PKCE with rotating refresh tokens. On the node, pick the credential type with the **Authentication** parameter (API Key / OAuth2).

## Operations

| Category | Operation | Description |
|----------|-----------|-------------|
| **Enrichment** | Enrich Entity | Enrich a single entity — just pick a schema; the best model and strategy are chosen automatically |
| **Enrichment** | Enrich Entity Advanced | Enrich a single entity with full control: models, fusion, strategy, classification, structured output |
| **Enrichment** | Batch Enrich | Enrich all input items as a single batch — automatic model and strategy |
| **Enrichment** | Batch Enrich Advanced | Enrich all input items as a single batch with the full parameter set |
| **Schema** | List Schemas | List available saved schemas |
| **Schema** | Get Schema Details | Get full schema content with extracted search key properties |
| **Record** | List Records | Query enrichment records with pagination and filters |
| **Record** | Get Record | Retrieve a specific enrichment result by ID |
| **Fusion** | Merge Results | Merge multiple model results with optional LLM arbitration |
| **Attachment** | Add Attachment | Upload one or more binary properties from the input item (single multipart request) and return one item per attachment ID |
| **Attachment** | Delete Attachment | Delete an attachment by ID — a handy post-enrichment cleanup step |
| **Configuration** | Get Options | Get available models, languages, and strategies |

## Single Entity Enrichment

Enrich a single entity against a schema with one or more LLM models.

**Configuration:**

![Node configuration for single enrichment](https://entityenricher.ai/docs/N8NConnectorEnrichment-light.png)

### Simple and advanced operations

**Enrich Entity** and **Batch Enrich** (the defaults) show only the essentials:

- **Schema**
- **Upload Input Binary Files** (all binary files on the input, cleaned up after the run)
- **Languages**
- **Web Search**

With these operations, Entity Enricher automatically runs with your organization's best model (the pinned per-task default, else the top benchmark-scored model — manage it in *Settings → Organization Defaults*) and the `auto` strategy, and outputs clean enriched data without metadata. If your organization has neither a pinned default nor a scoring benchmark, the node fails with instructions — pin a default or use an Advanced operation.

**Enrich Entity Advanced** and **Batch Enrich Advanced** expose the full parameter set described below. Workflows created before this split keep the full parameter set and their exact behavior.

### Advanced parameters

- **Schema**: Select from saved schemas (dynamic dropdown, pinned schemas shown first)
- **Models**: Choose one or more models — sorted by your organization's benchmark score when scoring benchmarks are configured, with a ★ overall badge and a Quality/Speed/Cost breakdown next to pricing
- **Auto — best model**: pick the "✨ Auto" entry (shown when your organization has scoring benchmarks) to let Entity Enricher use your best-scoring model — a pinned organization default wins when set. Auto resolves to a single model, so it never triggers fusion
- **Languages**: Output languages (at least one required)
- **Strategy**: `multi_expertise` (parallel per-domain) or `single_pass`
- **Classification Model** *(optional)*: Pre-flight entity type verification to prevent hallucination
- **Arbitration Model** *(optional)*: LLM-based conflict resolution when using multiple models
- **Upload Input Binary Files** *(optional)*: Upload the input item's binary files as attachments and use them as source material — see [Document Attachments](#document-attachments)
- **Timeout**: Max wait time (default: 5 minutes)

**Output (default):**

By default, the output contains only the enriched data at the top level for direct field access:

```json
{
  "company_name": "Pfizer",
  "headquarters": "New York",
  "revenue_usd": 58496000000,
  "..."
}
```

Toggle **Include Enrichment Metadata** to add cost, tokens, fusion details, and record IDs:

```json
{
  "result": { "company_name": "Pfizer", "headquarters": "New York", "..." : "..." },
  "record_id": "uuid",
  "success": true,
  "is_fused": true,
  "cost_usd": 0.0042,
  "input_tokens": 1250,
  "output_tokens": 890,
  "fusion": { "agreed_fields": 18, "conflicted_fields": 2, "total_fields": 20 },
  "source_models": ["anthropic::claude-sonnet-4-5", "openai::gpt-4o"]
}
```

Toggle **Include Per-Model Results** to also output individual model results alongside the fused output.

## Batch Enrichment

Enrich all input items in a single batch with parallel execution and per-provider rate limiting.

Each input item is treated as one entity. The node outputs one item per entity with the enrichment result, making it easy to chain with database upserts or further processing.

![Batch enrichment configuration](https://entityenricher.ai/docs/N8NConnectorBatchEnrich-light.png)

## Document Attachments

Feed source documents (PDF, image, audio, office/text) into an enrichment so the models extract facts from your files instead of relying only on their training data.

**Inline upload (recommended):** toggle **Upload Input Binary Files** on Enrich Entity or Batch Enrich. The node uploads the input item's binary files as attachments (one multipart request), feeds their IDs into the enrichment, and — with **Delete Uploaded Attachments After Enrichment** (default: on) — cleans them up afterwards, even when the enrichment fails. No separate Add Attachment / Delete Attachment steps needed:

```
HTTP Request (file) ──▶ Edit Fields (entity JSON) ──▶ Enrich Entity
```

- **Binary Fields to Upload** limits which binary properties are uploaded (comma-separated); leave empty to upload every binary file on the item — merge several files onto one item to attach multiple documents
- The upstream node must pass binary data through to the enrich node — on an Edit Fields node, enable *Include Other Input Fields* (otherwise it strips binary data)
- On **Batch Enrich**, files are gathered from all input items and apply to **every entity in the job**
- With **Include Enrichment Metadata**, the output lists `uploaded_attachment_ids` and whether they were deleted

**Pre-uploaded attachments:** use the standalone **Add Attachment** operation when you want to upload once and enrich many entities against the same document(s), then reference the returned IDs in the **Attachment IDs** field (comma-separated). These are never auto-deleted — pair with **Delete Attachment** for cleanup. Both sources can be combined in one enrichment.

## Key Features

- **Dynamic dropdowns** — Schemas, models, languages, and strategies are loaded from the API at configuration time
- **SSE streaming** — Uses server-sent events internally to wait for job completion with automatic lifecycle management (pause/continue/cancel)
- **Auto-continue** — Automatically continues past classification mismatch pauses (non-interactive)
- **Search key validation** — Validates that input entities contain the required search keys from the schema
- **Multi-model fusion** — When using 2+ models, results are automatically merged with field-level conflict detection. Conflicts are resolved via **rule-based merging** (majority vote, median, union) by default, or via **LLM arbitration** when an arbitration model is selected. Fusion can also be triggered manually on existing records with the **Merge Results** operation
- **Inactivity timeout** — The timeout resets on each progress event, so large batches won't time out as long as entities keep completing. The job is automatically cancelled if no event arrives within the configured period (default: 5 minutes)

## Workflow Ideas

| Pattern | Description |
|---------|-------------|
| **CRM Enrichment** | Webhook trigger > Extract company > Enrich > Upsert to CRM |
| **Spreadsheet Pipeline** | Read CSV/Google Sheet > Batch Enrich > Write enriched data back |
| **Waterfall Enrichment** | Enrich with cheap model > Check quality > Re-enrich failures with premium model |
| **Scheduled Refresh** | Cron trigger > Fetch stale records > Batch re-enrich > Update database |
| **Webhook-Driven** | HTTP webhook > Validate input > Enrich > Return result in response |

## Documentation

- [n8n Connector Guide](https://entityenricher.ai/docs/integrations/n8n) — Full setup and usage documentation
- [API Integration Guide](https://entityenricher.ai/docs/api) — REST API reference and code examples
- [API Keys](https://entityenricher.ai/docs/platform/api-keys) — Creating and managing API keys

## Development

```bash
# Install dependencies
pnpm install

# Build
npm run build

# Lint (type check)
npm run lint
```

### Releasing a New Version

Publishing is automated via GitHub Actions. To release a new version:

```bash
git tag n8n-v1.2.0 && git push origin n8n-v1.2.0
```

This triggers the CI/CD pipeline which will:

1. **Build & lint** the connector
2. **Run integration tests** (module loading + n8n startup verification)
3. **Publish to npm** with the version extracted from the tag
4. **Create a GitHub Release** with an auto-generated changelog from commits touching the connector directory

The tag name must follow the `n8n-v<semver>` format (e.g., `n8n-v1.0.0`, `n8n-v1.2.3`). The version in `package.json` is updated automatically during publish — no need to change it manually.

## Changelog

See [CHANGELOG.md](https://github.com/TOT-Concept/n8n-nodes-entity-enricher/blob/main/CHANGELOG.md) for a full list of changes in each version.

## License

[MIT](LICENSE)
