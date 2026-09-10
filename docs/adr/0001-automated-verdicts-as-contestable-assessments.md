# ADR-0001: Automated verdicts are published as contestable assessments, not authoritative facts

*Status: Proposed · Date: 2026-09-07 · Deciders: Bradley, Dave*

## Context

The product publishes machine-generated verdicts on political claims. Automated fact-checking accuracy on real-world claims is limited (AVeriTeC: 63% unrestricted in 2024; 33% open-weights-only in 2025; retrieval is the bottleneck; rankings flip across domains — see `RESEARCH-REVIEW.md` §2.2). A false or skewed verdict published as authoritative — during an election — would damage the project beyond repair at the first failure. Human editorial verdicts are excluded by the operating model: no permanent employed editorial staff.

## Decision

Every verdict is published as an **"Automated assessment — open to contest."** No per-verdict human sign-off. Credibility rests on:

1. the full **evidence pack** published with every verdict;
2. the **contestation pathway** through which the verdict can be mutated by validated evidence;
3. the **published accuracy** of the pipeline against a labelled ground-truth set (`EVALUATION.md`);
4. an append-only **audit log** of every verdict mutation and rejection.

Claims below a confidence threshold are published as **open questions** ("we could not verify this — can you?") rather than verdicts, which invites the right kind of participation.

## Alternatives considered

- **Human editorial sign-off on every verdict.** Highest credibility, excluded by the operating model (payroll + speed). Could be reintroduced later for high-profile claims during the freeze window.
- **Don't publish automated verdicts; automation only triages for a human team** (the Full Fact model). Excluded for the same reason — it requires employed fact-checkers.

## Consequences

- The evaluation harness is load-bearing: without published accuracy, "open to contest" becomes "we guess." This ADR makes ADR-0010 a dependency.
- Every verdict page must display the evidence pack and contest affordance from day one — the label is meaningless without the mechanism.
- The mutation freeze (ADR-0002) partially re-introduces human control at the highest-risk moment.