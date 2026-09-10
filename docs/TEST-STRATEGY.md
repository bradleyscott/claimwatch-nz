# Test & verification strategy

*Proposed (Draft 1). Companion to `VALIDATION-SLICE.md` (slice scope) and `EVALUATION.md` (harness methodology); makes them operational — what runs when, what gates a merge, what it costs.*

## 1. Core principle

The slice's headline deliverable is the **per-stratum accuracy table** — so the harness is not a test suite bolted on after the pipeline; it is the measuring instrument the slice exists to build. Pipeline code shipping before the harness can scaffold and ingest labels produces verdicts we cannot grade.

**Proposed consequence (D1):** harness scaffold + schema + first labelled batch land *with* the first verification code. The label schema is part of the storage schema — both define the claim/verdict/evidence objects; designed together, versioned together.

## 2. Four test layers

| Layer | What | Runs | Cost |
|---|---|---|---|
| **L1 deterministic** | Extraction ladder, caption parsing, `media_anchor`, stat-grid arithmetic, NLI gate — fixtures; LLM mocked | Every push | Free |
| **L2 golden-set** | ~20 pinned claims × pinned prompts → snapshot verdict + evidence path | Every PR | Pennies |
| **L3 accuracy harness** | AVeriTeC (Layer 1) + NZ n=100 stratified (Layer 2): per-stratum accuracy, calibration, cost | Weekly + pre-release | ~$10–20/run |
| **L4 site** | ClaimReview JSON-LD validation (every push); Playwright smoke (pre-release); methodology table generated from harness output | Every push / pre-release | Free |

- **L1** covers the large deterministic surface with conventional tests: per-lane extraction fixtures (including adversarial — `kind:"asr"` tracks, malformed feeds, empty transcripts, paywalled pages), stat-grid arithmetic as pure logic (highest-complexity mode, cheapest to test exhaustively), NLI must-pass/must-fail packs, fallback-counter assertions. Everything LLM-dependent mocked.
- **L2** snapshots verdict + confidence + evidence path + justifications for ~20 pinned claims spanning lanes and modes. Any pipeline change produces a **visible behaviour diff**, not merely "tests pass" — the cheap smoke layer catching drift between full runs.
- **L3** is EVALUATION.md made operational: AVeriTeC + public eval script from week 1 (regression-gates the generic loop); NZ set n=100 stratified per VALIDATION-SLICE, ~30% double-labelled. **Blind rule enforced in code** — the pipeline process structurally cannot read the labels store. Runs reproducible (pinned models, vintages, published prompts); output lands in a versioned file the methodology page renders — the published number is generated, never hand-edited.
- **L4** validates ClaimReview JSON-LD in CI (malformed JSON-LD fails *silently* in the wild — it must fail loudly here), Playwright-smokes the verdict page / hear-it link / feed, and asserts the displayed accuracy table matches the harness output file.

## 3. Regression gate (proposed: per-stratum)

EVALUATION §4 commits to "a change that reduces accuracy does not ship." Concretely:

- Any stratum regressing beyond **−5 points (n≥20 in that stratum) blocks the PR** — not just overall accuracy. The per-stratum table is the deliverable; a change that wins +1% overall by sacrificing quote-fidelity is a bad trade only stratum gating catches.
- n<20 strata: single label flips move >5 points — gate those **advisory only**, and keep label-mix targets at the ≥20 floor where possible.
- Overall: reported always; block threshold proposed at **−3 points**.

## 4. Cadence and cost

- **Every PR**: L1 + L2 + L4a — minutes, pennies.
- **Weekly + pre-release**: full L3 two-layer run + L4b. Golden snapshots also run at slice milestones.
- L3 cost: ~130 claims × $0.05–0.15 ≈ **$10–20/run** (FIRE frontier, paid models).

## 5. Deliberately out of scope for the slice

Community-layer grading replay (post-slice; contestation isn't in the MVP) · PDF/long-document lane (deferred per VALIDATION-SLICE) · load/performance testing · label-revision tooling (follows the contestation slice).

## 6. Decisions open (Bradley's call)

| # | Question | Recommendation |
|---|---|---|
| D1 | Harness vs pipeline sequencing | Harness scaffold + ~30 labels alongside first pipeline code; labels are part of the storage schema design |
| D2 | Regression-gate strictness | Per-stratum block (−5 pts where n≥20), overall −3 pts, small-stratum advisory |
| D3 | Scoring-run cadence | Golden-set per PR; full run weekly + pre-release |

## 7. Success criteria

1. Every published verdict traces to a harness run — no ungraded verdicts.
2. A change degrading any well-measured stratum cannot merge silently.
3. The published accuracy table is generated, reproducible, and matches harness output exactly.
4. A full run costs ≤$25, cheap enough to run weekly without thought.