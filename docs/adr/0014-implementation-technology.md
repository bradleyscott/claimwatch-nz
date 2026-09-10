# ADR-0014: Implementation technology choices — TypeScript-first, Postgres as the data plane

*Status: Proposed · Date: 2026-09-08 · Deciders: Bradley, Dave*

## Context

Design decisions are complete (ADRs 0001–0013). The next step is a **vertical validation slice** (`VALIDATION-SLICE.md`): end-to-end (ingest → triage → verify → store → export), small enough to run in days, whose outputs are (a) measured verification accuracy against the AVeriTeC harness, (b) measured cost per claim, and (c) a labelling dataset of real NZ claims for the ADR-0010 Layer-2 set. This ADR fixes the implementation technology choices. The governing principle, learned from ADR-0012's consolidation: **fewer moving parts that we understand beat richer stacks** — each choice below is made for the slice's actual job (measurement), not for imagined scale.

## Decision

### Language: TypeScript, not Python — for the pipeline core

The pipeline is **not** model training and not research code. It is application-layer orchestration: HTTP fetching, feed parsing, structured LLM calls, schema-validating their outputs, storing results, scheduled jobs, JSON/JSONL in and out. That is a TypeScript workload. The 2026 ecosystem split is well-established: Python owns compute (PyTorch, training, notebooks); TypeScript owns application orchestration, web surfaces, and MCP-adjacent tooling — and the AI SDKs have matured to the point that the orchestration gap closed this cycle.

The deciding factors, specific to this project:

- **The schema-constrained LLM output story is better in TS.** Every pipeline stage (triage, extraction ladder Tier-2, verdict, NLI audit) consumes **validated structured output** — Zod schemas + the Vercel AI SDK's `generateObject` give compile-time-checked, runtime-validated LLM outputs with provider switching in two lines. Python's equivalents (Pydantic + Instructor / Pydantic AI) work, but the AI SDK is the more cohesive single surface for exactly our shape: multi-provider routing (ADR-0011's per-role model picks), object generation, retries, telemetry middleware.
- **The Vercel AI SDK question (Bradley's preference) resolves directly**: yes, it was TypeScript-only historically — that has not changed — but it is the *right* tool here, not a limitation to work around. What it gives maps one-to-one onto ADR-0011: provider-agnostic `generateText`/`generateObject` across OpenAI/Anthropic/Google/DeepInfra-class providers, middleware hooks for cost capture, and first-class OpenTelemetry support (the `gen_ai.*` spans ADR-0012 routes to Grafana).
- **The site will be TypeScript regardless** (Next.js — verdict pages, ClaimReview JSON-LD, contest form, public coverage page). One language across pipeline + site halves the surface a two-person project maintains; shared Zod schemas between pipeline (write) and site (read) mean the store's types have a single definition.
- **What Python would give us that TS does not:** the AVeriTeC baseline's reference implementation and eval script (`MichSchli/AVeriTeC`) are Python; research-grade fine-tuning/tooling is Python-first. **Disposition: the harness adopts the official AVeriTeC eval script as-is, run as a pinned script step, not as a dependency** — scoring is a batch job executed at the end (JSONL in → score out), not a library our pipeline imports. The pipeline exports AVeriTeC-format predictions; Python appears nowhere in the runtime. If deep eval tooling (custom metrics beyond the official score) becomes needed, a thin Python sidecar is a later addition — reversible, isolated.

**TypeScript is not the ecosystem-maximal choice; it is the coherence-maximal choice** — one language, one schema system (Zod), one SDK surface (Vercel AI SDK), one test runner (Vitest), one CI story, with the one Python artefact (the AVeriTeC eval script) isolated as a pinned scoring step.

### LLM interface: the Vercel AI SDK (v6), no orchestration framework

Per the ADR-0006/0012 pattern (own the thin layer; no frameworks where auditability matters): the **Vercel AI SDK** is adopted as the provider abstraction, with the FIRE-style verification loop as plain TypeScript calling `generateObject` per step. No LangChain/LlamaIndex/LangGraph: the loop's steps must be individually observable (gen_ai spans, ADR-0012) and individually testable (ADR-0010's separable stages); a framework's abstraction sits exactly where our auditability lives. The AI SDK's middleware captures cost/latency per call — the ADR-0011 telemetry — natively.

### Storage: Postgres + pgvector (the data platform, as Bradley proposed)

**Postgres is adopted as the single data platform** — claims, evidence store, verdicts, audit log, embeddings, job state, and the full-text and vector retrieval:

- **pgvector** (HNSW) for the claim-embedding similarity that powers repeat detection, fingerprint adjacency, and store retrieval. The 2026 benchmark picture supports this decisively: Postgres+pgvectorscale processed 471 QPS at 99% recall over 50M vectors — beyond anything this project will generate (order 10⁴–10⁵ claims over the campaign; even 10⁶ vectors is far inside pgvector's envelope). SQLite-vec (the prior recommendation) is fine below ~50k vectors but was chosen as a placeholder; pgvector removes the later migration by starting on the destination.
- **Postgres FTS** (`tsvector`/`websearch_to_tsquery`) for keyword/BM25-ish retrieval — the hybrid retrieval (dense + lexical, per ADR-0006) is two indexes in one database, no separate engines.
- **pg_cron for scheduling** — jobs (ingestion cadence, nightly re-verification, backfills, re-probes) are scheduled *in* the database with standard cron syntax, durable across restarts, with SQL-queryable run history (`cron.job_run_details`) that feeds ADR-0012's job-health metrics and silence-detection. This replaces both cron-on-the-host and a job framework: the scheduler is the database.
- **Drizzle ORM + drizzle-kit for schema and migrations** (Bradley's tool of choice, adopted): the store's schema is defined as **typed Drizzle schema objects** — the claim record, evidence item, and verdict types are defined once in `packages/store` and typed end-to-end through pipeline, site, and harness (the shared-Zod-schemas goal is now shared-Drizzle-tables + Zod at the LLM boundary). **Schema changes are versioned migrations generated by drizzle-kit**, reviewed as SQL in PRs, applied in order — this matters disproportionately here because the evidence store is append-only and the audit log is permanent: schema evolution must be forward-compatible and reviewable, never ad-hoc DDL. Hand-written SQL remains available for queries that are genuinely SQL-shaped (funnel views, hybrid retrieval, reconciliation) — Drizzle's `sql` template keeps those typed and in-repo. Migrations run in CI against a scratch Postgres before merge (the schema-drift alarm).
- **The store-SQL funnel** (ADR-0012) is native — the reconciliation and coverage numbers are plain SQL views.
- Postgres is already operational in the homelab; pgvector is an extension install. Ops surface: one database, no new services.

**What is deliberately NOT adopted:** a separate vector database (Qdrant/Milvus/weaviate — unnecessary at our scale, adds a service), an orchestration engine (Temporal/Airflow/Prefect — pg_cron + workers cover the slice; orchestration is revisitable at operations-hardening, and the job-state tables are the seam), and Redis (pg_cron handles scheduling; advisory locks handle worker mutual exclusion).

### Layout: monorepo (confirmed), pnpm workspaces

```
claimwatch/
  apps/
    site/            # Next.js — verdict pages, ClaimReview JSON-LD, contest form (later slice)
  packages/
    pipeline/        # ingest lanes, extraction ladder, verification loop, store writer
    store/           # schema, migrations, queries (pg, pgvector) — shared by pipeline + site + harness
    llm/             # Vercel AI SDK ports: provider routing per ADR-0011, middleware (cost/telemetry), prompt loading
    harness/         # AVeriTeC-format export, scoring runner, NZ-labelling-set generator
  tools/
    averitec-eval/   # pinned official Python eval script (run as a step, not imported)
```

pnpm workspaces; TypeScript everywhere; shared Zod schemas in `packages/store` are the single type definition of the claim record, evidence item, verdict — consumed by pipeline (write), site (read), harness (export).

### Remaining stack (as recommended, confirmed)

- **Runtime:** Node 22 LTS, TypeScript 5.x, pnpm; `vitest` for tests; `biome` for lint/format; GitHub Actions CI (typecheck + test on PR).
- **Fetch/parse:** `fetch` (undici), `fast-xml-parser` for RSS/Atom, Playwright (TS) for the later party-lane slice, `cheerio` for HTML extraction (readability-style); PDF extraction deferred until an evidence source requires it.
- **Search API:** Serper primary, Brave secondary (ADR-0011 unchanged).
- **Config/secrets:** env + `.env` (gitignored) — no Vault.
- **Observability:** per ADR-0012 — Grafana Cloud; OTel instrumentation over the AI SDK's middleware emitting `gen_ai.*` spans.

## Alternatives considered

- **Python for the pipeline** (the initial recommendation). Rejected after comparison: Python's advantages (AVeriTeC reference code, fine-tuning tooling, research ecosystem) are concentrated in work this project explicitly does NOT do in the pipeline runtime (training, research experimentation); the orchestration layer — HTTP, schemas, jobs, typed stores — is TS-idiomatic; two languages across pipeline+site doubles schema definitions and maintenance. The AVeriTeC eval script is adopted as an isolated pinned step, preserving the benchmark without importing Python.
- **LangChain / LangGraph.js as the orchestration framework.** Rejected on the same grounds as the Python decision: the verification loop must be observable and testable stage-by-stage; frameworks abstract exactly there. The AI SDK is a library, not a framework — it does provider routing and object generation and gets out of the way.
- **SQLite + sqlite-vec + FTS5 (the prior recommendation).** Replaced by Postgres+pgvector: single-file-of-truth simplicity is lost, but the migration is eliminated, retrieval is native, scheduling is native, and the store-SQL funnel is native. SQLite was the right answer for a hypothetical solo-python slice; Postgres is the right answer for the shared typed store a TS monorepo implies.
- **Dedicated vector DB (Qdrant et al).** Rejected: pgvector's 2026 performance envelope exceeds our needs by orders of magnitude; a separate service contradicts the consolidation principle.
- **Celery/BullMQ + Redis for jobs.** Rejected for the slice: pg_cron + advisory locks cover it with one fewer service; the job-state tables keep the escalation path open.
- **Drizzle vs Prisma vs raw pg for the store package.** Chose **Drizzle ORM + drizzle-kit**: typed schema objects shared across packages, versioned SQL migrations reviewed in PRs — essential for an append-only store and permanent audit log where schema evolution must be forward-compatible.

## Consequences

- **The validation slice is immediately buildable** under these choices: three RSS lanes, triage via `generateObject`, FIRE-style loop, pgvector store, AVeriTeC-format export, gen_ai spans → Grafana.
- **One language** (TypeScript) across pipeline, store, site, harness — with one Python exception (the pinned AVeriTeC eval script) isolated in `tools/`.
- **pg_cron's limits are understood**: it schedules and runs SQL — heavy compute jobs (LLM loops) are *triggered by* pg_cron but execute in worker processes (a `pipeline worker` container), not inside the database; pg_cron is the trigger and the ledger, not the executor.
- **Model selection remains harness-gated** (ADR-0011): the AI SDK's provider-switching is what makes the harness's per-role model trials a config change, not a rewrite.