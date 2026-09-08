# Architecture Decision Records

Significant decisions are recorded here, one file each, numbered sequentially. Statuses: Proposed → Accepted / Superseded.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-automated-verdicts-as-contestable-assessments.md) | Automated verdicts as contestable assessments, not authoritative facts | Proposed |
| [0002](0002-ingestion-scope-2026.md) | Ingestion scope 2026: releases, Hansard, news RSS, user submissions, commentator watchlist; no broadcast/social crawling | Proposed |
| [0003](0003-build-open-vs-license-full-fact.md) | Build open-source vs license Full Fact tooling | **Decided: build open** |
| [0004](0004-statistical-claim-engine.md) | Statistical-claim engine within a multi-mode verification layer (informed by `docs/MISINFO-TAXONOMY.md`) | Proposed |
| [0005](0005-contestation-mechanism-v1.md) | Contestation v1: structured contest + validation + human review | Proposed |
| [0006](0006-verdict-language-and-mutation-freeze.md) | Verdict language standard + mutation freeze | Proposed |
| [0007](0007-llm-search-provider-selection.md) | LLM/search provider selection — accuracy-dominant, tiered by task | Open (recommendation recorded; harness-gated) |
| [0008](0008-ground-truth-set-construction.md) | Ground-truth evaluation: AVeriTeC immediate benchmark + NZ-labelled calibration set | Proposed |
| [0009](0009-public-proposal-of-sources-and-authorities.md) | Public proposal of claim sources and evidence authorities | Proposed |
| [0010](0010-claim-anchored-evidence-store.md) | Claim-anchored evidence store — verify claim-by-claim, accumulate context over time | Proposed |
| [0011](0011-ingestion-architecture.md) | Ingestion architecture — six lanes, health-checked, feeding the evidence store | Proposed |
| [0012](0012-pipeline-observability.md) | Pipeline observability — Grafana-only, one platform; LLM observability via OTel GenAI conventions | Proposed |
| [0013](0013-implementation-technology-choices.md) | Implementation technology — TypeScript + Vercel AI SDK, Postgres/pgvector/pg_cron data plane | Proposed |
| [0014](0014-broadcast-podcast-interviews.md) | Broadcast/podcast interviews — transcripts-first (published text only); self-generated transcription out of scope | Proposed |
| [0015](0015-claim-contextualisation.md) | Claim contextualisation — discourse context as a first-class input to verification | Proposed |
| [0016](0016-publication-and-segment-context.md) | Publication record and segment context — the document hierarchy around claims | Proposed |

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