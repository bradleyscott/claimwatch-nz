# ADR-0004: Statistical-claim verification via fingerprint + topic packs + sensitivity grid, within a multi-mode verification layer

*Status: Revised (see revision note) · Date: 2026-09-07 · Deciders: Bradley, Dave*

## Context

The project's founders identified the core risk class: **statistics quoted accurately but painting a convenient, incomplete, or skewed picture** ("crime up 30% since 2017" — true number, selective framing). This class dominates campaign material, and standard open-web fact-checking handles it poorly because the claim sentence itself is not false.

Academic work on cherry-picking detection exists (arXiv:2401.05650 "Cherry" 2024; UTA "Filling the Blanks" 2025) but is research-grade. NZ has unusually good open statistical infrastructure (Stats NZ Aotearoa Data Explorer + bulk CSVs, Infoshare, Figure NZ, MoJ, LAWA).

## Decision

Statistical claims are verified through a dedicated engine:

1. **Fingerprint extraction**: indicator × population × geography × time window × baseline × unit.
2. **Evidence-field retrieval**: the canonical series for the indicator, from official sources — regardless of what the claimant cited.
3. **Sensitivity grid** (pre-declared, published): window variants (endpoint-trick detection), raw vs per-capita, denominator family (e.g. recorded offences vs victim-survey prevalence), comparison cohorts, seasonality/averaging.
4. **Verdict vocabulary**: "accurate" / "accurate but incomplete — material alternatives contradict the impression" / "unverifiable" — never "false" for a true-but-selective number.
5. **Presentation**: chart-first, alternatives table, evidence field shown.

**Topic packs**: evidence fields for ~20–30 campaign-predictable indicators (crime, net migration, health waitlists by measure, housing consents, the three child-poverty measures, emissions, welfare rolls, etc.) are pre-computed, versioned, and party-blind. Live claims resolve by fingerprint-match + sensitivity check against the pack.

The general open-web verification loop (FIRE-style) remains for non-statistical claims, with a strict step budget, and its verdicts carry the most visible contest affordances — we know from the benchmarks that this mode is the least reliable.

## Alternatives considered

- **Uniform open-web pipeline for all claims.** Rejected: worse accuracy on the highest-value class; open-web retrieval is the known bottleneck.
- **Human analyst reviews for statistical claims.** Rejected: payroll; also slower than the pack lookup.
- **Only citation-checking** (does the cited source say what's claimed?). Kept, as a *sub-mode* of the engine — but citation checking alone cannot catch selective framing, which requires reconstructing the field beyond the citation.
- **A dedicated engine per misleading-technique class** (post taxonomy research, `docs/MISINFO-TAXONOMY.md`). Rejected: fabricated-content and false-context classes are better served by the capped open-web loop and a provenance/context-retrieval mode respectively; the stat engine remains one mode of the verification layer, not the layer.

## Revision note

2026-09-07 (revised after taxonomy research): retitled from "…as the flagship; open-web loop demoted to the long tail" — the stat engine is one mode of a multi-mode verification layer (topic-pack, citation-check, false-context/provenance, capped open-web), informed by the empirical technique distribution from the 2024 EU elections (`docs/MISINFO-TAXONOMY.md`): decontextualisation 59% of verified disinformation, missing-context verdicts 23%, so selective statistics is a real but minority slice of the missing-context class. An electoral-process topic pack was added as the highest-priority pack. Manipulated media declared out of scope for v1 (partner-referral path).

## Consequences

- The published rubric must exist before campaign peak — the grid is the criterion, and it must be identical for every party.
- Indicators without a clean canonical series (soft policy claims) fall back to the open-web loop with visibly lower reliability; the claim-type labelling makes this transparent.
- Series vintages are stored with verdicts ("as measured at publication") so revisions are detectable.