# ADR-0005: Contestation mechanism for v1 — structured contest + evidence validation + automated mutation with retrospective audit; bridging deferred

*Status: Proposed · Date: 2026-09-07 · Deciders: Bradley, Dave*

## Context

The product's differentiator: verdicts mutate on **validated evidence**, not crowd consensus. Community-correction prior art (X Community Notes, Meta 2025) uses bridging-based rating — but bridging needs a large active rater pool with rating history; a NZ election site will not have that in an 8-week build. X's own model needs ~100M+ daily users to make the arithmetic work; Meta's rollout is criticised for the consensus bar being too high for timely correction.

## Decision

V1 contestation mechanism:

1. **Structured contest form**: what part of the verdict is disputed, cited sources (links preferred), reasoning. Email-verified accounts, rate-limited.
2. **Evidence validation pipeline**: submitted evidence runs the same provenance gauntlet as the verification engine — source retrieval, authentication (primary vs secondary), authority, corroboration. Only evidence clearing the bar proposes a verdict change.
3. **Automated mutation with retrospective audit**: a validated evidence pack triggers the verdict change automatically; a **sampled post-hoc audit** (a fraction of mutations reviewed daily, all high-impact mutations reviewed) checks validator quality over time — audit findings are logged publicly, but audit does not gate the mutation.
4. **Mutation with public diff**: new verdict version + diff + contributing evidence + contributor credit (opt-in).

**Explicitly deferred to post-election:** bridging-weighted rating of contributions, public rater trust scores, community self-governance. The v1 contest log becomes the dataset that justifies (or rejects) that design with data — see `docs/EVALUATION.md` §5.

## Rationale for the asymmetry

A single well-sourced contest can flip a verdict even if the crowd dislikes it — this is deliberate. Brigading can flood noise, but noise dies in validation; the quality gate substitutes for the vote arithmetic X uses. This positions the system closer to Wikipedia's verifiability model than to social voting.

## Alternatives considered

- **Full Community Notes model from day one.** Rejected: cold start makes the bridging maths inert at NZ scale; would produce theatre, not governance.
- **No contestation until post-election.** Rejected: contestation data is itself the research/trust asset; two months of contest logs (even thin) seeds the post-election design.
- **Human-in-the-loop mutation review (pre-publication human gate).** Considered in the original draft and superseded by the adopted design: validated evidence mutates automatically; quality is checked by a *sampled retrospective audit* rather than a pre-publication gate. Residual risk is accepted deliberately: a single adversarial evidence pack that fools the validator would mutate a verdict unattended until caught by audit. Mitigations: audit sampling weighted toward high-impact verdicts, immediate re-mutation capability, and the append-only audit log making any bad mutation publicly reversible within hours. The freeze window (ADR-0006) still bounds the worst-case window.

## Consequences

- **No waiting human in the mutation loop** — the process is fully automated end-to-end (validator → mutation → retrospective audit). Audit findings are logged publicly; if audit reveals validator quality problems, the fix is a validator change through the harness gate, not manual gating of individual mutations.
- **Contest volume no longer queues on human attention** — automation scales to any volume; adversarial volume floods only the audit sample, not the mutation path.

- Contest volume no longer queues on human attention (automation scales to any volume); adversarial volume floods only the audit sample, not the mutation path.
- Rejections are public and reasoned — this keeps the process auditable and bad-faith patterns visible.