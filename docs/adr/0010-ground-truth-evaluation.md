# ADR-0010: Ground-truth evaluation — AVeriTeC as the immediate benchmark, NZ-labelled set as the calibration set

*Status: Proposed · Date: 2026-09-07 · Deciders: Bradley, Dave*

## Context

ADR-0001 makes the evaluation harness load-bearing. The harness needs (a) an immediately usable benchmark to test the pipeline against, and (b) a domain-calibrated labelled set reflecting what the production system will actually face. These are two different jobs; a single dataset construction method was conflating them.

The NZ-specificity question, examined: does claim content need to be NZ-specific to measure verification accuracy? **The claim text itself does not** — verification skill (question decomposition, evidence retrieval, verdict calibration) transfers across jurisdictions. **The evidence environment does** — NZ claims are verified against NZ sources (Stats NZ, Hansard, policedata.nz, NZ ministry sites), and a pipeline tuned or scored only against claims whose evidence lives in Wikipedia/Reddit/international news learns retrieval habits that don't transfer cleanly to the NZ source landscape. So the NZ-specific dimension is real, but it is specifically a **source-ecosystem problem** — which is exactly why the two-layer design below separates them.

## Decision

**Two-layer evaluation:**

**Layer 1 — AVeriTeC as the immediate benchmark (day-one testing).**

- The AVeriTeC dataset (public, CC-licensed, ~4,568 real-world claims from 50 fact-checking organisations, each with question–answer evidence annotations and verdicts: Supported / Refuted / Not Enough Evidence / Conflicting Evidence) is used directly as the pipeline's first benchmark.
- It measures what it genuinely measures for us: **end-to-end open-web verification skill** against a published field of reference scores (2024 winner 63%, 2025 open-weights winner 33%), so the pipeline's position is interpretable from day one.
- Honest limitations, stated in the harness docs: claims are US/open-web-centric (most common evidence domains: NLM, Reddit, ScienceDirect, Wikipedia, BBC, NYT, CNN); **no NZ sources and no NZ evidence ecosystem**; claim style is fact-check-organisation style, not NZ Hansard/release style; and it does not exercise our differentiating machinery at all — no NZ official-series retrieval, no evidence store, no sensitivity grid. A high AVeriTeC score does not mean the NZ-specific engine works; it means the generic loop works.
- Practical role: the regression gate for the generic verification mode from week 1 of the build; the pipeline runs AVeriTeC's dev set before any NZ labelling exists. **No NZ-set dependency blocks early pipeline development.**

**Layer 2 — the NZ-labelled set as the domain calibration set (n=100, per the original plan).**

- Claims sampled from historical Hansard (2024–2025) via the production detection pipeline, complemented by news-derived and commentary-derived claims; labelled by operator + one other, 20% double-labelled; schema, publication, and scoring as specified in `EVALUATION.md`.
- Its distinctive job — the thing AVeriTeC cannot do — is **exercising the NZ source ecosystem**: does the pipeline find and correctly read Stats NZ series, policedata.nz, MoJ data, Beehive releases, Hansard itself? Are NZ-specific denominator families (recorded crime vs victim survey, the three child-poverty measures) used correctly? The label schema adds a **source-ecosystem field** (which NZ sources the label rests on) so accuracy can be sliced by source-access difficulty.
- Timing: labelling runs in parallel with AVeriTeC-based development, not after it — the two layers measure different things.

**What each layer answers:**

| Question | Layer 1 (AVeriTeC) | Layer 2 (NZ set) |
|---|---|---|
| Is the generic verification loop competent? | ✅ primary measure | — |
| Are verdicts calibrated (abstention quality)? | ✅ comparable to published field | ✅ on NZ material |
| Does the NZ source ecosystem work (retrieval, reading, the evidence store)? | ❌ blind to it | ✅ primary measure |
| Is the sensitivity grid / stat engine sound? | ❌ not exercised | ✅ (stratified by claim type) |

**Reporting:** the public methodology page reports both layers separately, never blended into one headline number.

### Dataset-design lessons adopted from AVeriTeC

1. **Verdict label schema aligned for comparability.** Layer 2 uses AVeriTeC's four verdict classes rather than an ad-hoc scale; the fourth class explicitly covers "technically true claims that mislead by excluding important context" — our selective-framing class is first-class in their taxonomy too (ADR-0004 records the mapping). Product pages may present richer framing (e.g. "false context" detail from `MISINFO-TAXONOMY.md`), but the harness scores against the four classes.
2. **Deliberate distribution divergence — and stratification.** AVeriTeC is 62% Refuted *by construction* (fact-checkers select falsehoods to check). Our set, sampled from NZ public discourse via our own detection pipeline, will be far more Supported-heavy — most political claims are true or partially true. This is a real population difference to preserve, not correct. But it creates a measurement risk: on a truth-heavy sample, a pipeline that never detects refuted or cherry-picked claims still scores well. Therefore Layer 2 is **stratified with deliberate oversampling of the hard classes** — Conflicting/Cherry-picking and Not Enough Evidence are enriched relative to their natural frequency, because abstention quality (NEI) and selective-framing detection are the failure modes that matter most. The sampling design records both the natural distribution (measured) and the stratified sample (published).
3. **Annotation protocol.** AVeriTeC's process, adopted in lightweight form for the double-labelled 20%: the second labeller sees the claim, metadata, and the first labeller's question–answer evidence pairs — but **not** the first verdict — and produces an independent verdict + justification; disagreements are resolved by discussion, and unresolvable claims are excluded and counted (AVeriTeC discarded claims whose annotators still disagreed after re-annotation; ~25% of their claims went through re-annotation, which calibrates how hard evidence sufficiency is in practice). Justification guidelines are adopted too: calculations and rounding logic must be stated explicitly in the justification ("6.3% is greater than 6.1%", "4.3m ≈ 4m"), commonsense assumptions must be flagged separately, and authority references ("because the Guardian says so") are prohibited as answers.
4. **Temporal leakage and evidence durability.** Evidence must predate the claim date (their control; ours is the evidence-availability note plus vintage-dating from ADR-0005). Evidence URLs cited in labels are **cached in the Internet Archive at labelling time** — AVeriTeC does this so evidence doesn't rot out of the dataset; with NZ sources this matters at least as much (policedata.nz dashboards and ministerial release pages change).
5. **Claim metadata parity.** AVeriTeC annotates speaker, publisher, date, location, claim type, and fact-checker strategy. Our schema already carries speaker/party/date/source; it adds claim type (statistical / citation-backed / other — already planned) and a **verification-strategy field** (official-series / primary-document / expert-testimony / open-web), enabling the same style of stratified analysis they publish.
6. **Scoring reuse.** Layer 1 uses AVeriTeC's public evaluation script (EV2R / Hungarian-METEOR scoring). One documented caveat adopted from their own analysis: even their independent annotators score low on automatic evidence matching (~0.4), because different-but-equivalent evidence paths exist — so automatic evidence scores are treated as development signals, and human sufficiency judgement remains the gold standard for anything we publish.

**What the AVeriTeC distribution does NOT tell us:** their 62% Refuted share reflects fact-checker selection bias, not the NZ claim population. It is a useful calibration point for interpreting our pipeline's behaviour on their distribution versus ours, and it predicts a specific failure mode to watch: a pipeline tuned on refutation-heavy benchmarks tends to over-refute — exactly what the calibration stratification in Layer 2 is designed to catch.

## Alternatives considered

- **AVeriTeC as the sole harness.** Rejected: blind to the NZ source ecosystem and to every NZ-specific design feature (ADR-0005); would let the project declare success on numbers that don't touch the differentiating machinery.
- **NZ-labelled set as the sole harness.** Rejected: blocks all pipeline development behind labelling work, and n=100 alone gives too wide an interval for the generic-loop regression gate.
- **Synthetic/LLM-labelled ground truth.** Rejected: circular (labels generated by the same class of system being measured); LLM labels may assist *triage* of what to label, never the labels themselves.
- **Larger n later / perfect after launch.** Rejected: an unpublished harness protects nobody; two layers published before launch beat one perfect layer after.

## Consequences

- Pipeline development starts against AVeriTeC immediately — week-1 code has a benchmark, removing a sequencing dependency.
- The NZ-set labelling effort (n=100) is unchanged in size; it is targeted at the NZ-specific questions AVeriTeC can't answer.
- The harness docs gain an AVeriTeC section: dataset provenance, licence (the dataset and baseline are CC BY-NC 4.0 — fine for research/evaluation use, not for training a commercial product on it; verify terms at time of use), the evaluation-script reuse (the shared task's scoring script is public), and the honest statement of what a score on it does and does not mean.
- Both layers are published; Layer 2 remains the labelled-NZ-corpus asset (CC BY 4.0).