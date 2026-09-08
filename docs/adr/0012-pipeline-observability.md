# ADR-0012: Pipeline observability — hosted free tiers, OTel-instrumented, Discord-alerted

*Status: Proposed · Date: 2026-09-08 · Deciders: Bradley, Dave*

## Context

The pipeline has enough moving parts — six ingestion lanes, a three-tier extraction ladder, batch verification with NLI auditing, scheduled reprocessing — that without deliberate observability it fails silently. The failure modes the design already names (the silently-empty feed, markup drift, extraction gaps, cost overrun, NLI audit failures) are only visible if the pipeline emits signals about itself. Health checking (ADR-0011) defines *what* to monitor; this ADR defines *how* — the metrics, the funnel, the error tracking, the tooling.

Considered and declined: fully self-hosted observability (Grafana + Loki + GlitchTip on Proxmox). Declined for v1 because build/maintenance effort competes directly with the eight-week pipeline build, and telemetry is not claim content — the foreign-inference rule does not bind it. Revisit if free-tier limits bite mid-campaign (migration cost is low because instrumentation is OpenTelemetry — see decision).

## Decision

**Instrument once with OpenTelemetry; ship on hosted free tiers; alert into Discord.** After reviewing the alternatives (below), the tooling splits by job:

- **PostHog (Cloud free tier)** — funnel metrics, product/LLM analytics, error tracking. PostHog is a strong fit for this pipeline specifically: its native concept is the **event funnel**, which is exactly our ingestion→publication funnel; its **LLM analytics** product tracks model, latency, token cost, and failure per LLM call (our cost telemetry, built-in); and its error-tracking free allowance (100k exceptions/month) is 20× Sentry's. All signals share one event layer, so "errors correlated with funnel stage" is native. 1M pipeline events/month free comfortably covers our volumes (~120 claims/day ⇒ order 10⁴–10⁵ events/month).
- **Grafana Cloud (free tier)** — the operations surface the pipeline needs that PostHog doesn't provide: **job health for batch/cron work** (nightly re-verification, reprocessing backfills, re-probes), long-retention metrics for the health ladder, and alert rules with the committed 80%-cost alert. 
- **Discord webhooks** — alert routing for everything: warnings batch to a channel; page-level conditions (NLI failure spike, cost overrun, source-down >4h, reconciliation drift) notify directly.

All three ingest **OpenTelemetry** — PostHog logs/traces/LLM-analytics are OTLP-native, Grafana Cloud consumes OTLP natively — so instrumentation happens once, and any component can move between them (or to self-hosted) later without a rewrite.

### What is observed (the instrumented surface)

**1. The ingestion → publication funnel.** The pipeline is a conversion funnel, and every stage boundary is a measurable rate. Funnel metrics are counted **per lane × source × stage**, from stage-boundary events:

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

**2. Cost telemetry.** LLM calls logged per role × model × tokens × cost (from ADR-0007's routing), search calls per lane, batch vs realtime split. Dashboard with the committed **alert at 80% of the period's cost plan**; per-role cost drift shows when a model swap (post-harness) changes economics.

**3. Errors and exceptions.** All parser failures, schema mismatches, batch-job failures, and API errors to **PostHog error tracking** (100k exceptions/month free), tagged by lane/source/stage/pipeline-version. Exceptions are content-free (stack traces + tags; no claim text in payloads) — the same discipline applies to any payload leaving the estate.

**4. Job health.** Batch jobs (nightly re-verification, reprocessing backfills, health re-probes) report duration/status/failure to the same metrics stream; long-running reprocesses emit progress so backfills are observable, not hoped-about.

### The tooling decision

- **PostHog Cloud free tier** for funnel analytics, LLM-call telemetry, error tracking, and structured logs:
  - **Funnel**: stage-boundary events (`fetched`, `extracted`, `attributed`, `deduped`, `triaged`, `queued`, `verified`, `published`) with lane/source/stage/pipeline-version properties; PostHog funnel insights give drop-off per lane without hand-building the query. 1M events/month free.
  - **LLM analytics**: every LLM call (triage, Tier-2 extraction, verification, NLI audit) emits model, latency, tokens, cost, and failure — the ADR-0007 cost dashboard and per-role drift signals are this product's native output. 100k events/month free.
  - **Error tracking**: parser failures, schema mismatches, API errors — 100k exceptions/month free (the most generous of any error tool), exceptions grouped, tagged by pipeline-version so "errors introduced by yesterday's parser change" is a filter. Exceptions are content-free (stack traces + tags; no claim text in payloads).
  - **Logs**: structured JSON via OTLP with the reprocessing provenance fields (pipeline version, model version, extraction tier, claim/source IDs) as first-class fields — 50GB/month free, one logging schema powering debugging, the funnel, and ADR-0011's failure-cause corpus.
- **Grafana Cloud free tier** for job/metrics operations: batch-job health (nightly re-verification, backfills, re-probes) as metrics with duration/status history, the health-ladder's long-retention per-source metrics, and alert rules (80% cost alert, source-down, reconciliation drift) routing to Discord.
- **Discord webhooks** — shared alert routing for both platforms: warnings batch to a channel; page-level conditions notify directly.
- **OpenTelemetry everywhere**: PostHog and Grafana Cloud both consume OTLP natively — one instrumentation layer, no proprietary SDKs, any component movable later without a rewrite.

### LLM observability (its own concern, with its own tooling)

The pipeline is LLM-heavy in a way generic APM tools model poorly, and the LLM calls are where accuracy *and* money are spent (ADR-0007's routing). LLM observability therefore gets a dedicated decision:

**Langfuse (Cloud Hobby free tier) for LLM tracing, evaluation, and prompt management**, alongside PostHog's LLM analytics:

- **What Langfuse adds that PostHog doesn't provide**: nested **traces of the verification loop** — a claim's verification (question decomposition → retrieval rounds → grid computation → verdict → NLI audit) as one trace with spans per LLM call, showing *why* a verdict came out as it did; **evaluation datasets and experiments** (run prompt/model changes against the labelled harness claims inside the observability tool — this is where ADR-0008's harness runs live); **prompt management with versioning** (every prompt template versioned, diffs, prompts linked to the traces that used them — directly serving the harness-gated change rule); and **scores attached to traces** (NLI audit results, human review outcomes as scores on the producing trace).
- **What PostHog's LLM analytics still covers**: the aggregate view — calls/latency/tokens/cost/failure per role × model, feeding the cost dashboard and drift signals.
- **Division of labour**: PostHog = aggregate product/telemetry layer (funnels, errors, LLM call metrics); Langfuse = per-verification forensics, prompt lifecycle, and harness-experiment runs. Both are OTel-native; a claim's pipeline-version property links the PostHog event stream to the Langfuse trace.
- **Free-tier fit**: Langfuse Hobby = 50k units/month (a unit = trace/observation/score), 30-day retention, 2 users. At ~120 claims/day × ~8–10 LLM observations per verification ≈ 30–36k units/month — inside the free tier, with the audit lane and harness runs as the headroom question. If it overflows: Langfuse is MIT-licensed and **self-hosts well** (Postgres + ClickHouse — both already in the homelab's skillset), so this is the one tool we can bring fully in-house without migration pain.
- **Content discipline**: LLM traces contain prompts and completions, which include claim text. This is the same content already processed by ADR-0007-routed providers under the foreign-inference rule; Langfuse Cloud (EU region) carries it under the same posture as PostHog, with the same escape hatch — self-host if the sovereignty bar rises.

The market's own guidance (2026 comparisons) makes OTel support a hard buying requirement for LLM observability — Langfuse (MIT, ClickHouse-acquired, self-hostable) and PostHog (MIT core, OTLP-native) both pass; proprietary alternatives (LangSmith cloud-only) were declined on that ground alone. Note also that PostHog's own comparison (July 2026) concedes Langfuse's trace-exploration UI and pre-deployment eval workflows (annotation queues, curated dataset experiment runs) are more mature, while PostHog's LLM-observability strengths — traces linked to user profiles, session replay, prompt A/B tests on live users — are end-user-product strengths. This pipeline has no end user in the verification loop (the harness is the consumer), which is precisely why the division of labour above holds rather than consolidating on one vendor.

The evidence store is already the idempotent source of truth with versioned artefacts (ADR-0011 reprocessing), so funnel counts at every stage are **derivable from the store as SQL** — claims by stage × lane × hour. The event stream (OTel) provides the live/operational view; the store provides the reconcilable historical truth. Both being available means the dashboards can be checked against the store — dashboards that disagree with the store indicate instrumentation bugs, which is itself monitored (a daily reconciliation job compares event-count totals to store counts and alerts on drift).

### What this does NOT do (honest boundaries)

- **No user-side analytics here.** Site traffic, contest-form conversion, search behaviour on the public site is a separate concern (and a privacy-sensitive one — it will need its own decision, likely self-hosted Matomo or Plausible, keeping visitor data out of third-party ad-tech).
- **No model-quality metrics in production.** The funnel shows *distribution shifts* that suggest quality drift; real accuracy measurement only happens in the ADR-0008 harness. Production monitors are tripwires, not ground truth.
- **Free-tier limits are a known risk**: if Grafana Cloud or PostHog limits bite mid-campaign, the OTel instrumentation means migrating to self-hosted (Option A infrastructure on Proxmox) is a config change plus a day of ops, not a rebuild. The decision is reversible by design.

## Alternatives considered

- **PostHog as the single platform (no Grafana).** The closest call — PostHog covers funnel, LLM analytics, error tracking, and logs in one free-tier platform, and one-vendor consolidation is attractive. Declined as *the* platform because batch-job/cron health and long-retention operational metrics are Grafana-shaped problems (Prometheus-style metrics, uptime-style alert rules) that PostHog's product-analytics model handles awkwardly; also its error-tracking grouping is newer/shallower than dedicated tools. **Adopted for the funnel/LLM/error/logs jobs instead** — see decision. Its web-analytics product could also serve the public site's visitor analytics later, which would keep site traffic and pipeline telemetry under one roof (and its EU/US hosting choice matters for the privacy-sensitive visitor decision).
- **Langfuse as the single LLM platform replacing PostHog's LLM analytics.** Considered: Langfuse's tracing is deeper, but PostHog's aggregate LLM metrics (cost per role × model feeding the drift signals) would then be hand-built, and the funnel/error/logs jobs live in PostHog regardless. Running both is complementary (aggregate vs forensic), not redundant — see the division of labour above. If consolidation pressure rises, Langfuse is the one to keep for verification-loop forensics and the harness; PostHog's LLM analytics is the first thing to drop.
- **LangSmith.** Declined: cloud-only, proprietary (self-hosting requires an enterprise contract); fails the OTel-portability requirement the project's reversibility posture depends on. Braintrust (eval-first, generous free tier) evaluated similarly — proprietary; its eval-gating strengths are covered by Langfuse experiments + the ADR-0008 harness.
- **Helicone.** Declined for v1: it is a gateway (proxy-based cost/latency visibility), and our LLM calls already flow through provider SDKs with batch APIs — inserting a gateway proxy is redundant infrastructure; its cost visibility is covered by PostHog LLM analytics + provider billing exports. Revisit if per-request routing controls are ever needed.
- **Arize Phoenix / OpenLIT / OpenObserve LLM telemetry.** Noted as capable self-host options; declined with the rest of the self-host stack for v1 (ops-competes-with-build), preserved by the OTel posture.
- **Self-hosted PostHog.** Declined: PostHog's own documentation discourages it — single-machine, "unlikely to scale past a couple 100ks events without significant effort", unsupported. For a pipeline emitting constant events, that's the worst of both worlds: self-hosted ops burden without self-hosted ergonomics.
- **SigNoz / OpenObserve / Uptrace / HyperDX (self-hosted all-in-one OTel platforms).** Deferred, noted as the strongest self-hosted path: SigNoz (single ClickHouse datastore for logs/metrics/traces, OTel-native) or OpenObserve (single Rust binary, Parquet-to-object-storage) would replace the whole hosted layer if data sovereignty ever demands it or free tiers bite. Declined for v1 for the same ops-competes-with-the-build reason as the Grafana self-host stack; the OTel instrumentation makes migration a config change. Revisit post-election if the project outgrows free tiers.
- **Fully self-hosted Grafana + Loki + GlitchTip on Proxmox.** Declined for v1: setup and patching effort competes directly with the eight-week pipeline build; telemetry is not claim content, so the sovereignty concern is weak; migration path preserved by OTel instrumentation.
- **Axiom** (100GB/month free ingest, log-focused). Considered as the logs/events layer — generous limits and S3-backed storage. Declined: it duplicates the logs job PostHog now covers, and its strength (terabyte-scale log economics) isn't our shape; keep in reserve if log volume ever exceeds PostHog's 50GB free.
- **Self-built metrics from logs only (no dashboards/alert tooling).** Declined: grep-based dashboards don't survive the campaign crunch; the free tiers cost nothing and buy alert routing and error-grouping that would otherwise be hand-rolled.
- **Instrument later ("ship the pipeline first").** Rejected: observability added after the first silent failure is archaeology; the funnel metrics are also how the build itself is debugged in weeks 1–3, so they must exist as the pipeline comes up, not after.

## Consequences

- **Instrumentation ships with each lane** (same rule as health checking): a lane without funnel events is not done. Week-1 lanes come up already emitting OTel.
- **The funnel definition is itself a published artefact**: the methodology page documents the stages and drop-off semantics, consistent with the project's audit posture (and the numbers behind any "coverage" claims on the site are these same store-derived counts).
- **Alert fatigue is a design constraint**: warnings are batched to a channel; only page-level conditions notify. The health ladder's escalation (ADR-0011) and this alerting share one routing layer so a degrading source escalates coherently rather than spamming.
- **PostHog/Grafana accounts need a maintainer identity decision** (personal vs project account) before week 1 — a small operational note, not a design blocker.
- **The reconciliation job** (event stream vs store counts) is the integrity backstop that keeps dashboards trustworthy under reprocessing and backfills.