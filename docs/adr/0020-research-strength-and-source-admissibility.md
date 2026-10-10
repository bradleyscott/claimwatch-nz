# ADR-0020: Research strength — source admissibility and corroboration

*Status: Accepted · Deciders: Dave*

## Context

Verification is only as strong as the evidence it is allowed to rest on. Three failure modes matter:

1. **A source of the wrong kind is used as the record.** A personal encyclopaedia page answers "how much
   do we trust it?" with a low grade, but a low grade is not an exclusion. Some sources cannot be the
   record for a verdict whatever they would score.
2. **A search that only confirms.** Looking only for evidence that supports a claim is not verification;
   a claim can be backed by a selective reading of a real record.
3. **`not_enough_evidence` reached too cheaply.** If a weak pass abstains after one query, the class stops
   meaning *we looked hard and the record is thin* and starts meaning *we did the minimum and gave up*.

The publication the claim came from is also material: a referent like "the team" can only be resolved
from the surrounding text, and the document is a good retrieval seed for corroborating coverage of the
same event.

## Decision

**Research is a floor every claim clears, and the evidence that may settle a claim is constrained by
published rules.** Four rules, applied by the research loop (ADR-0026):

1. **Research floor.** Every claim gets a real research pass — plan, search, fetch, assess — before any
   verdict. The assessor's plan names what evidence would settle the claim and where it would live.
2. **Source admissibility.** Some sources can never be the record for a verdict, whatever tier they would
   score: encyclopaedia pages, social posts, aggregators, self-publishing platforms, and the claimant's
   own biography. Separately, a decisive verdict (`supported` / `refuted`) requires an **authority
   floor** — a source at tier 5 or better. Below the floor, or on an inadmissible source, the honest
   classes are `not_enough_evidence` and, where the question is only whether someone said it, an
   attribution finding.
3. **Corroboration and refutation.** For a factual assertion, require either one official record for the
   claim's own jurisdiction or at least two independent sources from different domains. Every plan must
   name at least one query aimed at **refuting** the claim. A search that only looks for confirmation is
   not verification.
4. **The publication is context and a seed.** The claim's own document is passed as context (so a
   referent can be resolved) and used as a retrieval seed to find corroborating coverage of the same
   event.

The research plan is built from **entities, action and time**, not from the claim sentence — a rhetorical
claim sentence is a poor search string; its entities are good ones.

## Alternatives considered

- **Merge the authority map and the source classifier into one scale.** Rejected: they answer different
  questions — which official authority is primary for a domain, versus what kind of source a page is.
  The fix is admissibility, not a merged scale.
- **Require an official record for every verdict.** Rejected: it would abstain on most of the corpus.
  Two independent sources is the honest floor for a non-official claim.
- **Trust a search API's own ranking.** Rejected: taking result #1 can make a personal page the evidence
  for a public claim.
- **Grade sources instead of excluding them.** Rejected: a tier answers how much to trust a source, not
  whether it is the right kind of source to be the record.

## Consequences

- `not_enough_evidence` is expensive to reach, and therefore meaningful: it reports the search trail that
  produced it.
- Cost follows difficulty, bounded by the per-claim research budget (ADR-0026) and the campaign budget
  alert.
- **The admissibility rules are enforced at collection, in code, not by instruction.** The researcher
  refuses a host that can never be the record before the item becomes evidence, because the search tool
  extracts mechanically from whatever its query returned: asking the model in a prompt not to gather
  social posts still gathered them. The tier floor and the corroboration check apply at the verdict.
- New pipeline surface: admissibility rules, a research planner, and a corroboration check, each with L1
  tests. Prompt changes are L2-gated (golden diff) and L3-measured (per-stratum gate).
- A claim about a **policy commitment** is researched as the commitment — whether it was made, by whom,
  with what conditions — and held as not yet checkable as fact.
