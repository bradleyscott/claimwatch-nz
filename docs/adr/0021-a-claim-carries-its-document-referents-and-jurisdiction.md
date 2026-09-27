# ADR-0021: A claim carries its document, its referents and its jurisdiction

*Status: Proposed · Date: 2026-09-26 · Deciders: Dave*

## Context

A claim was extracted from an RNZ article and verified to `not_enough_evidence` with this finding:

> *"There's no evidence found that any charity made this specific statement about needing $140,000 more
> for infrastructure and staffing."*

The statement was in the article the claim came from. The article's lead names **BirdCare Aotearoa**,
and its last paragraph is the claim sentence, verbatim. The verdict rested on these five sources:

| Source | What it is |
|---|---|
| capitalregionchamber.com | a US chamber of commerce |
| facebook.com/Militarydotcom | a Facebook post |
| infrastructurereportcard.org | a US infrastructure report |
| facebook.com/krqenews | another Facebook post |
| infrastructureusa.org | a US advocacy site |

The pipeline had everything it needed and used none of it:

- The **document** — the record that the statement was made — was stored, linked, and shown on the page,
  but never entered the evidence the adjudicator reasoned over.
- The **referent** — "The charity" in the claim text — is resolved by the article's lead and by the
  attribution stage (`BirdCare Aotearoa`), and was dropped from the standalone claim.
- The **jurisdiction** — `rnz.co.nz` is unambiguously New Zealand — was never derived, because the claim
  sentence contains no country word.

And the retrieval path was instructed against the fix: `decompose.ts` said *"Queries must NOT be biased
toward any country unless the claim itself concerns it."* The claim concerns New Zealand; the sentence
does not say so. So the queries carried no country bias, matched `"$140,000" + "infrastructure"`, and
returned American pages. The one jurisdiction-aware retrieval path (`open-web-retrieval.ts`, which
appends a locale suffix) was not the path in use.

## Decision

**A claim is never verified from its sentence alone. It carries three things the sentence cannot supply.**

1. **Its document.** The claim's own publication is handed to the adjudicator as `claimSource`, and is
   the record for *whether the statement was made*. It is not a source to search for, and its presence
   is never a reason to report a statement as unattested. It cannot corroborate itself, so it is
   provenance for the attribution question, not evidence for the substance.

2. **Its referents.** A leading definite reference is resolved at verification time — "The charity said…"
   becomes "BirdCare Aotearoa said…" — using the attributed speaker. Conservative: only a leading
   `The/A/An <referring-noun>`, only when the speaker is known and not already named. The page still
   shows the verbatim quote; the resolved form is what gets searched and adjudicated.

3. **Its jurisdiction**, derived from the **document** — the publication's ccTLD or source id — and never
   from the claim sentence. Queries are biased to it, and the decomposition prompt's instruction not to
   bias by country is replaced by the opposite.

Two further rules follow:

4. **Queries are anchored on entities.** The attributed speaker's own name is the strongest query term
   available: `"BirdCare Aotearoa"` finds the article; `"charity $140,000 infrastructure"` finds New
   Mexico.

5. **Attribution and substance are answered separately.** For reported speech the two questions are
   *was it said* (record: the claim's document) and *is it true* (evidence: research). The verdict is
   decided on the substance, and the finding must not conflate "we could not verify the figure" with
   "no one said this".

## Alternatives considered

- **Rely on the model to notice the claim is NZ.** Rejected: it has only the sentence, and the sentence
  does not say. Jurisdiction is a document property.
- **Keep the "no country bias" instruction and filter results afterwards.** Rejected: filtering is still
  needed, but a query with no jurisdiction returns a page of the wrong country, and the top results are
  what the researcher grades. Bias the query, then filter.
- **Rewrite the claim text to the resolved form at ingestion.** Rejected for now: the verbatim sentence
  is the quotable artefact and the auditable original, and rewriting it at write time would need a schema
  change and would lose the published wording. Resolution happens at use, and the page keeps the verbatim.
- **Add a new verdict class for "reported accurately, substance unverified".** Deferred: the vocabulary
  change is wider than this slice. This ADR requires only that the finding state which question it
  answered; the class stays `not_enough_evidence` for now.

## Consequences

- The BirdCare claim becomes the regression fixture: the publication is in the pack, "the charity"
  resolves to BirdCare Aotearoa, every query carries `New Zealand`, and no US source survives.
- `decompose.ts`'s prompt changes and the adjudicator's brief changes — both L2-gated (golden diff) and
  L3-measured.
- `claim-context.ts` is the single place jurisdiction, referent resolution and query bias live; the
  `open-web-retrieval.ts` locale logic and `discovery.ts`'s query builder should be folded into it so
  there is one mechanism rather than three.
- Out-of-jurisdiction and inadmissible sources still need filtering *before* adjudication (ADR-0020
  rule 2/3 applied to research evidence); this ADR biases the queries so fewer of them arrive, and the
  filter is the next slice.
