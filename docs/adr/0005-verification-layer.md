# ADR-0005: The verification layer — multi-mode engine, sensitivity grid, and the claim-anchored evidence store

*Status: Proposed · Date: 2026-09-08 · Deciders: Bradley, Dave*

## Context

The project's core risk class: **statistics quoted accurately but painting a convenient, incomplete, or skewed picture** ("crime up 30% since 2017" — true number, selective framing). This class dominates campaign material, and standard open-web fact-checking handles it poorly because the claim sentence itself is not false. NZ has unusually good open statistical infrastructure (Stats NZ Aotearoa Data Explorer, Infoshare, Figure NZ, MoJ, LAWA).

Two architectures were considered across the design phase:

1. **Pre-computed topic packs** — evidence fields per indicator built ahead of time, claims resolving by lookup.
2. **A claim-anchored evidence store** — verify claim-by-claim; accumulate evidence into a shared store; let indicator-level structure emerge from claim traffic.

The pack approach was rejected for a structural reason: **precomputation optimises for a prediction — which indicators will be claimed, and in which framings — that cannot be verified in advance.** A pack built around an indicator may miss the framing a claimant actually uses (framings are not indicator-shaped), and every pack for an unquoted indicator is wasted effort. The claim-detection pipeline predicts claims; it doesn't observe them.

## Decision

**A multi-mode verification layer backed by a claim-anchored evidence store. Claims route to modes by type; statistical claims resolve via fingerprint + sensitivity grid over official series; evidence accumulates in a shared store so repeat and adjacent claims compound.**

### The modes

1. **Statistical claims — the stat engine** (the flagship): fingerprint extraction (indicator × population × geography × time window × baseline × unit) → evidence-store match / retrieval against the T1–T6 authority map → **sensitivity grid** (window variants with endpoint-trick detection, raw vs per-capita, denominator family, comparison cohorts, seasonality/averaging) → verdict. Grid axes are pre-declared and published before campaign peak — identical for every claim about an indicator; the **computation** runs at claim time over accumulated + freshly retrieved evidence. The LLM selects which grid rows are material to the claim; it never authors the grid. Verdicts: "accurate" / "accurate but incomplete — material alternatives contradict the impression" / "unverifiable" — never "false" for a true-but-selective number (per ADR-0005's schema). Presentation: chart-first, alternatives table, "as deployed" line per the claim's discourse context (ADR-0010).
2. **Citation-backed claims** — fetch the cited document, bounded claim-vs-source check. Whether the citation does direct argumentative work or decorative work (ADR-0010's context) sets how strictly the check binds.
3. **False-context / provenance mode** — for decontextualised real content (the dominant verified-disinformation class in EU-2024 analysis, 59.3%): the stored discourse window (ADR-0010) plus retrieval of the original context is the instrument.
4. **General open-web loop** — question decomposition, multi-hop conditional retrieval, hybrid store search, confidence-capped depth (per ADR-0002's evidence-base findings), NLI justification auditing before publication. Least reliable mode; capped, labelled, most visibly open to contest.

### The claim-anchored evidence store (replacing pre-computed packs)

Every verified claim deposits: the claim record (text, fingerprint, speaker, date, source), the evidence retrieved (series, documents, URLs, **vintages**), the grid computation result, the verdict and audit trail. Later claims on similar territory match by fingerprint + embedding and **resume retrieval rather than restarting** — retrieval resumes, it doesn't restart. Indicator-level structure emerges from claim traffic; the store organises itself around what was actually disputed.

**Cold start is honest**: early claims pay full retrieval cost; the store warms as the campaign proceeds — visible in the published methodology rather than hidden by precomputation. **The store is the asset**: validated evidence chains organised by claim, growing with the campaign.

### Grid axes and the "reasonable alternatives" defence

The grid axes remain pre-declared and published before campaign peak — identical for every claim about an indicator, shown on the verdict page. The pre-declaration prevents "you invented the standard to hurt us"; the discourse context (ADR-0010) selects which rows are *material* for the deployment, never what the standard is.

### Claimant entities and relationships (store capabilities)

- **Claimant entities are first-class store objects**: person entities (aliases, party affiliation with history, role, attribution source links) and party/organisation entities (institutional statements attribute to the principal). Conservative attribution — person when clearly identified, party alone when institutional, "unattributed" when unclear; never guessed. Affiliation recorded **at time of statement**. Cross-links to canonical records: Wikipedia for persons, Electoral Commission registration for parties — fetched and human-reviewed for seed entities, rendered on every claim page and in ClaimReview metadata.
- **Reliability profiles** (per-claimant/per-party aggregates) are a post-verification layer with hard guardrails: they never feed back into verdicts (the verification loop receives no claimant identity — structural firewall); base-rate context mandatory; minimum-volume thresholds; party vs person never blended; corrections surfaced in the claimant's favour.
- **Claim relationships** — the store is a graph: repeats / corrects / contradicts / refines / responds-to. **Corrections are first-class**: bidirectional linkage, the original verdict kept as history (s 199A first-publication clarity), self-corrections surfaced approvingly, conservative linking with review queue for ambiguous cases.

### What this replaces from the pack design

| Pack-design element | Disposition |
|---|---|
| Pre-computed evidence fields | Dropped — on-demand retrieval + accumulated store |
| 9-pack seed build | Dropped as build work — electoral-process claims keep the fastest lane via retrieval priority (Electoral Commission as sole T1, s 199A interaction) |
| Sensitivity grid axes | Kept — pre-declared; computed on demand |
| Authority map (T1–T6) | Kept — retrieval guidance configuring the loop |
| Series vintages + revision policy | Kept — nightly batch re-verification detects revisions |
| Community extension of evidence | Kept, strengthened — contest evidence extends the store by definition |
| Batch economics | Kept — verification runs are batch-shaped (ADR-0006) |

## Alternatives considered

- **Pre-computed topic packs.** Rejected: optimises for an unverifiable prediction; pack construction is effort ahead of evidence of need; framings are not indicator-shaped.
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