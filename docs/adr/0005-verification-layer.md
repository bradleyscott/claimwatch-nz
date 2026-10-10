# ADR-0005: The claim-anchored evidence store

*Status: Accepted · Deciders: Dave*

## Context

The project's core risk class is a **statistic quoted accurately to paint a convenient, incomplete, or
skewed picture** — "crime up 30% since 2017", a true number with selective framing. This class dominates
campaign material, and standard open-web fact-checking handles it badly, because the claim sentence
itself is not false (`MISINFO-TAXONOMY.md`). New Zealand has unusually good open statistical
infrastructure: Stats NZ's Aotearoa Data Explorer and Infoshare, Figure NZ, MoJ, LAWA.

Two architectures were considered.

1. **Pre-computed topic packs.** Build an evidence field per indicator ahead of time; a claim resolves by
   lookup.
2. **A claim-anchored evidence store.** Verify claim by claim, accumulate evidence in a shared store, and
   let indicator-level structure emerge from claim traffic.

Precomputation bets on a prediction that cannot be checked in advance — which indicators will be claimed,
and in which framings. A pack built around an indicator can miss the framing a claimant actually uses,
because framings are not indicator-shaped, and every pack for an indicator nobody quotes is wasted
effort. The pipeline can predict claims; it cannot observe them.

## Decision

**A claim-anchored evidence store: every verification deposits the claim, the evidence it used, and the
finding, and later claims on similar ground resume from what the store already holds.**

### The store

Every verified claim deposits the claim record (text, speaker, date, source), the evidence retrieved
(series, documents, URLs, **vintages**, archive snapshots), the finding, and the audit trail. Later
claims on similar ground match by claim identity and embedding, and **resume retrieval rather than
restarting it**. Indicator-level structure emerges from claim traffic: the store organises itself around
what was actually disputed.

**Cold start is honest.** Early claims pay the full retrieval cost, and the store warms as the campaign
proceeds — visible in the published methodology rather than hidden by precomputation. **The store is the
asset**: validated evidence chains organised by claim, growing with the campaign.

### Authority map

Retrieval is guided by the A1–A6 authority map (`SOURCE-TAXONOMY.md` §2): each domain has a declared
primary authority, alternates and denominator family. Precedence is A1 > A2 > … > A6, and the conflict is
often the finding — a verdict cites the claim's own tier first, then the higher authority, and is about
the gap. Advocacy data never enters as evidence (ADR-0018).

### Vintage discipline

Every evidence row carries a `vintage_date` and an `archive_snapshot_url`; verdicts note "as measured at
publication". This is recorded provenance, not an ongoing re-verification commitment (CROSS-CUTTING §10).
Re-fetching a series creates a new versioned row, never an update.

### Claimant entities and relationships

- **Claimant entities are first-class store objects**: person entities (aliases, party affiliation at
  time of statement, role, attribution source links) and party/organisation entities (institutional
  statements attribute to the principal). Attribution is conservative — person when clearly identified,
  party alone when institutional, "unattributed" when unclear; never guessed.
- **Reliability profiles** (per-claimant aggregates) are a post-verification layer with hard guardrails:
  they never feed back into verdicts (the verification loop receives no claimant identity), base-rate
  context is mandatory, minimum-volume thresholds apply, and party and person are never blended.
- **Claim relationships** — the store is a graph: repeats / corrects / contradicts / refines /
  responds-to. **Corrections are first-class**: bidirectional linkage, the original verdict kept as an
  earlier version (s 199A first-publication clarity), self-corrections surfaced approvingly, conservative
  linking with a review queue for ambiguous cases.

## Alternatives considered

- **Pre-computed topic packs.** Rejected: optimises for an unverifiable prediction; framings are not
  indicator-shaped.
- **Hybrid (pre-compute high-frequency packs, accumulate the rest).** Rejected: the high-frequency
  indicators only become known from claim traffic.
- **Pure open-web loop, no store.** Rejected: repeat claims would pay full retrieval cost every time, and
  the store is the research/licensing asset.
- **Human analyst review.** Rejected: payroll, and slower than store lookup.

## Consequences

- Build effort goes to the retrieval loop, the store, and authority-map configuration — not to pack
  construction.
- **The store is the asset**: validated evidence chains organised by claim, growing with the campaign —
  the licensable/research dataset, claim-anchored from day one.
- Indicators without a clean canonical series are researched from the open web with visibly lower
  reliability; the page says so.
- Series vintages are stored with verdicts ("as measured at publication") so revisions are detectable.
- Claimant entities, reliability profiles, and the claim graph are build items: entity resolution at
  ingestion, the identity firewall enforced in code, relationship detection alongside repeat-matching.
