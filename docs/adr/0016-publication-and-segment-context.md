# ADR-0016: Publication record and segment context — the document hierarchy around claims

*Status: Proposed · Date: 2026-09-08 · Deciders: Bradley, Dave*

## Context

ADR-0015 gave every claim a **discourse window** (±300 words, preceding turn, venue metadata). Review raised a structural point: a claim's context is not one flat span — it is **a hierarchy of documents**, and the current design implicitly collapses them. A claim from an interview belongs to: (1) a **publication** — the whole podcast episode / press release / article / broadcast segment, with its own publisher, date, programme, URL, and (for audio) a summary of the whole transcription; (2) a **portion** of that publication — the particular interview question and its complete set of answers, or the section of a policy announcement the claim relates to. Both levels are context, and they are distinct from each other and from the window.

This matters concretely: the same statistic quoted in a routine weekly briefing vs in a campaign-launch release is interpreted differently *at the publication level* (occasion, audience, purpose); and within one long interview, a claim belongs to a specific question's segment — the question asked three minutes earlier is context, while a later unrelated answer is not. The discourse window (ADR-0015) captures the immediately surrounding text; it cannot express "this was the third answer to the host's housing question, in an episode otherwise about tax" — that requires the publication and segment layers.

This ADR defines the document hierarchy and how its three levels (publication → segment → claim, with the window attached to the claim) work together.

## Decision

**Two context levels above the claim, stored as first-class records: `publication` (1-to-many to claims) and `segment` (1-to-many to claims), with the ADR-0015 discourse window attached at claim level. Three levels, each answering a different question: what occasion produced this? — what was the relevant part of it? — what did the speaker say here?**

### 1. The publication record (1-to-many: publication → claims)

One row per ingested document, created at ingestion (ADR-0011's normalise stage), carrying:

- **Provenance (already specced)**: source ID, canonical URL, retrieval timestamp/method, content hash.
- **Publisher metadata**: publisher name, publisher type (broadcaster / party / ministry / outlet / independent), and the claimant-entity link where the publication is itself the principal (a party release belongs to the party entity, per ADR-0010).
- **Publication metadata**: type (podcast episode / press release / news article / broadcast segment / Hansard debate / social post), title/headline, publication date (+ event date where they differ — broadcast date vs publication date), authors/speakers, duration or word count, programme/section ("Heather du Plessis-Allan Drive", "Morning Report", election-pledges section).
- **Whole-document summary** (LLM-generated, batch-priced, Flash-class): a 2–5 sentence neutral summary of what the publication as a whole is and does — "A 24-minute interview segment in which the Opposition leader discusses housing policy, prompted by questions on the weekly poll; three policy positions stated" — plus the document's overall topic tags. Generated once per publication, reused by every claim from it.
- **For broadcast (ADR-0014)**: transcript tier (publisher-reviewed / auto), transcript provenance, and the full transcript text stored once at publication level (claims reference into it — the utterance text is not duplicated per claim).

The publication record is the **unit of dedupe's document level, health checking, and reprocessing** — all already specced in ADR-0011 — and is now also the unit of whole-document context. It is published (part of the public store) and contestable like everything else.

### 2. The segment record (1-to-many: segment → claims; many-to-1 to publication)

A **segment** is the relevant portion of a publication: one interview question and its complete answers; one section of a policy announcement; one debate exchange; one article's thematic block. Created during extraction, carrying:

- **Span** into the publication (timecode range for audio/video per ADR-0014's media_anchor; section/text range for documents).
- **Segment summary** (LLM-generated): what this portion is about — "the host asks about superannuation costs; the minister disputes the Opposition's figures and restates the indexation policy" — a bounded, factual description of the exchange.
- **Turn structure** where present: the question (which publication content constitutes "the question") and the ordered answers.
- The segment summary is **descriptive, not interpretive**: it says what was discussed, not what the speaker meant. Interpretation lives in ADR-0015's structured fields.

### 3. How the three levels relate (and where ADR-0015's window sits)

The three levels answer different questions and are all attached to the claim:

```
publication (1) ──< segment (n) ──< claim (n) ── discourse window (1, span)
```

- **Publication** answers *"what was this occasion?"* — the full-context frame: what programme, what document, who published it, when, and what the whole thing covered. Relevant to interpretation because a statistic's meaning differs between a data-release briefing and a campaign rally — and that difference lives at this level.
- **Segment** answers *"what was the relevant part of the occasion?"* — the question-and-answer unit or section the claim belongs to. In a 40-minute interview, the claim's context is not the whole episode; it's the housing Q&A block. The segment summary records what was asked and the full set of responses — including other answers the speaker gave, which often carry the qualifying context ADR-0015's window alone would miss.
- **Discourse window** (ADR-0015, unchanged) answers *"what did the speaker say immediately around the claim?"* — the fine-grained span: the sentence's containing paragraphs, the prompt turn, the speaker's own qualifiers.

They compose rather than compete: **publication = the whole occasion, segment = the relevant portion, window = the immediate span**. A verdict page can show all three — "in a Morning Report interview (publication) responding to the host's question about hospital waitlists (segment), the Minister said… (window)". Each level's summary is stored once and referenced, not regenerated per claim.

### 4. How each level feeds verification — with on-demand access to all levels

The verification loop treats context as **available on demand at all three levels, up to and including the full publication**: the claim's immediate window and the segment summary are included by default (cheap, pre-computed); but the loop may pull **deeper into any level when it judges it needed** — the full transcript, the whole document, the whole episode. This is the same principle as the retrieval loop itself (ADR-0011): the model decides whether its current evidence suffices, and asks for more when it doesn't.

- **Default context pack (automatic, every verification)**: claim + discourse window + segment summary + publication summary + publication metadata. This is the standard conditioning input — bounded, cached, and batch-priced.
- **On-demand expansion (the loop requests it)**: when the default pack leaves a question open, the loop can request (1) the **full segment content** (the whole Q&A exchange, verbatim), (2) the **full publication** (whole transcript or whole document text), (3) **adjacent segments** in the same publication (e.g. the speaker's earlier answer on the same topic). The request is logged with its reason (structured output), so the audit trail shows not just what context was used but *why* the loop went looking.
- **The long-context economics work**: broadcast transcripts are the large case — a full Morning Report transcript is ~10–20k words (~15–30k tokens); modern verdict-role models (ADR-0007 routing) handle that context comfortably, and the loop only pays for it when it fetches. Most claims resolve from the default pack; full-document pulls are the exception the loop escalates to.
- **What the loop never gets**: the claimant's identity (the ADR-0010 firewall is absolute — no reliability profiles, party platform, or speaker history in the verification context, even on demand) and anything from other publications beyond what retrieval legitimately brings (the loop's open-web retrieval remains the cross-publication instrument; context records are intra-publication only).
- **Statistical mode note**: the fingerprint/grid computation is unaffected (it runs on the fingerprint and official series); deeper context pulls mainly serve interpretation (what was the speaker's deployment) and the open-web/citation modes.

Per-level detail:

- **Publication level**: venue/occasion (already an ADR-0015 field, now sourced from the publication record rather than re-derived per claim — `speech_context` becomes a publication field); publication date anchors temporal reasoning (a claim about "last year" is fingerprinted against the publication's event date); publisher type informs the evidence-authority emphasis (a ministry release claims against its own data differently than a party page).
- **Segment level**: the question text seeds question-generation for the open-web loop (the claim was an *answer* — what was asked shapes what is being asserted); the segment summary gives the verification loop its scoping ("this claim is one of three answers on housing in this segment"); debate exchanges carry the `responds-to` relationship naturally (ADR-0010).
- **Claim/window level**: unchanged from ADR-0015 — the fine-grained stance and qualifier extraction runs over the window, with the segment and publication summaries as additional conditioning context for that extraction.

### 5. Cost and mechanics

The publication and segment summaries are **one-time LLM work per document/segment, not per claim** — batch-priced (ADR-0007), cached on the publication record, and reused by every claim the document yields. A release producing 15 claims pays for one publication summary; a podcast segment producing 8 claims pays for one segment summary. The summary generation is part of the extraction ladder's Tier-1 flow (deterministic segmentation + a summarisation call), with failures alerting per ADR-0011's health model. Segments are created only where the publication has detectable structure (turns, sections); an unstructured short article has publication + window and no segment record.

## Alternatives considered

- **Window-only (ADR-0015 as-is, no publication/segment records).** Rejected: collapses three distinct levels of context into one span; loses publisher/occasion metadata as a first-class record (it would be duplicated or dropped per-claim); loses segment structure that turn-structured sources carry natively.
- **Publication-level context only.** Rejected: too coarse — the relevant portion of a 40-minute interview is not the whole episode; a whole-document summary alone would mislead (a claim's meaning is not the episode's theme).
- **Store context per-claim only (duplicating window text into context fields).** Rejected: the window is the claim-level context; segment and publication are *shared* context — one row, referenced many times. Duplication would fragment reprocessing (a publication summary regenerating per claim) and break the 1-to-many relationship Bradley specified.
- **Merging segment into window.** Rejected: they differ in kind — the window is *verbatim surrounding text* (quotable, auditable); the segment summary is a *generated description of a larger span* (navigational). Blurring them would either bloat the window or force the summary to carry interpretive weight it shouldn't.

## Relation to claim normalisation and ClaimBuster (the question this ADR answers)

**Claim normalization** (CheckThat! 2025; Sundriyal et al. 2023): given a noisy in-context utterance (typically a social media post, but the operation generalises), produce a **concise, standalone, verifiable statement** that captures the core factual assertion. Its purpose: the verification loop (and repeat-matching) needs an atomic, deictic-free claim — "crime up 30% since 2017" — but the source utterance is context-laden. Normalization is the **lossless-as-possible projection from utterance+context → atomic claim**: it resolves references ("that figure" → "the 55,000 net-migration figure"), strips discourse-dependent deixis ("under this government" → named government or dropped with the loss recorded), and preserves the assertion's meaning. Its known hazard (measured in the decomposition literature, ADR-0015's evidence base) is **omission of context** — the normalized form can silently drop qualifiers or logical links that change the claim's meaning. **In our pipeline, normalisation is the operation that produces the claim's `text` field from the utterance within the window — and the window/segment/publication context is precisely what makes that projection checkable**: the stored context levels are the reference against which "did normalisation preserve meaning?" can be audited (and contested, like everything else). The normalized claim is never the *only* record — the utterance, window, segment, and publication all remain, so a reader can always see what was actually said and where.

**ClaimBuster** (Hassan et al., KDD 2017 / VLDB 2017): the first end-to-end automated fact-checking *triage* system — sentence-level check-worthiness scoring. Its pipeline: ingest streams (broadcast closed-captions, websites, social) → **claim spotting**: score each sentence for check-worthiness with a supervised model (features: TF-IDF bag-of-words, POS patterns, named entities, sentence structure) → rank → for the top sentences, retrieve evidence (web search for matching pages, Wolfram Alpha for computables, prior verdicts from a ClaimReview database) → present to human fact-checkers with **a context affordance: the four preceding sentences** ("we observe that about 14% of the time, participants chose to read the context before labeling"). Its architecture validated the whole approach we've adopted — automated check-worthiness triage feeding human/automated verification — but its context handling is exactly what ADR-0015/0016 improve on: **a fixed four-sentence window, generated on demand for a human labeler, not a stored, structured, multi-level context model**. Our design keeps ClaimBuster's core insight (rank sentences by check-worthiness before spending verification cost — our LLM triage is the successor) and replaces its ad-hoc context peek with the publication→segment→window hierarchy, where context is persisted data that also informs the machine verification, not just the human reviewer.

## Consequences

- **Ingestion schema gains `publication` and `segment` tables** (Drizzle, ADR-0013) — publication created at normalise, segments created at extraction where structure exists; claims carry `publication_id` + `segment_id?` FKs alongside the ADR-0015 window.
- **Two summary generations per document** (publication summary, segment summaries) — batch-priced, one-time, reused by all claims from the document; the incremental cost per claim is a FK reference, not an LLM call.
- **Verdict pages render the context stack**: publication (name, publisher, date, link, whole-document summary) → segment (what this portion was, the question, the full set of answers) → the claim with its window and "hear it/watch it" anchor. This is the fuller picture rendered as navigation, not prose.
- **ADR-0015's context extraction conditions on segment + publication summaries** (they bound the interpretation), while the window remains the quotable auditable artefact.
- **The harness gains context-level fields per label** (publication venue, segment presence) — enabling the ablation to measure which level of context actually moves verdict quality.
- **Reprocessing operates at all three levels** (ADR-0011): a re-summarised publication or segment regenerates without touching claim extraction; extraction reprocesses against stored summaries.