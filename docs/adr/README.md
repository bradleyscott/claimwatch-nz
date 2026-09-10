# Architecture Decision Records

One file per decision, grouped by subject area. Statuses: Proposed → Accepted / Superseded. Renumbered 2026-09-08 for coherence — this set is the stable record; history is preserved in git.

## Trust and publication model

| ADR | Title | Status |
|---|---|---|
| [0001](0001-automated-verdicts-as-contestable-assessments.md) | Automated verdicts as contestable assessments, not authoritative facts | Proposed |
| [0002](0002-verdict-language-mutation-freeze-contestation.md) | Contestation, mutation, verdict language, and the election-window freeze | Proposed |
| [0003](0003-build-open-vs-license-full-fact.md) | Build the pipeline open-source rather than licensing Full Fact AI tooling | **Decided** |
| [0004](0004-verdict-schema-and-benchmark-alignment.md) | Verdict schema, benchmark alignment, and honest abstention | Proposed |

## Verification architecture

| ADR | Title | Status |
|---|---|---|
| [0005](0005-verification-layer.md) | The verification layer — multi-mode engine, sensitivity grid, evidence store | Proposed |
| [0006](0006-ingestion-architecture.md) | Ingestion — six lanes, extraction ladder, health checking, dedupe, retrieval discipline | Proposed |
| [0007](0007-broadcast-and-context-scope.md) | Broadcast/podcast interviews and the context scope boundary | Proposed |
| [0008](0008-claim-context-and-document-hierarchy.md) | Claim context — discourse window, publication/segment hierarchy, on-demand depth | Proposed |
| [0009](0009-argument-chains.md) | Argument chains — verdicts composed into the reasoning structure | Proposed |

## Measurement and providers

| ADR | Title | Status |
|---|---|---|
| [0010](0010-ground-truth-evaluation.md) | Ground-truth evaluation — AVeriTeC benchmark + NZ-labelled calibration set | Proposed |
| [0011](0011-provider-selection.md) | LLM and search provider selection — accuracy-dominant, harness-gated | Open (harness-gated) |
| [0012](0012-observability.md) | Pipeline observability — Grafana-only, OTel GenAI conventions | Proposed |

## Community input and implementation

| ADR | Title | Status |
|---|---|---|
| [0013](0013-public-proposals.md) | Public proposal of claim sources and evidence authorities | Proposed |
| [0014](0014-implementation-technology.md) | Implementation technology — TypeScript, Vercel AI SDK, Postgres data plane | Proposed |
| [0018](0018-institutional-claim-sources.md) | Institutional claim sources — think tanks, lobbies, unions, sector peak bodies | Proposed |

## Process

1. Anyone (maintainers or public) proposes an ADR via PR or issue.
2. Discussion happens in the PR or linked issue, in the open.
3. Maintainers set the status; superseded ADRs stay in place with a link to their successor.
4. Competing ADRs are welcome — disagreements between ADRs are resolved by a new ADR, not by editing history.

## Conventions

- Numbering never reuses numbers within a generation of the ADR set; this set is numbered as consolidated records.
- "Deciders" lists the humans who made the call.
- Every ADR carries a **Context → Decision → Alternatives → Consequences** structure.
- When implementation contradicts an accepted ADR, the ADR is superseded first, in the open, before the code changes.