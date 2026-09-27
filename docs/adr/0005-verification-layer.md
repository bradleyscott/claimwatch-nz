# ADR-0005: The verification layer — multi-mode engine, sensitivity grid, and the claim-anchored evidence store

*Status: Accepted (2026-09-26) · Date: 2026-09-08 · Deciders: Dave*

> **Partly superseded (Sept 2026) by [ADR-0023](0023-verification-plans-and-the-procedure-library.md).**
> Claims no longer route to one of five modes; each gets a **plan** over a growing **procedure library**.
> The five modes survive as the library's seeded procedures, and the sensitivity grid, the authority
> map, and the claim-anchored evidence store are unchanged. The **fingerprint is removed entirely** —
> read the mentions of it below as the claim's typed window and magnitude, parsed at the point of use.
> §2.1's routing rule is superseded; everything else in this ADR still holds.

## Context

The project's core risk class is a **statistic quoted accurately to paint a convenient, incomplete, or
skewed picture** — "crime up 30% since 2017", a true number with selective framing. This class dominates
campaign material, and standard open-web fact-checking handles it badly, because the claim sentence
itself is not false (`MISINFO-TAXONOMY.md`). New Zealand has unusually good open statistical
infrastructure: Stats NZ's Aotearoa Data Explorer and Infoshare, Figure NZ, MoJ, LAWA.

Two architectures were considered during the design phase.

1. **Pre-computed topic packs.** Build an evidence field per indicator ahead of time; a claim resolves by
   lookup.
2. **A claim-anchored evidence store.** Verify claim by claim, accumulate evidence in a shared store, and
   let indicator-level structure emerge from claim traffic.

The pack approach was rejected for a structural reason: **precomputation bets on a prediction that
cannot be checked in advance** — which indicators will be claimed, and in which framings. A pack built
around an indicator can miss the framing a claimant actually uses, because framings are not
indicator-shaped, and every pack for an indicator nobody quotes is wasted effort. The pipeline can
predict claims; it cannot observe them.

## Decision

**A multi-mode verification layer backed by a claim-anchored evidence store. Claims route to modes by type; statistical claims resolve via fingerprint + sensitivity grid over official series; evidence accumulates in a shared store so repeat and adjacent claims compound.**

### The modes

1. **Statistical claims — the stat engine**, the flagship. Fingerprint extraction (indicator, population,
   geography, time window, baseline, unit) → match or retrieve against the A1–A6 authority map
   (`SOURCE-TAXONOMY.md` §2) → **sensitivity grid** (window variants with endpoint-trick detection, raw
   against per-capita, denominator family, comparison cohorts, seasonality) → verdict. The grid axes are
   pre-declared and published before the campaign peak, identical for every claim about an indicator;
   only the **computation** runs at claim time, over accumulated and freshly retrieved evidence. The LLM
   selects which grid rows are material to the claim and never writes the grid. Verdicts are "accurate",
   "accurate but incomplete — material alternatives contradict the impression", or "unverifiable" — never
   "false" for a true but selective number (ADR-0004). The page is chart-first, with an alternatives table
   and an "as deployed" line from the claim's context (ADR-0008).
2. **Citation-backed claims** — fetch the cited document, bounded claim-vs-source check. Whether the citation does direct argumentative work or decorative work (ADR-0008's context) sets how strictly the check binds.
3. **False-context / provenance mode** — for decontextualised real content (the dominant verified-disinformation class in EU-2024 analysis, 59.3%): the stored discourse window (ADR-0008) plus retrieval of the original context is the instrument.
4. **General open-web loop** — question decomposition, multi-hop conditional retrieval, hybrid store search, confidence-capped depth (per ADR-0006's evidence-base findings), NLI justification auditing before publication. Least reliable mode; capped, labelled, most visibly open to contest.

### The claim-anchored evidence store (replacing pre-computed packs)

Every verified claim deposits the claim record (text, fingerprint, speaker, date, source), the evidence
retrieved (series, documents, URLs, **vintages**), the grid result, the verdict, and the audit trail.
Later claims on similar ground match by fingerprint and embedding, and **resume retrieval rather than
restarting it**. Indicator-level structure emerges from claim traffic: the store organises itself around
what was actually disputed.

**Cold start is honest.** Early claims pay the full retrieval cost, and the store warms as the campaign
proceeds — visible in the published methodology rather than hidden by precomputation. **The store is the
asset**: validated evidence chains organised by claim, growing with the campaign.

### Grid axes and the "reasonable alternatives" defence

The grid axes remain pre-declared and published before campaign peak — identical for every claim about an indicator, shown on the verdict page. The pre-declaration prevents "you invented the standard to hurt us"; the discourse context (ADR-0008) selects which rows are *material* for the deployment, never what the standard is.

### Claimant entities and relationships (store capabilities)

- **Claimant entities are first-class store objects**: person entities (aliases, party affiliation with history, role, attribution source links) and party/organisation entities (institutional statements attribute to the principal). Conservative attribution — person when clearly identified, party alone when institutional, "unattributed" when unclear; never guessed. Affiliation recorded **at time of statement**. Cross-links to canonical records: Wikipedia for persons, Electoral Commission registration for parties — fetched and human-reviewed for seed entities, rendered on every claim page and in ClaimReview metadata.
- **Reliability profiles** (per-claimant/per-party aggregates) are a post-verification layer with hard guardrails: they never feed back into verdicts (the verification loop receives no claimant identity — structural firewall); base-rate context mandatory; minimum-volume thresholds; party vs person never blended; corrections surfaced in the claimant's favour.
- **Claim relationships** — the store is a graph: repeats / corrects / contradicts / refines / responds-to. **Corrections are first-class**: bidirectional linkage, the original verdict kept as history (s 199A first-publication clarity), self-corrections surfaced approvingly, conservative linking with review queue for ambiguous cases.

### What this replaces from the pack design

| Pack-design element | Disposition |
|---|---|
| Pre-computed evidence fields | Dropped — on-demand retrieval + accumulated store |
| 9-pack seed build | Dropped as build work — electoral-process claims keep the fastest lane via retrieval priority (Electoral Commission as sole A1, s 199A interaction) |
| Sensitivity grid axes | Kept — pre-declared; computed on demand |
| Authority map (A1–A6) | Kept — retrieval guidance configuring the loop |
| Series vintages + revision policy | Kept — nightly batch re-verification detects revisions |
| Community extension of evidence | Kept, strengthened — contest evidence extends the store by definition |
| Batch economics | Kept — verification runs are batch-shaped (ADR-0011) |

## Alternatives considered

- **Pre-computed topic packs.** Rejected: optimises for an unverifiable prediction; effort ahead of evidence of need; framings are not indicator-shaped.
- **Hybrid (pre-compute high-frequency packs, accumulate the rest).** Rejected for v1: the high-frequency indicators only become known from claim traffic — precomputing before observing duplicates the prediction problem.
- **Pure open-web loop, no store.** Rejected: throws away compounding value; repeat claims would pay full retrieval cost every time; the store is the research/licensing asset.
- **Uniform open-web pipeline for all claims.** Rejected: worse accuracy on the highest-value class; open-web retrieval is the known bottleneck.
- **Human analyst review for statistical claims.** Rejected: payroll; slower than store lookup.
- **A dedicated engine per misleading-technique class.** Rejected: fabricated-content and false-context classes are better served by the open-web loop and the false-context mode; the stat engine is one mode of the verification layer, not the layer.

## Consequences

- **No pack-construction workstream** — build effort goes to the retrieval loop, the store, and authority-map configuration.
- **The store is the asset**: validated evidence chains organised by claim, growing with the campaign — the licensable/research dataset, claim-anchored from day one.
- **Grid axes pre-declared; computation on demand** — methodology page publishes the axes; materiality selection automated but auditable.
- **The electoral-process lane is a retrieval-priority rule**, not a pre-computed pack.
- **Claimant entities, reliability profiles, and the claim graph are build items** — entity resolution at ingestion, the structural firewall enforced in code, relationship detection alongside repeat-matching.
- **Cold-start honesty, verdict-page narrative rendering (relationship chains), and grid rubric sign-off before campaign peak** are stated build requirements.
- Indicators without a clean canonical series fall back to the open-web loop with visibly lower reliability; claim-type labelling makes this transparent. Series vintages stored with verdicts ("as measured at publication") so revisions are detectable.