# ADR-0009: Public proposal of claim sources and evidence authorities

*Status: Proposed · Date: 2026-09-07 · Revised: 2026-09-07 (see revision note) · Deciders: Bradley, Dave*

## Context

`docs/SOURCE-TAXONOMY.md` defines the claim-source coverage matrix and the evidence-authority map, both maintained by the project. Two problems with pure maintainer curation:

1. **Coverage blind spots**: maintainers will not know about provincial, community, or niche outlets that matter to specific communities; the public will. Source gaps discovered after the campaign peak are expensive.
2. **Legitimacy**: an authority map curated in private is exactly the kind of editorial power the project's open-scrutiny model tries to avoid. If the map says "Stats NZ is the authority on employment", a member of the public should be able to propose additions — and see how the decision was made.

The risk that must be designed against: **poisoning**. "Suggest a source" is an open door for partisan actors proposing advocacy outlets as trusted authorities, or proposing flood-of-noise sources to skew the claim corpus. The mechanism must let the public shape *consideration*, not control *adoption*.

## Decision

A **public proposal pathway** with two proposal types, one intake, and a vetting gate.

### Proposal types (kept minimal — the burden of analysis is on the project, not the proposer)

1. **Claim-source proposal** — "this outlet/publication should be monitored." Submit: outlet name, URL(s), and a free-text note on why it matters for election claim coverage. **No matrix classification is asked of the proposer** — where the source fits the coverage matrix is determined by project analysis after acceptance (the pipeline's own metadata + LLM classification of the outlet's profile). Proposers describe; the project classifies.
2. **Evidence-authority proposal** — "this institution/dataset should be considered as an authority." Submit: institution, dataset/series name, URL, and a **narrative justification** (why it is trusted: statutory role, methodology publication, independence, revision policy — in the proposer's own words). **Proposers are not asked to classify a tier** — tier assignment (T1–T6) is made during review by the maintainers/subject-matter reviewers, informed by the narrative, not by the proposer's self-assessment.

**Domain proposals are not accepted — but the domain taxonomy is not open-ended either.** The starting domain set is **seeded up front** from established policy groupings used in NZ political analysis (the NZ Parliament select-committee subject areas, plus Treasury/Stats NZ standard classification families) — see `docs/SOURCE-TAXONOMY.md` §2.2, which is deliberately a reasonably complete starting point, not a blank slate. After launch, the domain structure is **refined claim-derived**: clustering the live claim corpus reveals where the seed taxonomy under-splits (new sub-areas emerging as claim clusters) or over-splits (dormant domains), and maintainer decision records adjust the structure accordingly. If a community believes a domain is missing, the actionable proposal is either (a) a source proposal that surfaces those claims, or (b) a claim submission (ADR-0002 lane 5) — the domain structure follows the claims, refined analytically, never negotiated proposal-by-proposal.

### The vetting gate (proposals are consideration, not adoption)

- **Automated scope check first**: for claim sources, the pipeline probes the submitted URL with the same tooling that built `docs/COVERAGE.md` (feed discoverable? bot-protected? JS-only? last-updated?). For authorities, it checks the dataset is actually machine-accessible. The proposer sees the probe result — many proposals die or self-correct here, cheaply.
- **Maintainer decision record**: maintainers accept or reject, with the decision and its reasons recorded publicly (a decision-record entry per proposal — no fixed review window; a decision may be made as soon as the scope-check and the maintainers' assessment allow). Classification work (matrix placement, tier assignment) happens as part of this decision, by the project. Authority-tier assignments above T4 additionally require a subject-matter review (the standing invite to statistics/domain experts noted in the taxonomy §3).
- **Rejections are public and reasoned** — same principle as contest rejections (ADR-0005). A rejected proposal with its reason is itself part of the audit trail.

### What public proposals can and cannot do

| Can | Cannot |
|---|---|
| Add outlets to the claim-source coverage matrix | Change a verdict's weighting by source |
| Add datasets to the authority map (with review) | Auto-assign authority tiers or self-classify tier |
| Flag coverage gaps the monthly audit missed | Define or add policy domains (derived from claims, not proposals) |
| Provide narrative justification that informs review | Bypass the paywall/TPM policy (ADR-0002) — proposed circumvention routes are rejected on sight |

### Placement in the system

- Pre-launch (now): proposals via GitHub issues against this repo, using proposal templates (two templates, one per type).
- At launch: a "Suggest a source or authority" form alongside claim submission (ADR-0002 lane 5), feeding the same pipeline. Claim-source proposals that pass scope-check enter the *ingestion candidate list*; actual ingestion still obeys the parked ingestion-architecture ADR (health checks, parsers, rate limits — a proposed source is not ingested until it passes onboarding).
- **Provenance**: every community-added source or authority is labelled in the taxonomy ("added by public proposal, reviewed YYYY-MM-DD") — provenance of the map is part of the audit trail.

## Alternatives considered

- **Fully automatic adoption** (proposal passes scope-check → ingested). Rejected: the poisoning vector is unacceptable for evidence authorities; scope-check alone cannot judge institutional authority.
- **No public pathway** (maintainers-only, informed by coverage audits). Rejected: recreates exactly the closed-curation problem the project criticises, and wastes the public's local knowledge (community media, iwi radio, regional titles — the matrix cells maintainers are weakest on).
- **Community vote on proposals**. Rejected for v1: no rater base (same cold-start reason as ADR-0005), and authority is a factual question (institutional role), not a popularity question. Revisit post-election alongside bridging.
- **Proposer-classified matrix placement and tiers** (the original design). **Rejected after review**: classification is project analysis, not public burden — a proposer describing an outlet in their own words is reliable input; a proposer self-assessing "T2 authority" or "fills the provincial cell" is noise the review then has to un-do. Domain proposals (also in the original design) were dropped entirely: domain groupings are derivable from the claim corpus, so accepting proposals there added a contested adjudication surface with no informational gain.

## Consequences

- Two proposal templates + a scope-check probe runner are added to the build backlog (small: reuses COVERAGE.md tooling).
- The taxonomy doc gains a change-history section (proposal provenance).
- Expected proposal volume is modest; if it spikes adversarially during the campaign, proposals queue visibly (same policy as contest queueing, ADR-0005).
- Coverage audits (taxonomy §1.3) now have a second input: community proposals pointing at gaps the audits didn't detect.
- **Domain taxonomy is seeded, then claim-refined**: the starting domain set comes from established NZ policy groupings (select-committee subject areas + standard classification families — `docs/SOURCE-TAXONOMY.md` §2.2); live claim clustering then reveals under-splits and dormant domains, adjusted via maintainer decision records. New policy emphases surface as claim clusters against the seed taxonomy.

## Templates

Pre-launch proposal intake uses two GitHub issue templates in this repo:

- `.github/ISSUE_TEMPLATE/source-proposal.md` — claim-source proposals
- `.github/ISSUE_TEMPLATE/authority-proposal.md` — evidence-authority proposals

Both are deliberately lightweight: free-text narrative in the proposer's own words; classification (matrix placement, trust tier) is done by the project during review.