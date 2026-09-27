# ADR-0022: Materiality — a pre-declared test for whether a claim is worth checking

*Status: Proposed · Date: 2026-09-26 · Deciders: Dave*

## Context

Triage decides two things: whether a sentence is **checkable** (TRIAGE §2.2), and — through the attribute
stage — whether it is **ours to check** (ADR-0019). Neither asks whether the claim **matters**.

The gap is real. A claim can be checkable and in scope and still change nothing anyone is arguing about:
a figure mentioned in passing, with no policy topic and no argument around it. Verifying it costs money
and publishes a verdict nobody needed. But the same gap is where a fact-checking project can quietly
start curating reality — deciding what is important is a judgement about politics, and it is the one
judgement that must not be made ad hoc, per claim, by a model's mood.

The relevance link itself was already designed (ADR-0008): `policyTopic`, `attachedProposal` (the proposal
a claim was deployed in support of) and `argumentDirection` (the stance the passage takes). ADR-0021 made
that context reach research. This ADR uses it for one more thing.

## Decision

**A claim is material when it is load-bearing to a position on policy. The test is structural, party-blind
and pre-declared — and it is a priority filter, never a truth filter.**

The criterion, in order (first match wins), all read from the argumentative **context**:

| Signal | Material because |
|---|---|
| `attachedProposal` present | it was deployed in support of a proposal |
| `argumentDirection` present | it takes a side — a fault to fix, or a result to claim |
| `policyTopic` present | it is about a policy topic |

With **none** of them the claim is `inconsequential`: recorded, not verified.

Four rules constrain it:

1. **It cannot see the speaker.** The function's input has no speaker and no party field, so it cannot
   score the same claim differently depending on who said it. That is a structural guarantee, not a
   promise (pinned by test).
2. **It is a priority filter, not a truth filter.** An immaterial claim is **still recorded** — the claim
   row is written, with the reason — and only verification is skipped. The project never claims such a
   claim is false or unimportant-as-fact; it says it is not worth a verdict. The page's wording follows
   that distinction.
3. **It fails open.** When there was no passage to read, relevance cannot be judged, so the claim is kept.
   Absence of extracted context is not evidence of irrelevance — otherwise a context-extraction gap would
   silently become a claim filter.
4. **It is measured.** The materiality decision and its reason are logged, and the rate of set-asides is
   visible like any funnel rate. The exclusions stay inspectable, on the `?corpus=all` precedent.

The criterion is published on `/methodology` **before** it applies, so it cannot be tuned after the fact
to remove something inconvenient.

## Alternatives considered

- **Let a model judge "interesting".** Rejected: it is the project's single most dangerous judgement, it
  is unauditable, and it varies per run. A structural rule is boring on purpose.
- **Set claims aside at triage, into the drop log.** Rejected after it broke a test in exactly the way it
  would break production: every claim whose context extraction returned null (which is most of them) was
  set aside. It conflates *we could not assess relevance* with *there is no relevance*, removes claims
  from the record, and mixes a priority decision into a recall denominator that measures something else.
- **No filter at all.** Rejected: verification spend and public attention are finite, and an
  inconsequential verdict is a verdict the project did not need to defend.
- **Rank by model confidence or by claim type.** Rejected: neither is a consequence measure, and both are
  correlated with things that are not political importance.

## Consequences

- Verification spend follows consequence, not claim count. The same claims are still ingested and
  recorded, so the corpus and the funnel are unchanged; only the verdict set narrows.
- A claim being recorded but not verified is a state the site must handle: it has no verdict, so it is not
  eligible for publication, and the reason is on its record.
- The criterion is a published commitment. If it is wrong, that is a visible, arguable failure on
  `/methodology`, which is the intended failure mode.
- The rule will initially set aside little, because `attachedProposal` extraction rarely fires. That is the
  honest state: with weak context the filter mostly fails open, and its effect grows as the context pass
  improves.
- Sampled recall on set-aside claims remains a harness obligation, so a filter that removes real claims is
  a measured defect rather than an invisible one.
