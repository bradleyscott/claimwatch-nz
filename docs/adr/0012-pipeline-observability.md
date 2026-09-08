# ADR-0012: Pipeline observability — two tools, not three; LLM observability on Grafana

*Status: Proposed · Date: 2026-09-08 · Deciders: Bradley, Dave*

## Context

The pipeline has enough moving parts — six ingestion lanes, a three-tier extraction ladder, batch verification with NLI auditing, scheduled reprocessing — that without deliberate observability it fails silently. The failure modes the design already names (the silently-empty feed, markup drift, extraction gaps, cost overrun, NLI audit failures) are only visible if the pipeline emits signals about itself. Health checking (ADR-0011) defines *what* to monitor; this ADR defines *how* — the metrics, the funnel, the errors, and the tooling.

Considered and declined: fully self-hosted observability (Grafana + Loki + GlitchTip on Proxmox). Declined for v1 because build/maintenance effort competes directly with the eight-week pipeline build, and telemetry is not claim content — the foreign-inference rule does not bind it. Revisit if free-tier limits bite mid-campaign (migration cost is low because instrumentation is OpenTelemetry — see decision).

## Decision

**Instrument once with OpenTelemetry; ship on two hosted platforms — Grafana Cloud for operations AND LLM observability; PostHog for the product-analytics layer; alert into Discord.** Each tool must earn its inclusion by doing a job the others cannot; the LLM-observability layer previously assigned to Langfuse moves to Grafana Cloud, cutting the tool count from three to two.

- **Grafana Cloud (free tier)** — operations AND LLM observability:
  1. **Operations** (the three metrics-shaped jobs event analytics handles awkwardly): (a) **scheduled-job monitoring** — nightly re-verification, reprocessing backfills, and health re-probes are cron work whose primary failure mode is *silence* (a job that never ran emits no event for PostHog to count); Grafana's synthetic monitoring / dead-man's-switch alerts fire on the *absence* of a heartbeat — the one signal PostHog's event model structurally cannot produce; (b) **long-retention, low-cardinality metrics** — per-source rates (Tier-2 fallback, unattributed rate, fetch success) as Prometheus-style time series with months of retention, queryable as "last week vs the same week last month," versus PostHog's 30-day free event retention; (c) **alert rules as first-class objects** — threshold/no-data/composite conditions (the committed 80%-cost alert, source-down >4h, reconciliation drift) as monitorable configuration.
  2. **LLM observability** — Grafana Cloud ships **purpose-built GenAI dashboards** (LLM performance, agent performance, vector-DB operations) consuming the standard **OpenTelemetry GenAI semantic conventions** (`gen_ai.*` spans): every LLM call (triage, Tier-2 extraction, verification, NLI audit) emits a span with prompt, model, tokens, cost, latency, and parent-span linkage — so the **nested verification-loop trace** (question decomposition → retrieval rounds → grid computation → verdict → NLI audit) is one trace in Tempo, viewable in the AI Agents dashboard. This is the same OTel instrumentation PostHog and Langfuse would consume — nothing proprietary.
- **PostHog (Cloud free tier)** — the product-analytics layer: the **event funnel** (its native concept — exactly our ingestion→publication funnel), **error tracking** (100k exceptions/month free — 20× Sentry's), and **structured logs** (50GB/month free). Its LLM analytics product is **dropped** — Grafana's gen_ai traces now carry that job — removing the overlap that justified Langfuse.
- **Discord webhooks** — alert routing for everything: warnings batch to a channel; page-level conditions notify directly.

All ingest **OpenTelemetry**: Grafana Cloud consumes OTLP natively; PostHog ingests OTLP for logs/traces. Instrumentation happens once; any component can move between platforms (or to self-hosted) later without a rewrite.

### What Langfuse did, and what replaces each job

| Langfuse job | Replacement | Where it lives |
|---|---|---|
| Nested verification-loop traces (spans per LLM call) | OTel GenAI spans → Grafana Cloud Traces (Tempo) + AI Agents dashboard | Grafana — native; the trace is the same OTel data, only the viewer changes |
| Aggregate LLM cost/latency/failure per role × model | Grafana metrics from `gen_ai.*` span attributes → the ADR-0007 cost dashboard | Grafana — arguably better: same store as the ops metrics, so cost and job health correlate in one place |
| Prompt management with versioning | **Dropped as a product feature** — prompts live in the pipeline repo as versioned config; the git history is the prompt-version record, and the harness (ADR-0008) is the gate | Pipeline repo — already the source of truth under the harness-gated change rule; a UI for prompt editing was convenience, not capability |
| Evaluation datasets + experiment runs | **The ADR-0008 harness itself** (the labelled claims, the scoring scripts, the published matrix) — Langfuse's experiment UI duplicated a job the harness does more rigorously and more publicly | The harness — this is the project's own infrastructure, not a vendor feature |
| Scores attached to traces | Grafana: gen_ai span attributes + custom metrics; NLI-audit results as a metric series (the failure-rate alert reads it) | Grafana |
| LLM-as-a-judge / annotation queues | Out of scope — the NLI audit (ADR-0011) is the project's own judge, built into the pipeline | The pipeline |

The honest trade: **we lose Langfuse's polished trace-exploration UI and prompt-editing UX, and gain one fewer vendor, one fewer free-tier limit to track, and LLM traces in the same store as job health** — where "did the model change or did the job fail" is one query instead of two platforms. Given the harness (not a UI) is the project's quality gate and prompts are code under git, the lost convenience was low-value; the consolidation is high-value.

## What is observed (the instrumented surface)

**1. The ingestion → publication funnel.** The pipeline is a conversion funnel; every stage boundary is a measurable rate, counted **per lane × source × stage**:

```
fetched → extracted (tier 1/2/3) → attributed (person/party/unattributed)
        → deduped (new claim / repeat occurrence) → triaged (checkable / dropped)
        → queued → verified (per verdict class) → published (versioned)
```

Primary funnel instruments, each with a named failure mode it exists to catch:

| Metric | Catches |
|---|---|
| fetch success rate per source | dead feeds, bot walls appearing |
| **Tier-2 fallback rate** per source | markup drift (the extraction ladder's monitoring instrument, ADR-0011) |
| extraction-empty-from-known-nonempty rate | generic-parser failure class (AVeriTeC lesson) |
| **unattributed rate** per lane | entity-resolution degradation; name-disambiguation trouble |
| repeat-occurrence ratio | dedupe health; also a claim-traffic signal |
| triage drop rate shift | claim-detection drift (model or content mix changed) |
| verdict-class distribution shift | verification drift — a sudden change in Supported/Refuted/NEI mix is a model or prompt problem, visible before the harness would catch it |
| **NLI audit failure rate** | justification-hallucination rate; anything above noise pages a human |
| contest rate + mutation rate | public-trust engagement; also ADR-0005's audit-sample denominator |

Funnel counts are **derivable from the store as SQL** (the store is the idempotent source of truth with versioned artefacts, per ADR-0011); the event stream provides the live view, and a daily reconciliation job compares event-count totals to store counts, alerting on drift — dashboards that disagree with the store indicate instrumentation bugs, which is itself monitored.

**2. Cost telemetry.** `gen_ai.*` spans carry tokens and per-call cost (matched against model pricing); Grafana aggregates per role × model — the ADR-0007 cost dashboard with the committed **alert at 80% of the period's cost plan**, in the same system as the ops alerts.

**3. Errors and exceptions.** Parser failures, schema mismatches, batch-job failures, and API errors to **PostHog error tracking**, tagged by lane/source/stage/pipeline-version. Exceptions are content-free (stack traces + tags; no claim text in payloads).

**4. Job health.** Batch jobs report heartbeat + duration/status to Grafana as metrics; long-running reprocesses emit progress. Silence alerts via Grafana's no-data conditions.

## What this does NOT do (honest boundaries)

- **No user-side analytics here.** Site traffic, contest-form conversion, search behaviour on the public site is a separate, privacy-sensitive decision (likely self-hosted Plausible/Matomo, or PostHog web analytics — PostHog's product would keep site analytics in an already-included tool; decide when the site ships).
- **No model-quality metrics in production.** Funnel shifts are tripwires; real accuracy measurement happens only in the ADR-0008 harness. The harness is also what replaces Langfuse's experiment UI — it is more rigorous and more public.
- **No prompt-editing UI.** Prompts are versioned files in the repo, changed by PR, gated by the harness. Editors who want to iterate on prompts work with an engineer or through the harness — by design, since ADR-0007 makes prompt changes model-equivalent changes.
- **Free-tier limits are a known risk**: if Grafana Cloud or PostHog limits bite mid-campaign, the OTel instrumentation means migrating to self-hosted is a config change plus a day of ops. The decision is reversible by design.

## Alternatives considered

- **PostHog + Grafana + Langfuse (the prior three-tool stack).** Replaced by this ADR: Langfuse's four jobs reduce to two Grafana jobs (traces, cost metrics) and two the project already owns (prompt versioning in git, evaluation in the harness). The unique loss is UI polish; the unique gain is one fewer vendor and LLM traces co-located with job health.
- **PostHog as the single platform (no Grafana).** Declined: batch-job silence cannot be detected by an event-analytics product; long-retention metric comparisons and infrastructure-shaped alert rules are Grafana-shaped jobs. (This was the closest call and remains the fallback if Grafana Cloud's free tier proves limiting — silence-detection could be hand-rolled as a cron watchdog posting to Discord, at the cost of reinventing Grafana's alert engine.)
- **Grafana-only (no PostHog).** Considered seriously — Grafana Cloud does cover error tracking (via integrated Loki/Sentry-style alerting) and logs. Declined for v1: PostHog's funnel insight (its native product) is the best-in-class view of exactly our pipeline shape, and its error-tracking grouping (100k/mo free) is materially better than assembling the same from Loki queries. Keep this as the first consolidation move if tool-count pressure rises: the funnel could live as Grafana dashboards over store-SQL with modest loss.
- **Langfuse as a dedicated LLM-observability platform.** Rejected (this revision): its four jobs are covered as above; the 50k-unit free tier and third vendor are real costs for UI polish the harness makes unnecessary. Revisit post-election if prompt-iteration UX becomes a bottleneck for non-engineer contributors.
- **LangSmith / Braintrust.** Declined: cloud-only, proprietary; fail the OTel-portability requirement. (Braintrust's eval-gating strengths are the ADR-0008 harness.)
- **Helicone.** Declined: a gateway proxy is redundant when calls flow through provider SDKs and batch APIs.
- **Self-hosted everything (SigNoz / OpenObserve / Grafana stack on Proxmox).** Declined for v1: ops competes with the build; OTel keeps it reachable. SigNoz (single ClickHouse store) is the strongest post-election consolidation candidate — it would subsume both Grafana Cloud *and* the LLM-trace job in one self-hosted platform.
- **Instrument later.** Rejected: observability added after the first silent failure is archaeology; the funnel metrics are how the build itself is debugged in weeks 1–3.

## Consequences

- **Two vendors, not three** — one fewer free tier to monitor, one fewer account/identity decision, one fewer SDK surface.
- **Instrumentation ships with each lane** (same rule as health checking): a lane without funnel events and gen_ai spans is not done.
- **Prompts are code**: versioned in the repo, changed by PR, gated by the harness. No prompt UI — deliberate, per ADR-0007's model-change discipline.
- **The funnel definition is a published artefact**: the methodology page documents stages and drop-off semantics; the numbers behind "coverage" claims on the site are the same store-derived counts.
- **Alert fatigue is a design constraint**: warnings batch to a Discord channel; only page-level conditions notify; Grafana and the health ladder share one routing layer.
- **PostHog/Grafana accounts need a maintainer identity decision** (personal vs project) before week 1.
- **Raw-document retention** (per ADR-0011) remains the enabling cost for reprocessing and the store-SQL reconciliation.