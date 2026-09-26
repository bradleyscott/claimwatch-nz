# Ingestion design

*ADRs: 0006, 0007, 0013, 0018, 0019. Companions: `ARCHITECTURE.md`, `VALIDATION-SLICE.md`, `TEST-STRATEGY.md`, `CROSS-CUTTING.md`.*

## 1. Purpose and slice scope

Ingestion turns outside publications into documents that carry their provenance, never bare text, and
hands them to triage. It never writes verdicts. Attribution candidates pass through; verdicts do not.

The full system defines six lanes plus an institutional lane. The first build slice runs five of them,
chosen so that measured accuracy speaks to the media types rather than to a single lane.

*References: ADR-0002, ADR-0006, ADR-0018.*

| Slice lane | Lineage | Risks exercised |
|---|---|---|
| 1. Beehive RSS | ADR-0006 lane 1 | R1 (official prose), R2 (statistical claims) |
| 2. RNZ politics RSS | ADR-0006 lane 4 | R1, R2 |
| 3. YouTube broadcaster captions (1News, Q+A) | ADR-0007 | R3 (Tier-2 captions, media_anchor, quote fidelity), R8 (repeats) |
| 4. One institution source | ADR-0018 | R6 (claims paired with own evidence → citation-check) |
| 5. False-context sample set | VALIDATION-SLICE (not live) | R5 (provenance mode, curated demonstration) |

Every lane exercises R7 (extraction-ladder stress). The per-lane Tier-2 fallback rate is both its
by-product and our markup-drift instrument (ADR-0006).

Deferred with the slice: party pages, Hansard, user submissions, the commentator watchlist, the PDF
lane (R4), and the full institutional register.

## 2. Design

### 2.1 Shared pipeline shape

Lanes share the same stages but run as separate workers:

```
[lane worker] → fetch → normalise → attribute (claimant candidates)
             → dedupe → [document record with provenance] → triage queue
```

- **Attribution.** The `attribute` stage works out who is speaking in each sentence, and therefore
  which sentences may become claims at all. Before this existed, every sentence was a candidate and
  lane 2 published a verdict about a journalist's own narration (ADR-0019, §2.9).
- **Scheduling.** One Graphile Worker per lane; job history (`graphile_worker.jobs`) feeds the
  job-health metrics (STORE §2.3, ADR-0012).
- **Idempotency.** Every stage can be re-run. Raw documents are kept with `pipeline_version`, and
  reprocessing appends rather than overwrites.
- **Extraction ladder**, per document:

| Tier | Mechanism | Slice usage |
|---|---|---|
| 1 — deterministic | per-format parsers (RSS XML → readability HTML; VTT/SRT captions) | always, first |
| 2 — LLM-assisted | schema-constrained extraction (Zod + `generateObject`) | Tier-1 failure; fallback rate logged per lane |
| 3 — degraded | headless render retry → source marked degraded | Tier-2 failure |

When Tier 2 runs, it records why Tier 1 failed: what it tried, which check failed, a raw snapshot, and
a failure class. That corpus is what repairs the Tier-1 parsers, and each captured case becomes a
regression test.

- **Fetch from source.** The server re-fetches at verification time. Ingest fetches once and keeps
  the raw copy and its hash (ADR-0006).
- **Paywalls.** No circumvention. Paywalled content is a claim source, never evidence for itself, and
  we quote it under fair dealing with attribution.

### 2.2 Lane 1 — Beehive RSS

`beehive.govt.nz/rss.xml` (verified, 30 items). The path is `fast-xml-parser` → canonical URL → fetch
→ readability via cheerio. A release bundles a policy proposition with the evidence it claims, which
makes it the natural R2 input; the release's own numbers are never the evidence for it. Hourly poll;
dedupe on GUID and content hash.

### 2.3 Lane 2 — RNZ politics RSS

`rnz.co.nz` political feed (verified, 16 items). Same path as Lane 1. Its extra value is a second
editorial voice to measure R1 against. The slice fetches full articles at ingest, but fetching a
single item stays its own re-runnable stage, so moving to fetch-on-verify in production is a config
change rather than a rewrite.

### 2.4 Lane 3 — YouTube broadcaster captions

The broadcast lane per ADR-0007, exercising R3 end-to-end.

- **Access posture**: low-volume, read-only, public-page caption access for specific items (single-digit requests/day), robots.txt-consistent, no redistribution. ToS compliance boundary, not a nice-to-have; fallback if challenged is publisher web text.
- **Track discovery and tier.** List the item's `captionTracks` and read each track's own metadata.
  A track marked `kind:"asr"` sets `transcript_tier = publisher-auto` (Tier-2, guardrails on); an
  English track with no such marker is `publisher-reviewed` (Tier-1). We check provenance and never
  assume it.
- **Extraction**: VTT/SRT → speaker-turn-preserving text; cue timestamps are first-class fields.
- **media_anchor** on every caption-sourced claim: `{media_url, start_s, end_s, deep_link}` — cue span ± small pad, YouTube `t=`/`end=` deep link. Renders as the site's "hear it / watch it" control.
- **Tier-2 guardrails** (ADR-0007, non-negotiable). Caption text is a **claim pointer, never the
  evidence for a quoted number** — a numerical claim verifies against the official series whatever
  the caption says. Every Tier-2 claim carries a `caption_quality` flag, and the verdict page states
  that the wording rests on unreviewed speech recognition. Wording-critical claims get "verification
  limited to the quoted claim". Attribution stays conservative; we do no diarization. And there is
  **no self-generated transcription anywhere** — audio-only segments are out of scope, and the
  methodology page names that gap.
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

**Recommendation: The Kākā.** It delivers R6's real test — a claim paired with its own evidence,
routed to citation-check — over the deterministic feed path, with no new infrastructure. That keeps
the slice measuring the verification mode rather than scraper engineering. NZIER is the natural next
institution source once a scrape path exists. For paid Kākā items, ingest the truncated feed item and
apply the paywall policy; never scrape around it. Advocacy-poll handling is post-slice (ADR-0018).

### 2.6 Lane 5 — false-context sample set (not a live lane)

A hand-curated set of about ten known miscaptioned or false-context items — real New Zealand examples
with documented provenance — shipped as a versioned fixture dataset (JSON: item URL, media URL,
claimed context, verified context, provenance notes, licence status). They are seeded into the store
with the same document shape as a live lane.

Its job is to demonstrate the provenance mode and produce per-group numbers. It does **not** claim
that false-context detection is automatable. It has no scheduler, fetcher, or alert path, and no
lane-health registration, because nothing about it can go stale. Its health is fixture validation,
not liveness.

### 2.7 Health checking (every live lane)

| Monitor | Behaviour |
|---|---|
| Liveness | fetch/parse success; 200-but-zero-items is a distinct alarm |
| Volume anomaly | counts vs per-lane bands |
| Extraction drift | Tier-2 fallback rate — rising rate is the earliest drift signal |
| Staleness | last-new-item age vs cadence; old items forever = stale, not healthy |
| Escalation | retry → headless fallback → degraded → maintainer alert → public coverage page |

Metrics land in Grafana. Lane health is SQL views, and the public coverage page renders from those
same views, so the ops view and the public view cannot diverge.

### 2.8 Dedupe at ingest

- **Document level.** GUID, canonical URL, and content hash. This is the only dedupe that must run
  here.
- **Claim level** (fingerprint plus embedding, with a repeat becoming a source-occurrence). This
  straddles ingestion and triage: ingestion computes the embedding inputs and the occurrence records,
  and does not merge claims.

### 2.9 Speakership attribution and claim scope (ADR-0019)

The `attribute` stage (§2.1) works out who is speaking in each sentence of a document, and therefore
which sentences are eligible to become claims. This is a scope decision, not a refinement of entity
resolution. Without it every sentence is a candidate, and a news report's narration gets fact-checked
as if the outlet had made a claim.

Each sentence gets exactly one class (ADR-0019 §1):

| Class | Eligible to become a claim |
|---|---|
| `quoted-actor` — reported speech with a resolvable speaker | Yes, if the actor is in scope |
| `author-claim` — an opinion/analysis author asserting in their own voice | Yes, if the statement is a political claim |
| `outlet-prose` — narration, editorial synthesis, scene-setting | **No** — recorded, never verified |
| `unresolved` — quotation with no resolvable attribution | **No** — never guessed (ADR-0006) |

Each document also gets a genre, because the rule depends on it (ADR-0019 §2): press release, news
report, opinion/analysis, transcript, or institutional post. **Structural markup wins where it
exists.** Hansard speaker markup and caption turn structure are attribution rather than inference,
which is why Hansard is the cleanest claimant-entity source, and why a classified attribution is
recorded as a different method with a different confidence.

In scope (ADR-0019 §3): elected politicians, parties and candidates; officials speaking for the
government (the MFAT deputy-secretary case); and institutional claim sources (ADR-0018). Journalists
and outlets are sources of quotation, never claimants.

Two constraints are structural rather than stylistic:

- **Identity decides eligibility, never reading.** It may not fill a context field (ADR-0008), and it
  may not enter triage's checkability or typing decision. Triage receives an eligibility flag and
  attribution candidates, never a person to reason about (TRIAGE §1). Verification stays party-blind.
- **Attribution never guesses.** `unresolved` is excluded and counted, never promoted to a claim.

One by-product per lane: the **in-scope rate** (eligible sentences divided by sentences read) sits
alongside `tier2_fallback_rate` as a scope funnel. A lane whose in-scope rate collapses looks healthy
on every other signal — the same shape as a feed answering 200 with no items — and it alarms the same
way (ING-R17).

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
| All prose lanes | speakership class + classification method, genre, actor candidate (ADR-0019, §2.9) |
| False-context | fixture provenance fields; `is_curated_fixture=true` |

### 3.3 Health contract

Each live lane exposes `lane_id`, `last_run_at`, `last_success_at`, `items_seen/new`, `tier2_fallback_rate`, `staleness_state`, `alert_state` — consumed by Grafana and the public coverage page.

### 3.4 Handoff

Document record + extraction provenance + attribution candidates + dedupe inputs → triage queue. Never resolved verdicts; claimant identity never used downstream for verification decisions (ADR-0002).

## 4. Tests

Every risk maps to a layer in `TEST-STRATEGY.md`: **L1** every push, **L2** every PR, **L3** weekly and pre-release, **L4a** every push, **L4b** pre-release.

Highlights:

| ID | Risk | Consequence if untested | Test | Signal | Layer |
|---|---|---|---|---|---|
| ING-R1 | Feed breakage / silent staleness (200 but zero or frozen items) | Coverage collapses invisibly; accuracy table rests on a shrinking sample | Fixtures: frozen feed → staleness asserted; dead feed → liveness alarm | Staleness monitor; zero-items-with-200 alarm | L1 + L2 |
| ING-R2 | Per-media-type extraction quality varies; generic parser silently mangles a lane | The AVeriTeC 297/500 failure mode repeats: extraction "succeeds" but drops content | Per-format parser tests incl. adversarial; tier numeric cross-check; failure-cause persistence | Per-lane Tier-2 fallback rate; tier cross-check; fixture diffs | L1 |
| ING-R3 | `kind:"asr"` misdetection when a creator-uploaded track exists — tier misclassified | Tier-2 trusted as reviewed — the exact ADR-0007 failure | `captionTracks` payload fixtures: asr → publisher-auto; manual → publisher-reviewed; none → explicit out-of-scope | Track-metadata-derived tier vs fixture expectation | L1 |
| ING-R4 | media_anchor extraction failure breaks "hear it" links | Demo feature dead-ends; L4 smoke fails at demo time | Anchor construction tests (cue → padded window → deep-link shape); L4 resolves the link | L1 anchor-field assertions; L4 deep-link check | L1 + L4a |
| ING-R5 | Duplicate documents/claims on re-ingest | Double triage cost, corrupted per-stratum counts | Dedupe fixture pairs: identical copies collapse; near-fingerprint distinct claims don't merge | GUID/hash dedupe counters | L1 |
| ING-R6 | Dedupe false positives — distinct claims merged | Real occurrence swallowed; provenance lost | Dedupe fixture pairs: identical copies collapse; near-fingerprint distinct claims don't merge | Fixture-pair tests; fingerprint collision tests | L1 |
| ING-R7 | YouTube ToS / rate limits breached by over-fetching | Lane shut off; legal exposure | Request-budget test against a local fixture server; rate metric asserted | Request-rate metric per lane | L1 |
| ING-R8 | Encoding/malformed HTML — mis-encoded Māori macrons, broken markup | Silent text corruption; attribution downstream damaged | Macron round-trips, double-encoded entities, malformed HTML — byte-exact comparisons | Adversarial fixture round-trips | L1 |
| ING-R9 | Paywalled content mishandled — truncated text treated as complete | Mis-verification; ToS breach | Paid-tier fixture: truncated item → quoted-claim-only; no full-text fetch attempted | Fixture: paid-tier item → quoted-claim-only flag | L1 |
| ING-R10 | False-context set treated as production lane | Slice overclaims a least-mature mode; credibility damage | Fixture records carry `is_curated_fixture`; never registered with lane health or scheduler | No lane-health registration; `is_curated_fixture` gate | L1 |
| ING-R11 | Caption revision drift — stored cue no longer matches live track | "Hear it" plays audio that doesn't match the stored quote | Changed track hash → affected-claim flagging; re-pull re-resolves the cue span | Track-hash comparison; affected-claim flag | L1 + L2 |
| ING-R12 | Health checks themselves fail silently | Monitoring is theatre | Graphile Worker job-history fixture with missing run → silence alert | Job-health silence-detection (Graphile Worker); heartbeat metric | L1 |
| ING-R13 | Provenance fields missing at store-write | Firewall and reprocessing guarantees break silently | Zod validation on every emitted record; Drizzle constraints in CI migrations | L1 schema validation; NOT NULL constraints | L1 |
| ING-R14 | Tier-2 fallback explosion — markup change flips a whole lane to LLM extraction | Silent cost blowout; the designated drift signal missed | Synthetic fallback rates outside bands → alert state | Per-lane fallback-rate anomaly band | L1 |
| ING-R15 | Outlet prose verified as a claim — the pipeline fact-checks the newsroom | Unattributable verdicts about journalists; the project's stated subject abandoned (observed live, Sept 2026) | Fixture: a news report where narration and a quoted actor both assert — only the quoted actor's sentences become claims; the narration is recorded as out of scope | Speakership gate before claim creation; fixture where narration and quotation both assert | L1 |
| ING-R16 | Misattributed speaker — a quotation assigned to the wrong actor | The verdict names someone who did not say it; defamation exposure (ADR-0002) | Fixture set: in-sentence attribution, cross-sentence attribution, unattributed pull-quote, opinion-piece author claim, Hansard turn markup, press-release forwarding — `unresolved` never promoted | Structural markup preferred over classification; `unresolved` excluded, never guessed; per-lane attribution-accuracy meter | L1 + L2 |
| ING-R17 | Scope starvation — over-strict filtering silently empties a lane's eligible claims | Coverage collapses invisibly; the slice measures a shrinking sample it did not notice | Synthetic in-scope rates outside the band → alert state; per-lane funnel on the coverage page | Per-lane in-scope rate vs band; 200-with-zero-in-scope is an alarm | L1 |
| Behavioural | — | — | Golden set: one pinned item per lane; extraction changes show as snapshot diffs |  | L2 |
| Accuracy | — | — | Per-stratum extraction quality is a measured L3 output, not an assumption |  | L3 |
| Site | — | — | Hear-it links, ClaimReview on caption-derived pages, methodology table |  | L4 |

**L1 fixture list**: Beehive feed + release page (tables, macrons); RNZ feed + article (+ malformed-encoding variant, + valid-entity variant — a page whose `&amp;` escapes are correct must extract, which the old guard denied); stale/broken feeds (200-zero-items, frozen, malformed XML); speakership set (quoted with in-sentence attribution, cross-sentence attribution, unattributed pull-quote, opinion-piece author claim, Hansard turn markup, press-release forwarded sentence); `captionTracks` payloads (asr-only, manual-only, both, none); VTT/SRT tracks (asr with cues, manual, empty, revised-hash); media_anchor edge cases (missing end, missing URL, boundary cues); Kākā feed (free + paid-truncated items); dedupe pairs (identical, near-fingerprint, cross-lane repeat); the curated false-context set; rate-budget harness; synthetic job history + metric series.

## 5. Open questions

1. **Beehive/RNZ lookback and item caps** — per-lane cadence and history depth. Default: hourly polls; GUID-dedupe makes over-fetch harmless.
2. **Caption revision policy** — auto re-process affected claims on track-hash change, or maintainer review first?
3. **media_anchor context-pad size** — seconds of padding for the "hear it" clip; needs a listen-test against real items.
4. **Kākā paid-tier depth** — truncated previews only, or paid items out of scope entirely?
5. **Health-alert routing** — who receives maintainer alerts, via what channel.
6. **NZIER entry criteria** — what justifies adding the scrape path post-slice; via an ADR-0013 public proposal?
7. **False-context set redistribution** — can the curated set's provenance notes be published as-is, or need per-item licence review?
8. **Embedding model for claim-level dedupe** — ADR-0011 routes embeddings; the slice's pick is unpinned.
9. **Opinion-piece political relevance** (ADR-0019 §2) — how is "a statement relevant to politics" operationalised for an opinion piece, and who audits that boundary when it is contested?
10. **Attribution window** (ADR-0019 §1) — how far from a quotation may its speaker be resolved: same sentence, same paragraph, ±N sentences? Cross-sentence attribution is the common real case.
11. **`unresolved` handling** — counted only, or surfaced publicly as a coverage gap the way extraction degradation is?
12. **Existing mis-scoped verdicts** — verdicts published under the pre-ADR-0019 rule (outlet prose as a claim) are wrong by the new standard: supersede with a new version, or annotate and leave (ADR-0002 append-only)?
13. **Genre detection source** — structural metadata (feed section, URL path, markup) where available, classified where not; which is recorded, and how is a mis-classified genre caught?