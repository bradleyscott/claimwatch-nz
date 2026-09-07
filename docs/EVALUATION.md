# Evaluation: measuring the pipeline and the community layer

*Status: proposed. This doc defines the ground-truth harness that the project treats as its core trust asset. Related ADRs: ADR-008 (dataset construction), ADR-001 (automation posture).*

---

## 1. Why this is the core asset, not an afterthought

ClaimWatch has no editorial masthead. An automated verdict system that can be mutated by public contestation must earn trust another way: **published, reproducible accuracy measurement.** Every credibility question about the system ("how do we know the AI is right?", "does the crowd make it better or worse?") gets the same answer: a labelled ground-truth set, a blind scoring run, and published numbers — refreshed with every pipeline change and every labelled-set version.

This follows the methodology of the AVeriTeC shared tasks: systems are scored against claims with human-verified answers, and accuracy is reported so systems are comparable. We are doing that domestically, continuously, and in public.

## 2. The ground-truth set

### 2.2.1 Sampling
- Source: historical Hansard (initial target: 2024–2025 sessions — pre-current-cycle so nothing is live-controversial at labelling time), plus a smaller complement of news-derived claims so the distribution isn't purely parliamentary.
- Claims are sampled using the **same detection pipeline** as production (so the harness measures the end-to-end system, not just verification).
- Stratify by topic (health, housing, justice, economy, environment, education) and claim type (statistical / citation-backed / other factual / predictive-excluded).

### 2.2 Labelling
- Each claim record: claim text, speaker, party, date, source URL, verdict (true / false / partially true / misleading-selective / unverifiable), cited primary sources, labeller reasoning, evidence-availability note (see leakage), labeller ID, label date.
- **Double-label a random 20%** and report inter-annotator agreement with the published accuracy number.
- Labelling resource for the 2026 cycle: operator + one other person; journalism-school research partnership is the scale-up path (and a recruitment channel for post-election community review).

### 2.3 Versioning and publication
- The set is versioned (v1.0 …) and published openly (CC BY 4.0) with an update policy: new claims may be added; existing labels may be revised only through the same contest-and-mutation process used for verdicts, with the revision history preserved.
- Contested labels are the most valuable entries in the dataset.

## 3. Scoring runs

- **Blind rule:** the pipeline never accesses labels; labels never change to suit the pipeline.
- Report: accuracy overall, **per claim type**, **per confidence band**, and **calibration** (does high confidence predict higher accuracy?).
- **Held-out slice** (10–20%) exists but is never tuned against; reported separately at each release.
- A scoring run is reproducible: pinned model versions, pinned data vintages, published prompts.

## 4. Regression gate

Every pipeline change (prompt, model, retrieval source, grid definition) re-runs the harness. A change that reduces accuracy does not ship. The harness is the project's CI gate for quality, not just a launch-day number.

## 5. Grading the community layer

Replay historical contest cases (real and constructed) against the harness:

- Does evidence-validated mutation move verdicts **toward** or **away from** expert labels?
- What proportion of submitted evidence survives validation (by source type)?
- Mutation rate per verdict, and net accuracy delta after community participation.

This produces the dataset that can answer the question the sector is actively arguing about (Meta's 2025 switch to community correction, and its critics). It is a publishable, fundable research artefact in its own right.

## 6. The 2026-cycle quick build

Full harness scaled down to be feasible before the election:

| Parameter | Research version | 2026-cycle version |
|---|---|---|
| Labelled claims | 500–1,000 | **100** |
| Double-labelled | 20% | 20 (same rate) |
| Labellers | 2+ (research partnership) | operator + one other |
| Scoring cadence | every pipeline change | once before launch + after any major change |
| Published | accuracy + calibration + IAA | accuracy + IAA |

Known and accepted limitation: n=100 gives a wide confidence interval (±~8–10 points at 95% for proportions near 80%). The number is published *with* its interval, and the contest pathway plus mutation audit log carry the rest of the credibility load.

## 7. Temporal leakage controls

- Label claims with an **evidence-availability note**: was the claim verifiable at the time, and is it verifiable now?
- Exclude claims whose truth was only checkable at a past moment (the AVeriTeC 2025 approach).
- The pipeline verifies using only present-day retrievable evidence — never post-retrieval label information.
- Statistical series are stored with **vintage dates** so verdicts can note "as measured at publication" and re-verification can detect revisions.

## 8. Success criteria for the harness

1. An accuracy number for the automated layer, per claim type and confidence band, published before the campaign peak.
2. A measured answer on whether validated community evidence improves verdicts.
3. A regression gate that every pipeline change passes through.
4. A labelled NZ political-claims corpus that does not otherwise exist — published, auditable, and reusable by researchers, journalists, and the community layer itself.