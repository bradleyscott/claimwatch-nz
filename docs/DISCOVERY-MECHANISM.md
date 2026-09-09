# Discovery mechanism — how users find the information they want on the site

*Companion note to WEBSITE-UX-RESEARCH.md. Covers the findability layer: how a user gets from "I have a question" to "here is the verdict and its evidence".*

## The discovery problem, stated plainly

A fact-check site's content is only as valuable as it is findable. Users arrive in three distinct modes, and the discovery mechanism must serve all three:

1. **Verification mode** — "I just heard X said Y — is it true?" (high intent, narrow query, often via Google/social share)
2. **Browse mode** — "What's new / what should I be outraged or reassured about today?" (low intent, feed-driven, the habit loop)
3. **Research mode** — "What is the record on immigration claims this campaign?" (durable intent, entity or topic-scoped, journalists/students/engaged citizens)

## The mechanisms, mapped to our architecture

### 1. External search is the front door — ClaimReview markup gets us surfaced

The single most important discovery channel is **other people's search boxes**. Every verdict page carries **ClaimReview JSON-LD** (already specced): claim text, claimant, date, our rating, and the URL. This makes each claim card eligible for:

- **Google Search rich results** — when someone searches a claim ("immigration rate NZ 2026"), the fact-check rich result can render directly in the SERP with claimant + rating, before the user ever reaches our site
- **Google Fact Check Explorer** — all our ClaimReview-marked verdicts are indexed and searchable there by default
- **Facebook/YouTube third-party fact-checking surfaces** (if eligible) and any platform consuming ClaimReview

**Design implication:** the claim page must be server-rendered (Next.js SSR — already chosen in ADR-0014) with the ClaimReview block in initial HTML, not client-injected. Verdict pages get canonical URLs and stable slugs. This is a hard build requirement, not a nice-to-have.

### 2. Faceted browse — the structured spine

Our store is *structured by design* (claim → claimant → party → topic → verdict → confidence → publication), which means the faceted browse that other sites fake with tags comes free from the data model:

- **By person** (`/people/[slug]`) — every claim made by that person, verdict distribution, timeline
- **By party** (`/parties/[slug]`) — aggregate view, manifesto vs verified-record claims
- **By institution** (`/organisations/[slug]`) — think tanks/lobbies/unions per ADR-0018
- **By topic/policy domain** (`/topics/[slug]`) — the 14 SOURCE-TAXONOMY domains: housing, immigration, health, education, climate, etc.
- **By verdict** (`/verdicts/refuted`, `/verdicts/accurate-but-incomplete`) — the "show me what was wrong" view, which is what most visitors actually want to see
- **By publication** (`/publications/[slug]`) — every claim from a given Beehive release, debate transcript, or podcast episode (ADR-0016's hierarchy pays off here — one publication's claims form a natural reading group)
- **By date** — a date-scoped view (campaign week N, debate night, budget day)

Filters compose: `topic=immigration AND verdict=refuted AND person=...`. This is a single Postgres query away (ADR-0014's store), not a search-engine integration problem.

### 3. Full-text + semantic search — the answer box

A site search box in the header, doing two things:

- **Exact/keyword search** — Postgres full-text (pg_trgm + tsvector) over claim text, plain-language verdicts, and evidence-pack text. Fast, cheap, precise for quoted phrases.
- **Semantic search** — pgvector embeddings over claim text + verdict summaries, so "do politicians overstate crime stats?" retrieves cherry-picking verdicts about crime numbers even without keyword overlap. The same embedding infrastructure already exists in the verification pipeline (ADR-0010's evidence retrieval) — the site search reuses the model, not the store.

**The search results page is a claim-card grid**, not a document list — every hit renders with its verdict badge visible, so scanning results *is* scanning answers.

**Special case — the "quote check":** pasting a quote or a claim's distinctive phrase ("gang members on the benefit") should hit a **claim-text index tuned for verbatim matching** (trigram + normalised), because users frequently paste what they think a politician said. When the pasted text matches a stored claim (exact or fuzzy), the results page offers the claim card directly rather than a list — a "did you mean this claim?" jump.

### 4. The feed and its algorithms — browse mode

The homepage is a chronological feed (newest verdicts first) with **editorial-free ranking**: recency, with pinned slots for high-significance claims. Ranked feeds (engagement-optimised) are explicitly rejected — they train users toward outrage and would compromise the claims-not-persons register. Feed composition:

- **New verdicts** (the bulk)
- **Verdicts mutated by contestation** — a "what changed" section, which is itself a trust signal
- **Recurring claims resurfacing** (Full Fact's insight: a debunked claim coming back is *more* newsworthy than a new one) — the store's claim-graph links (ADR-0010's corrections/repeat relationships) drive this automatically
- **Newsletter** — daily/weekly digest email generated from the same feed query; the cheapest habit-retention mechanism available and a distribution asset the business model can build on

### 5. Entity and topic hubs as landing pages

Each person/party/institution/topic page is both a destination (from search) and a browsing hub (from the nav). These are the pages that accrue SEO authority over a campaign — an entity page consolidates every claim by that person under one URL, which is exactly what a voter Googling "chris hipkins record on housing" wants to land on.

### 6. Related-claim navigation — the rabbit hole

Within a claim page, three kinds of links keep the engaged reader moving through the corpus:

- **Related claims by the same claimant on the same topic** (entity+topic intersection)
- **The argument chain this claim participates in** (ADR-0017) — "see the full argument" is the natural next click
- **Correction/successor claims** — if a politician later retracted or contradicted this claim, the link is displayed prominently (the claim graph does this work)

## What we deliberately don't build

- **No login/personalisation at launch** — no accounts, no saved-for-later, no follow-entity notifications. These are the retention features of a mature product, not a launch feature set; post-election-phase consideration only.
- **No engagement-ranked or algorithmic feed** — recency + significance only, as above.
- **No AI chat interface at launch** (Snopes' FactBot analogue) — a natural post-launch feature (RAG over the verdict corpus), but it needs the corpus to be complete first, and it adds a surface where errors compound. The search+facets+argument-chain stack covers the same need deterministically at launch.

## Summary

**Four discovery surfaces, one data model:** ClaimReview-marked SSR verdict pages for external search; faceted browse (person/party/institution/topic/verdict/publication/date) driven straight off the store; hybrid text+semantic site search with a paste-a-quote jump; and a recency-ranked feed with newsletter as the habit loop. Because the pipeline already produces the structured entities, verdicts, media anchors, and claim graph, none of this requires new data infrastructure — it's presentation-layer work on top of ADR-0010/0014/0016/0017's design.