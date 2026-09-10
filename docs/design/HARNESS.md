# Harness & labelling design

*Status: proposed. Companion docs: docs/EVALUATION.md, docs/TEST-STRATEGY.md, docs/VALIDATION-SLICE.md, docs/design/CROSS-CUTTING.md. ADRs: 0004, 0010.*

## 1. Purpose and slice scope

The harness is the measuring instrument the validation slice exists to build (TEST-STRATEGY §1): labelled ground truth, blind scoring runs, and published per-stratum numbers that every pipeline change must pass. It is a component in its own right with its own failure modes, so this doc specifies (a) what it produces and (b) how it is itself tested.

In scope for the slice:

| Component | Deliverable |
|---|---|
| Label schema | Shared `claim`/`verdict`/`evidence` objects with the pipeline store, versioned together (Drizzle + Zod, `packages/store`) |
| Stratified sample | ~110 NZ labels across five lanes × four verification modes, verdict-mix targets enforced |
| Double-labelling | ~30% of labels double-labelled; IAA reported with the accuracy number |
| Blind rule | Pipeline process structurally cannot read labels — Postgres role/database separation, enforced and tested |
| Scoring runs | Layer 1 (AVeriTeC public set, official eval script) from week 1; Layer 2 (NZ n≈110) per cadence D3 |
| Regression gate | Per-stratum −5 pts block where n≥20, overall −3 pts block, small-stratum advisory (D2) |
| Exports | Dataset A (labelling export, CC BY 4.0) and Dataset B (AVeriTeC L1 harness export) |
| Evidence durability | Internet Archive snapshots at labelling time; statistical series with vintage dates |
| Reproducibility | Pinned models, pinned data vintages, published prompts, run manifest per scoring run |

Out of scope (per TEST-STRATEGY §5): community-layer grading replay, label contest/revision tooling (follows the site contestation slice), PDF-lane labelling.

## 2. Design

### 2.1 Label schema (per EVALUATION §2.2)

One row per label, stored in the harness's own tables but typed against the shared objects in `packages/store`:

| Field | Type | Notes |
|---|---|---|
| `claim_id` | FK → claims | The claim object (text, speaker, party, date, source URL) is the pipeline's claim record, not a harness copy |
| `verdict` | enum | AVeriTeC-exact four classes (ADR-0004): `supported` / `refuted` / `not_enough_evidence` / `conflicting_cherry_picking` |
| `confidence` | enum | Labeller confidence band (high/medium/low) — enables calibration reporting |
| `cited_sources` | jsonb[] | Primary sources the label rests on: URL + archive snapshot URL + access date |
| `labeller_reasoning` | text | Justification per AVeriTeC annotation protocol: explicit arithmetic/rounding, flagged commonsense assumptions, no authority-by-citation ("because RNZ says so" is not a verdict basis) |
| `evidence_availability` | enum | `verifiable_then_and_now` / `verifiable_then_only` / `not_verifiable_then` — the temporal-leakage control (EVALUATION §7) |
| `source_ecosystem` | jsonb | Which NZ sources the label rests on (tier per SOURCE-TAXONOMY Part 2: T1–T6), so accuracy slices by source-access difficulty |
| `labeller_id` | text | Anonymised ID; operator + second labeller for the 2026 cycle |
| `label_date` | date | Date of labelling, not of claim |
| `schema_version` | semver | Label-schema version stamped on every row |

Design rule: the label schema does **not** redefine claim or verdict types — it imports them from `packages/store`. Verdict enum is the identical Zod/Drizzle object the pipeline's LLM output validation uses (ADR-0004: "the harness and the site share one verdict universe"). Any schema change is a `packages/store` migration consumed by both sides in the same release.

### 2.2 Stratum grid

**The tension, addressed first.** TEST-STRATEGY D2 wants ≥20 labels per stratum for the gate; the naive grid is 5 lanes × 4 modes = 20 cells, needing 400 labels at 20/cell against a ~100-label budget. Five labels per cell is statistically meaningless and would make the per-stratum gate advisory everywhere — the deliverable would collapse back to one number.

**Resolution: the gate axis is the verification mode, not the lane×mode cell.** Lane is a secondary reported dimension, advisory everywhere. This is honest about the deliverable: VALIDATION-SLICE's example table rows are mode-level ("stat-engine on official prose: X%"), and the mode is what determines the verification machinery being exercised. The lane split *within* a mode is reported for diagnosis but never gated.

| Primary stratum (gate axis) | n | Lane feed | Verdict-mix emphasis | Gate |
|---|---|---|---|---|
| Stat-engine grid | 30 | Beehive 15, RNZ 8, institution 7 | ≥12 Conflicting/Cherry-picking (deliberate oversample), ≥5 NEI | Block at n≥20 |
| Quote-fidelity | 25 | YouTube captions 25 (1News + Q+A) | Supported-heavy natural mix + NEI oversample | Block at n≥20 |
| Citation-check | 20 | Institution 15, RNZ 5 | Claims paired with own evidence; some cherry-picked citations | Block at n=20 |
| Open-web loop (catch-all) | 25 | Hansard/news-derived 20, commentary 5 | Supported-heavy natural mix | Block at n≥20 |
| Provenance (false-context) | 10 | Curated miscaptioned set only | By construction of the curated set | **Advisory only** (n<20, fixed curated set) |
| **Total** | **110** | | | 95 gated labels |

Verdict-mix targets across the gated 100 (natural mix recorded during sampling, both reported per ADR-0010 lesson 2):

| Verdict | Target | Rationale |
|---|---|---|
| Supported | ~40% | Supported-heavy natural NZ mix — the corrective to AVeriTeC's 62%-Refuted skew |
| Conflicting/Cherry-picking | ~25% | "Accurate but incomplete" is the flagship class (ADR-0004); deliberately oversampled above natural frequency |
| Not Enough Evidence | ~20% | Abstention quality is a measured capability; enriched |
| Refuted | ~15% | Present enough to detect over-refutation |

The ≥20 floor holds on the gate axis (stat/quote/open-web run 25–30; citation-check exactly 20; provenance is declared advisory up front rather than silently under-powered). If labelling yields fewer than 100 usable labels after disagreement exclusions, provenance is cut first, then citation-check drops to advisory — never the three core strata.

### 2.3 Labelling workflow + IAA

1. Claims are drawn from historical Hansard 2024–2025 plus the other lanes via the **production detection pipeline** (the harness measures the end-to-end system, EVALUATION §2.2); the sampler records the natural verdict distribution observed pre-stratification.
2. Sampling script assigns claims to strata to hit the grid targets; the assignment is a versioned artefact (`dataset-a-v1.sample.json`).
3. First labeller labels against the full schema; evidence URLs are IA-snapshotted at labelling time (§2.7).
4. Second labeller (double-labelled subset, ~30% → ~33 claims, spread so every gated stratum has ≥6 double-labelled claims) sees the claim, metadata, and the first labeller's question–answer evidence pairs — **but not the first verdict or reasoning** (AVeriTeC protocol, ADR-0010 lesson 3).
5. Disagreements resolved by discussion; unresolvable claims are excluded and counted (the count is published, not silently dropped).
6. IAA reporting: raw percent agreement + Cohen's kappa (four ordinal-ish classes, two raters) overall and per stratum, published alongside accuracy. EV2R automatic evidence-matching is recorded as a development signal only — human sufficiency judgement is the published standard (EVALUATION §3).

### 2.4 Blind-rule enforcement mechanism

The rule (EVALUATION §3): the pipeline never accesses labels; labels never change to suit the pipeline. Enforced structurally, not by convention:

- **Separate database.** Postgres instance hosts `claimwatch` (pipeline store) and `claimwatch_labels` (labels, IAA records, sample assignments). The pipeline's `DATABASE_URL` names only `claimwatch`; the harness connects to `claimwatch_labels` (and reads the pipeline store read-only for claim objects).
- **Role separation.** `pipeline_role` has no CREATE DATABASE and no grants on `claimwatch_labels`; Postgres cross-database queries do not exist, so even a compromised pipeline config cannot read labels through its own connection.
- **One-way data flow.** `packages/harness` may import `packages/store` (read-only queries); `packages/pipeline` has a lint rule (dependency-cruiser or equivalent) forbidding any import of `packages/harness` or of anything under the labels connection module. The claim objects flow pipeline → harness; nothing flows back except through published exports.
- **No shared secrets.** The labels DB credentials exist only in the labelling operator's env and the harness job's env — never in the pipeline's `.env`, which CI asserts via a grep-based check for the labels credential variable name.
- **Drizzle isolation.** The label tables live in a separate Drizzle schema directory (`packages/harness/schema`), generated by its own drizzle-kit config against `claimwatch_labels`; the pipeline's migration history never touches them.

### 2.5 Scoring-run pipeline

| Step | Detail |
|---|---|
| 1. Input assembly | Layer 1: AVeriTeC dev set (fixed slice, versioned checkout). Layer 2: Dataset A labels joined to pipeline-produced verdicts for the same claim IDs |
| 2. Pipeline run | Pinned model versions (ADR-0011 role picks), pinned prompt versions (content-hashed, §2.8), pinned retrieval config |
| 3. Export | Pipeline emits AVeriTeC-format predictions JSONL (Dataset B shape, §3.3) |
| 4. Score | Layer 1: official AVeriTeC eval script (EV2R / Hungarian-METEOR) run as a **pinned tool step** from `tools/averitec-eval` — Python exists nowhere in the runtime (ADR-0014). Layer 2: TS scoring script in `packages/harness` — verdict-class match, per-stratum accuracy, calibration (confidence band vs accuracy), cost/claim per stratum |
| 5. Gate | §2.6 comparison against baseline; exit non-zero on block |
| 6. Publish | Run output written to `harness/runs/<run-id>.json` (immutable, content-addressed run-id), committed; the methodology page renders from this file — the published number is generated, never hand-edited (TEST-STRATEGY L4b) |
| 7. Log | Cost and token counts per claim land in the run file (gen_ai spans feed this, ADR-0012) |

Outputs per run, per layer, never blended: overall accuracy with 95% interval, per-stratum accuracy, calibration table, cost/claim per stratum, IAA (Layer 2), EV2R development score.

### 2.6 Regression gate implementation (D2)

A `packages/harness` script compares the current run file against the **baseline run file** (the last run tagged `accepted`; re-baselined only at a release, never mid-PR):

| Check | Threshold | Effect |
|---|---|---|
| Any gated stratum (n≥20) | −5 points vs baseline | **Block** — CI job fails, PR cannot merge |
| Overall accuracy (Layer 2) | −3 points | **Block** |
| Overall accuracy (Layer 1) | −3 points | **Block** |
| Any gated stratum (n<20) | any regression | **Advisory** — comment on PR, never blocks |
| Provenance stratum | any regression | **Advisory** (declared small) |
| Calibration | reported | Advisory this slice (EOD/ECE thresholds deferred, §6) |

Implementation notes:

- The gate is a pure function over two run files → `{decision: "pass"|"block"|"advisory", reasons[]}`. Pure and fixture-testable, so gate logic is covered at L1 (see HAR-R4).
- Layer 1 has no strata: gate is overall-only. Layer 1 runs from week 1, so the gate exists before any NZ label does.
- A stratum's n is read from the run file, not assumed — the −5 rule self-disables if a stratum under-delivers, and the gate emits a warning listing strata that fell below n≥20 (that warning is itself tested; a silently weakened gate is HAR-R4's sibling).
- Gate runs in CI on the same trigger as full scoring runs (weekly + pre-release per D3); golden-set snapshot diffs (L2) catch drift between full runs.

### 2.7 Evidence durability

- Every evidence URL cited in a label is submitted to the Internet Archive (Save Page Now) at labelling time; the archive URL and snapshot timestamp are stored on the label. AVeriTeC's practice; NZ sources (policedata.nz dashboards, Beehive pages) rot at least as fast (ADR-0010 lesson 4).
- Statistical series are stored with **vintage dates** per the SOURCE-TAXONOMY authority map; labels record the vintage used, so re-verification can detect revisions and verdicts can say "as measured at publication."
- Claims whose truth was checkable only at a past moment are excluded at sampling time (evidence-availability note; EVALUATION §7).

### 2.8 Reproducibility

A scoring run carries a **run manifest** — the run is reproducible if and only if the manifest fully determines it:

| Pinned | How |
|---|---|
| Model versions | Exact provider model IDs + versions per role (ADR-0011), recorded per run |
| Prompts | Prompt files live in `packages/llm/prompts`, versioned in-repo; the manifest records each prompt's content hash |
| Data vintages | Dataset version (Dataset A version, AVeriTeC checkout commit), statistical-series vintage dates, evidence snapshot timestamps |
| Eval tooling | Pinned AVeriTeC eval script (commit + environment recorded in `tools/averitec-eval`) |
| Retrieval config | Search API (Serper/Brave, ADR-0011), capped retrieval depth, authority-map version (SOURCE-TAXONOMY) |

Two runs with identical manifests and a non-deterministic model may still differ; the manifest pins everything we control, and the golden-set snapshot layer (L2) quantifies residual nondeterminism. Search-API result drift is the known irreducible source (§6).

Cadence per D3: golden-set snapshots every PR; full two-layer scoring run weekly + pre-release; gate evaluated on every full run.

## 3. Interfaces and contracts

### 3.1 What the pipeline must never read

| Prohibited | Mechanism that enforces it |
|---|---|
| Label rows, verdict labels, labeller reasoning | Separate `claimwatch_labels` database; `pipeline_role` has no grants; no cross-DB queries in Postgres |
| IAA records, double-labelling assignments | Same database |
| Stratification assignment (which claims are in which stratum) | Same database — the pipeline must not know a claim is "a cherry-picking oversample" or it could behave differently on it |
| Baseline run files during pipeline execution | Run files are consumed only by the gate script after the pipeline run completes; the pipeline job's env never includes the runs directory |
| Anything exported from `packages/harness` | Lint rule on package dependency direction (pipeline → harness forbidden) |

The contract is testable end-to-end: CI spins the slice stack, connects with the pipeline's actual credentials, and asserts every read attempt against `claimwatch_labels` fails with a permission error (HAR-R1).

### 3.2 What the site methodology page consumes

- The **current accepted run file** (`harness/runs/<run-id>.json`): accuracy table per stratum, calibration, IAA, interval, dataset version. Rendered, never hand-edited; L4b asserts the rendered table equals the file.
- The verdict-class mapping (ADR-0004's four classes ↔ page language) — static, published verbatim.
- Dataset A download (CC BY 4.0) and the label-schema version it corresponds to.

### 3.3 Dataset A / Dataset B shapes

**Dataset A — labelling export** (the NZ labelled corpus, CC BY 4.0, versioned):

```
{ "dataset": "claimwatch-nz-labels", "version": "v1", "schema_version": "1.x",
  "label": { claim_id, claim: {text, speaker, party, date, source_url},
             verdict, labeller_confidence,
             cited_sources: [{url, archive_url, archive_timestamp, vintage_date?}],
             labeller_reasoning, evidence_availability,
             source_ecosystem: [{source, tier}],
             labeller_id, label_date },
  "double_label": { second_verdict, second_labeller_id, resolved_verdict?,
                    agreement: bool, excluded: bool }   // present on ~30%
}
```

**Dataset B — AVeriTeC L1 harness export** (pipeline predictions in AVeriTeC format):

```
{ "run_id", "model_versions", "prompt_hashes", "dataset_version",
  "predictions": [ { claim_id, claim_text, verdict, confidence,
                     questions_and_answers: [...], evidence_urls: [...] } ],
  "scores": { layer1: {ev2r, meteor}, layer2: {overall, per_stratum, calibration, cost_per_claim, iaa} } }
```

Dataset B is the artifact the pinned eval script consumes (Layer 1) and the scoring script consumes (Layer 2); Dataset A is the published research asset and the input to Layer-2 scoring.

## 4. Test risks

| ID | Risk | Where it lives | Consequence if untested | Detection signal |
|---|---|---|---|---|
| HAR-R1 | Blind-rule breach: pipeline reads labels (config mistake, grant drift, cross-wired env) | Postgres roles/grants; pipeline env; package dependency graph | Scoring runs silently contaminated — the accuracy number is worthless and unrecoverable retroactively | CI integration test connecting as `pipeline_role` and asserting every labels-DB read fails; dependency-direction lint; env-var assertion |
| HAR-R2 | Label noise / low IAA: labellers disagree beyond chance, or the double-labelled subset is too thin to detect it | Labelling workflow; IAA computation | Per-stratum accuracy measured against noisy ground truth; gate decisions on noise | Kappa < ~0.6 overall or in a gated stratum; disagreement-exclusion rate far above the AVeriTeC ~25% re-annotation reference |
| HAR-R3 | Stratification drift: actual label mix deviates from the grid (oversampled classes under-filled; a stratum drops below n≥20) | Sampling script; sample manifest vs delivered labels | Gate self-disables on thin strata without anyone noticing; "Supported-heavy corrective" claim becomes false | Sampler post-run assertion comparing manifest targets vs actual counts; gate warning on n<20 strata |
| HAR-R4 | Gate logic bugs: a gate that never blocks (comparison inverted, baseline always current) or always blocks (off-by-one on thresholds, n read wrong) | Gate function; CI wiring | Bad pipeline changes ship unchallenged, or iteration halts and the gate gets bypassed "temporarily" — either way the gate stops being trust | Fixture tests over synthetic run-file pairs covering block/pass/advisory for every rule; mutation-style check that a deliberately degraded fixture run is blocked |
| HAR-R5 | Harness-vs-schema drift: labels stop matching pipeline objects after a `packages/store` schema change (renamed field, changed enum) | Shared claim/verdict/evidence objects; Dataset A/B serializers | Export breaks, or worse, exports stale-shaped data that still parses — scoring compares mismatched verdict vocabularies | CI typecheck (shared types fail loudly); round-trip test: a fixture label exports → re-imports → validates against the current Zod schema; migration runs in CI against scratch Postgres |
| HAR-R6 | Temporal leakage: pipeline verifies with post-hoc evidence, or labels rely on knowledge unavailable at claim time | Verification loop; evidence-availability field; vintage dating | Accuracy flattered by future information; verdicts unreproducible at claim time | Availability-note distribution sanity check (claims marked not-verifiable-then must not score as clean supported/refuted); evidence-date ≤ claim-date assertion on sampled runs; golden-set fixtures with post-dated evidence that must trigger the note |
| HAR-R7 | Reproducibility breaks: unpinned prompt/model/config changes alter scores between runs with no code change | Run manifest; prompt hashing; model-version capture | Gate compares runs that differ for uncontrolled reasons — every regression is arguable, the gate loses authority | Manifest-completeness test (every field non-null, hashes verified against prompt files at run time); two identical-manifest runs diffed in CI on a small fixed slice to quantify residual nondeterminism |
| HAR-R8 | Cost overrun on scoring runs (run grows past the ≤$25/week envelope; someone disables it "until costs settle") | Run cost capture; CI budget assertion | Harness goes stale; the regression gate goes stale with it | Cost/claim recorded per run; CI warning when a run exceeds the budget envelope; run duration and claim count asserted against the manifest |
| HAR-R9 | Published-number staleness: methodology page renders an old or hand-edited run file | Site methodology page; run-file publication step | Public trust asset shows numbers no run produced — the exact failure the harness exists to prevent | L4b test: rendered accuracy table equals the accepted run file, byte-for-byte on values; publication step refuses to run with an untagged/unaccepted run |
| HAR-R10 | Evidence rot: cited label URLs die, labels become unauditable | IA snapshot step at labelling time | Dataset A's auditability claim collapses; contested labels can't be re-checked | Sampler reports snapshot coverage (every cited URL has an archive URL + timestamp); periodic link-check of the live URLs with IA fallback assertion |
| HAR-R11 | Double-label subset unrepresentative: the ~30% double-labelled claims cluster in easy strata, so IAA looks fine while hard strata are unmeasured | Sampling script (double-label assignment) | Published IAA overstates label quality exactly where labels are hardest | Per-stratum double-label counts asserted against the grid floor (≥6 per gated stratum); IAA reported per stratum, not only overall |
| HAR-R12 | Eval-script drift: AVeriTeC scoring reimplemented or upgraded ad hoc, diverging from the published field's metric | `tools/averitec-eval` pin | Scores not comparable to the published field; Layer-1 position claims become false | Pin check: CI asserts the tool's recorded commit/environment matches the manifest; smoke test scoring a tiny fixture with known expected output |

## 5. Test strategy

Every §4 risk mapped to a layer (TEST-STRATEGY §2) and a trigger. The harness's own tests live mostly at L1 (free, every push) because most of the harness is deterministic code over fixtures — the thing L1 exists for.

| ID | Mitigation | Layer | When it runs |
|---|---|---|---|
| HAR-R1 | Integration test: connect as `pipeline_role`, attempt reads on `claimwatch_labels`, assert permission errors; dependency-direction lint (pipeline ↛ harness); env-var grep for labels credentials in pipeline config | L1 (lint + testcontainers integration) | Every push |
| HAR-R2 | IAA computed and published per run with thresholds flagged (kappa < 0.6 → warning in run file); disagreement-exclusion rate reported against the AVeriTeC reference; IAA floor is an advisory signal in the gate output | L3 | Weekly + pre-release |
| HAR-R3 | Sampler asserts delivered counts vs manifest targets before a run is accepted; gate emits the n<20 warning list; sample manifest is a reviewed artefact in version control | L1 (sampler assertions) + L3 | L1 every push; L3 weekly + pre-release |
| HAR-R4 | Gate function is pure; fixture run-file pairs cover: per-stratum block, overall block, small-stratum advisory, pass, and inverted-comparison mutation (a test asserting the gate blocks a deliberately degraded run — if the gate is broken to always-pass, this test fails) | L1 | Every push |
| HAR-R5 | Shared types from `packages/store` make drift a compile error; round-trip export/import test on fixture labels; drizzle migrations run against scratch Postgres in CI (the schema-drift alarm, ADR-0014) | L1 | Every push (CI runs migrations before merge) |
| HAR-R6 | L1 fixtures: golden-set claims with post-dated evidence must produce the availability note, not a clean verdict; L3 assertion that evidence dates ≤ claim dates on sampled runs; availability-note distribution reported per run | L1 + L2 + L3 | L1 every push; L2 every PR; L3 weekly + pre-release |
| HAR-R7 | Manifest-completeness test (all pin fields non-null; prompt hashes recomputed and matched at run time); residual-nondeterminism probe: two identical-manifest runs on a fixed 20-claim slice, diff bounded, run in CI weekly | L1 + L3 | L1 every push; probe weekly |
| HAR-R8 | Cost/claim per stratum recorded in every run file; CI assertion that full-run cost stays inside the budget envelope (warn, then fail at 2×) | L1 (assertion logic) + L3 (measurement) | L3 weekly + pre-release |
| HAR-R9 | L4b: rendered methodology-page accuracy table asserted equal to the accepted run file; publication step rejects runs not tagged `accepted` | L4b | Pre-release |
| HAR-R10 | Snapshot coverage report at labelling time (every cited URL → archive URL + timestamp; uncovered citations fail the labelling batch); link-check job with IA fallback | L1 (coverage assert) + scheduled job | Labelling batches; link-check monthly |
| HAR-R11 | Double-label assignment is part of the sampled manifest; per-stratum counts asserted at sampling; IAA broken out per stratum in the run file and on the methodology page | L1 + L3 | L1 at sampling; L3 weekly + pre-release |
| HAR-R12 | Pinned tool step: CI records and asserts the eval script's commit + environment against the run manifest; smoke test scores a fixture with a known expected score | L1 (smoke + pin check) | Every push |

Sequencing note (D1): the harness scaffold — schema, blind-rule grants, gate function with fixtures, export serializers — lands **with** the first pipeline code, so HAR-R1/R4/R5 tests exist before there is an accuracy number to protect.

## 6. Open questions

| # | Question | Notes |
|---|---|---|
| 1 | Second-labeller capacity | Operator + one other for the 2026 cycle; j-school partnership is the scale-up path. If the second labeller can't commit ~33 double-labels, does the grid drop to 2 gated strata or accept lower double-label coverage? |
| 2 | IAA metric | Cohen's kappa proposed (2 raters, 4 classes). If a third labeller joins via the partnership, switch to Krippendorff's α — decide before the first double-labelled batch, not after. |
| 3 | Calibration gate threshold | Calibration is reported but only advisory in the gate (§2.6). What ECE/interval-width threshold makes it a block, and on what n? Deferred until two runs of calibration data exist. |
| 4 | Held-out slice vs gate | EVALUATION §3 holds out 10–20% never tuned against. With n≈110, holding out 15–20 labels drops every stratum below the gate floor. Does the slice run gate-only on the full set (held-out deferred to scale-up), or hold out and shrink the grid? Recommendation: defer held-out, revisit at n≥300. |
| 5 | Search-API result drift | Identical manifests can still diverge on live search results. Accept as reported residual noise, or pin a cached retrieval corpus for the gate runs (costs storage, removes a noise source)? |
| 6 | Baseline re-baselining policy | Gate compares against the last `accepted` run; who tags runs accepted and under what authority (release process doesn't exist yet in the slice)? |
| 7 | Provenance stratum's future | The curated 10-item set is advisory-only by design (VALIDATION-SLICE lane 5). At what point does provenance get a real labelled stratum with n≥20, and does it enter the gate then? |
| 8 | AVeriTeC licence verification | CC BY-NC 4.0 assumed fine for evaluation use; verify terms at first scoring run and record the check in the run manifest (ADR-0010). |