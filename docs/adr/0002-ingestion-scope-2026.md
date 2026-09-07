# ADR-0002: Ingestion scope for the 2026 cycle — releases, Hansard, news RSS; no broadcast, no social

*Status: Proposed · Date: 2026-09-07 · Deciders: Bradley, Dave*

## Context

We are inside the regulated period (7 Aug 2026) with roughly eight weeks to a working system. Ingestion is where scope creep most naturally happens: Parliament TV transcription, social-platform monitoring, podcast capture are all buildable but none are essential.

## Decision

Four ingestion lanes for 2026:

1. **Beehive.govt.nz** releases + speeches (official RSS) — the primary lane.
2. **Party press-release pages** (scraped on schedule; Scoop.co.nz as aggregator backstop).
3. **Hansard** (official daily transcripts).
4. **News RSS** (NZ Herald, RNZ, Stuff) — context and claim-source lane.

**Explicitly deferred:** Parliament TV/broadcast transcription (whisper self-hosting is a time sink; Hansard covers the chamber), social-platform ingestion (API gating and cost; on-record material is better covered by lanes 1–3).

Press releases are prioritised because they pair **policy proposition + claimed evidence** in one self-published package — enabling citation checking and the statistical-claim engine (ADR-0004) against primary sources.

## Alternatives considered

- **Full Fact AI licence instead of building ingestion.** Rejected: closed core pipeline, dependency on a UK charity's roadmap and pricing, and NZ-source onboarding unknown; revisit only if our own pipeline fails its published accuracy bar.
- **Parliament TV + whisper.** Deferred post-election; the GPU time and operational load aren't justified when Hansard exists as official text.
- **Social firehose.** Excluded: cost, platform gating, and the moderation/legal surface it opens (HDCA) outweigh the claim value for v1.

## Consequences

- Week-1 deliverable is achievable with RSS + simple scrapers.
- Claims made on broadcast/social but never in releases, Hansard, or news are out of coverage — acknowledged and stated in the methodology.