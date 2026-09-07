# ADR-0002: Ingestion scope for the 2026 cycle — releases, Hansard, news RSS; no broadcast, no social

*Status: Proposed · Date: 2026-09-07 · Deciders: Bradley, Dave*

## Context

We are inside the regulated period (7 Aug 2026) with roughly eight weeks to a working system. Ingestion is where scope creep most naturally happens: Parliament TV transcription, social-platform monitoring, podcast capture are all buildable but none are essential.

## Decision

Five ingestion lanes for 2026:

1. **Beehive.govt.nz** releases + speeches (official RSS) — the primary lane.
2. **Party press-release pages** (scraped on schedule; Scoop.co.nz as aggregator backstop).
3. **Hansard** (official daily transcripts).
4. **News RSS** (NZ Herald, RNZ, Stuff) — context and claim-source lane.
5. **User-submitted content** — the public can submit a URL (news article, press release, social media post) or pasted text claiming it needs checking, optionally quoting the specific claim.

**Submission rules (part of this ADR):**

- **Fetch-from-source rule:** the pipeline never verifies from the submission's own rendering. Submitted URLs are re-retrieved server-side (direct fetch; oEmbed for social posts; archive.today/Wayback fallback for deleted or geo-blocked content). Pasted text is accepted only as a pointer; the source must be retrievable for a verdict to publish. Screenshots are OCR-assisted but insufficient on their own.
- **Priority signal:** a public submission bumps the claim's position in the verification queue — the crowd's attention substitutes for part of the check-worthiness ranking. Duplicate submissions of the same claim increment the same queue entry.
- **Guardrails:** email-verified accounts, per-account rate limits, the claims-not-persons standard applies to submission text (ADR-0006), and submissions are hosted communications under the HDCA content-host process (`docs/LEGAL-COMPLIANCE.md` §4).
- **What a submission is not:** it is not evidence. It is a *claim pointer*. Evidence comes from what the pipeline retrieves from the source, plus what users submit through the contest pathway (ADR-0005).

**Explicitly deferred:** Parliament TV/broadcast transcription (whisper self-hosting is a time sink; Hansard covers the chamber), **proactive social-platform crawling** (API gating and cost; user submissions cover the highest-value social claims without it).

Press releases are prioritised because they pair **policy proposition + claimed evidence** in one self-published package — enabling citation checking and the statistical-claim engine (ADR-0004) against primary sources.

## Alternatives considered

- **Full Fact AI licence instead of building ingestion.** Rejected: closed core pipeline, dependency on a UK charity's roadmap and pricing, and NZ-source onboarding unknown; revisit only if our own pipeline fails its published accuracy bar.
- **Parliament TV + whisper.** Deferred post-election; the GPU time and operational load aren't justified when Hansard exists as official text.
- **Proactive social-platform crawling (firehose).** Excluded: cost, platform gating, and the moderation/legal surface it opens (HDCA) outweigh the claim value for v1. **User submissions partially fill this gap** — the public points at the social posts worth checking, and the pipeline fetches them from source (see Submission rules above) — without us operating a crawler.

## Consequences

- Week-1 deliverable is achievable with RSS + simple scrapers.
- Claims made on broadcast (TV/radio/podcasts) but never in releases, Hansard, or news are out of coverage — acknowledged and stated in the methodology. User submissions narrow, but do not close, this gap (a submitted link to broadcast content can be checked if a transcript or report exists; live audio itself still needs the deferred transcription capability).
- The submission feature adds the first user-facing moderation surface; rate limits and the HDCA process must ship with it, not after it.