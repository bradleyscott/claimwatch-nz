# ADR-0002: Contestation, mutation, verdict language, and the election-window freeze

*Status: Proposed · Date: 2026-09-08 · Deciders: Bradley, Dave*

## Context

Three connected decisions shape how verdicts change and how they are worded:

1. **The contestation mechanism.** The product's differentiator: verdicts mutate on **validated evidence**, not crowd consensus. Community-correction prior art (X Community Notes, Meta 2025) uses bridging-based rating — but bridging needs a large active rater pool with rating history; a NZ election site will not have that in an 8-week build. X's own model needs ~100M+ daily users to make the arithmetic work; Meta's rollout is criticised for the consensus bar being too high for timely correction.

2. **The language standard.** Verdicts that imply persons lied invite defamation suits (civil, no anti-SLAPP in NZ); Electoral Act 1993 s 199A (publishing a statement of fact known to be false, with intent to influence voters) applies to material first published on election day or the two preceding days — a verdict mutated in that window is a first publication.

3. **The freeze window.** These two exposures together define when mutations must stop.

## Decision

### The contestation mechanism

1. **Structured contest form**: what part of the verdict is disputed, cited sources (links preferred), reasoning. Email-verified accounts, rate-limited.
2. **Evidence validation pipeline**: submitted evidence runs the same provenance gauntlet as the verification engine — source retrieval, authentication (primary vs secondary), authority, corroboration. Only evidence clearing the bar proposes a verdict change.
3. **Automated mutation with retrospective audit**: a validated evidence pack triggers the verdict change automatically; a **sampled post-hoc audit** (a fraction of mutations reviewed daily, all high-impact mutations reviewed) checks validator quality over time — audit findings are logged publicly, but audit does not gate the mutation.
4. **Mutation with public diff**: new verdict version + diff + contributing evidence + contributor credit (opt-in).

**The asymmetry, stated:** a single well-sourced contest can flip a verdict even if the crowd dislikes it — this is deliberate. Brigading can flood noise, but noise dies in validation; the quality gate substitutes for the vote arithmetic X uses. This positions the system closer to Wikipedia's verifiability model than to social voting.

**Explicitly deferred to post-election:** bridging-weighted rating of contributions, public rater trust scores, community self-governance. The v1 contest log becomes the dataset that justifies (or rejects) that design with data — see `docs/EVALUATION.md` §5.

### The verdict language standard — "claims, not persons"

- Verdicts address claims and evidence: "the quoted figure is accurate but incomplete — material alternatives contradict the impression."
- Never character statements: "X lied", "X is dishonest" are structurally impossible in generated verdicts and prohibited in community contributions (guidelines + moderation).
- Written into every LLM prompt, the site copy, the contest form, and the community guidelines.

### The mutation freeze

- From 00:00 on **5 November 2026** until after official results (27 November), the verdict state machine accepts no mutations. Contested verdicts display "contested — under review" with the contest logged.
- Implemented in the verdict state machine (not as a manual process), with the freeze dates as configuration.

## Alternatives considered

- **Full Community Notes model from day one.** Rejected: cold start makes the bridging maths inert at NZ scale; would produce theatre, not governance.
- **No contestation until post-election.** Rejected: contestation data is itself the research/trust asset; two months of contest logs (even thin) seeds the post-election design.
- **Human-in-the-loop mutation review (pre-publication human gate).** Considered and superseded: validated evidence mutates automatically; quality is checked by a sampled retrospective audit rather than a pre-publication gate. Residual risk accepted deliberately: a single adversarial evidence pack that fools the validator would mutate a verdict unattended until caught by audit. Mitigations: audit sampling weighted toward high-impact verdicts, immediate re-mutation capability, and the append-only audit log making any bad mutation publicly reversible within hours. The freeze window bounds the worst case.
- **Soft freeze** (mutations allowed with human sign-off during the window). Rejected for v1: the freeze is nearly free to build, and human sign-off under campaign pressure is a worse failure mode than no mutations.
- **Softer language throughout** ("this framing may not reflect the full picture"). Rejected: vague verdicts are useless to readers; the standard is *specific about claims, silent about persons*.

## Consequences

- **No waiting human in the mutation loop** — the process is fully automated end-to-end (validator → mutation → retrospective audit). Audit findings are logged publicly; if audit reveals validator quality problems, the fix is a validator change through the harness gate, not manual gating of individual mutations.
- **Contest volume no longer queues on human attention** — automation scales to any volume; adversarial volume floods only the audit sample, not the mutation path. Rejections are public and reasoned — this keeps the process auditable and bad-faith patterns visible.
- **Prompt design and output validation must enforce the language standard mechanically** (banned-pattern checks on generated text).
- **The freeze must be tested in rehearsal before 5 November** (a staged freeze in October).