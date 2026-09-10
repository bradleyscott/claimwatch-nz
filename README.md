# ClaimWatch NZ (working name)

An open-source system for checking factual claims made during New Zealand political debate. Every step of the checking process is inspectable, contestable, and correctable by the public.

**Status: documentation and design phase.** No pipeline code yet; approach decisions are being made publicly via Architecture Decision Records in [`docs/adr/`](docs/adr/).

## What it does

Ahead of the 2026 NZ general election (7 November 2026):

1. **Monitors** official sources — Beehive releases, party releases, Hansard, news RSS, broadcast captions (publisher-published text only), and institutional claim sources.
2. **Detects and types** checkable factual claims, with a focus on statistics used to support policy propositions.
3. **Verifies** claims against primary and official evidence. The flagship mode targets the most common campaign pattern: a statistic quoted accurately but painting a selective picture.
4. **Publishes** verdicts as automated assessments, open to contest — validated contest evidence mutates the verdict with a public diff and append-only audit log.
5. **Measures itself** against a labelled set of NZ political claims and publishes the numbers.

## Design principles

- **Automation triages and drafts; evidence decides.** No verdict is published as an uncontestable fact; every verdict page carries its full evidence pack.
- **Claims, not persons.** Verdicts address claims ("this figure is selective"), never character ("X lied") — an epistemic and legal (defamation) decision.
- **Mutation, not retraction.** Verdicts change only through validated evidence, with a public diff and append-only audit log.
- **Measured, not asserted.** The system publishes its own accuracy against a labelled ground-truth set; the community layer is graded by the same harness.
- **Everything is open.** Code, prompts, labelled datasets, evidence rubrics, decision records, methodology.

## Reading order

| Doc | Covers |
|---|---|
| [`docs/RESEARCH-REVIEW.md`](docs/RESEARCH-REVIEW.md) | State of the art: automated fact-checking research, existing systems, community-correction evidence, NZ data infrastructure. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The proposed system architecture, with diagrams and per-component reasoning. |
| [`docs/EVALUATION.md`](docs/EVALUATION.md) | The two-layer evaluation harness (AVeriTeC benchmark + NZ-labelled set). |
| [`docs/COVERAGE.md`](docs/COVERAGE.md) | Live-probed access map for every cited source: feeds, bot protection, degradation, mitigations. |
| [`docs/SOURCE-TAXONOMY.md`](docs/SOURCE-TAXONOMY.md) | Claim-source coverage matrix (anti-bias) and the evidence-authority map (T1–T6 tiers, per-domain, precedence rules). |
| [`docs/MISINFO-TAXONOMY.md`](docs/MISINFO-TAXONOMY.md) | Misleading-information taxonomies (Wardle, DISARM/FIMI, EU-2024 distributions) mapped to verification modes. |
| [`docs/WEBSITE-UX-RESEARCH.md`](docs/WEBSITE-UX-RESEARCH.md) | What PolitiFact/Full Fact/Snopes/FactCheck.org do, and our page set + differentiators. |
| [`docs/DISCOVERY-MECHANISM.md`](docs/DISCOVERY-MECHANISM.md) | Findability: ClaimReview-marked SSR pages, faceted browse, hybrid search, feed + newsletter. |
| [`docs/USER-SUBMISSIONS.md`](docs/USER-SUBMISSIONS.md) | Intake: source-URL vs claim submission, fuzzy match, public verification requests, never-trust rule. |
| [`docs/VALIDATION-SLICE.md`](docs/VALIDATION-SLICE.md) | The first build slice: five risk-representative lanes, per-stratum accuracy measurement, site MVP. |
| [`docs/LEGAL-COMPLIANCE.md`](docs/LEGAL-COMPLIANCE.md) | NZ electoral law, defamation, and content-hosting obligations, with design responses. |
| [`docs/DECISION-LOG.md`](docs/DECISION-LOG.md) | Working notes behind the ADRs; the ADRs are the stable record. |
| [`docs/adr/`](docs/adr/) | Every significant approach decision, its alternatives, and reasoning. |

## Timeline context

- Regulated advertising period: **7 Aug – 6 Nov 2026** (we are inside it)
- Election day: **7 November 2026**
- Official results declared: **27 November 2026**
- Verdict mutation freeze: **5 Nov – after results** (see `docs/LEGAL-COMPLIANCE.md` §1)

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Disagreement with any ADR is a useful contribution — open an issue or a competing ADR.

## License

Code: MIT ([`LICENSE`](LICENSE)). Documentation and datasets: CC BY 4.0.