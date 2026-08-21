# Example workflows

Importable n8n workflows for the Entity Enricher node. Each one is a small, complete flow you can
run as-is once you point it at your own schema and credential.

| # | Workflow | Shows |
|---|---|---|
| 01 | [01-enrich-single-entity.json](01-enrich-single-entity.json) | One entity, four languages, automatic model and strategy |
| 02 | [02-batch-enrich.json](02-batch-enrich.json) | Many entities in one job — parallel execution, one output item per entity |
| 03 | [03-document-to-enrichment.json](03-document-to-enrichment.json) | **PDF in** → inline attachment upload → enrichment sourced from the document |
| 04 | [04-image-to-sample-to-schema.json](04-image-to-sample-to-schema.json) | **Photo in** → sample → saved schema, without writing any JSON by hand |
| 05 | [05-samples-to-schema.json](05-samples-to-schema.json) | 3 samples of one type → a saved, relational-ready schema |
| 06 | [06-delta-sync-to-postgres.json](06-delta-sync-to-postgres.json) | The delta trigger → your own PostgreSQL, in one transaction, acknowledged |

Workflows 05 → 06 are the n8n version of the platform's end-to-end sync test
(`scenario-tests/scenarios/001`): author a schema from generated samples, register a database on it,
enrich, and keep your own database converged. See [The full arc](#the-full-arc-05--06) below.

---

## Importing

1. In n8n: **Workflows ▸ ⋯ (top right) ▸ Import from File**, then pick the `.json`. (Pasting the JSON
   straight onto an open canvas works too.)
2. Open each Entity Enricher node and select your **credential** (the workflows ship without one) —
   *Entity Enricher API* or *Entity Enricher OAuth2 API*, matching the node's **Authentication** field.
3. Replace the placeholders:
   - `PASTE_YOUR_SCHEMA_ID` — just re-pick the schema from the **Schema** dropdown.
   - `PASTE_YOUR_DATABASE_SYNC_ID` (workflow 06) — copy it from the **Database Sync ▸ List Database
     Syncs** operation, or from the app's Database Sync page.
4. Workflow 06 also needs a **Postgres credential** on its *Apply to your replica* node.

The workflows reference the node as `n8n-nodes-entity-enricher.entityEnricher`, which is how it is
registered when installed from npm (**Settings ▸ Community Nodes**). If you run the node as a local
custom extension instead, n8n registers it as `CUSTOM.entityEnricher` — rename the `type` fields
before importing.

---

## 01 · Enrich one entity

```
Manual Trigger  →  Edit Fields (the entity)  →  Enrich Entity
```

**Enrich Entity** (the simple operation) asks for a schema and nothing else: the model is your
organization's best one — the pinned per-task default, else the top benchmark-scored model — and the
strategy is chosen from the schema's shape. Output is the enriched data at the top level, ready for
direct field access downstream.

`Languages` is `en, fr, de, ja` — all four are produced **in a single LLM pass**, not four calls.
Map any of them downstream: `{{ $json.description.fr }}`.

Switch to **Enrich Entity Advanced** when you want to pick models yourself (2+ models fuse
automatically), add a classification model, or force a strategy. Toggle **Include Enrichment
Metadata** to get `record_id`, `cost_usd`, token counts, the `fusion` summary and `source_models`
alongside the result.

## 02 · Batch enrich

```
Manual Trigger  →  Code (one item per entity)  →  Batch Enrich
```

Every input item is one entity; the node runs them as a single job with parallel execution and
per-provider rate limiting, then emits one output item per entity. Unlike a loop, the whole batch is
one job — the inactivity timeout resets on each completed entity, so a long batch does not time out
as long as entities keep finishing.

Replace the Code node with your real source (Google Sheets, Postgres, a webhook payload). Keep one
entity per item.

## 03 · A document as the source (PDF, DOCX, TXT, audio…)

```
HTTP Request (responseFormat = file)  →  Edit Fields  →  Enrich Entity  (Upload Input Binary Files ✔)
```

No separate upload step: **Upload Input Binary Files** takes the binary properties on the input item,
uploads them as attachments in one multipart request, feeds their IDs into the enrichment, and
deletes them afterwards — even if the enrichment fails.

Two things that break this flow if you miss them:

- **The Edit Fields node must pass the binary through.** Enable **Include Other Input Fields**
  (it is set in the workflow) — otherwise n8n strips the binary data and the node has nothing to
  upload.
- **Fetch the file as a file.** The HTTP Request node's *Response ▸ Format* must be **File**, so the
  bytes arrive as binary rather than being parsed into JSON.

Leave **Binary Fields to Upload** empty to send every binary property on the item — merge several
files onto one item to attach several documents. On **Batch Enrich**, files are gathered from all
input items and apply to *every* entity in the job.

The server decides how each file reaches the model: extracted text inlined into the prompt (any
model), or the original bytes (needs a model with the matching capability — with no model pinned,
auto-selection restricts itself to capable ones).

Use the standalone **Add Attachment** operation instead when one document serves many enrichments;
those attachments are never auto-deleted, so pair them with **Delete Attachment**.

## 04 · A photo as the source

```
HTTP Request (file)  →  Add Attachment  →  Generate Sample  →  Code (unwrap)  →  Generate Schema  →  Delete Attachment
```

The fastest way to get a schema for something you can only photograph. Attachments switch **Generate
Sample** into *source mode*: it describes **visible** attributes only and generates a single sample
(there is one object to describe, not several instances to invent). The extra instructions in the
workflow fence it in further — no invented provenance or price.

**The unwrap step is not optional.** Generate Sample emits `{ success, sample: {…}, sample_index, … }`
per sample, while Generate Schema treats **every input item as one sample object**. Without the Code
node, the schema would be generated from the wrapper (`success`, `sample_index`, …) instead of your
data. The node is three lines:

```js
return $input.all().map((item) => ({ json: item.json.sample }));
```

## 05 · Samples → schema

```
Generate Sample (Sample Count = 3)  →  Code (unwrap)  →  Generate Schema
```

`Sample Count = 3` returns three **distinct instances that share one field set** in a single job: the
first sample defines the fields and names the remaining instances, the rest fill them for their own
instance. That is what makes the schema honest — a field missing or null in *any* sample becomes
**nullable** instead of required, and the distinct observed values become the property `examples`.
**Typical Instances** (comma-separated) anchors the instances you care about; slots you leave empty
are named by the model itself, in one pass, so they stay distinct.

The extra instructions carry the rules that decide whether the schema is usable downstream: settled
public facts only (an operational or time-varying property becomes a required field nobody can fill),
nullable where an instance legitimately lacks the property, and a shape with parts of its own plus
recurring third parties.

**Generate Semantic IDs is on** in this workflow, because the schema is headed for a database sync.
Without semantic IDs every table keys on whatever `identifying` property generation picked (a name, a
website), which drifts between runs and mints duplicate rows; adding them afterwards means
hand-editing every object. It needs an organization embedding model (Settings ▸ Organization) and
adds embedding cost.

Then open the schema in the [Workflow Editor](https://entityenricher.ai/workflow-editor) and check
**ownership**: the entity's own parts should be `owned`; a recurring third party (a laboratory, a
publisher, a launch site) must **not** be — an owned shared entity materializes one private copy per
parent instead of one row every parent references, and no join undoes that afterwards.

## 06 · Delta feed → your own PostgreSQL

```
Entity Enricher Trigger (Database Deltas Available)  →  Code (aggregate)  →  Postgres (Execute Query)  →  Acknowledge Deltas
```

Register the database on the schema first (**Database Sync** page in the app, or over MCP / the REST
API) and publish the schema — a linked-but-unpublished schema queues nothing. Then activate this
workflow: the trigger registers its webhook on the linked schema, so every enrichment that queues
deltas wakes it up.

With **Fetch Deltas on Fire** enabled (the default), the trigger doesn't just notify — it fetches and
**leases** the next FIFO window and emits **one item per delta**, each carrying `id`, `sql`, `kind`,
`op`, `entity_type`, `revision` and the shared `next_cursor`.

Two rules the workflow encodes, both easy to get wrong:

1. **Apply a whole window in one transaction.** All deltas of one enrichment share a batch and the
   projected tables carry `DEFERRABLE INITIALLY DEFERRED` foreign keys — splitting a batch across
   transactions fails on the constraint. The window never splits a batch, so "one fire = one
   transaction" is the correct unit. That is what the Code node is for: it joins the window's `sql`
   into one script (PostgreSQL runs a multi-statement query as a single implicit transaction) and
   carries the highest delta id forward.
2. **Acknowledge only after the apply succeeded.** The ack node is last on purpose, and reads the
   cursor from the Code node (`$('Aggregate the window').first().json.up_to_id`). Ack first and a
   failed apply loses those deltas permanently.

Deltas of `kind: "schema"` are DDL migrations and arrive **before** the data rows that need them —
apply them in order, never filter them out. The Code node counts them (`schema_migrations`) so you
can branch a notification off it.

> **Prefer the CLI when you can.** [`ee-database`](https://github.com/TOT-Concept/ee-database) pairs
> to a database sync, bootstraps from the `.sql` snapshot, applies batches over a WebSocket and acks
> them. This workflow is for when a CLI can't run where your database lives, or when you want the
> deltas to fan out into something else (a warehouse queue, an audit log, a Slack alert on schema
> migrations).

**The other two trigger events** need no polling either: *Enrichment Result* fires on every completed
enrichment of a schema, and *Rejected for Database Save* fires only on enrichments the database
admission gate refused — a ready-made review queue, with the missing fields in the payload.

---

## The full arc (05 → 06)

The platform's end-to-end test (`scenario-tests/scenarios/001`) walks exactly this path with chemical
elements: three generated samples (Gold, Iron, Carbon) → a schema whose `isotopes` are an owned
component → a registered database → enrichments in `en` + `fr` → a replica of 4 tables, 18 indexes
and 4 primary keys, converged over the delta feed. In n8n:

```
05  Generate Sample ×3  →  unwrap  →  Generate Schema
        ↓
    (in the app) Database Sync ▸ register a database on the schema, review the Model tab, publish
        ↓
01/02  Enrich Entity / Batch Enrich
        ↓
06  Trigger fires  →  aggregate  →  apply in one transaction  →  Acknowledge Deltas
```

The one step with no n8n operation is registering the database itself: it is a one-time setup action
in the app (or via MCP / the REST API), not something a workflow repeats.
