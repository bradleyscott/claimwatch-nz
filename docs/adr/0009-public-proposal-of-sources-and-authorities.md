# ADR-0009: Public proposal of claim sources and evidence authorities

*Status: Proposed · Date: 2026-09-07 · Deciders: Bradley, Dave*

## Context

`docs/SOURCE-TAXONOMY.md` defines the claim-source coverage matrix and the evidence-authority map, both maintained by the project. Two problems with pure maintainer curation:

1. **Coverage blind spots**: maintainers will not know about provincial, community, or niche outlets that matter to specific communities; the public will. Source gaps discovered after the campaign peak are expensive.
2. **Legitimacy**: an authority map curated in private is exactly the kind of editorial power the project's open-scrutiny model tries to avoid. If the map says "Stats NZ is the authority on employment", a member of the public should be able to propose additions — and see how the decision was made.

The risk that must be designed against: **poisoning**. "Suggest a source" is an open door for partisan actors proposing advocacy outlets as trusted authorities, or proposing flood-of-noise sources to skew the claim corpus. The mechanism must let the public shape *consideration*, not control *adoption*.

## Decision

A **public proposal pathway** with three proposal types, one intake, and a vetting gate:

### Proposal types

1. **Claim-source proposal** — "this outlet/publication should be monitored." Submit: outlet name, URL(s), what coverage dimension it fills (the taxonomy matrix dimensions are offered as checkboxes), where its content is machine-accessible (feed URL if known).
2. **Evidence-authority proposal** — "this institution/dataset should be a trusted authority for domain X." Submit: institution, dataset/series name, URL, proposed authority tier (T1–T6 per the taxonomy), the policy domain, and a justification stating why it is authoritative (statutory role, methodology publication, revision policy).
3. **Domain/topic addition** — "this policy domain is missing from the authority map." Submit: domain, why it will matter this election, candidate authorities.

### The vetting gate (proposals are consideration, not adoption)

- **Automated scope check first**: for claim sources, the pipeline probes the submitted URL with the same tooling that built `docs/COVERAGE.md` (feed discoverable? bot-protected? JS-only? last-updated?). For authorities, it checks the dataset is actually machine-accessible and the tier assignment is plausible. The proposer sees the probe result — many proposals die or self-correct here, cheaply.
- **Public review period**: accepted-for-review proposals are published on the site (and as GitHub issues pre-launch) for **14 days** with the scope-check results visible.
- **Maintainer decision, in public**: maintainers accept or reject with published reasons. Authority-tier assignments above T4 additionally require a subject-matter review (the same standing invite to statistics/domain experts noted in the taxonomy §3).
- **Rejections are public and reasoned** — same principle as contest rejections (ADR-0005). A rejected proposal with its reason is itself part of the audit trail.

### What public proposals can and cannot do

| Can | Cannot |
|---|---|
| Add outlets to the claim-source coverage matrix | Change a verdict's weighting by source |
| Add datasets to the authority map (with review) | Auto-assign authority tiers |
| Flag coverage gaps the monthly audit missed | Reopen a published verdict by flooding proposals |
| Propose topic domains | Bypass the paywall/TPM policy (ADR-0002) — proposed circumvention routes are rejected on sight |

### Placement in the system

- Pre-launch (now): proposals via GitHub issues against this repo, using proposal templates (three templates, one per type).
- At launch: a "Suggest a source or authority" form alongside claim submission (ADR-0002 lane 5), feeding the same pipeline. Claim-source proposals that pass scope-check enter the *ingestion candidate list*; actual ingestion still obeys the parked ingestion-architecture ADR (health checks, parsers, rate limits — a proposed source is not ingested until it passes onboarding).
- **Provenance**: every community-added source or authority is labelled in the taxonomy ("added by public proposal, reviewed YYYY-MM-DD") — provenance of the map is part of the audit trail.

## Alternatives considered

- **Fully automatic adoption** (proposal passes scope-check → ingested). Rejected: the poisoning vector is unacceptable for evidence authorities; scope-check alone cannot judge institutional authority.
- **No public pathway** (maintainers-only, informed by coverage audits). Rejected: recreates exactly the closed-curation problem the project criticises, and wastes the public's local knowledge (community media, iwi radio, regional titles — the matrix cells maintainers are weakest on).
- **Community vote on proposals**. Rejected for v1: no rater base (same cold-start reason as ADR-0005), and authority is a factual question (institutional role), not a popularity question. Revisit post-election alongside bridging.

## Consequences

- Three proposal templates + a scope-check probe runner are added to the build backlog (small: reuses COVERAGE.md tooling).
- The taxonomy doc gains a change-history section (proposal provenance).
- Expected proposal volume is modest; if it spikes adversarially during the campaign, proposals queue visibly (same policy as contest queueing, ADR-0005).
- Coverage audits (taxonomy §1.3) now have a second input: community proposals pointing at gaps the audits didn't detect.
- Authority-map entries proposed by the public get subject-matter review above T4 — this keeps "public suggestions" from becoming "public-authored truth criteria" while still letting the public nominate candidates.

## Templates

Pre-launch proposal intake uses three GitHub issue templates in this repo:

- `.github/ISSUE_TEMPLATE/source-proposal.md` — claim-source proposals
- `.github/ISSUE_TEMPLATE/authority-proposal.md` — evidence-authority proposals
- `.github/ISSUE_TEMPLATE/domain-proposal.md` — policy-domain additions