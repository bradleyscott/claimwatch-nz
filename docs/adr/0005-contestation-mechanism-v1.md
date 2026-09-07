# ADR-0005: Contestation mechanism for v1 — structured contest + evidence validation + human mutation review; bridging deferred

*Status: Proposed · Date: 2026-09-07 · Deciders: Bradley, Dave*

## Context

The product's differentiator: verdicts mutate on **validated evidence**, not crowd consensus. Community-correction prior art (X Community Notes, Meta 2025) uses bridging-based rating — but bridging needs a large active rater pool with rating history; a NZ election site will not have that in an 8-week build. X's own model needs ~100M+ daily users to make the arithmetic work; Meta's rollout is criticised for the consensus bar being too high for timely correction.

## Decision

V1 contestation mechanism:

1. **Structured contest form**: what part of the verdict is disputed, cited sources (links preferred), reasoning. Email-verified accounts, rate-limited.
2. **Evidence validation pipeline**: submitted evidence runs the same provenance gauntlet as the verification engine — source retrieval, authentication (primary vs secondary), authority, corroboration. Only evidence clearing the bar proposes a verdict change.
3. **Human mutation review**: a small daily review task (the operator in v1, a steward panel post-election) approves/rejects the proposed change; every decision is logged publicly with reasons.
4. **Mutation with public diff**: new verdict version + diff + contributing evidence + contributor credit (opt-in).

**Explicitly deferred to post-election:** bridging-weighted rating of contributions, public rater trust scores, community self-governance. The v1 contest log becomes the dataset that justifies (or rejects) that design with data — see `docs/EVALUATION.md` §5.

## Rationale for the asymmetry

A single well-sourced contest can flip a verdict even if the crowd dislikes it — this is deliberate. Brigading can flood noise, but noise dies in validation; the quality gate substitutes for the vote arithmetic X uses. This positions the system closer to Wikipedia's verifiability model than to social voting.

## Alternatives considered

- **Full Community Notes model from day one.** Rejected: cold start makes the bridging maths inert at NZ scale; would produce theatre, not governance.
- **No contestation until post-election.** Rejected: contestation data is itself the research/trust asset; two months of contest logs (even thin) seeds the post-election design.
- **Fully automated mutation (no review).** Rejected: a single adversarial evidence pack that fools the validator would mutate verdicts unattended during the regulated period. The review step is 20 minutes/day at realistic volume.

## Consequences

- Contest volume must be monitored; if it exceeds the review queue's capacity, contests queue visibly rather than mutate unsupervised.
- Rejections are public and reasoned — this keeps the process auditable and bad-faith patterns visible.