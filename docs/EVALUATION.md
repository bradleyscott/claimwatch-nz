# Evaluation: measuring the pipeline and the community layer

*Status: proposed. This doc defines the two-layer evaluation harness the project treats as its core trust asset. Related ADRs: ADR-0008 (ground-truth evaluation), ADR-0001 (automation posture), ADR-0004 (verification modes).*

---

## 1. Why this is the core asset, not an afterthought

ClaimWatch has no editorial masthead. An automated verdict system that can be mutated by public contestation must earn trust another way: **published, reproducible accuracy measurement.** Every credibility question about the system ("how do we know the AI is right?", "does the crowd make it better or worse?") gets the same answer: labelled ground truth, a blind scoring run, and published numbers — refreshed with every pipeline change and every labelled-set version.

This follows the methodology of the AVeriTeC shared tasks: systems are scored against claims with human-verified answers, and accuracy is reported so systems are comparable. The evaluation is **two-layer** (see ADR-0008): **Layer 1 — AVeriTeC's public dataset** (~4,568 real-world claims, public evaluation script, published reference scores) as the immediate benchmark for the generic open-web verification loop from day one; **Layer 2 — the NZ-labelled set** as the domain calibration set exercising the NZ source ecosystem. Both are reported separately, never blended.

## 2. The ground-truth sets

### 2.1 Layer 1 — AVeriTeC (immediate benchmark)

- **Source**: the public AVeriTeC dataset (CC BY-NC 4.0 — evaluation use is fine; not for training a commercial product on it; verify terms at time of use). It comes with question–answer evidence annotations, a public evaluation script (EV2R / Hungarian-METEOR scoring), and published reference scores (2024 winner 63% with GPT-4o; 2025 open-weights winner 33%).
- **Scope of what it measures**: the generic open-web verification loop — question decomposition, evidence retrieval, verdict calibration, justification quality. It is **blind to the NZ-specific machinery**: no topic packs, no NZ official-series retrieval, no sensitivity grid.
- **Role**: regression gate for the generic verification mode from week 1 of the build; position against the published field is interpretable from day one. A high AVeriTeC score means the generic loop works — it does *not* mean the NZ-specific engine works.

### 2.2 Layer 2 — the NZ-labelled set (n=100)

- **Source**: claims sampled from historical Hansard (2024–2025 — pre-current-cycle so nothing is live-controversial at labelling time) via the **same detection pipeline** as production (so the harness measures the end-to-end system, not just verification), complemented by news-derived and commentary-derived claims (commentator-sourced claims are a distinct claim *style* — assertive, evidence-light — and are stratified deliberately).
- **Stratification**: by topic (the seeded policy domains — see `docs/SOURCE-TAXONOMY.md` §2.2), by **misleading-technique class** (statistical-selective / false-context / citation-backed / fabricated-other / satire-excluded — per `docs/MISINFO-TAXONOMY.md`), and by evidence-availability. The technique-class stratification is deliberate: hard classes (selective-framing, false-context) are **oversampled** relative to their natural frequency, because abstention quality (NEI) and selective-framing detection are the failure modes that matter most.
- **Labelling**: operator + one other for the 2026 cycle; journalism-school research partnership is the scale-up path (and a recruitment channel for post-election community review). **Double-label a random 20%** and report inter-annotator agreement with the published accuracy number.
- **Label schema**: claim text, speaker, party, date, source URL, verdict, cited primary sources, labeller reasoning, evidence-availability note, **source-ecosystem field** (which NZ sources the label rests on — so accuracy can be sliced by source-access difficulty), labeller ID, label date.
- **Verdict schema**: aligned to AVeriTeC's four classes (Supported / Refuted / Not Enough Evidence / Conflicting Evidence–Cherry-picking) for comparability with the published field, with "accurate but incomplete" mapped to the Conflicting/Cherry-picking class (the AVeriTeC class explicitly covers "technically true claims that mislead by excluding important context").
- **Evidence durability**: evidence URLs cited in labels are **cached to the Internet Archive at labelling time** (AVeriTeC's own practice); statistical series are stored with vintage dates.

### 2.3 Versioning and publication

- Both layers are published (Layer 2: CC BY 4.0, versioned) with an update policy: new claims may be added; existing labels may be revised only through the same contest-and-mutation process used for verdicts, with revision history preserved.
- Contested labels are the most valuable entries in the dataset.

## 3. Scoring runs

- **Blind rule:** the pipeline never accesses labels; labels never change to suit the pipeline.
- Report per layer, never blended: accuracy overall, **per claim type and technique class**, **per confidence band**, and **calibration** (does high confidence predict higher accuracy?).
- **Held-out slice** (10–20%) exists but is never tuned against; reported separately at each release.
- A scoring run is reproducible: pinned model versions, pinned data vintages, published prompts.
- Automatic evidence-matching scores (EV2R) are treated as **development signals** — AVeriTeC's own analysis found independent annotators score only ~0.4 on automatic evidence matching because different-but-equivalent evidence paths exist; human sufficiency judgement is the gold standard for anything published.

## 4. Regression gate

Every pipeline change (prompt, model, retrieval source, grid definition) re-runs the harness — both layers. A change that reduces accuracy does not ship. The harness is the project's CI gate for quality, not just a launch-day number.

## 5. Grading the community layer

Replay historical contest cases (real and constructed) against the harness:

- Does evidence-validated mutation move verdicts **toward** or **away from** expert labels?
- What proportion of submitted evidence survives validation (by source type)?
- Mutation rate per verdict, and net accuracy delta after community participation.

This produces the dataset that can answer the question the sector is actively arguing about (Meta's 2025 switch to community correction, and its critics). It is a publishable, fundable research artefact in its own right.

## 6. What each layer answers

| Question | Layer 1 (AVeriTeC) | Layer 2 (NZ set) |
|---|---|---|
| Is the generic verification loop competent? | ✅ primary measure | — |
| Are verdicts calibrated (abstention quality)? | ✅ comparable to published field | ✅ on NZ material |
| Does the NZ source ecosystem work (retrieval, reading, topic packs)? | ❌ blind to it | ✅ primary measure |
| Is the sensitivity grid / stat engine sound? | ❌ not exercised | ✅ (stratified by claim type) |

## 7. Temporal leakage controls

- Label claims with an **evidence-availability note**: was the claim verifiable at the time, and is it verifiable now?
- Exclude claims whose truth was only checkable at a past moment (the AVeriTeC 2025 approach).
- The pipeline verifies using only present-day retrievable evidence — never post-retrieval label information.
- Statistical series are stored with **vintage dates** so verdicts can note "as measured at publication" and re-verification can detect revisions.

## 8. Known and accepted limitations

- **Layer 2 n=100**: wide confidence interval (±~8–10 points at 95% for proportions near 80%). The number is published *with* its interval, and the contest pathway plus mutation audit log carry the rest of the credibility load.
- **Layer 1 distribution skew**: AVeriTeC is ~62% Refuted by construction (fact-checker selection bias). Our pipeline is *not* tuned against that distribution, and Layer 2's Supported-heavy NZ sample is deliberately the corrective instrument — a pipeline tuned on refutation-heavy benchmarks tends to over-refute, which the stratified Layer 2 catches.
- **Hansard claims skew parliamentary**: complemented with news-derived and commentary-derived claims so the distribution isn't purely institutional.

## 9. Success criteria for the harness

1. An accuracy number for the automated layer, per claim type and confidence band, published before the campaign peak (both layers reported separately).
2. A measured answer on whether validated community evidence improves verdicts.
3. A regression gate that every pipeline change passes through.
4. A labelled NZ political-claims corpus that does not otherwise exist — published, auditable, and reusable by researchers, journalists, and the community layer itself.