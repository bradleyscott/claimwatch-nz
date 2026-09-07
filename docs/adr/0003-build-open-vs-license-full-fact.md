# ADR-0003: Build the pipeline open-source rather than licensing Full Fact AI tooling

*Status: Decided · Date: 2026-09-07 · Deciders: Bradley, Dave*

## Context

Two paths to a monitoring/triage engine:

1. **License Full Fact AI** — battle-tested (45+ orgs, 30 countries, 12 national elections), zero engineering risk on that layer, but a closed core pipeline, dependency on a UK charity's roadmap and pricing, NZ-source onboarding unknown, and grant-subsidised deployments typical (they were actively offering subsidised licences to US newsrooms ahead of the 2026 midterms).
2. **Build open** — own everything, tailor to NZ (Stats NZ series, Hansard, Beehive), no licence risk, and the produced assets (labelled claim set, mutation/audit dataset, the claim-anchored evidence store) remain ours and are licensable later.

## Decision

**Build open-source.** The deciding factors:

- The project's credibility mechanism (published methodology, open scrutiny) is incompatible with a closed core.
- The flagship feature — statistical-fingerprint verification against NZ official series — is not something the licensed tooling does; it would be built regardless.
- Election-cycle timing made licensing conversations slow relative to our build capacity.
- The dataset and audit-log assets are strategically valuable *because* they are ours.

## Alternatives considered

- **Hybrid**: license Full Fact for monitoring, open stack for the rest. Rejected for 2026 (integration time); revisitable post-election if volumes grow beyond our ingestion lanes.
- Full outreach to Full Fact was considered and remains a relationship worth having (their ClaimReview WordPress plugin is used; their methodology informs ours), but not as a dependency.

## Consequences

- Engineering time is the dominant cost; accepted.
- We inherit the honest state of the art (see ADR-0001): automation stays in triage/drafting/evidence-assembly, not authoritative verdicts.