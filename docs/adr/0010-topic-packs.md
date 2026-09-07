# ADR-0010: Topic packs — pre-computed evidence fields and sensitivity grids for the seeded policy domains

*Status: Proposed · Date: 2026-09-07 · Deciders: Bradley, Dave*

## Context

ADR-0004 defines the verification layer: statistical claims resolve by fingerprint-match and sensitivity check against **topic packs**, rather than open-web retrieval. ADR-0009 seeds the domain taxonomy up front (NZ Parliament select-committee subject areas, standard classification families) and refines it claim-derived. `docs/SOURCE-TAXONOMY.md` maps trusted authorities (T1–T6) and denominator families per domain. `docs/MISINFO-TAXONOMY.md` adds the empirical distributions that prioritise which claims matter (electoral-integrity the top verified-disinformation topic; selective statistics the core campaign pattern).

What does not yet exist is the topic-pack specification itself: what a pack contains, how the seed list is scoped for the 2026 cycle, how the sensitivity grid is defined and published, and how packs evolve. This ADR is that specification — the last design gate before the ingestion-architecture ADR and pipeline code.

## Decision

### Pack anatomy

A topic pack is a versioned, party-blind, published artefact containing, per indicator:

1. **Indicator definition** — the canonical statistical identity: indicator × population × geography × time-series span × unit. Named series IDs from the T1/T2 authority (e.g. Stats NZ dataset reference, MoJ table reference).
2. **Authority references** — primary authority (T1/T2) with series URL and vintage policy; alternates (T3/T4/T5) with their role (cross-check, denominator-family member, comparison cohort).
3. **The evidence field** — the full dataset: the canonical series plus every denominator-family member the sensitivity grid will compute (e.g. recorded offences *and* victim-survey prevalence *and* per-capita rates for a crime pack).
4. **The sensitivity grid** — the pre-declared alternative framings (below).
5. **Series vintages and revision policy** — when each series revises, what the revision history looks like, and how verdicts note "as measured at publication".
6. **Known limitations** — coverage gaps, series breaks, anything a hostile reader should know before we do.

### The sensitivity grid (pre-declared, published before campaign peak)

The grid is the criterion by which "accurate but incomplete" verdicts are made. It is identical for every claim about an indicator, published on the verdict page itself. The standard grid computes, per claim fingerprint:

| Grid axis | Variants computed |
|---|---|
| **Time window** | the claimed window vs 5-yr / 10-yr / full-series; endpoint-trick detector (does the sign of the trend flip under a nearby start month?) |
| **Normalisation** | raw counts vs per-capita / per-100k / per-household |
| **Denominator family** | the alternate official measures for the indicator (e.g. recorded offences vs victim-survey prevalence) |
| **Comparison cohort** | NZ-wide vs OECD/peer-country (only where a T6 series is maintained) |
| **Seasonality/averaging** | cherry month vs annual average; seasonally-adjusted vs raw |

Verdict logic against the grid: if the quoted framing survives all grid variants → **"accurate"**; if material alternatives reverse or contradict the claimed impression → **"accurate but incomplete"** with the alternatives shown chart-first. The grid definition — which alternatives count as "reasonable" — is fixed per pack before the campaign and not adjusted mid-campaign (ADR-0006's mutation-freeze logic applies to the grid too).

### Seed list for the 2026 cycle

Nine packs, prioritised by (a) AVeriTeC/EU-2024 empirical topic frequency, (b) NZ campaign history, (c) evidence tractability:

| Priority | Pack | Primary authority (T1/T2) | Notes |
|---|---|---|---|
| **0 — highest** | **Electoral process** | Electoral Commission | Single T1 authority; trivial verification; s 199A interaction; fastest lane (see `docs/MISINFO-TAXONOMY.md` §3) |
| 1 | Crime & justice | Police (policedata.nz); MoJ | Denominator family: recorded vs NZCVS victim survey |
| 2 | Immigration | Stats NZ international migration | Net vs arrivals vs departures; citizen vs non-citizen |
| 3 | Health | Te Whatu Ora / MoH waitlists; NZ Health Survey | Waitlist vs wait-*time*; FSA vs treatment |
| 4 | Housing | Stats NZ consents; RBNZ/HUD prices | Consents vs completions; prices vs rents |
| 5 | Economy & fiscal | Stats NZ (CPI, GDP); Treasury forecasts | Real vs nominal; quarterly vs annual |
| 6 | Employment | Stats NZ HLFS | Unemployment vs underutilisation vs benefit counts |
| 7 | Welfare & child poverty | MSD; Stats NZ child-poverty statistics | The three official measures (BHC50, AHC50, material hardship) |
| 8 | Education | MoE; ERO | Attendance vs achievement; cohort-based vs raw pass rates |

Packs 9+ (climate, energy, transport, primary/rural, Māori outcomes, state sector — per `docs/SOURCE-TAXONOMY.md` §2.2) are built post-election or opportunistically as claim volume justifies.

**Pack construction is batch work** (per ADR-0007's batch economics): series retrieval, grid computation, and chart pre-generation run through batch APIs and Fireworks-style hosts at the 50% discount. A pack build is a scheduled job, not a live-path task.

### Pack lifecycle

- **Versioned and published openly** (CC BY 4.0) before campaign peak — the grid is the published criterion, and it must exist before the campaign peak so it cannot be adjusted per claim.
- **Party-blind construction**: pack contents are defined by indicator and authority, never by who is quoting them.
- **Claim-derived refinement**: clustering the live claim corpus reveals where the seed taxonomy under-splits (new sub-areas emerging as claim clusters) or over-splits (dormant domains); adjustments go through maintainer decision records (ADR-0009).
- **Community extension of the evidence field**: a validated contest submission proposing an additional series or denominator (e.g. "you're missing the victim-survey series for this indicator") extends the pack's evidence field after passing the ADR-0009 authority-proposal gate. The pack grows; existing grid results are preserved.
- **Claim resolution**: a live claim is fingerprint-extracted, matched to a pack, and the sensitivity grid computed against the pack's cached series — seconds, not agent loops. Claims that match no pack fall to the open-web loop with visible "no pre-vetted authority for this domain" labelling.
- **Re-verification**: packs store series vintages so verdicts can note "as measured at publication", and a nightly batch job re-verifies verdicts whose underlying series has since revised.

## Alternatives considered

- **Compute sensitivity variants live per claim (no pre-computed packs).** Rejected: slower, costlier, and less reproducible; pre-computation is also what makes batch pricing apply.
- **Fewer, broader packs** (e.g. one "social statistics" pack). Rejected: denominator families are indicator-specific; breadth without indicator-level identity produces generic context, not the alternatives that matter.
- **Ship all 14 domains in v1.** Rejected: eight fully-specified packs cover the highest-traffic campaign claims; the remaining six arrive post-election or as claim volume justifies — visible on the site's coverage page rather than silently absent.
- **Grid defined per-claim by the LLM at verification time.** Rejected: the grid is the published criterion; per-claim grid invention is the "you invented the standard to hurt us" vulnerability the pre-declaration exists to prevent. The LLM selects *which grid rows are material* to a given claim; it does not author the grid.

## Consequences

- The stat-engine's accuracy claim is anchored: every verdict resolves to a published pack and a pre-declared grid, re-derivable by any reader.
- Grid definitions need sign-off before campaign peak (part of the pre-launch checklist; flagged for the harness — grid rows are stratifiable claim types in the labelled set).
- Pack maintenance is ongoing work (series revisions, URL moves — per COVERAGE.md's health-check pattern); the authority-map owner from ADR-0009 owns pack currency.
- The packs are a dataset asset: versioned NZ indicator series with denominator families, reusable by journalists and researchers independent of the pipeline.