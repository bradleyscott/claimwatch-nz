# ClaimWatch NZ (working name)

An open-source system for checking factual claims made during New Zealand political debate — built so that every step of the checking process can be inspected, contested, and corrected by the public.

**Status: documentation and design phase.** No pipeline code yet. We are working through approach decisions publicly, via Architecture Decision Records, before building. See [`docs/`](docs/).

## Why

Ahead of the 2026 NZ general election (7 November 2026), we are building a public resource that:

1. **Monitors** official sources — Beehive ministerial releases, party press releases, Hansard, and major news RSS feeds.
2. **Detects and types** checkable factual claims, with particular focus on statistical claims used to support policy propositions.
3. **Verifies** claims against primary and official evidence, with special machinery for the most common campaign pattern: *a statistic that is quoted accurately but paints a selective or incomplete picture*.
4. **Publishes** verdicts that are explicitly **automated assessments, open to contest** — the public can dispute a verdict with evidence; that evidence is itself validated by the pipeline; and a validated challenge **mutates** the verdict with a visible, auditable diff.
5. **Measures itself** against an independently labelled set of NZ political claims, and publishes the accuracy numbers.

## Core design principles

- **Automation triages and drafts; evidence decides.** No automated verdict is ever published as an uncontestable fact. Every verdict page shows its full evidence pack.
- **Claims, not persons.** Verdict language addresses claims ("this figure is selective"), never character ("X lied"). This is both an epistemic and a legal (defamation) decision.
- **Mutation, not retraction.** Verdicts change only through validated evidence, always with a public diff and append-only audit log.
- **Measured, not asserted.** The system publishes its own accuracy against a labelled ground-truth set, and the community layer is graded by the same harness.
- **Everything is open.** Code, prompts, labelled datasets, evidence rubrics, decision records, and methodology are public and subject to scrutiny.

## Reading order

| Doc | What it covers |
|---|---|
| [`docs/RESEARCH-REVIEW.md`](docs/RESEARCH-REVIEW.md) | Survey of the state of the art: automated fact-checking research, existing systems (open and proprietary), community-correction systems, and NZ-specific data infrastructure. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The proposed system architecture, with diagrams and reasoning per component. |
| [`docs/EVALUATION.md`](docs/EVALUATION.md) | How we measure pipeline and community-layer accuracy against labelled ground truth. |
| [`docs/COVERAGE.md`](docs/COVERAGE.md) | Verified access map: every cited source probed for API/feed availability, bot protection, and degradation, with mitigations. |
| [`docs/SOURCE-TAXONOMY.md`](docs/SOURCE-TAXONOMY.md) | Source taxonomy: the claim-source coverage matrix (anti-bias) and the evidence-authority map (trusted sources per policy domain, with precedence rules). |
| [`docs/LEGAL-COMPLIANCE.md`](docs/LEGAL-COMPLIANCE.md) | NZ electoral law, defamation, and content-hosting obligations, and how the design addresses each. |
| [`docs/adr/`](docs/adr/) | Architecture Decision Records — every significant approach decision, its alternatives, and the reasoning. |

## Timeline context

- Regulated advertising period: **7 Aug – 6 Nov 2026** (we are inside it)
- Election day: **7 November 2026**
- Official results declared: **27 November 2026**
- Design freeze on verdict mutations: **5 November 2026** (see legal doc)

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). This project is being built in the open; disagreement with any ADR is itself a useful contribution — open an issue or a competing ADR.

## License

Code: MIT (see [`LICENSE`](LICENSE)). Documentation and datasets: CC BY 4.0.