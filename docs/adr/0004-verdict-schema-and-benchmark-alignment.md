# ADR-0004: Verdict schema, benchmark alignment, and honest abstention

*Status: Proposed · Date: 2026-09-08 · Deciders: Bradley, Dave*

## Context

The verdict vocabulary is where epistemics, legal posture, and benchmark comparability meet. The design needs verdict classes that are (a) mechanically derivable from published evidence, (b) directly comparable to the international benchmark field, and (c) honest about abstention — and the presentation language must be plain enough for the public while exact enough to re-derive.

**The benchmark anchor:** AVeriTeC ("Automated Verification of Textual Claims", FEVER workshop shared task) is the field's standard: ~4,568 real-world claims from 50 fact-checking organisations, each with human-annotated question–answer evidence pairs, a public evaluation script, and published reference scores (2024 winner 63% with GPT-4o; 2025 open-weights winner 33%; baseline 11%). Its four verdict classes are the field's taxonomy — and its fourth class explicitly covers "technically true claims that mislead by excluding important context," independently confirming that selective framing is a first-class verdict, not our invention.

## Decision

**The harness scores against AVeriTeC's four verdict classes; product verdict pages render the same judgements in plain language.**

### The four classes (harness labels → page rendering)

| Harness label (AVeriTeC-exact) | Verdict-page rendering | Meaning |
|---|---|---|
| **Supported** | Supported | The evidence backs the claim as stated |
| **Refuted** | Refuted | The evidence contradicts the claim |
| **Not Enough Evidence** | Not enough evidence (open question) | Insufficient authoritative evidence either way — honest abstention, published as "we could not verify this — can you?" (ADR-0001's open-question posture) |
| **Conflicting Evidence–Cherry-picking** | **Accurate but incomplete** — material alternatives contradict the impression | Technically true, framing misleads by omitting material context — the selective-framing class (ADR-0002's stat engine is built for this) |

- **"Accurate but incomplete" is a rendering, not a departure.** AVeriTeC's own definition of the fourth class is "technically true claims that mislead by excluding important context" — the page label restates it in plain English for the flagship case (a true number whose framing is unrepresentative; the official series agrees with the number, so "conflicting evidence" would under-describe the finding). The methodology page states the mapping verbatim so the friendly label is transparent against the benchmark term.
- **No subjective degrees of truth** (PolitiFact-style "Mostly True" / "Half-True" / 1–6 scores): every verdict must be re-derivable by any reader from the published evidence and the pre-declared sensitivity grid (ADR-0002). A degree-slider invites judgements that cannot be mechanically re-derived.
- **Claims, not persons** (per ADR-0006): verdicts address claims and evidence, never character.
- **Pledges**: "pledge — not yet checkable" for future promises (checkable only as consistency claims against published forecasts).
- **Confidence**: every verdict carries a confidence level; claims below threshold publish as open questions rather than verdicts (ADR-0001).

### What the benchmark does and does not measure

AVeriTeC measures **end-to-end open-web verification skill** — question decomposition, evidence retrieval, verdict calibration, justification quality — against a published field. It is blind to the NZ-specific machinery (no NZ sources, no claim-anchored evidence store, no sensitivity grid) and its distribution is ~62% Refuted by construction (fact-checker selection bias). It is the Layer-1 benchmark (ADR-0005); the NZ-labelled calibration set is Layer 2. The two are reported separately, never blended.

## Alternatives considered

- **An ad-hoc verdict scale** (project-invented classes). Rejected: breaks benchmark comparability, and inventing a taxonomy is the "invented standard" attack surface the pre-declared grid exists to avoid.
- **PolitiFact-style six-level truth ratings.** Rejected: subjective degrees cannot be mechanically re-derived; invites unanswerable "why Half-True?" disputes; the four classes + published evidence carry the same information with full auditability.
- **Dropping "Not Enough Evidence"** (force every claim to a true/false verdict). Rejected: abstention quality is a core measured capability (AVeriTeC analysis: models overpredict the rarer classes when prevented from abstaining); honest abstention published as open questions is a participation mechanism, not a failure (ADR-0001).
- **AVeriTeC as the sole evaluation.** Rejected (ADR-0005): blind to NZ sources and every differentiating feature; the two-layer structure exists because of this.

## Consequences

- **The verdict schema in the store is exactly the four classes** (+ the pledge/conditional states and confidence) — defined in `packages/store`, enforced in LLM output validation.
- **The harness and the site share one verdict universe**: harness numbers are against the four classes; page language is the public rendering. The mapping is published on the methodology page.
- **AVeriTeC scoring runs use the official evaluation script** (pinned tool step, per ADR-0007) — no reimplementation drift.
- **The "accurate but incomplete" class is the flagship**: its definition (AVeriTeC's own), its detection (the sensitivity grid), and its deployment-context rendering (ADR-0010) are the project's differentiating capabilities.