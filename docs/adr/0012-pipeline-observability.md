# ADR-0012: Pipeline observability — Grafana-only, one platform

*Status: Proposed · Date: 2026-09-08 · Deciders: Bradley, Dave*

## Context

The pipeline has enough moving parts — six ingestion lanes, a three-tier extraction ladder, batch verification with NLI auditing, scheduled reprocessing — that without deliberate observability it fails silently. The failure modes the design already names (the silently-empty feed, markup drift, extraction gaps, cost overrun, NLI audit failures) are only visible if the pipeline emits signals about itself. Health checking (ADR-0011) defines *what* to monitor; this ADR defines *how* — the metrics, the funnel, the errors, and the tooling.

The tooling question was revised twice: first from three vendors (Grafana + PostHog + Langfuse) to two (dropping Langfuse — its jobs were covered by Grafana's GenAI support plus the project's own harness and git-versioned prompts); now to **one**: Grafana Cloud alone. The deciding reasoning: PostHog's retained jobs were funnel dashboards (derivable from store-SQL + Grafana dashboards), error tracking (Grafana Cloud covers exceptions via Faro/loki alerting, and our errors are server-side Python where log-based grouping suffices), and logs (Grafana Loki's core job). What remained unique to PostHog was UI polish on the funnel view and a more mature exception-grouping UI — convenience, not capability, and not worth a second vendor, second free-tier limit, second SDK surface, and second account for a two-person project.

Considered and declined throughout: fully self-hosted observability (Grafana + Loki + GlitchTip on Proxmox). Declined for v1 because build/maintenance effort competes directly with the eight-week pipeline build, and telemetry is not claim content — the foreign-inference rule does not bind it. Revisit if free-tier limits bite mid-campaign (migration cost is low because instrumentation is OpenTelemetry — see decision).

## Decision

**Instrument once with OpenTelemetry; ship entirely on Grafana Cloud (free tier); alert into Discord. One platform.**

- **Metrics & scheduled-job monitoring** — Prometheus-style time series with months of retention; the three metrics-shaped jobs event analytics handles awkwardly: (a) **scheduled-job monitoring** — nightly re-verification, reprocessing backfills, and health re-probes are cron work whose primary failure mode is *silence* (a job that never ran emits nothing to count); Grafana's synthetic monitoring / dead-man's-switch alerts fire on the *absence* of a heartbeat; (b) **long-retention, low-cardinality metrics** — per-source rates (Tier-2 fallback, unattributed rate, fetch success) queryable as "last week vs the same week last month"; (c) **alert rules as first-class objects** — threshold/no-data/composite conditions (the committed 80%-cost alert, source-down >4h, reconciliation drift) as monitorable configuration.
- **LLM observability** — Grafana Cloud ships **purpose-built GenAI dashboards** (LLM performance, agent performance, vector-DB operations) consuming the standard **OpenTelemetry GenAI semantic conventions** (`gen_ai.*` spans): every LLM call (triage, Tier-2 extraction, verification, NLI audit) emits a span with prompt, model, tokens, cost, latency, and parent-span linkage — so the **nested verification-loop trace** (question decomposition → retrieval rounds → grid computation → verdict → NLI audit) is one trace in Tempo, viewable in the AI Agents dashboard. Aggregate cost per role × model (the ADR-0007 dashboard) aggregates from the same spans — LLM cost and job health correlate in one store.
- **Logs** — structured JSON to **Loki** (50GB/month free) with the reprocessing provenance fields (pipeline version, model version, extraction tier, claim/source IDs) as first-class labels — one logging schema powering debugging, the funnel, and ADR-0011's failure-cause corpus.
- **Errors** — exceptions as structured log events (and/or Faro-style error events) into Loki, grouped by fingerprint; error-rate alert rules route to Discord. Our errors are server-side Python from our own code — stack traces plus the structured labels (lane/source/stage/pipeline-version) give grouping adequate for a pipeline with a handful of distinct failure classes per source. What is lost vs a dedicated error product is sophisticated cross-release regression grouping UI; what is gained is errors correlating with the job health and LLM traces they belong to, in one store.
- **Funnel** — **store-derived SQL, rendered as Grafana dashboards.** The evidence store is the idempotent source of truth with versioned artefacts (ADR-0011): counts per stage × lane × hour are a SQL view over the store, and the funnel is a set of Grafana panels over that view. The event stream (OTel spans/points at each stage boundary) provides the live view for operational alerting; the store provides the reconcilable historical truth; a daily reconciliation job compares event-count totals to store counts and alerts on drift — dashboards that disagree with the store indicate instrumentation bugs, which is itself monitored.
- **Discord webhooks** — alert routing: warnings batch to a channel; page-level conditions (NLI failure spike, cost overrun, source-down >4h, reconciliation drift) notify directly.

Everything ingests **OpenTelemetry** — one instrumentation layer, no proprietary SDKs, any component movable later without a rewrite.

### Prompt management and evaluation (Langfuse's remaining jobs)

- **Prompts are code**: versioned files in the pipeline repo, changed by PR, gated by the harness. Git history is the prompt-version record; no vendor UI. This aligns with ADR-0007, which treats prompt changes as model-equivalent changes.
- **Evaluation** — the ADR-0008 harness (labelled claims, scoring scripts, published accuracy matrix) is the project's own experiment infrastructure, more rigorous and more public than any vendor's experiment UI. The NLI audit (ADR-0011) is the project's own LLM-as-judge, built into the pipeline with its failure-rate metric alerting in Grafana.

## What is observed (the instrumented surface)

**1. The ingestion → publication funnel** — every stage boundary is a measurable rate, counted **per lane × source × stage**:

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

**2. Cost telemetry.** `gen_ai.*` spans carry tokens and per-call cost (matched against model pricing); Grafana aggregates per role × model — the ADR-0007 cost dashboard with the committed **alert at 80% of the period's cost plan**.

**3. Errors and exceptions.** All parser failures, schema mismatches, batch-job failures, and API errors into Loki as structured events, tagged by lane/source/stage/pipeline-version, with error-rate alerts. Exceptions are content-free (stack traces + tags; no claim text in payloads) — the same discipline applies to any payload leaving the estate.

**4. Job health.** Batch jobs report heartbeat + duration/status as metrics; long-running reprocesses emit progress; silence alerts via no-data conditions.

## What this does NOT do (honest boundaries)

- **No user-side analytics here.** Site traffic, contest-form conversion, search behaviour on the public site is a separate, privacy-sensitive decision — likely self-hosted Plausible/Matomo (visitor data stays off third-party ad-tech), decided when the site ships.
- **No model-quality metrics in production.** Funnel shifts are tripwires; real accuracy measurement happens only in the ADR-0008 harness.
- **No prompt-editing UI.** Prompts are versioned files changed by PR, gated by the harness — deliberate, per ADR-0007's model-change discipline.
- **Weaker exception grouping than a dedicated error product.** Acknowledged and accepted: our errors are few, server-side, and self-inflicted (parser classes, API failures); log-based grouping over structured labels is adequate. If error volume ever justifies it, GlitchTip (self-hosted, Sentry-compatible) is the add-on path.
- **Free-tier limits are a known risk**: if Grafana Cloud limits bite mid-campaign, the OTel instrumentation means migrating to self-hosted (the Grafana OSS stack on Proxmox — literally the same software) is a config change plus a day of ops. The decision is reversible by design; and the one-platform posture makes that migration *simpler* than the multi-vendor alternative.

## Alternatives considered

- **Grafana + PostHog (two platforms, the prior revision).** Replaced by this ADR: PostHog's remaining jobs — funnel dashboards, error tracking, logs — are all Grafana-native or store-derived. What PostHog uniquely offered was funnel-UI polish and exception-grouping maturity; both are convenience, and the costs were real: a second vendor, second free tier, second SDK, second account, and a split brain between "what happened" (PostHog) and "what stopped happening" (Grafana). One platform wins for a two-person project under deadline.
- **Grafana + Langfuse (dedicated LLM observability).** Rejected (previous revision): Langfuse's jobs reduce to Grafana GenAI support (traces, cost metrics) plus project-owned artefacts (prompts in git, evaluation in the harness). UI polish and prompt-editing UX were the unique losses; not worth a third vendor.
- **PostHog as the single platform.** Declined: batch-job silence cannot be detected by an event-analytics product; long-retention metric comparisons and infrastructure-shaped alert rules are Grafana-shaped jobs. If PostHog were kept, silence-detection would need hand-rolling as a cron watchdog.
- **Grafana + Langfuse + PostHog (three platforms).** Superseded: each revision removed a tool whose jobs were covered elsewhere; no job in the current surface requires it.
- **LangSmith / Braintrust.** Declined: cloud-only, proprietary; fail the OTel-portability requirement.
- **Helicone.** Declined: a gateway proxy is redundant when calls flow through provider SDKs and batch APIs.
- **Self-hosted everything (SigNoz / OpenObserve / Grafana OSS stack on Proxmox).** Declined for v1: ops competes with the build; OTel keeps it reachable. Note the migration is now *simpler* under one vendor: the Grafana OSS stack is literally the same software as Grafana Cloud, so "move to self-hosted" means pointing the same OTel pipelines at local Prometheus/Loki/Tempo. SigNoz (single ClickHouse store) remains the strongest consolidation candidate post-election if a single self-hosted platform covering everything is wanted.
- **Instrument later.** Rejected: observability added after the first silent failure is archaeology; the funnel metrics are how the build itself is debugged in weeks 1–3.

## Consequences

- **One vendor, one account, one SDK surface, one free tier to monitor.** The maintainer-identity decision (personal vs project account) simplifies to a single Grafana Cloud account.
- **Instrumentation ships with each lane** (same rule as health checking): a lane without funnel events, gen_ai spans, and structured logs is not done.
- **Prompts are code**: versioned in the repo, changed by PR, gated by the harness — no prompt UI, by design.
- **The funnel definition is a published artefact**: the methodology page documents stages and drop-off semantics; the numbers behind "coverage" claims on the site are the same store-derived counts.
- **Error grouping is log-based** — adequate for our shape, upgradeable via GlitchTip if error volume or complexity ever justifies it.
- **Alert fatigue is a design constraint**: warnings batch to a Discord channel; only page-level conditions notify; alert rules are versioned configuration, reviewable like code.
- **Raw-document retention** (per ADR-0011) remains the enabling cost for reprocessing and the store-SQL funnel reconciliation.