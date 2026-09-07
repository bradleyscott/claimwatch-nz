# ADR-0006: Verdict language standard ("claims, not persons") and the mutation freeze

*Status: Proposed · Date: 2026-09-07 · Deciders: Bradley, Dave*

## Context

Two legal exposures shape published language and timing:

1. **Defamation** (civil, no anti-SLAPP in NZ): verdicts that imply persons lied invite suits from well-resourced actors.
2. **Electoral Act 1993 s 199A** (publishing a statement of fact known to be false, with intent to influence voters): applies only to material **first published on election day or the two preceding days**. A verdict mutated in that window is a first publication.

## Decision

**Language standard — "claims, not persons":**

- Verdicts address claims and evidence: "the quoted figure is accurate but incomplete — material alternatives contradict the impression."
- Never character statements: "X lied", "X is dishonest" are structurally impossible in generated verdicts and prohibited in community contributions (guidelines + moderation).
- Written into every LLM prompt, the site copy, the contest form, and the community guidelines.

**Mutation freeze:**

- From 00:00 on **5 November 2026** until after official results (27 November), the verdict state machine accepts no mutations. Contested verdicts display "contested — under review" with the contest logged.
- Implemented in the verdict state machine (not as a manual process), with the freeze dates as configuration.

## Alternatives considered

- **Soft freeze** (mutations allowed with human sign-off during the window). Rejected for v1: the freeze is nearly free to build, and human sign-off under campaign pressure is a worse failure mode than no mutations.
- **Softer language throughout** ("this framing may not reflect the full picture"). Rejected: vague verdicts are useless to readers; the standard is *specific about claims, silent about persons*.

## Consequences

- Prompt design and output validation must enforce the language standard mechanically (banned-pattern checks on generated text).
- The freeze must be tested in rehearsal before 5 November (a staged freeze in October).