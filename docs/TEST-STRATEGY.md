# Test & verification strategy

*Status: proposed (Draft 1 — awaiting Bradley's review before slice build starts). Companion to `docs/VALIDATION-SLICE.md` (the slice scope) and `docs/EVALUATION.md` (the harness methodology). This doc makes those operational: what runs when, what gates a merge, what it costs.*

---

## 1. The core principle

The slice's headline deliverable is the **per-stratum accuracy table** (VALIDATION-SLICE §"Labelling and accuracy"). That means the harness is not a test suite bolted on after the pipeline — **it is the measuring instrument the slice exists to build.** Pipeline code that ships before the harness can scaffold and ingest labels produces verdicts we cannot grade, and the slice fails on its own terms.

**Consequence (proposed):** harness scaffold + schema + first labelled batch land *with* the first verification code, not after it. The label schema is effectively part of the pipeline's storage schema — both define the claim/verdict/evidence objects; they should be designed together and versioned together.

## 2. The four test layers

| Layer | What | When it runs | Cost |
|---|---|---|---|
| L1 — Deterministic tests | Extraction ladder, caption parsing, `media_anchor`, stat-grid arithmetic, NLI audit gate — all on fixtures; LLM mocked | Every push (CI) | Free |
| L2 — Golden-set snapshots | ~20 pinned claims × pinned prompts → snapshot verdict + evidence path | Every PR | Pennies |
| L3 — The accuracy harness | AVeriTeC Layer 1 + NZ Layer 2 (n=100 stratified), per-stratum accuracy, calibration, cost/claim | Weekly + pre-release | ~$10–20/run |
| L4 — Site verification | ClaimReview JSON-LD schema validation, Playwright smoke (verdict page, "hear it" link, feed/facets), methodology-page accuracy table generated from harness output | Every push (L4a) / pre-release (L4b) | Free |

### Layer 1 — deterministic tests

The slice's machinery has a large deterministic surface; it gets conventional tests:

- **Extraction ladder** against fixture files per lane (Beehive RSS, RNZ article, YouTube caption track, Substack/institution item), including adversarial fixtures: `kind:"asr"` caption tracks, malformed feeds, empty transcripts, paywalled pages, encoding edge cases.
- **Caption parsing**: `kind:"asr"` detection, `media_anchor` extraction, `transcript_tier` flagging — the ADR-0014 machinery.
- **Stat-engine grid** (R2): denominators, vintage selection, "as deployed" framing are pure logic over a fixture official series — fully testable without an LLM. This is the highest-complexity verification mode and the cheapest to test exhaustively.
- **NLI justification audit gate** (the publication gate): fixture evidence packs that must pass and must fail publication.
- **Tier-2 fallback rate logging** (R7): assert the fallback counter fires and lands in the per-lane log.

Everything LLM-dependent is mocked at this layer. Fast, free, every commit.

### Layer 2 — golden-set snapshots

- ~20 pinned claims spanning the five lanes and four verification modes.
- Run with pinned prompt versions + pinned model version; snapshot the full output (verdict, confidence, evidence path, justifications) into version control.
- Any pipeline change produces a **visible diff** in verdicts — the reviewer sees *what changed in behaviour*, not merely "tests pass."
- This is the cheap smoke layer of the harness; it catches accidental prompt/behaviour drift between full runs.

### Layer 3 — the accuracy harness

As per EVALUATION.md, made operational:

- **Layer 1 (AVeriTeC)**: public dataset + public eval script from week 1. Regression-gates the generic loop. Position vs published field is interpretable immediately.
- **Layer 2 (NZ set)**: n=100, stratified across five lanes × four verification modes per VALIDATION-SLICE; double-label ~30%; per-stratum accuracy + calibration + cost/claim reported.
- **Blind rule enforced in code**: the pipeline process structurally cannot read the labels directory (separate storage path, no read permission / separate injection boundary). Not convention — enforced.
- **Evidence durability**: evidence URLs cached to the Internet Archive at labelling time; statistical series stored with vintage dates (EVALUATION.md §7 controls).
- Runs are **reproducible**: pinned model versions, pinned data vintages, published prompts. A scoring run's output lands in a versioned file that the site's methodology page renders — the published number is generated, never hand-edited.

### Layer 4 — site verification

- **ClaimReview JSON-LD** validated against schema.org on every verdict page in CI. This is the Google Fact Check Explorer discovery channel; malformed JSON-LD fails *silently* in the wild, so it must fail loudly here.
- **Playwright smoke**: verdict page renders, "hear it / watch it" deep link resolves to the right anchor, feed + facets return data.
- **Methodology page integrity**: the displayed accuracy table is generated from the harness output file — a test asserts the table matches the file, so a stale or hand-edited number cannot ship.

## 3. The regression gate (proposed: per-stratum)

EVALUATION.md §4 commits to "a change that reduces accuracy does not ship." Made concrete:

- **Any stratum regressing beyond a small threshold (proposed: −5 points at n≥20 labels in that stratum) blocks the PR** — not just overall accuracy.
- Rationale: the per-stratum table is the deliverable. A change that wins +1% overall by sacrificing the quote-fidelity stratum is a bad trade visible only with stratum-level gating.
- Small-stratum caveat: with n<20 in a stratum, a single label flip moves >5 points — so gate at the stratum level only where labels support it, and flag small-stratum regressions as advisory. (The slice's stratification plan should keep ≥20 labels per stratum where possible; ~100 labels / 5 lanes × 4 modes is tight, so the label-mix targets in VALIDATION-SLICE need to respect this floor.)
- Overall accuracy + calibration always reported; overall block threshold proposed at −3 points.

## 4. Cadence and cost control (proposed)

- **Every PR**: L1 + L2 + L4a. Minutes, pennies.
- **Weekly + before any release**: L3 full two-layer run + L4b. Two tiers keep iteration fast while the accuracy gate never goes stale for long.
- Golden-set snapshots also run at slice milestones so drift between weekly runs is visible.
- Run cost estimate for L3: ~130 claims × ~$0.05–0.15 LLM+search ≈ **$10–20/run** (per FIRE's cost frontier, adjusted for paid models).

## 5. What this deliberately does NOT cover in the slice

- Community-layer grading (EVALUATION.md §5) — replay infrastructure is post-slice; the contestation layer isn't in the MVP.
- PDF/long-document lane (R4) — deferred per VALIDATION-SLICE; its accuracy risk surfaces through evidence documents anyway.
- Load/performance testing — election-night scale is a later concern.
- Label revision/contest tooling for the dataset itself (labels revised only via the contest-and-mutation process; tooling follows the site's contestation slice).

## 6. Decisions still open (Bradley's call)

| # | Question | My recommendation | Status |
|---|---|---|---|
| D1 | Harness vs pipeline sequencing | Harness scaffold + ~30 labels alongside first pipeline code; labels are part of the storage schema design | Proposed |
| D2 | Regression gate strictness | Per-stratum block (−5 pts where n≥20), overall −3 pts, small-stratum advisory | Proposed |
| D3 | Full scoring-run cadence | Golden-set per PR; full run weekly + pre-release | Proposed |

## 7. Success criteria for this strategy

1. Every verdict the slice publishes can be traced to a harness run — no ungraded verdicts.
2. A pipeline change that degrades any well-measured stratum cannot merge silently.
3. The site's published accuracy table is generated, reproducible, and matches the harness output exactly.
4. The full harness run is cheap enough (≤$25) to run weekly without thought.