# Architecture Decision Records

Significant decisions are recorded here, one file each, numbered sequentially. Statuses: Proposed → Accepted / Superseded.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-automated-verdicts-as-contestable-assessments.md) | Automated verdicts as contestable assessments, not authoritative facts | Proposed |
| [0002](0002-ingestion-scope-2026.md) | Ingestion scope 2026: releases, Hansard, news RSS; no broadcast/social | Proposed |
| [0003](0003-build-open-vs-license-full-fact.md) | Build open-source vs license Full Fact tooling | **Decided: build open** |
| [0004](0004-statistical-claim-engine.md) | Statistical-claim engine: fingerprint + topic packs + sensitivity grid | Proposed |
| [0005](0005-contestation-mechanism-v1.md) | Contestation v1: structured contest + validation + human review | Proposed |
| [0006](0006-verdict-language-and-mutation-freeze.md) | Verdict language standard + mutation freeze | Proposed |
| [0007](0007-llm-search-provider-selection.md) | LLM/search provider selection | **Open** |
| [0008](0008-ground-truth-set-construction.md) | Ground-truth set construction | Proposed |

## Process

1. Anyone (maintainers or public) proposes an ADR via PR or issue.
2. Discussion happens in the PR or linked issue, in the open.
3. Maintainers set the status; superseded ADRs stay in place with a link to their successor.
4. Competing ADRs are welcome — disagreements between ADRs are resolved by a new ADR, not by editing history.

## Conventions

- Numbering never reuses numbers.
- "Deciders" lists the humans who made the call.
- Every ADR carries a **Context → Decision → Alternatives → Consequences** structure.
- When implementation contradicts an accepted ADR, the ADR is superseded first, in the open, before the code changes.