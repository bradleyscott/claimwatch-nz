# Ingestion design

*Proposed. ADRs: 0006, 0007, 0013, 0018. Companions: `ARCHITECTURE.md`, `VALIDATION-SLICE.md`, `TEST-STRATEGY.md`, `CROSS-CUTTING.md`.*

## 1. Purpose and slice scope

Ingestion turns external publications into **documents with provenance** — never bare text — and hands them to triage (ADR-0006). It never writes verdicts; attribution candidates pass through, verdicts do not (ADR-0002 firewall).

The full system defines six lanes (ADR-0006) plus an institutional lane (ADR-0018). **The slice runs five**, sampled so measured accuracy attests to media types, not a lane:

| Slice lane | Lineage | Risks exercised |
|---|---|---|
| 1. Beehive RSS | ADR-0006 lane 1 | R1 (official prose), R2 (statistical claims) |
| 2. RNZ politics RSS | ADR-0006 lane 4 | R1, R2 |
| 3. YouTube broadcaster captions (1News, Q+A) | ADR-0007 | R3 (Tier-2 captions, media_anchor, quote fidelity), R8 (repeats) |
| 4. One institution source | ADR-0018 | R6 (claims paired with own evidence → citation-check) |
| 5. False-context sample set | VALIDATION-SLICE (not live) | R5 (provenance mode, curated demonstration) |

R7 (extraction-ladder stress) is exercised by every lane — the per-lane Tier-2 fallback rate is both by-product and the markup-drift instrument (ADR-0006).

Deferred with the slice: party pages, Hansard, user submissions, commentator watchlist, PDF lane (R4), the full institutional register.

## 2. Design

### 2.1 Shared pipeline shape

Per ADR-0006, lanes share stages but run as separate workers:

```
[lane worker] → fetch → normalise → attribute (claimant candidates)
             → dedupe → [document record with provenance] → triage queue
```

- **Scheduling**: pg_cron per lane (ADR-0014); run history (`cron.job_run_details`) feeds ADR-0012 job-health metrics.
- **Idempotency**: every stage re-runnable; raw documents retained with `pipeline_version`; reprocessing appends, never overwrites.
- **Extraction ladder** per document (ADR-0006):

| Tier | Mechanism | Slice usage |
|---|---|---|
| 1 — deterministic | per-format parsers (RSS XML → readability HTML; VTT/SRT captions) | always, first |
| 2 — LLM-assisted | schema-constrained extraction (Zod + `generateObject`) | Tier-1 failure; fallback rate logged per lane |
| 3 — degraded | headless render retry → source marked degraded | Tier-2 failure |

Tier-2 invocations persist failure-cause records (what Tier-1 attempted, which validation failed, raw snapshot, failure class) — the corpus that repairs Tier-1 parsers, captured case becoming the regression test.
- **Fetch-from-source** (ADR-0006): server-side re-fetch happens at *verification* time; ingest fetches once and retains raw + hash.
- **Paywall policy**: no circumvention; paywalled content is a claim source, never evidence; fair-dealing quotation with attribution.

### 2.2 Lane 1 — Beehive RSS

`beehive.govt.nz/rss.xml` (verified, 30 items). `fast-xml-parser` → canonical URL → fetch → readability (cheerio). Releases pair policy proposition + claimed evidence in one package — the natural R2 input; the release's own numbers are never the evidence (ADR-0005). Hourly poll; dedupe on GUID + content hash.

### 2.3 Lane 2 — RNZ politics RSS

`rnz.co.nz` political feed (verified, 16 items). Same path as Lane 1; its extra value is a second editorial prose style for R1 measurement. Headlines list cheaply; the slice fetches full articles at ingest, but per-item fetch stays a distinct re-runnable stage so production fetch-on-verify is a config change, not a rewrite.

### 2.4 Lane 3 — YouTube broadcaster captions

The broadcast lane per ADR-0007, exercising R3 end-to-end.

- **Access posture**: low-volume, read-only, public-page caption access for specific items (single-digit requests/day), robots.txt-consistent, no redistribution. ToS compliance boundary, not a nice-to-have; fallback if challenged is publisher web text.
- **Track discovery → tier**: enumerate `captionTracks`; read the track's own metadata. `kind:"asr"` → `transcript_tier = publisher-auto` (Tier-2, guardrails on); English track without the marker → `publisher-reviewed` (Tier-1). Provenance checked, never defaulted.
- **Extraction**: VTT/SRT → speaker-turn-preserving text; cue timestamps are first-class fields.
- **media_anchor** on every caption-sourced claim: `{media_url, start_s, end_s, deep_link}` — cue span ± small pad, YouTube `t=`/`end=` deep link. Renders as the site's "hear it / watch it" control.
- **Tier-2 guardrails** (ADR-0007, non-negotiable): caption text is a **claim pointer, never evidence for a quoted number** — numerical claims verify against official series regardless of caption wording; `caption_quality` flag rides on every Tier-2 claim and verdict pages state the wording rests on unreviewed ASR; wording-critical claims get "verification limited to the quoted claim"; attribution conservative, no diarization; **no self-generated transcription anywhere** — audio-only segments are out of scope and named as a gap on the methodology page.
- **Caption revisions**: re-ingest detects a changed track hash and flags affected claims (cue span enables re-pull).
- Volume ~20–40 items/day — small, cheap, highest-value claims in the corpus.

### 2.5 Lane 4 — one institution source

The Kākā vs NZIER (per VALIDATION-SLICE):

| Dimension | The Kākā | NZIER |
|---|---|---|
| Machine access | **Substack RSS verified** | No RSS → headless scrape |
| Extraction | Same deterministic path as Lanes 1–2 | New scraper + drift monitoring |
| Build cost | ~zero | New Playwright path |
| Claim profile | Housing/climate/poverty claims citable to own posts | Consensus Forecasts — heavily quoted, but forecasts are consistency-checks only |
| Paywall | Paid + free tiers on Substack | Some member-gated |

**Recommendation: The Kākā.** It delivers R6's actual test (claims paired with own evidence → citation-check) through the deterministic feed path, zero new infrastructure — the slice measures the verification mode, not scraper engineering. NZIER is the natural next institution source once the scrape path exists. Paid-tier Kākā items: ingest the truncated feed item, apply the paywall policy, never scrape around it. Advocacy-poll handling (ADR-0018) is post-slice.

### 2.6 Lane 5 — false-context sample set (not a live lane)

A hand-curated set of ~10 known miscaptioned/false-context items — real NZ examples with documented provenance — delivered as a **versioned fixture dataset** (JSON: item URL, media URL, claimed context, verified context, provenance notes, licence status), seeded into the store with the same document-record shape as live lanes.

Purpose: demonstrate the provenance mode and produce per-stratum numbers — **no claim that false-context detection is automatable**. Explicitly not: a scheduler, fetcher, or alerting path; no lane-health registration (nothing to go stale). Its health surface is fixture validation, not liveness.

### 2.7 Health checking (every live lane)

| Monitor | Behaviour |
|---|---|
| Liveness | fetch/parse success; 200-but-zero-items is a distinct alarm |
| Volume anomaly | counts vs per-lane bands |
| Extraction drift | Tier-2 fallback rate — rising rate is the earliest drift signal |
| Staleness | last-new-item age vs cadence; old items forever = stale, not healthy |
| Escalation | retry → headless fallback → degraded → maintainer alert → public coverage page |

Metrics land in Grafana; lane health is SQL views — the public coverage page renders from the same views, so ops and public cannot diverge.

### 2.8 Dedupe at ingest

- **Document-level**: GUID + canonical URL + content hash — the only dedupe that must run here.
- **Claim-level** (fingerprint + embedding, repeat → source-occurrence): straddles ingestion/triage. Ingestion computes embedding inputs and occurrence records; it does not merge claims.

## 3. Interfaces

### 3.1 Document record (what triage receives)

| Field | Meaning |
|---|---|
| `source_id` | registered lane config key |
| `canonical_url` / `retrieved_at` / `retrieval_method` / `content_hash` | provenance |
| `raw_ref` | retained raw document |
| `extraction_method` | tier-1 parser id / tier-2 / degraded |
| `pipeline_version` | provenance |
| `publication_id` / `segment_id?` | ADR-0008 FKs |
| `text` | extracted content |

### 3.2 Per-lane additions

| Lane | Fields |
|---|---|
| Beehive / RNZ | minister/portfolio metadata where present |
| YouTube | `media_anchor`, `transcript_tier`, `caption_quality_flag` (Tier-2), `cue_span`, track hash |
| Institution | organisation entity candidate for attribution |
| False-context | fixture provenance fields; `is_curated_fixture=true` |

### 3.3 Health contract

Each live lane exposes `lane_id`, `last_run_at`, `last_success_at`, `items_seen/new`, `tier2_fallback_rate`, `staleness_state`, `alert_state` — consumed by Grafana and the public coverage page.

### 3.4 Handoff

Document record + extraction provenance + attribution candidates + dedupe inputs → triage queue. Never resolved verdicts; claimant identity never used downstream for verification decisions (ADR-0002).

## 4. Test risks

| ID | Risk | Consequence if untested | Detection signal |
|---|---|---|---|
| ING-R1 | Feed breakage / silent staleness (200 but zero or frozen items) | Coverage collapses invisibly; accuracy table rests on a shrinking sample | Staleness monitor; zero-items-with-200 alarm |
| ING-R2 | Per-media-type extraction quality varies; generic parser silently mangles a lane | The AVeriTeC 297/500 failure mode repeats: extraction "succeeds" but drops content | Per-lane Tier-2 fallback rate; tier cross-check; fixture diffs |
| ING-R3 | `kind:"asr"` misdetection when a creator-uploaded track exists — tier misclassified | Tier-2 trusted as reviewed — the exact ADR-0007 failure | Track-metadata-derived tier vs fixture expectation |
| ING-R4 | media_anchor extraction failure breaks "hear it" links | Demo feature dead-ends; L4 smoke fails at demo time | L1 anchor-field assertions; L4 deep-link check |
| ING-R5 | Duplicate documents/claims on re-ingest | Double triage cost, corrupted per-stratum counts | GUID/hash dedupe counters |
| ING-R6 | Dedupe false positives — distinct claims merged | Real occurrence swallowed; provenance lost | Fixture-pair tests; fingerprint collision tests |
| ING-R7 | YouTube ToS / rate limits breached by over-fetching | Lane shut off; legal exposure | Request-rate metric per lane |
| ING-R8 | Encoding/malformed HTML — mis-encoded Māori macrons, broken markup | Silent text corruption; attribution downstream damaged | Adversarial fixture round-trips |
| ING-R9 | Paywalled content mishandled — truncated text treated as complete | Mis-verification; ToS breach | Fixture: paid-tier item → quoted-claim-only flag |
| ING-R10 | False-context set treated as production lane | Slice overclaims a least-mature mode; credibility damage | No lane-health registration; `is_curated_fixture` gate |
| ING-R11 | Caption revision drift — stored cue no longer matches live track | "Hear it" plays audio that doesn't match the stored quote | Track-hash comparison; affected-claim flag |
| ING-R12 | Health checks themselves fail silently | Monitoring is theatre | pg_cron silence-detection; heartbeat metric |
| ING-R13 | Provenance fields missing at store-write | Firewall and reprocessing guarantees break silently | L1 schema validation; NOT NULL constraints |
| ING-R14 | Tier-2 fallback explosion — markup change flips a whole lane to LLM extraction | Silent cost blowout; the designated drift signal missed | Per-lane fallback-rate anomaly band |

## 5. Test strategy

Every risk maps to a layer per TEST-STRATEGY (L1 every push; L2 every PR; L3 weekly + pre-release; L4a every push, L4b pre-release). Highlights:

| Risk | Mitigation | Layer |
|---|---|---|
| ING-R1 | Fixtures: frozen feed → staleness asserted; dead feed → liveness alarm | L1 + L2 |
| ING-R2 | Per-format parser tests incl. adversarial; tier numeric cross-check; failure-cause persistence | L1 |
| ING-R3 | `captionTracks` payload fixtures: asr → publisher-auto; manual → publisher-reviewed; none → explicit out-of-scope | L1 |
| ING-R4 | Anchor construction tests (cue → padded window → deep-link shape); L4 resolves the link | L1 + L4a |
| ING-R5, R6 | Dedupe fixture pairs: identical copies collapse; near-fingerprint distinct claims don't merge | L1 |
| ING-R7 | Request-budget test against a local fixture server; rate metric asserted | L1 |
| ING-R8 | Macron round-trips, double-encoded entities, malformed HTML — byte-exact comparisons | L1 |
| ING-R9 | Paid-tier fixture: truncated item → quoted-claim-only; no full-text fetch attempted | L1 |
| ING-R10 | Fixture records carry `is_curated_fixture`; never registered with lane health or scheduler | L1 |
| ING-R11 | Changed track hash → affected-claim flagging; re-pull re-resolves the cue span | L1 + L2 |
| ING-R12 | pg_cron run-history fixture with missing run → silence alert | L1 |
| ING-R13 | Zod validation on every emitted record; Drizzle constraints in CI migrations | L1 |
| ING-R14 | Synthetic fallback rates outside bands → alert state | L1 |
| Behavioural | Golden set: one pinned item per lane; extraction changes show as snapshot diffs | L2 |
| Accuracy | Per-stratum extraction quality is a measured L3 output, not an assumption | L3 |
| Site | Hear-it links, ClaimReview on caption-derived pages, methodology table | L4 |

**L1 fixture list**: Beehive feed + release page (tables, macrons); RNZ feed + article (+ malformed-encoding variant); stale/broken feeds (200-zero-items, frozen, malformed XML); `captionTracks` payloads (asr-only, manual-only, both, none); VTT/SRT tracks (asr with cues, manual, empty, revised-hash); media_anchor edge cases (missing end, missing URL, boundary cues); Kākā feed (free + paid-truncated items); dedupe pairs (identical, near-fingerprint, cross-lane repeat); the curated false-context set; rate-budget harness; synthetic pg_cron history + metric series.

## 6. Open questions

1. **Beehive/RNZ lookback and item caps** — per-lane cadence and history depth. Default: hourly polls; GUID-dedupe makes over-fetch harmless.
2. **Caption revision policy** — auto re-process affected claims on track-hash change, or maintainer review first?
3. **media_anchor context-pad size** — seconds of padding for the "hear it" clip; needs a listen-test against real items.
4. **Kākā paid-tier depth** — truncated previews only, or paid items out of scope entirely?
5. **Health-alert routing** — who receives maintainer alerts, via what channel.
6. **NZIER entry criteria** — what justifies adding the scrape path post-slice; via an ADR-0013 public proposal?
7. **False-context set redistribution** — can the curated set's provenance notes be published as-is, or need per-item licence review?
8. **Embedding model for claim-level dedupe** — ADR-0011 routes embeddings; the slice's pick is unpinned.