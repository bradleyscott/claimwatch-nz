# Discovery mechanism — how users find the information they want on the site

*Companion to `WEBSITE-UX-RESEARCH.md`. The findability layer: how a user gets from "I have a question" to "here is the verdict and its evidence".*

## The discovery problem

A fact-check site's content is only as valuable as it is findable. Users arrive in three modes, all served:

1. **Verification** — "I just heard X said Y — is it true?" (high intent, narrow query, often via Google/social share)
2. **Browse** — "What's new today?" (low intent, feed-driven, the habit loop)
3. **Research** — "What is the record on immigration claims this campaign?" (durable, entity/topic-scoped; journalists/students/engaged citizens)

## The mechanisms

### 1. External search is the front door — ClaimReview markup

The single most important discovery channel is **other people's search boxes**. Every verdict page carries **ClaimReview JSON-LD** (claim text, claimant, date, rating, URL), making each claim card eligible for Google Search rich results, **Google Fact Check Explorer**, and any platform consuming ClaimReview.

**Design implication:** verdict pages must be server-rendered (Next.js SSR — ADR-0014) with the ClaimReview block in initial HTML, canonical URLs, stable slugs. A hard build requirement, not a nice-to-have.

### 2. Faceted browse — the structured spine

The store is structured by design (claim → claimant → party → topic → verdict → confidence → publication), so the faceted browse other sites fake with tags comes free from the data model:

- **By person** (`/people/[slug]`) — every claim, verdict distribution, timeline
- **By party** (`/parties/[slug]`) — aggregate view, manifesto vs verified-record claims
- **By institution** (`/organisations/[slug]`) — think tanks/lobbies/unions per ADR-0018
- **By topic** (`/topics/[slug]`) — the SOURCE-TAXONOMY domains
- **By verdict** (`/verdicts/refuted`, `/verdicts/accurate-but-incomplete`) — the "show me what was wrong" view most visitors want
- **By publication** (`/publications/[slug]`) — every claim from one Beehive release, debate transcript, or podcast episode (ADR-0008's hierarchy pays off here)
- **By date** — campaign week N, debate night, budget day

Filters compose (`topic=immigration AND verdict=refuted AND person=...`) — a single Postgres query (ADR-0014), not a search-engine integration problem.

### 3. Full-text + semantic search — the answer box

A header search box doing two things:

- **Exact/keyword** — Postgres full-text (pg_trgm + tsvector) over claim text, verdicts, evidence-pack text. Fast, cheap, precise for quoted phrases.
- **Semantic** — pgvector embeddings over claim text + verdict summaries, so "do politicians overstate crime stats?" retrieves cherry-picking verdicts without keyword overlap. Reuses the verification pipeline's embedding model (ADR-0006's retrieval), not its store.

Results render as a **claim-card grid** — every hit shows its verdict badge, so scanning results *is* scanning answers.

**Special case — the "quote check":** pasting a quote ("gang members on the benefit") hits a claim-text index tuned for verbatim matching (trigram + normalised). When the paste matches a stored claim, the results page offers the claim card directly — a "did you mean this claim?" jump.

### 4. The feed — browse mode

Homepage = chronological feed (newest verdicts first), **editorial-free ranking**: recency, with pinned slots for high-significance claims. Engagement-ranked feeds are explicitly rejected — they train users toward outrage and would compromise the claims-not-persons register. Composition:

- **New verdicts** (the bulk)
- **Verdicts mutated by contestation** — a "what changed" section, itself a trust signal
- **Recurring claims resurfacing** (Full Fact's insight: a debunked claim coming back is *more* newsworthy than a new one) — driven automatically by the claim graph (ADR-0005's repeat relationships)
- **Newsletter** — daily/weekly digest from the same feed query; the cheapest habit-retention mechanism and a distribution asset the business model can build on

### 5. Entity and topic hubs as landing pages

Each person/party/institution/topic page is both a destination (from search) and a browsing hub (from nav) — and the pages that accrue SEO authority over a campaign. An entity page consolidates every claim by that person under one URL — exactly what a voter Googling "chris hipkins record on housing" wants to land on.

### 6. Related-claim navigation — the rabbit hole

Within a claim page, three link kinds keep the engaged reader moving:

- **Related claims by the same claimant on the same topic**
- **The argument chain this claim participates in** (ADR-0009) — "see the full argument" is the natural next click
- **Correction/successor claims** — if the claim was later retracted or contradicted, displayed prominently (the claim graph does this work)

## What we deliberately don't build

- **No login/personalisation at launch** — no accounts for reading, saved-for-later, or follow-entity notifications; post-election-phase consideration.
- **No engagement-ranked feed** — recency + significance only.
- **No AI chat at launch** — a natural post-launch feature (RAG over the verdict corpus) but it needs the corpus complete first and adds a surface where errors compound; the search+facets+argument-chain stack covers the same need deterministically.

## Summary

**Four discovery surfaces, one data model:** ClaimReview-marked SSR verdict pages; faceted browse off the store; hybrid text+semantic search with a paste-a-quote jump; a recency-ranked feed with newsletter. The pipeline already produces the structured entities, verdicts, media anchors, and claim graph — all of this is presentation-layer work on top of ADR-0008/0009/0010/0014's design.