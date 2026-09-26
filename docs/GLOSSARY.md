# Glossary

Two vocabularies, one rule each.

- **Everyday words** are for prose — design docs, the site, the contest form. Write plainly.
- **Internal names** are the exact strings in the database, code, and run files. Keep them where a
  machine reads them. Define them here. Do not use them to explain.

A word that may not appear on a verdict page should not be the only name for the thing in a design
doc. If a term is banned in public copy, it may appear in a doc as an identifier, once, with its
everyday meaning beside it — never as the explanation itself.

## Everyday word ↔ internal name

| Everyday word | Internal name | What it means |
|---|---|---|
| official source | verifier authority | A public, structured source we trust for one domain (Stats NZ, police data). Consulted as evidence, never checked as a claim. |
| the evidence behind the verdict | evidence pack | The frozen record of the sources and figures a verdict used. |
| added to, never edited | append-only | A verdict changes by writing a new version. Old versions stay. |
| claim key | fingerprint | The fields that say two claims are the same number: indicator, group, place, period, baseline, unit. |
| the full field / the other ways to count it | sensitivity grid | The fixed set of alternative framings we test every claim against. Same set for every speaker. |
| re-check of the reasoning | NLI audit | A second pass that checks the written justification actually follows from the evidence. |
| who said it | speakership | Which sentence belongs to which actor — a quoted minister, the outlet's own prose, or nobody we can name. |
| reading the page | extraction ladder | How we get text out of a page: direct, then a fallback reader. |
| group | stratum | One slice of the labelled set — a source kind, a claim type. |
| what the claim was arguing for | discourse context | The proposal a claim was deployed in support of. Absent stays absent. |
| the check / the pipeline | (formerly "adjudicator") | The automated step that produced a verdict. Not a person. Prefer "the check". |
| we couldn't reach a verdict | abstention | The honest outcome when the evidence does not decide. |
| verdict | verdict class | The published word: supported, refuted, and so on. |
| a second source | corroboration | Independent agreement from another source. |

## Words banned in public copy

The site's register check (`apps/site/src/lib/verdict-page.ts`, `BANNED_LEXICON`, enforced by
`assertRegisterSafe`) fails the build if public copy contains any of:

`sensitivity grid` · `extraction ladder` · `NLI audit` · `Tier-2` · `stratum` · `discourse context` ·
`fingerprint` · `pgvector` · `drizzle`

These are also the words most likely to be used as if self-explanatory in a design doc. If you need
one, name the everyday meaning first and give the internal name in parentheses.

## Terms that are fine as identifiers, never as explanation

`provenance` · `materiality` · `canonical` · `idempotent` · `vintage` · `source-occurrence`

Each has a plain equivalent ("where this came from", "which comparisons matter", "the standard
one", "safe to run twice", "the date the data was published", "another time the same claim was
said"). Use the plain equivalent in sentences. Keep the precise word in field names.
