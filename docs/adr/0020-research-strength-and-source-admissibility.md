# ADR-0020: Research strength — a research floor, source admissibility, and corroboration

*Status: Proposed · Date: 2026-09-26 · Deciders: Dave*

## Context

A live run verified a policy quote — *"Police spokesperson Mark Mitchell said the team would boost the
visible police presence…"* — and the only evidence it consulted was **Mark Mitchell's Wikipedia
biography**. The verdict was `not_enough_evidence`, and the justification said so plainly: the source
does not mention the quote.

Tracing it found the design causes, not a one-off bug:

1. **The verification mode is chosen from the claim's surface.** `routeMode` maps a six-way claim-type
   label to a fixed strategy before any evidence is seen. Nothing asks *what evidence would settle this,
   and where would it live?*
2. **The taxonomy has no class for a policy commitment.** "Would boost X" is a statement about a plan.
   Triage has a `pledge-conditional` rejection class but no *verification mode* for commitments, so the
   claim was typed `institution-citation` and routed to citation-check.
3. **citation-check invents a citation when none exists.** With no cited source, the path searched the
   claimant's name, took organic result #1, and compared against it — with no gate, no ranking, and no
   requirement that the source be the document cited.
4. **Sources are graded, never excluded.** A personal Wikipedia page passes as tier 6 and is compared
   against. The tier system answers "how much do we trust it?" when the question was "is this even the
   right kind of source?"
5. **Modes do not escalate and there is no research floor.** A weak citation check abstains after one
   query instead of doing the research that would settle the claim.
6. **The publication is treated as irrelevant.** The claim's own document — headline, lead, surrounding
   text — is stored but never used as context or as a retrieval seed.

Consequence: `not_enough_evidence` stopped meaning *we looked hard and the record is thin* and started
meaning *we did the minimum and gave up.*

## Decision

**Research is a floor every claim clears; the mode only decides how the finding is framed.** Four rules:

1. **Research floor and escalation.** Every claim that cannot be resolved from the evidence store gets a
   research pass — plan, search, fetch, assess — before any verdict. A mode that finds nothing usable
   does not abstain; it **escalates** to the open-web loop. A citation check with no cited document never
   runs.
2. **Source admissibility.** Some sources can never be the record for a verdict, whatever tier they would
   score: encyclopaedia pages, social posts, aggregators, and the claimant's own biography. Separately, a
   decisive verdict (`supported` / `refuted`) requires an **authority floor** — a source at tier 5 or
   better. Below the floor, or on an inadmissible source, the honest classes are `not_enough_evidence`
   and, where the question is only whether someone said it, an attribution finding.
3. **Corroboration and refutation.** For a factual assertion, require either one official record or at
   least two independent sources, and run at least one query aimed at **refuting** the claim. A search
   that only looks for confirmation is not verification.
4. **The publication is context and a seed.** The claim's own document is passed as context (so a
   referent like "the team" can be resolved) and used as a retrieval seed to find corroborating coverage
   of the same event.

The research plan is built from **entities, action and time**, not from the claim sentence — a rhetorical
claim sentence is a poor search string; its entities are good ones.

## Alternatives considered

- **Patch the citation path only.** Rejected: it fixes one entry point while the "choose a cheap strategy
  from a label" cause remains for every other claim.
- **Merge the authority map and the source classifier into one scale.** Rejected: they answer different
  questions — which official authority is primary for a domain, versus what kind of source a page is.
  The fix is admissibility, not a merged scale.
- **Require an official record for every verdict.** Rejected: it would abstain on most of the corpus.
  Two independent sources is the honest floor for a non-official claim.
- **Trust a search API's own ranking.** Rejected: taking result #1 is what produced a Wikipedia bio as
  the evidence for a policing claim.

## Consequences

- `not_enough_evidence` becomes expensive to reach, and therefore meaningful: it will report the search
  trail that produced it.
- Cost rises for claims that previously took the cheap path — bounded by the per-mode cap and the
  campaign budget alert. This is intended: effort follows difficulty, not claim type.
- The verification modes become framings over a shared research pass rather than four independent
  pipelines. `citation-check` and `quote-fidelity` gain the escape hatch they lacked.
- New pipeline surface: admissibility rules, a research planner, and a corroboration check, each with L1
  tests. The prompt and planning changes are L2-gated (golden diff) and L3-measured (per-group gate).
- A claim about a **policy commitment** is verified as the commitment — whether it was made, by whom,
  with what conditions — and labelled as not yet checkable as fact. This is a taxonomy gap to close in
  TRIAGE, tracked as a follow-up rather than solved here.
