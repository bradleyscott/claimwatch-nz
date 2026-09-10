# Ingestion design

*Status: proposed. Companion docs: docs/ARCHITECTURE.md, docs/VALIDATION-SLICE.md, docs/TEST-STRATEGY.md, docs/design/CROSS-CUTTING.md. ADRs: 0006, 0007, 0013, 0018.*

## 1. Purpose and slice scope

Ingestion turns external publications into **documents with provenance** — never bare text — and hands them to triage as structured records (ADR-0006). It never writes verdicts; attribution candidates pass through, verdicts do not (ADR-0002 firewall).

The full system defines six claim-source lanes (ADR-0006) plus an institutional lane (ADR-0018). **The validation slice runs five**, deliberately sampled so measured accuracy attests to media types, not to a lane:

| Slice lane | ADR lineage | Risks exercised (VALIDATION-SLICE) |
|---|---|---|
| 1. Beehive RSS | ADR-0006 lane 1 | R1 (structured official prose), R2 (statistical claims) |
| 2. RNZ politics RSS | ADR-0006 lane 4 | R1, R2 |
| 3. YouTube broadcaster captions (1News, Q+A) | ADR-0007 as amended into ADR-0006 | R3 (Tier-2 captions, media_anchor, quote fidelity), R8 (repeat claims) |
| 4. One institution source | ADR-0018 | R6 (claims paired with own evidence → citation-check mode) |
| 5. False-context sample set | VALIDATION-SLICE (not a live lane) | R5 (provenance mode, curated demonstration only) |

R7 (extraction-ladder stress) is exercised by **every** lane: the Tier-2 fallback rate is logged per lane as a by-product and is itself the markup-drift monitoring instrument (ADR-0006).

Deferred with the slice (not designed here): party release pages, Hansard, user submissions, commentator watchlist, PDF/long-document lane (R4), full institutional register (~20–30 parser instances).

## 2. Design

### 2.1 Shared pipeline shape (all lanes)

Per ADR-0006, lanes share stages but run as **separate workers** (no monolithic scraper):

```
[lane worker] → fetch → normalise → attribute (claimant candidates)
             → dedupe → [document record with provenance] → triage queue
```

- **Scheduling** is pg_cron (ADR-0014): each lane's poll job runs in-database with queryable run history (`cron.job_run_details`) feeding ADR-0012's job-health metrics.
- **Idempotency**: every stage is re-runnable; raw documents are retained with `pipeline_version` per artefact; reprocessing appends, never overwrites.
- **Extraction ladder** (ADR-0006), per document:

| Tier | Mechanism | Slice usage |
|---|---|---|
| 1 — deterministic | per-format parsers (RSS XML → readability HTML; VTT/SRT for captions) | always, first |
| 2 — LLM-assisted | schema-constrained extraction over the raw document (Zod + AI SDK `generateObject`) | Tier-1 failure or validation miss; **fallback rate logged per lane** |
| 3 — degraded | headless render retry → source marked degraded | Tier-2 failure |

Tier-2 invocations persist failure-cause records (what Tier-1 attempted, which validation failed, raw snapshot, structured failure class) — the labelled corpus that later repairs Tier-1 parsers, with the captured case as the repaired parser's regression test.
- **Fetch-from-source discipline** (ADR-0006): stored canonical URL; server-side re-fetch happens at *verification* time, not ingest. Ingest fetches once, retains raw + hash.
- **Paywall policy** (ADR-0006): no circumvention. Paywalled content is a claim source, never evidence; minimal fair-dealing quotation with attribution.

### 2.2 Lane 1 — Beehive RSS

- Source: `beehive.govt.nz/rss.xml` (verified working, 30 items — SOURCE-TAXONOMY probe). `fast-xml-parser`; item → canonical URL → fetch → readability extraction (cheerio).
- Release pages pair policy proposition + claimed evidence in one package — the natural R2 input: statistical claims whose verification reconstructs the field from official series (the release's own numbers are never the evidence, per ADR-0005).
- Cadence: hourly poll; dedupe on GUID + content hash. Lookback window and item cap are slice configuration (§6).

### 2.3 Lane 2 — RNZ politics RSS

- Source: `rnz.co.nz` political feed (verified, 16 items). Same normalise path as Lane 1; the lane's value beyond mechanics is a second *editorial* prose style for R1 extraction quality measurement.
- Fetch-on-verify discipline applies (ADR-0006): headlines list cheaply; full article fetched at ingest for slice-scale volume, but the per-item fetch stays a distinct, re-runnable stage so the production fetch-on-verify mode is a config change, not a rewrite.

### 2.4 Lane 3 — YouTube broadcaster captions (1News, Q+A)

The broadcast lane per ADR-0007, exercising R3 end-to-end.

- **Access posture**: low-volume, read-only, public-page access of caption tracks for specific broadcast items (single-digit requests/day), robots.txt-consistent, no redistribution of caption files. YouTube ToS prohibits bulk automated access — this posture is the compliance boundary, not a nice-to-have. Fallback if challenged: same content via publisher web text.
- **Caption-track discovery**: enumerate `captionTracks` for the target video; read the track's own metadata to determine provenance. `kind: "asr"` → auto-generated → `transcript_tier = publisher-auto` (Tier-2, guardrails on). English track without the marker → creator-uploaded → `transcript_tier = publisher-reviewed` (Tier-1). **Provenance is checked, not assumed** — tier classification is derived from track metadata on every ingest, never defaulted.
- **Extraction**: VTT/SRT → speaker-turn-preserving text; **cue timestamps are first-class fields** (start/end seconds per cue).
- **media_anchor** on every caption-sourced claim: `{media_url, start_s, end_s, deep_link}` — utterance span (cue span ± small context pad) plus a YouTube `t=`/`end=` deep link. This is what renders as the site's "hear it / watch it" control (ADR-0007; the slice's demo moment per VALIDATION-SLICE).
- **Guardrails on Tier-2 claims** (all per ADR-0007, non-negotiable):
  - Caption-derived text is a **claim pointer, never the evidence for a quoted number** — numerical claims verify against official series via the stat engine regardless of caption wording.
  - `caption-quality` flag rides on every Tier-2-derived claim; verdict pages state the wording rests on unreviewed ASR and link the video + timestamp.
  - Claims whose exact wording matters get "verification limited to the quoted claim" treatment.
  - Attribution is conservative (never guessed); no diarization.
  - **No self-generated transcription anywhere in the lane** — no MP3/ASR fallback path exists in code. Audio-only segments without captions are out of scope and visible as a stated gap on the methodology page.
- **Caption revision handling**: YouTube can revise captions after upload; the cue span stored on the claim lets re-processing re-pull the same cue. Slice posture: re-ingest detects changed track hash and flags affected claims (§6 for the full policy).
- Volume: ~20–40 caption items/day across monitored channels (ADR-0007) — small, cheap in triage, highest-value claims in the corpus.

### 2.5 Lane 4 — one institution source

Choice per VALIDATION-SLICE: The Kākā (Substack RSS) or NZIER (scrape). Trade-offs from ADR-0018's live probes:

| Dimension | The Kākā | NZIER |
|---|---|---|
| Machine access | **Substack RSS verified working** (`thekaka.substack.com/feed`) | No RSS found (404 on feed paths) → headless listing scrape |
| Extraction determinism | Feed items → standard HTML article parse; same path as Lanes 1–2 | Listing scrape + per-publication page parse; markup drift risk (ADR-0006 health machinery needed) |
| Marginal build cost | ~zero — reuses Lane 1/2 parser stack | New scraper instance + Playwright path + drift monitoring |
| Claim profile (R6) | Independent political-economy newsletter; housing/climate/poverty; claims citable to its own posts | Consensus Forecasts + Quarterly Survey of Business Opinion — heavily quoted; but *forecasts are claims about the future*, checkable only as consistency claims (SOURCE-TAXONOMY §2.3) |
| Paywall | Paid + free tiers on Substack | Some publications member-gated |
| Party-blind register | Added by reach criteria via public decision record (ADR-0013/0018) | Same |

**Recommendation: The Kākā for the slice.** It delivers R6's actual test (claims paired with own evidence → citation-check mode) through the same deterministic feed path as Lanes 1–2, with zero new infrastructure and a verified feed — the slice measures the *verification mode*, not scraper engineering. NZIER remains the natural next institution source once the scrape path + health machinery is exercised by the party lane; its forecast claims add a distinct consistency-check class worth its own slice item later.

- **Kākā ingestion detail**: ingest free-tier RSS items fully; paid-tier items are truncated in the feed — apply the paywall policy (claim source, never evidence; quoted-claim-only treatment where the full text is unavailable). Do not scrape around the paywall.
- Poll handling (ADR-0018) is not exercised by this lane in the slice (The Kākā is not a poll publisher); the advocacy-poll record shape is post-slice.

### 2.6 Lane 5 — false-context sample set (NOT a live lane)

- A **hand-curated set of ~10 known miscaptioned / false-context items** — real NZ examples with documented provenance (where the image/clip came from, what the false caption claims, what the true context is).
- Delivered as a **versioned fixture dataset in the repo** (JSON with per-item provenance fields: item URL, media URL, claimed context, verified context, provenance notes, licence/attribution status), loaded by a seed script into the store with the same document-record shape as live lanes.
- Purpose: the slice **demonstrates** the provenance mode on curated items and measures how the pipeline handles them (per VALIDATION-SLICE: "demonstrate, don't pretend production-ready"). It produces per-stratum accuracy numbers for the provenance mode; it makes **no** claim that false-context detection is automatable — provenance verification is the least mature mode.
- **Explicitly not**: a scheduler, a fetcher, or an alerting path. The lane has no health checks (nothing to go stale), no rate limits (no live fetching beyond what the harness needs to view media), and must never appear in lane-health dashboards as a "healthy lane" — its health surface is the fixture dataset's validation, not liveness.

### 2.7 Health checking (ADR-0006, every live lane)

| Monitor | Behaviour |
|---|---|
| Liveness | fetch/parse success per run; HTTP 200-but-zero-items is a **distinct alarm**, not "quiet day" |
| Volume anomaly | item counts vs per-lane bands; sudden spike/drop alerts |
| Extraction drift | Tier-2 fallback rate per lane — rising rate is the earliest markup-drift signal |
| Staleness | last-new-item timestamp per lane vs expected cadence; a feed serving old items forever is stale, not healthy |
| Escalation ladder | retry → headless fallback → source marked degraded → maintainer alert → **public coverage page** — never silently absent |

Extraction failures join fetch failures as alertable defects. Metrics land in Grafana (ADR-0012); scheduling state comes from pg_cron run history. Lane health is queryable as SQL views (the ADR-0012 store-SQL funnel) — the public coverage page renders from the same views, so what ops sees and what the public sees cannot diverge.

### 2.8 Deduplication at ingest (ADR-0006)

- **Document-level**: GUID/feed ID + canonical-URL + content-hash — identical syndicated copies are collapsed at ingest. This is the only dedupe that *must* run in the ingestion component.
- **Claim-level** (fingerprint + pgvector embedding match; repeat claims gain source-occurrences rather than new queue entries) straddles ingestion and triage: embeddings and fingerprints are computed on document text at normalise, but occurrence-merging decisions belong to claim detection. The ingestion component provides the embedding inputs and the source-occurrence records; it does not merge claims. Cross-lane provenance is preserved — "everyone was saying it" stays auditable.

## 3. Interfaces and contracts

### 3.1 Document record (what triage receives)

Every lane emits the same shape (Drizzle-typed, per ADR-0014):

| Field | Meaning |
|---|---|
| `source_id` | registered lane/source config key |
| `canonical_url` | resolved canonical URL |
| `retrieved_at` | retrieval timestamp |
| `retrieval_method` | direct fetch / feed / caption-track |
| `content_hash` | hash of raw payload at retrieval |
| `raw_ref` | retained raw document (reprocessability) |
| `extraction_method` | tier-1 parser id / tier-2 / degraded |
| `pipeline_version` | pipeline + model version provenance |
| `publication_id` / `segment_id?` | discourse-context FKs (ADR-0008) |
| `text` | extracted content, per-format parser output |

### 3.2 Per-lane additional fields

| Lane | Additional fields |
|---|---|
| Beehive / RNZ | standard document record; minister/portfolio metadata where present in feed |
| YouTube captions | `media_anchor {media_url, start_s, end_s, deep_link}`; `transcript_tier` (`publisher-reviewed` \| `publisher-auto`); `caption_quality_flag` (Tier-2 only); `cue_span` (start/end for re-pull); caption-track hash |
| Institution | standard record; organisation entity candidate for attribution (ADR-0005 entity model) |
| False-context set | fixture provenance fields as §2.6; `is_curated_fixture=true` |

### 3.3 Health-check contract

Each live lane exposes: `lane_id`, `last_run_at`, `last_success_at`, `items_seen`, `items_new`, `tier2_fallback_rate`, `staleness_state` (fresh / stale / zero-items / degraded), `alert_state`. Consumed by Grafana dashboards (ADR-0012) and the public coverage page.

### 3.4 Handoff contract

Ingestion passes document records + claimant-entity *candidates* (never resolved verdicts, never claimant identity used downstream for verification decisions — ADR-0002) to the triage queue, with source-occurrence inputs for dedupe. The queue contract is: document record + extraction provenance + attribution candidates + dedupe inputs.

## 4. Test risks

| ID | Risk | Where it lives | Consequence if untested | Detection signal |
|---|---|---|---|---|
| ING-R1 | Feed breakage / silent staleness — feed 200s but serves zero or frozen items | Lanes 1, 2, 4 (Beehive, RNZ, Kākā) | Coverage silently collapses; the corpus looks healthy while nothing new arrives; the per-stratum accuracy table rests on a shrinking sample | Staleness monitor: last-new-item age vs cadence; zero-items-with-200 alarm |
| ING-R2 | Extraction quality differs per media type; a generic parser silently mangles one lane's content | All lanes; extraction ladder Tier 1 | The AVeriTeC 297/500 failure mode repeats: extraction "succeeds" but drops content (tables, quotes, cue text), degrading verdicts invisibly | Per-lane Tier-2 fallback rate; numeric cross-check between tiers; fixture diffs |
| ING-R3 | Caption track absent, or `kind:"asr"` misdetectd when a creator-uploaded track exists — tier misclassification | Lane 3 caption-track discovery | Tier-1 treated as Tier-2 (over-flagging) or Tier-2 treated as reviewed (fabrication-adjacent trust in unreviewed ASR — the exact ADR-0007 failure) | Track-metadata-derived tier vs fixture expectation; caption-track probe assertions |
| ING-R4 | media_anchor extraction failure breaks "hear it" links — missing/offset cue times, missing video URL | Lane 3 → site | The site's demo feature dead-ends; caption-derived claims become unverifiable dead-end assertions; L4 Playwright smoke fails at demo time | L1 anchor-field assertions; L4 deep-link resolution check |
| ING-R5 | Duplicate documents inflate the corpus / duplicate claims queue twice | Dedupe stage, all lanes | Same claim processed twice → double triage cost, double verdict records, corrupted per-stratum counts | GUID/hash dedupe counters; claim-level occurrence counts |
| ING-R6 | Dedupe false positives — distinct claims merged (same fingerprint, different claimant/context) | Dedupe stage | A real second occurrence is swallowed; "everyone was saying it" provenance lost or wrong | Occurrence-record review on fixture pairs; fingerprint collision tests |
| ING-R7 | Rate limits / robots / ToS violations — YouTube access posture breached by over-fetching; RNZ/Beehive rate limits | Lane 3 access layer; all fetchers | Lane shut off by platform; legal exposure; the ADR-0007 posture collapses | Request-rate metric per lane in Grafana; access-log assertions on request counts |
| ING-R8 | Encoding / malformed HTML — feeds or pages with bad entities, mis-encoded Māori macrons (te reo in NZ political text), broken markup | Normalise/extraction, all lanes | Silent text corruption; macron damage corrupts names and entities downstream (attribution, entity linking) | Adversarial fixture round-trips; charset assertions |
| ING-R9 | Paywalled content mishandled — paid-tier Kākā items ingested as if full text, or circumvention attempted | Lane 4 | ToS/legal breach; or truncated text silently treated as complete document → mis-verification | Fixture: paid-tier truncated item; assertion that truncated items carry quoted-claim-only treatment |
| ING-R10 | False-context set treated as an automatable production lane (scheduler, health checks, "production-ready" claims) | Lane 5 | The slice overclaims: a least-mature mode is presented as working infrastructure; credibility damage when it fails on live data | Fixture-set validation only; no lane-health registration; explicit `is_curated_fixture` gate |
| ING-R11 | Caption revision drift — YouTube revises a track after ingest; stored cue text no longer matches the live track | Lane 3 | Quote fidelity breaks silently; the "hear it" link plays audio that doesn't match the stored quote | Track-hash comparison at re-ingest; affected-claim flag |
| ING-R12 | Health checks themselves fail silently (monitor-of-monitors gap) — Grafana panel quiet because the job never ran | §2.7, pg_cron | All lane health is theatre; the silently-empty-feed failure ADR-0006 guards against happens *to the monitoring itself* | pg_cron `job_run_details` silence-detection; heartbeat metric |
| ING-R13 | Provenance fields missing at store-write — verdict pages unauditable, attribution blocked downstream | Document-record contract, all lanes | ADR-0002 firewall and ADR-0006 provenance guarantees break silently; reprocessing impossible | L1 schema validation on every emitted record; store NOT NULL constraints |
| ING-R14 | Tier-2 fallback explosion — a markup change flips a whole lane to LLM extraction unnoticed (cost + quality) | Extraction ladder, all lanes | Silent cost blowout and degraded extraction quality; drift signal that ADR-0006 designates as primary is missed | Per-lane fallback-rate anomaly band; Grafana alert |

## 5. Test strategy

Every §4 risk maps to a test layer per docs/TEST-STRATEGY.md (L1 deterministic / L2 golden-set / L3 accuracy harness / L4 site verification) with its run cadence.

| Risk | Mitigation | Layer | When it runs |
|---|---|---|---|
| ING-R1 | Fixture: frozen feed (200 + zero new items) → staleness state asserted; fixture: dead feed → liveness alarm. Staleness monitor covered by L1 logic tests on synthetic timestamps; real-cadence behaviour verified in L2 | L1 + L2 | Every push (L1); every PR (L2) |
| ING-R2 | Per-format parser tests against per-lane fixtures including adversarial cases; Tier-1/Tier-2 numeric cross-check test; failure-cause record asserted to persist | L1 | Every push |
| ING-R3 | Caption-track discovery tests on captured `captionTracks` payloads: asr track → publisher-auto; manual track → publisher-reviewed; no track → explicit out-of-scope outcome, never a silent skip | L1 | Every push |
| ING-R4 | `media_anchor` construction tests (cue span → padded window → deep-link URL shape); L4 Playwright asserts the rendered deep link resolves with correct `t=`/`end=` parameters | L1 + L4 | Every push (both — L4a) |
| ING-R5, ING-R6 | Dedupe fixture pairs: identical syndicated copies (collapse asserted), distinct claims with near-identical fingerprints (non-merge asserted); occurrence-record provenance assertions | L1 | Every push |
| ING-R7 | Request-budget test: lane worker against a local fixture server asserts requests-per-run ≤ configured budget; rate metric emitted to Grafana asserted | L1 | Every push |
| ING-R8 | Adversarial encoding fixtures: macron round-trips (whāinga, te reo terms), double-encoded entities, malformed HTML — extraction output compared byte-exact to expected text | L1 | Every push |
| ING-R9 | Paid-tier fixture: truncated Substack item → asserted quoted-claim-only flag; asserted no full-text fetch attempted | L1 | Every push |
| ING-R10 | Schema test: fixture records carry `is_curated_fixture=true`; test asserts the false-context set never registers with lane health and never enters the scheduler | L1 | Every push |
| ING-R11 | Caption revision fixture: changed track hash → affected-claim flagging asserted; re-pull re-resolves the stored cue span | L1 + L2 | Every push; PR golden snapshots show affected claims |
| ING-R12 | Silence-detection test: pg_cron run-history fixture with a missing run → silence alert asserted; heartbeat metric presence asserted | L1 | Every push |
| ING-R13 | Zod schema validation on every emitted record in L1; Drizzle NOT NULL/migration tests in CI against scratch Postgres (ADR-0014 schema-drift alarm) | L1 | Every push |
| ING-R14 | Fallback-rate band test: synthetic per-lane rates outside bands → alert state asserted; trend visible in Grafana dashboard definition tests | L1 | Every push |
| All lanes (behavioural) | Golden-set snapshots include one pinned item per lane; an ingestion change that alters extracted text shows as a visible snapshot diff | L2 | Every PR |
| Cross-lane accuracy | Per-stratum accuracy table (VALIDATION-SLICE) — extraction quality per media type is a *measured output*, not an assumption; stratified labels across five lanes × modes | L3 | Weekly + pre-release |
| Site integration | "Hear it / watch it" link rendering, ClaimReview on caption-derived verdict pages, methodology page accuracy table generated from harness output | L4 | Every push (L4a) / pre-release (L4b) |

### Per-lane fixture list (L1 surface)

| Fixture | Contents | Risks covered |
|---|---|---|
| Beehive feed + release page | valid RSS with entities; release HTML with table of figures; macron-bearing minister names | ING-R1, R2, R5, R8, R13 |
| RNZ feed + article | politics RSS item; article HTML with embedded quotes; malformed-encoding variant | ING-R1, R2, R8, R13 |
| Beehive/RNZ stale + broken feeds | 200-with-zero-items; frozen-old-items; malformed XML; dead URL | ING-R1, R2, R12 |
| Caption-track payloads | `captionTracks` response: asr-only; manual-only; both; none | ING-R3, R13 |
| VTT/SRT tracks | asr track with cue timestamps; manual track; empty transcript; revised track (hash delta) | ING-R3, R4, R11, R2 |
| media_anchor cases | normal cue span; missing end time; missing video URL; cue at video start/end boundaries | ING-R4 |
| Kākā Substack feed | free-tier item; paid-tier truncated item; encoding edge cases | ING-R1, R9, R8, R13 |
| Dedupe pairs | identical syndicated copies; near-fingerprint distinct claims; cross-lane repeat pair | ING-R5, R6 |
| False-context sample set | the ~10 curated items themselves (versioned dataset), validated against fixture schema | ING-R10, R13 |
| Rate-budget harness | local fixture server + request counters per lane worker | ING-R7 |
| Health/silence synthetic | synthetic pg_cron run history; synthetic per-lane metric series | ING-R12, R14, R1 |

## 6. Open questions

Genuinely undecided items only — each needs a decision before or during slice build.

1. **Beehive/RNZ lookback and item caps** — how much feed history the slice ingests per run (affects triage cost and the L2 golden-set pinning) and what cadence per lane. Default proposal: hourly polls, GUID-dedupe makes over-fetch harmless; cap under-specified.
2. **Caption revision policy** — when a re-ingest detects a changed caption-track hash: auto re-process affected claims, or flag for maintainer review first? The cue-span re-pull mechanism exists (ADR-0007); the trigger policy is undecided.
3. **media_anchor context-pad size** — seconds of padding around the cue span for the "hear it" clip. Needs a listen-test against real 1News/Q+A items to pick.
4. **Kākā paid-tier depth** — ingest truncated free previews only (current posture), or treat paid items as out-of-scope entirely? Depends on how much of the election-project series sits behind the paywall.
5. **Health-alert routing** — who receives maintainer alerts and via what channel (Grafana alerting exists per ADR-0012; the routing/contact surface for a two-person project is undecided).
6. **NZIER entry criteria** — what claim volume or coverage gap from the Kākā lane justifies adding the NZIER scrape path post-slice, and whether it enters via an ADR-0013 public proposal rather than maintainer selection (exercising the pathway it designed).
7. **False-context set redistribution** — whether the curated set's provenance notes and item references can be published in the open repo as-is, or need takedown/licence review per item.
8. **Ingestion-side embedding model choice** for the pgvector inputs feeding claim-level dedupe — provider routing is ADR-0011's, but which embedding model the slice uses for repeat detection is not pinned.