# Evaluation: measuring the pipeline and the community layer

*Proposed. Defines the two-layer harness the project treats as its core trust asset. ADRs: 0010 (ground-truth evaluation), 0001 (automation posture), 0005 (verification modes).*

## 1. Why this is the core asset

ClaimWatch has no editorial masthead; an automated verdict system that the public can mutate must earn trust another way: **published, reproducible accuracy measurement.** Every credibility question ("how do we know the AI is right?", "does the crowd make it better or worse?") gets the same answer: labelled ground truth, a blind scoring run, published numbers — refreshed with every pipeline change and labelled-set version.

The harness is **two-layer** (ADR-0010), reported separately, never blended:

- **Layer 1 — AVeriTeC's public dataset** (~4,568 real-world claims, public evaluation script, published reference scores) as the immediate benchmark for the generic open-web verification loop from day one.
- **Layer 2 — the NZ-labelled set** as the domain calibration set exercising the NZ source ecosystem.

## 2. The ground-truth sets

### 2.1 Layer 1 — AVeriTeC (immediate benchmark)

- **Source**: the public AVeriTeC dataset (CC BY-NC 4.0 — evaluation use fine; not for training a commercial product; verify terms at time of use), with question–answer evidence annotations, a public evaluation script (EV2R / Hungarian-METEOR scoring), and published reference scores (2024 winner 63% with GPT-4o; 2025 open-weights winner 33%).
- **Measures**: the generic open-web loop — question decomposition, evidence retrieval, verdict calibration, justification quality. **Blind to the NZ machinery**: no NZ official-series retrieval, no evidence store, no sensitivity grid. A high AVeriTeC score means the generic loop works, not that the NZ engine works.
- **Role**: regression gate for the generic verification mode from week 1; position against the published field is interpretable from day one.

### 2.2 Layer 2 — the NZ-labelled set (n=100)

- **Source**: claims sampled from historical Hansard (2024–2025, pre-current-cycle so nothing is live-controversial) via the **same detection pipeline as production** — the harness measures the end-to-end system — complemented by news-derived and commentary-derived claims (commentator claims are a distinct, assertive, evidence-light style; stratified deliberately).
- **Stratification**: by topic (the policy domains of `SOURCE-TAXONOMY.md` §2.2), by **misleading-technique class** (statistical-selective / false-context / citation-backed / fabricated-other / satire-excluded — per `MISINFO-TAXONOMY.md`), and by evidence-availability. Hard classes (selective framing, false context) are **oversampled**: abstention quality and selective-framing detection are the failure modes that matter most.
- **Labelling**: operator + one other for 2026; journalism-school partnership is the scale-up path (and a recruitment channel for post-election community review). **Double-label a random 20%**; report inter-annotator agreement with the accuracy number.
- **Label schema**: claim text, speaker, party, date, source URL, verdict, cited primary sources, labeller reasoning, evidence-availability note, **source-ecosystem field** (which NZ sources the label rests on — accuracy sliceable by source-access difficulty), labeller ID, label date.
- **Verdict schema**: AVeriTeC's four classes (Supported / Refuted / Not Enough Evidence / Conflicting Evidence–Cherry-picking) for comparability; "accurate but incomplete" maps to the fourth class, which covers "technically true claims that mislead by excluding important context."
- **Evidence durability**: cited evidence URLs are **cached to the Internet Archive at labelling time** (AVeriTeC's own practice); statistical series stored with vintage dates.

### 2.3 Versioning and publication

Both layers are published (Layer 2: CC BY 4.0, versioned) with an update policy: new claims may be added; existing labels revised only through the same contest-and-mutation process used for verdicts, revision history preserved. Contested labels are the most valuable entries in the dataset.

## 3. Scoring runs

- **Blind rule**: the pipeline never accesses labels; labels never change to suit the pipeline.
- Reported per layer: accuracy overall, **per claim type and technique class**, **per confidence band**, and **calibration** (does high confidence predict higher accuracy?).
- **Held-out slice** (10–20%) never tuned against; reported separately at each release.
- Reproducible: pinned model versions, pinned data vintages, published prompts.
- Automatic evidence-matching scores (EV2R) are **development signals** — AVeriTeC's own annotators score only ~0.4 on them (different-but-equivalent evidence paths exist); human sufficiency judgement is the gold standard for anything published.

## 4. Regression gate

Every pipeline change (prompt, model, retrieval source, grid definition) re-runs the harness — both layers. A change that reduces accuracy does not ship. The harness is the project's CI gate for quality, not just a launch-day number.

## 5. Grading the community layer

Replay historical contest cases (real and constructed) against the harness:

- Does evidence-validated mutation move verdicts **toward** or **away from** expert labels?
- What proportion of submitted evidence survives validation (by source type)?
- Mutation rate per verdict, and net accuracy delta after community participation.

This produces the dataset that answers the question the sector is actively arguing about (Meta's 2025 switch to community correction, and its critics) — a publishable, fundable research artefact in its own right.

## 6. What each layer answers

| Question | Layer 1 (AVeriTeC) | Layer 2 (NZ set) |
|---|---|---|
| Is the generic verification loop competent? | ✅ primary measure | — |
| Are verdicts calibrated (abstention quality)? | ✅ comparable to published field | ✅ on NZ material |
| Does the NZ source ecosystem work (retrieval, reading, the evidence store)? | ❌ blind to it | ✅ primary measure |
| Is the sensitivity grid / stat engine sound? | ❌ not exercised | ✅ (stratified by claim type) |

## 7. Temporal leakage controls

- Label claims with an **evidence-availability note**: verifiable at the time? verifiable now?
- Exclude claims whose truth was only checkable at a past moment (the AVeriTeC 2025 approach).
- The pipeline verifies using only present-day retrievable evidence — never post-retrieval label information.
- Statistical series stored with **vintage dates** so verdicts can note "as measured at publication" and re-verification can detect revisions.

## 8. Known and accepted limitations

- **Layer 2 n=100**: wide confidence interval (±~8–10 points at 95% for proportions near 80%). The number is published *with* its interval; the contest pathway plus mutation audit log carry the rest of the credibility load.
- **Layer 1 distribution skew**: AVeriTeC is ~62% Refuted by construction (fact-checker selection bias). Layer 2's Supported-heavy NZ sample is deliberately the corrective instrument — a pipeline tuned on refutation-heavy benchmarks tends to over-refute, which the stratified Layer 2 catches.
- **Hansard claims skew parliamentary**: complemented with news-derived and commentary-derived claims.

## 9. Success criteria

1. An accuracy number for the automated layer, per claim type and confidence band, published before the campaign peak (both layers, reported separately).
2. A measured answer on whether validated community evidence improves verdicts.
3. A regression gate every pipeline change passes through.
4. A labelled NZ political-claims corpus that does not otherwise exist — published, auditable, reusable by researchers, journalists, and the community layer itself.