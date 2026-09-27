# ADR-0003: Build the pipeline open-source rather than licensing Full Fact AI tooling

*Status: **Decided** · Date: 2026-09-07 · Deciders: Dave*

## Context

Two paths to a monitoring/triage engine:

1. **Licence Full Fact AI.** Battle-tested — 45+ organisations, 30 countries, 12 national elections — with
   no engineering risk in that layer. But the core pipeline is closed; it depends on a UK charity's roadmap
   and pricing; onboarding NZ sources is unproven; and deployments are typically grant-subsidised (they
   were offering subsidised licences to US newsrooms ahead of the 2026 midterms).
2. **Build open.** Own everything, tailor it to New Zealand (Stats NZ series, Hansard, Beehive), carry no
   licence risk, and keep the produced assets — the labelled claim set, the mutation and audit dataset, the
   evidence store — ours, and licensable later.

## Decision

**Build open-source.** Deciding factors:

- The project's credibility mechanism (published methodology, open scrutiny) is incompatible with a closed core.
- The flagship feature — statistical verification against NZ official series (a pre-declared sensitivity grid, ADR-0005; the "fingerprint" named here was removed by ADR-0023) — is not something the licensed tooling does; it would be built regardless.
- Election-cycle timing made licensing conversations slow relative to build capacity.
- The dataset and audit-log assets are strategically valuable *because* they are ours.

## Alternatives considered

- **Hybrid**: license Full Fact for monitoring, open stack for the rest. Rejected for 2026 (integration time); revisitable post-election if volumes grow beyond our ingestion lanes.
- Full outreach to Full Fact remains a relationship worth having (their ClaimReview WordPress plugin is used; their methodology informs ours), but not as a dependency.

## Consequences

- Engineering time is the dominant cost; accepted.
- We inherit the honest state of the art (ADR-0001): automation stays in triage/drafting/evidence-assembly, not authoritative verdicts.