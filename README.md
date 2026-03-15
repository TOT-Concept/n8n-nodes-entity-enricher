# n8n-nodes-entity-enricher

[![npm version](https://img.shields.io/npm/v/n8n-nodes-entity-enricher.svg)](https://www.npmjs.com/package/n8n-nodes-entity-enricher)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An [n8n](https://n8n.io/) community node that integrates with [Entity Enricher](https://entityenricher.ai) — a multi-model LLM enrichment platform with schema-driven structured output, multilingual support, and automated fusion.

![Single entity enrichment workflow](https://entityenricher.ai/docs/N8NSingleEntity.png)

## Installation

### From the n8n UI

1. Go to **Settings > Community Nodes**
2. Click **Install a community node**
3. Enter `n8n-nodes-entity-enricher`
4. Click **Install**

### From the command line

```bash
npm install n8n-nodes-entity-enricher
```

## Prerequisites

1. An Entity Enricher instance (cloud or self-hosted)
2. An API key (create one in **API Keys > App Access Keys**)

### Credential Setup

1. In n8n, go to **Credentials > New Credential**
2. Search for **Entity Enricher API**
3. Enter your API key (format: `ent_XXXXXXXXXXXX`)
4. Set the Base URL (default: `https://entityenricher.ai`)

The credential is verified against the API on save.

## Operations

| Category | Operation | Description |
|----------|-----------|-------------|
| **Enrichment** | Enrich Entity | Enrich a single entity using one or more LLM models with SSE streaming |
| **Enrichment** | Batch Enrich | Enrich all input items as a single batch with parallel execution |
| **Schema** | List Schemas | List available saved schemas |
| **Schema** | Get Schema Details | Get full schema content with extracted search key properties |
| **Record** | List Records | Query enrichment records with pagination and filters |
| **Record** | Get Record | Retrieve a specific enrichment result by ID |
| **Fusion** | Merge Results | Merge multiple model results with optional LLM arbitration |
| **Configuration** | Get Options | Get available models, languages, and strategies |

## Single Entity Enrichment

Enrich a single entity against a schema with one or more LLM models.

**Configuration:**

![Node configuration for single enrichment](https://entityenricher.ai/docs/N8NConnectorEnrichment.png)

- **Schema**: Select from saved schemas (dynamic dropdown, pinned schemas shown first)
- **Models**: Choose one or more models (pricing displayed per model)
- **Languages**: Output languages (English always included)
- **Strategy**: `multi_expertise` (parallel per-domain) or `single_pass`
- **Classification Model** *(optional)*: Pre-flight entity type verification to prevent hallucination
- **Arbitration Model** *(optional)*: LLM-based conflict resolution when using multiple models
- **Timeout**: Max wait time (default: 5 minutes)

**Output:**

```json
{
  "result": { "company_name": "Pfizer", "headquarters": "New York", "..." : "..." },
  "record_id": "uuid",
  "success": true,
  "is_fused": true,
  "cost_usd": 0.0042,
  "input_tokens": 1250,
  "output_tokens": 890,
  "processing_time_ms": 3200,
  "fusion": { "agreed_fields": 18, "conflicted_fields": 2, "total_fields": 20 },
  "source_models": ["anthropic::claude-sonnet-4-5", "openai::gpt-4o"]
}
```

Toggle **Include Per-Model Results** to also output individual model results alongside the fused output.

## Batch Enrichment

Enrich all input items in a single batch with parallel execution and per-provider rate limiting.

![Batch enrichment workflow](https://entityenricher.ai/docs/N8NBatchEntities.png)

Each input item is treated as one entity. The node outputs one item per entity with the enrichment result, making it easy to chain with database upserts or further processing.

![Batch enrichment configuration](https://entityenricher.ai/docs/N8NConnectorBatchEnrich.png)

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
npm install

# Build
npm run build

# Lint (type check)
npm run lint
```

## License

[MIT](LICENSE)
