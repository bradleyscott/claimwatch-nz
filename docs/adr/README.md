# Architecture Decision Records

One file per decision, grouped by subject area. Statuses: Proposed → Accepted / Superseded. Renumbered 2026-09-08 for coherence — this set is the stable record; history is preserved in git.

**Accepted means built.** An ADR is Accepted once its decision is implemented in code and covered by tests; the acceptance date records when that happened. An ADR stays Proposed while nothing implements it, Open while it is gated on a measurement, and Decided when the call is a direction rather than a buildable feature. Five ADRs remain Proposed because no code implements them: 0007 (no broadcast ingestion lane), 0009 (argument chains), 0012 (no OTel/Grafana wiring), 0013 (proposal templates exist, but the automated scope-check and public decision record do not), and 0018 (no institutional-source lane).

## Trust and publication model

| ADR | Title | Status |
|---|---|---|
| [0001](0001-automated-verdicts-as-contestable-assessments.md) | Automated verdicts as contestable assessments, not authoritative facts | Accepted |
| [0002](0002-verdict-language-mutation-freeze-contestation.md) | Contestation, mutation, verdict language, and the election-window freeze | Accepted |
| [0003](0003-build-open-vs-license-full-fact.md) | Build the pipeline open-source rather than licensing Full Fact AI tooling | **Decided** |
| [0004](0004-verdict-schema-and-benchmark-alignment.md) | Verdict schema, benchmark alignment, and honest abstention | Accepted |

## Verification architecture

| ADR | Title | Status |
|---|---|---|
| [0005](0005-verification-layer.md) | The verification layer — multi-mode engine, sensitivity grid, evidence store | Accepted |
| [0006](0006-ingestion-architecture.md) | Ingestion — six lanes, extraction ladder, health checking, dedupe, retrieval discipline | Accepted |
| [0007](0007-broadcast-and-context-scope.md) | Broadcast/podcast interviews and the context scope boundary | Proposed |
| [0008](0008-claim-context-and-document-hierarchy.md) | Claim context — discourse window, publication/segment hierarchy, on-demand depth | Accepted |
| [0009](0009-argument-chains.md) | Argument chains — verdicts composed into the reasoning structure | Proposed |
| [0019](0019-speakership-attribution-and-claim-scope.md) | Speakership attribution and claim scope — newsroom narration is not a claim | Accepted |
| [0020](0020-research-strength-and-source-admissibility.md) | Research strength — research floor, source admissibility, corroboration | Proposed |
| [0021](0021-a-claim-carries-its-document-referents-and-jurisdiction.md) | A claim carries its document, its referents and its jurisdiction | Proposed |
| [0022](0022-materiality-worth-checking.md) | Materiality — a pre-declared test for whether a claim is worth checking | Proposed |

## Measurement and providers

| ADR | Title | Status |
|---|---|---|
| [0010](0010-ground-truth-evaluation.md) | Ground-truth evaluation — AVeriTeC benchmark + NZ-labelled calibration set | Accepted |
| [0011](0011-provider-selection.md) | LLM and search provider selection — accuracy-dominant, harness-gated | Open (harness-gated) |
| [0012](0012-observability.md) | Pipeline observability — Grafana-only, OTel GenAI conventions | Proposed |

## Community input and implementation

| ADR | Title | Status |
|---|---|---|
| [0013](0013-public-proposals.md) | Public proposal of claim sources and evidence authorities | Proposed |
| [0014](0014-implementation-technology.md) | Implementation technology — TypeScript, Vercel AI SDK, Postgres data plane | Accepted |
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