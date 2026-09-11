# Harness & labelling design

*Proposed. ADRs: 0004, 0010. Companions: `EVALUATION.md`, `TEST-STRATEGY.md`, `VALIDATION-SLICE.md`, `CROSS-CUTTING.md`.*

## 1. Purpose and slice scope

The harness is the measuring instrument the slice exists to build (TEST-STRATEGY §1): labelled ground truth, blind scoring runs, published per-stratum numbers that every pipeline change must pass. It is a component with its own failure modes, so this doc specifies what it produces and how it is itself tested.

| Deliverable | Detail |
|---|---|
| Label schema | Shared claim/verdict/evidence objects with the pipeline store, versioned together |
| Stratified sample | ~110 NZ labels across five lanes × four modes, verdict-mix targets enforced |
| Double-labelling | ~30%; IAA reported with the accuracy number |
| Blind rule | Pipeline structurally cannot read labels — separate database, enforced and tested |
| Scoring runs | Layer 1 (AVeriTeC, official eval script) from week 1; Layer 2 (NZ n≈110) per cadence D3 |
| Regression gate | Per-stratum −5 pts block where n≥20, overall −3 pts block, small-stratum advisory (D2) |
| Exports | Dataset A (labelling, CC BY 4.0) and Dataset B (AVeriTeC-format predictions) |
| Evidence durability | IA snapshots at labelling; series with vintage dates |
| Reproducibility | Pinned models, vintages, prompts; run manifest per scoring run |

Out of scope: community-layer grading replay, label-revision tooling, PDF-lane labelling.

## 2. Design

### 2.1 Label schema

One row per label, typed against the shared objects in `packages/store`:

| Field | Notes |
|---|---|
| `claim_id` | FK — the claim object is the pipeline's record, not a harness copy |
| `verdict` | AVeriTeC-exact enum (ADR-0004): supported / refuted / not_enough_evidence / conflicting_cherry_picking |
| `confidence` | labeller band (high/med/low) — enables calibration |
| `cited_sources` | URL + archive snapshot + access date |
| `labeller_reasoning` | explicit arithmetic/rounding, flagged assumptions, no authority-by-citation |
| `evidence_availability` | the temporal-leakage control (EVALUATION §7) |
| `source_ecosystem` | which NZ sources the label rests on (T1–T6) — accuracy slices by source-access difficulty |
| `labeller_id` / `label_date` / `schema_version` | provenance |

The label schema does **not** redefine claim or verdict types — it imports them from `packages/store`. Any schema change is a store migration consumed by both sides in the same release.

### 2.2 Stratum grid

**The tension, addressed first.** D2 wants ≥20 labels per gated stratum; the naive 5-lane × 4-mode grid needs 400 labels against a ~100 budget. Five labels per cell is statistically meaningless and the gate collapses to advisory everywhere.

**Resolution: the gate axis is the verification mode, not lane×mode.** Lane is reported for diagnosis, never gated — this is honest about the deliverable (VALIDATION-SLICE's example rows are mode-level, and the mode is what exercises the machinery).

| Gate stratum | n | Lane feed | Verdict-mix emphasis | Gate |
|---|---|---|---|---|
| Stat-engine grid | 30 | Beehive 15, RNZ 8, institution 7 | ≥12 cherry-picking (oversampled), ≥5 NEI | Block at n≥20 |
| Quote-fidelity | 25 | YouTube captions | Supported-heavy + NEI oversample | Block at n≥20 |
| Citation-check | 20 | Institution 15, RNZ 5 | Claims paired with own evidence | Block at n=20 |
| Open-web loop | 25 | Hansard/news 20, commentary 5 | Supported-heavy natural mix | Block at n≥20 |
| Provenance | 10 | Curated set only | By construction | **Advisory** (n<20) |
| **Total** | **110** | | | 95 gated |

Verdict-mix targets across the gated labels: Supported ~40% (the corrective to AVeriTeC's 62%-Refuted skew) · Conflicting/Cherry-picking ~25% (the flagship class, deliberately oversampled) · NEI ~20% (abstention is a measured capability) · Refuted ~15%. If labelling yields fewer than 100 usable labels, provenance is cut first, then citation-check goes advisory — never the three core strata.

### 2.3 Labelling workflow + IAA

1. Claims drawn from historical Hansard 2024–2025 plus the other lanes via the **production detection pipeline** — the harness measures the end-to-end system; the sampler records the natural distribution pre-stratification.
2. Sampling assigns claims to strata; the assignment is a versioned artefact.
3. First labeller labels against the full schema; evidence URLs IA-snapshotted at labelling time.
4. Second labeller (~30%, spread so every gated stratum has ≥6) sees claim, metadata, and the first labeller's question–answer pairs — **but not the first verdict or reasoning** (AVeriTeC protocol).
5. Disagreements resolved by discussion; unresolvable claims excluded and counted (published, not silently dropped).
6. IAA: raw agreement + Cohen's kappa, overall and per stratum, published alongside accuracy. EV2R automatic evidence-matching is a development signal only — human sufficiency judgement is the published standard.

### 2.4 Blind-rule enforcement (structural, not convention)

- **Separate database**: `claimwatch` (pipeline) and `claimwatch_labels` on different Postgres databases. The pipeline's `DATABASE_URL` names only `claimwatch`; Postgres has no cross-database queries, so even a compromised pipeline config cannot reach labels through its own connection.
- **Role separation**: `pipeline_role` has no grants on the labels DB.
- **One-way data flow**: `packages/harness` may import `packages/store` (read-only); a lint rule forbids `packages/pipeline` importing `packages/harness` or the labels connection module. Claim objects flow pipeline → harness; nothing flows back except published exports.
- **No shared secrets**: labels-DB credentials exist only in the labelling operator's and harness job's env; CI greps the pipeline env for the labels credential name.
- **Drizzle isolation**: label tables in `packages/harness/schema`, generated against `claimwatch_labels`; the pipeline's migration history never touches them.

### 2.5 Scoring-run pipeline

| Step | Detail |
|---|---|
| 1. Input assembly | Layer 1: AVeriTeC dev set (versioned checkout). Layer 2: labels joined to pipeline verdicts for the same claim IDs |
| 2. Pipeline run | Pinned model/prompt/retrieval config |
| 3. Export | AVeriTeC-format predictions JSONL (Dataset B) |
| 4. Score | Layer 1: official eval script as a **pinned tool step** (Python exists nowhere in the runtime). Layer 2: TS scoring — verdict-class match, per-stratum accuracy, calibration, cost/claim |
| 5. Gate | §2.6 comparison vs baseline; exit non-zero on block |
| 6. Publish | Run output → `harness/runs/<run-id>.json` (immutable, content-addressed); the methodology page renders from this file — generated, never hand-edited |
| 7. Log | Token counts per claim from gen_ai spans; cost computed at aggregation from the versioned price map (CROSS-CUTTING §5.3) into the run file |
Outputs per run, per layer, never blended: accuracy with 95% interval, per-stratum accuracy, calibration, cost/claim per stratum, IAA, EV2R development score.

### 2.6 Regression gate (D2)

A pure function over two run files → `{decision: pass|block|advisory, reasons[]}` — fixture-testable at L1. Compares the current run against the **baseline** (last run tagged `accepted`; re-baselined only at release):

| Check | Threshold | Effect |
|---|---|---|
| Gated stratum (n≥20) | −5 pts vs baseline | **Block** |
| Overall (Layer 2) | −3 pts | **Block** |
| Overall (Layer 1) | −3 pts | **Block** |
| Gated stratum (n<20) | any regression | Advisory comment |
| Provenance stratum | any regression | Advisory |
| Calibration | reported | Advisory this slice |

A stratum's n is read from the run file — the −5 rule self-disables if a stratum under-delivers, and the gate emits a warning listing strata below n≥20 (that warning is itself tested). Layer 1 has no strata: overall-only, running from week 1 so the gate exists before any NZ label does.

### 2.7 Evidence durability

Every evidence URL cited in a label IA-snapshotted at labelling time (URL + timestamp stored on the label) — NZ sources rot at least as fast as anywhere. Series stored with vintage dates; labels record the vintage used. Claims checkable only at a past moment are excluded at sampling.

### 2.8 Reproducibility

A scoring run carries a **run manifest** — the run is reproducible iff the manifest fully determines it: model versions per role (ADR-0011) · prompt content hashes · dataset versions + series vintages + snapshot timestamps · pinned eval tooling (commit + environment) · retrieval config (provider, depth cap, authority-map version). Two identical-manifest runs may still differ (non-determinism, search drift); the manifest pins everything we control, and the golden-set layer quantifies the residual.

## 3. Interfaces

### 3.1 What the pipeline must never read

| Prohibited | Enforced by |
|---|---|
| Label rows, verdict labels, labeller reasoning | Separate database; no grants; no cross-DB queries |
| IAA records, double-labelling assignments | Same database |
| Stratification assignment | Same database — the pipeline must not know a claim is an oversample or it could behave differently on it |
| Baseline run files during pipeline execution | Run files consumed only by the gate script after the run completes |
| Anything exported from `packages/harness` | Dependency-direction lint (TOOLCHAIN §2.3) |

Testable end-to-end: CI connects with the pipeline's actual credentials and asserts every labels read fails (HAR-R1).

### 3.2 What the methodology page consumes

The current accepted run file (rendered, never hand-edited; L4b asserts rendered == file) · the ADR-0004 verdict-class mapping (static, published verbatim) · Dataset A download + its schema version.

### 3.3 Dataset shapes

**Dataset A** (labelling export, CC BY 4.0, versioned): claim object + verdict + labeller confidence + cited sources (with archive timestamps + vintages) + reasoning + evidence-availability + source ecosystem + labeller identity; double-label block on ~30% (second verdict, agreement, exclusion).

**Dataset B** (AVeriTeC-format predictions): run id, model/prompt versions, dataset version, predictions (claim, verdict, confidence, Q&A evidence pairs, evidence URLs), scores (layer 1: EV2R/METEOR; layer 2: overall, per-stratum, calibration, cost, IAA).

## 4. Test risks

| ID | Risk | Consequence if untested | Detection signal |
|---|---|---|---|
| HAR-R1 | Blind-rule breach: pipeline reads labels | Scoring silently contaminated — the number is worthless, unrecoverable retroactively | CI integration test as `pipeline_role`; dependency lint; env-var assertion |
| HAR-R2 | Label noise / low IAA | Accuracy measured against noisy ground truth; gate decides on noise | Kappa < ~0.6; exclusion rate far above the AVeriTeC ~25% reference |
| HAR-R3 | Stratification drift from the grid | Gate self-disables on thin strata unnoticed; the "Supported-heavy corrective" claim becomes false | Sampler asserts delivered vs manifest; gate warning on n<20 |
| HAR-R4 | Gate logic bugs — never blocks, or always blocks | Bad changes ship unchallenged, or iteration halts and the gate gets bypassed | Fixture run-file pairs covering block/pass/advisory; mutation test: a deliberately degraded run must be blocked |
| HAR-R5 | Harness-vs-schema drift after a store change | Exports stale-shaped data that still parses — scoring compares mismatched vocabularies | Shared types fail loudly at compile; round-trip export/re-import test |
| HAR-R6 | Temporal leakage | Accuracy flattered by future information | Post-dated-evidence fixtures must trigger the availability note; evidence-date ≤ claim-date on sampled runs |
| HAR-R7 | Reproducibility breaks — unpinned changes alter scores with no code change | Every regression arguable; the gate loses authority | Manifest-completeness test; two identical-manifest runs diffed on a fixed slice |
| HAR-R8 | Cost overrun past the ≤$25/week envelope | Someone disables the harness "until costs settle"; the gate goes stale | Cost/claim per run; CI warn-then-fail at 2× budget |
| HAR-R9 | Published-number staleness — methodology page shows an old or hand-edited run | The trust asset shows numbers no run produced | L4b: rendered table == accepted run file; publication refuses untagged runs |
| HAR-R10 | Evidence rot — cited label URLs die | Dataset A's auditability claim collapses | Snapshot coverage report; monthly link-check with IA fallback |
| HAR-R11 | Double-label subset clusters in easy strata | Published IAA overstates quality exactly where labels are hardest | Per-stratum double-label counts ≥6; IAA broken out per stratum |
| HAR-R12 | Eval-script drift from the published metric | Layer-1 comparability claims become false | Pin check: CI asserts tool commit/environment vs manifest; known-output smoke test |

## 5. Test strategy

Most of the harness is deterministic code over fixtures — the thing L1 exists for.

| ID | Mitigation | Layer | Runs |
|---|---|---|---|
| HAR-R1 | Integration test as `pipeline_role` asserting denial; dependency lint; env grep | L1 | Every push |
| HAR-R2 | IAA published per run with thresholds flagged (kappa < 0.6 → warning in run file); exclusion rate vs reference | L3 | Weekly + pre-release |
| HAR-R3 | Sampler asserts delivered counts vs manifest; gate emits the n<20 warning list; manifest is a reviewed artefact | L1 + L3 | Push; weekly |
| HAR-R4 | Pure gate function; fixture pairs for every rule; mutation test on a degraded run | L1 | Every push |
| HAR-R5 | Shared types make drift a compile error; round-trip export/import; migrations in CI | L1 | Every push |
| HAR-R6 | Post-dated-evidence fixtures trigger the note; evidence-date ≤ claim-date asserted; availability distribution reported | L1 + L2 + L3 | Push; PR; weekly |
| HAR-R7 | Manifest completeness (hashes recomputed at run time); residual-nondeterminism probe on a fixed 20-claim slice | L1 + L3 | Push; weekly |
| HAR-R8 | Cost/claim per stratum in every run file; CI warn-then-fail vs budget | L1 + L3 | Push; weekly |
| HAR-R9 | L4b: rendered table == accepted run file; publication rejects untagged runs | L4b | Pre-release |
| HAR-R10 | Snapshot coverage asserted at labelling (uncovered citations fail the batch); monthly link-check | L1 + job | Batches; monthly |
| HAR-R11 | Double-label assignment in the manifest; per-stratum counts asserted; IAA per stratum | L1 + L3 | Sampling; weekly |
| HAR-R12 | Tool pin check vs manifest; known-output smoke test | L1 | Every push |

Sequencing (D1): the scaffold — schema, blind-rule grants, gate function with fixtures, export serializers — lands **with** the first pipeline code, so HAR-R1/R4/R5 tests exist before there is an accuracy number to protect.

## 6. Open questions

| # | Question | Notes |
|---|---|---|
| 1 | Second-labeller capacity — if ~33 double-labels can't be committed, drop to 2 gated strata or accept lower coverage? | Operator + one other; j-school partnership is the scale-up path |
| 2 | IAA metric — Cohen's kappa proposed; switch to Krippendorff's α if a third labeller joins | Decide before the first double-labelled batch |
| 3 | Calibration gate threshold — what ECE/interval-width makes calibration a block, on what n? | Deferred until two runs of calibration data exist |
| 4 | Held-out slice vs gate — holding out 15–20 labels drops every stratum below the floor. Recommendation: defer held-out, revisit at n≥300 | EVALUATION §3 |
| 5 | Search-API result drift — accept as reported noise, or pin a cached retrieval corpus for gate runs? | Storage cost vs removing a noise source |
| 6 | Baseline re-baselining policy — who tags runs `accepted`, under what authority? | No release process exists yet in the slice |
| 7 | Provenance stratum's future — at what point does it get a real labelled stratum and enter the gate? | Curated set is advisory-only by design |
| 8 | AVeriTeC licence — CC BY-NC 4.0 assumed fine for evaluation; verify at first scoring run and record in the manifest | |