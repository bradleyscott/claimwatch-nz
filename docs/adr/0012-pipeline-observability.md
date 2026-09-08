# ADR-0012: Pipeline observability — hosted free tiers, OTel-instrumented, Discord-alerted

*Status: Proposed · Date: 2026-09-08 · Deciders: Bradley, Dave*

## Context

The pipeline has enough moving parts — six ingestion lanes, a three-tier extraction ladder, batch verification with NLI auditing, scheduled reprocessing — that without deliberate observability it fails silently. The failure modes the design already names (the silently-empty feed, markup drift, extraction gaps, cost overrun, NLI audit failures) are only visible if the pipeline emits signals about itself. Health checking (ADR-0011) defines *what* to monitor; this ADR defines *how* — the metrics, the funnel, the error tracking, the tooling.

Considered and declined: fully self-hosted observability (Grafana + Loki + GlitchTip on Proxmox). Declined for v1 because build/maintenance effort competes directly with the eight-week pipeline build, and telemetry is not claim content — the foreign-inference rule does not bind it. Revisit if free-tier limits bite mid-campaign (migration cost is low because instrumentation is OpenTelemetry — see decision).

## Decision

**Instrument once with OpenTelemetry; ship on hosted free tiers (Grafana Cloud for metrics/logs/dashboards, Sentry for exceptions); alert into Discord.**

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

**3. Errors and exceptions.** All parser failures, schema mismatches, batch-job failures, and API errors to **Sentry** (free tier), tagged by lane/source/stage/pipeline-version. Exceptions are content-free (stack traces + tags; no claim text in payloads) — the same discipline applies to any payload leaving the estate.

**4. Job health.** Batch jobs (nightly re-verification, reprocessing backfills, health re-probes) report duration/status/failure to the same metrics stream; long-running reprocesses emit progress so backfills are observable, not hoped-about.

### The tooling decision

- **OpenTelemetry for all instrumentation** (traces + metrics + structured logs). This is the load-bearing choice: every stage boundary, LLM call, and job emits OTel; because OTel is vendor-neutral, moving any component between Grafana Cloud, self-hosted Prometheus/Loki, or a future vendor is configuration, not a rewrite.
- **Grafana Cloud free tier** for metrics storage, dashboards, and alert rules. Dashboards: the funnel (per-lane × source), cost, job health, extraction ladder, quality-drift panel (verdict mix, NLI failure rate, Tier-2 rate).
- **Sentry free tier** for exception tracking with release tagging — pipeline version as release, so "errors introduced by yesterday's parser change" is a filter, not an archaeology project.
- **Discord webhook alerts** — the health-ladder escalations (ADR-0011), the 80% cost alert, NLI-failure pages, and harness regressions land in Discord where maintainers already live. Alert routing: warnings go to a channel; only page-level alerts (NLI failure spike, cost overrun, source-down >4h) notify directly.
- **Structured JSON logs** with the reprocessing provenance fields (pipeline version, model version, extraction tier, claim/source IDs) as first-class log fields — one logging schema powers debugging, the funnel, and ADR-0011's failure-cause corpus.

### Store-derived metrics where possible

The evidence store is already the idempotent source of truth with versioned artefacts (ADR-0011 reprocessing), so funnel counts at every stage are **derivable from the store as SQL** — claims by stage × lane × hour. The event stream (OTel) provides the live/operational view; the store provides the reconcilable historical truth. Both being available means the dashboards can be checked against the store — dashboards that disagree with the store indicate instrumentation bugs, which is itself monitored (a daily reconciliation job compares event-count totals to store counts and alerts on drift).

### What this does NOT do (honest boundaries)

- **No user-side analytics here.** Site traffic, contest-form conversion, search behaviour on the public site is a separate concern (and a privacy-sensitive one — it will need its own decision, likely self-hosted Matomo or Plausible, keeping visitor data out of third-party ad-tech).
- **No model-quality metrics in production.** The funnel shows *distribution shifts* that suggest quality drift; real accuracy measurement only happens in the ADR-0008 harness. Production monitors are tripwires, not ground truth.
- **Free-tier limits are a known risk**: if Grafana Cloud or Sentry limits bite mid-campaign, the OTel instrumentation means migrating to self-hosted (Option A infrastructure on Proxmox) is a config change plus a day of ops, not a rebuild. The decision is reversible by design.

## Alternatives considered

- **Fully self-hosted (Grafana + Loki + GlitchTip on Proxmox).** Declined for v1: setup and patching effort competes with the eight-week build; telemetry is not claim content so the sovereignty concern is weak; revisit on free-tier limits. Migration path preserved by OTel instrumentation.
- **Self-built metrics from logs only (no Grafana/Sentry).** Declined: grep-based dashboards don't survive the campaign crunch; the free tiers cost nothing and buy alert routing and error-grouping that would otherwise be hand-rolled.
- **Instrument later ("ship the pipeline first").** Rejected: observability added after the first silent failure is archaeology; the funnel metrics are also how the build itself is debugged in weeks 1–3, so they must exist as the pipeline comes up, not after.

## Consequences

- **Instrumentation ships with each lane** (same rule as health checking): a lane without funnel events is not done. Week-1 lanes come up already emitting OTel.
- **The funnel definition is itself a published artefact**: the methodology page documents the stages and drop-off semantics, consistent with the project's audit posture (and the numbers behind any "coverage" claims on the site are these same store-derived counts).
- **Alert fatigue is a design constraint**: warnings are batched to a channel; only page-level conditions notify. The health ladder's escalation (ADR-0011) and this alerting share one routing layer so a degrading source escalates coherently rather than spamming.
- **Sentry/Grafana accounts need a maintainer identity decision** (personal vs project account) before week 1 — a small operational note, not a design blocker.
- **The reconciliation job** (event stream vs store counts) is the integrity backstop that keeps dashboards trustworthy under reprocessing and backfills.