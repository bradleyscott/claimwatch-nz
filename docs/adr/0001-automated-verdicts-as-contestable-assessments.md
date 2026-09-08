# ADR-0001: Automated verdicts are published as contestable assessments, not authoritative facts

*Status: Proposed · Date: 2026-09-07 · Deciders: Bradley, Dave*

## Context

The product publishes machine-generated verdicts on political claims. Automated fact-checking accuracy on real-world claims is limited: the AVeriTeC 2024 winner (with GPT-4o) scored 63%; the 2025 open-weights-restricted winner scored 33%; retrieval is the primary bottleneck, and system rankings flip across domains. A false or skewed verdict published as authoritative — during an election — would damage the project beyond repair at the first failure.

The alternative (human editorial verdicts) is excluded by the project's operating model: no permanent employed editorial staff (ADR discussion, `docs/RESEARCH-REVIEW.md` §2.6).

## Decision

Every verdict is published as an **"Automated assessment — open to contest."** There is no per-verdict human sign-off. Credibility rests on:

1. the full **evidence pack** published with every verdict;
2. the **contestation pathway** through which the verdict can be mutated by validated evidence;
3. the **published accuracy** of the pipeline against a labelled ground-truth set (`docs/EVALUATION.md`);
4. an append-only **audit log** of every verdict mutation and rejection.

Claims below a confidence threshold are published as **open questions** ("we could not verify this — can you?") rather than verdicts, which invites the right kind of participation.

## Alternatives considered

- **Human editorial sign-off on every verdict.** Highest credibility, excluded by the operating model (payroll + speed). Could be reintroduced later for high-profile claims during the freeze window.
- **Don't publish automated verdicts at all; automation only triages for a human team.** This is the Full Fact model. Excluded for the same reason — it requires employed fact-checkers.

## Consequences

- The evaluation harness is load-bearing: without published accuracy, "open to contest" becomes "we guess." This ADR makes ADR-0010 a dependency.
- Every verdict page must display the evidence pack and contest affordance from day one — the label is meaningless without the mechanism.
- The mutation freeze (ADR-0002) partially re-introduces human control at the highest-risk moment.