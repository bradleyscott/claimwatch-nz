# ADR-0026: The adversarial research loop

*Status: Accepted · Deciders: Dave*

## Context

A published verdict is a claim about what the evidence shows. Producing it from a fixed set of
pre-declared checks means the verdict is composed from several machine outputs by rules in code, and the
set of checks becomes machinery to version, plan and render. The question every check answers is the
same — gather the evidence that bears on a claim, then decide whether it is sufficient — and what differs
is where the evidence comes from and what "sufficient" means.

Research is not one search: it is a strategy that changes as pages are read. A useful researcher decides
what to look for, runs several searches, reads the pages behind the results, follows the promising
sources, and stops when further searching would not help. A separate entailment pass over the written
justifications cannot catch the failure that matters most — a class asserted on evidence that does not
support it — because that is a property of the sufficiency decision, not of the prose written after it.

## Decision

**Verification is one capped adversarial loop of three roles. The loop produces the evidence, the
finding and the reason.**

### 1. The three roles

| Role | Input | Output |
|---|---|---|
| `claim-assessor` | the claim, its context, and the previous critique | an **evidence plan**: what would prove or disprove the claim, and the questions to answer |
| `researcher` | the plan and the evidence so far | a bounded tool-loop agent: it plans queries, dispatches them in parallel, reads what comes back, and decides the next step |
| `evidence-critiquer` | the claim, the plan, and **all** evidence across turns | **sufficiency**: whether the evidence is enough, the verdict class, confidence, reason, gaps and justifications |

The assessor names what would **falsify** as well as confirm, and does not write search queries — the
researcher chooses those. The assessor is adversarial by instruction.

### 2. The researcher is a tool-loop agent

The researcher runs on the AI SDK's `generateText` with tools, behind a typed `AgentPort` so the blind
rule holds and L1 can mock the model. Its tools are the action space:

| Tool | What it does |
|---|---|
| `search` | a web search; several may run in parallel in one step |
| `readPage` | fetch the full text of a page |
| `extractEvidence` | for a set of urls and a question, return the shortest **verbatim** passages that speak to the claim |
| `finish` | no execute — calling it ends the loop |

The assessor's plan also names where the evidence would live — for a New Zealand data claim, the
primary agency (`stats.govt.nz`, `policedata.nz`, the Ministry of Justice NZCVS) and figure.nz, which
curates official NZ series and links each to its source — and the researcher targets those domains
rather than the claim's wording. The loop is bounded by `stopWhen: [stepCountIs(maxSteps),
hasToolCall('finish')]`, and each tool enforces a budget (searches, reads), telling the model when a
budget is spent so it can finish. Every tool call is
recorded from the SDK's per-step results, so the run's actions are auditable.

### 3. The loop

```
claim + context
   → claim-assessor → plan { evidencePlan, questions }
   → researcher (tool loop) → evidence + strategy + queries + tool calls
   → evidence-critiquer
        ├─ sufficient                  → finding (class + reason + justifications)
        └─ insufficient, budget left    → back to claim-assessor with the critique
        └─ insufficient, budget spent   → not_enough_evidence, with the critiquer's reason
```

**How long to keep looking is a spend budget, not a turn count.** `DEFAULT_RESEARCH_BUDGET_USD` (0.25)
is the policy, checked between turns against what the loop has actually spent on model calls — priced
from the versioned price map (ADR-0012), never from a provider's own figure. A claim that settles early
stops early; a claim that needs more looking gets it, up to the budget. The spend can exceed the budget
by at most one turn, because the check is between turns and a claim always gets a first attempt.

`MAX_RESEARCH_TURNS` (20) is a **hard backstop, not the policy**: it stops a run that cannot read its
own spend (no meter supplied), and it is set well above what a budget buys so that reaching it means
something is wrong. `MAX_SEARCHES_PER_TURN` and `MAX_RESEARCH_STEPS_PER_TURN` still bound each
researcher turn. When the loop stops without sufficiency the conclusion is `not_enough_evidence`
**and the critiquer's stated reason is published** — a stopped run is a finding about the record, named
as one, with `stopReason` (`budget` | `cap` | `sufficient`) recording which bound bit.

The researcher is the only role that touches the network.

### 4. The critiquer is the publication gate

The critiquer decides sufficiency. Its finding must cite evidence for **every** justification; a
conclusion the evidence does not support is a failed call, not an implicit pass. The entailment question
is asked where the class is chosen, so a claim whose evidence does not support its class cannot publish.
The critiquer also states the loop's own bound — what the evidence cannot establish — in plain words.

Because the critiquer is itself a model, it is calibrated by the harness: must-conclude /
must-not-conclude packs at L1, and critiquer-vs-human agreement on labels at L3.

### 5. Verdict classes and the class-agreement gate

`supported` · `refuted` · `not_enough_evidence` · `conflicting_cherry_picking` (ADR-0004). `pledge` /
`conditional` are store statuses for held commitments, not classes the loop returns.

The class-deciding call runs **twice** and only an agreed class is published; a disagreement publishes
`not_enough_evidence` and is counted (VER-R16). The configured models discard the sampling settings, so
identical input can move a class between runs. A failed call is not a disagreement: provider errors
propagate.

### 6. Stored and published

The evidence pack stores the evidence items, the loop record (each turn's plan, strategy, queries, tool
calls and critique, the turns used, whether the cap bound, the class-agreement state), the
justifications, and the final reason. The verdict page renders the evidence plan, the searches and tool
calls the researcher made, the evidence found, and the critiquer's finding.

### 7. Admissibility, authority and corroboration

The critiquer applies the published criteria of ADR-0020: inadmissible sources can never be the record,
a decisive verdict needs an authority floor of tier 5 or better, and a factual assertion needs one
official record or two independent sources.

## Alternatives considered

- **A hand-rolled orchestrator that asks the model for a query list and runs it in code.** Rejected: the
  AI SDK already provides a bounded tool loop with per-step tool-call audit and parallel execution, so
  the hand-rolled version would re-implement it less well and record less.
- **A query-only researcher.** Rejected: it cannot read a page or follow a source, which is where the
  evidence usually is.
- **A second LLM agent per subagent.** Rejected: the subagent work is deterministic (search, fetch,
  extract); only the orchestration and the extraction need a model, so the tools stay bounded and cheap.
- **Keep a set of pre-declared checks and route a claim to one.** Rejected: real claims are compound, and
  the routing rule is not what decides the check.
- **An uncapped loop.** Rejected: unbounded spend, and an unbounded loop makes `not_enough_evidence`
  unmeasurable because the bound is never stated.
- **A fixed turn count as the bound.** Rejected in favour of the spend budget: a turn count spends the
  same on a cheap claim as on a hard one, and five turns is a guess about difficulty rather than a
  statement about cost. A budget states the actual constraint, and `stopReason` keeps the bound visible.
- **Let the assessor see verdict outcomes from past claims.** Rejected: it would train the pipeline to
  agree with itself.

## Consequences

- Per-claim call shape is bounded and legible: one assessor, one bounded researcher tool loop and one
  critiquer per turn, against a USD research budget with a hard turn backstop. Budget-exhaustion rate is
  a published funnel number, and the loop record carries the budget, the spend and the `stopReason`.
- Every search, page read and extraction is recorded as a tool call, so the public trail can show
  exactly what the researcher did.
- The sensitivity grid is not run: a quantitative claim is researched like any other, and the page says
  so. A deterministic series check can return as a tool the researcher can call without changing the
  loop (OPEN-QUESTIONS).
- The evidence store, the A1–A6 authority map and the admissibility / corroboration criteria are applied
  by the critiquer.
- The harness reports per-stratum accuracy and the class-agreement rate.
- The loop record is stored on the evidence pack; the store schema carries no claim type and no plan.
