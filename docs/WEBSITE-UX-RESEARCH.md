# Website UX research — what famous fact-check sites do, and how ours should present the analysis

*Companion research note for ADR-0016 (publication/segment context) and the site build. Sources: live pages of PolitiFact, Full Fact, Snopes, FactCheck.org, plus secondary coverage, September 2026.*

## What the famous sites actually let users do

**PolitiFact** — the most imitated fact-check UI in the world:
- **Truth-O-Meter graphic per claim** — a six-point visual meter (True → Pants on Fire) that renders the verdict as an image users can share, embed, and recognise at a glance. The meter is the brand; a large share of traffic arrives from the meter graphic being quoted in news articles and social posts.
- **Claim cards in the feed**: quote → who said it → where/when stated → rating → short verdict summary. Each card is self-contained and quotable.
- **Per-person scorecards**: every politician gets a page aggregating their rated statements (the "Truth-O-Meter scoreboard"), which turns individual verdicts into a *track record*. This is the stickiest feature — people return to check "what's this person's overall record?" not just one claim.
- **Live debate fact-checking** — a running feed during major debates, published in real time.
- **Promise tracker / Obameter lineage** — rating whether campaign pledges were kept, a separate product from statement checking.
- **Reader suggestions** — email intake for claims to check; editorially selected.
- **Methodology transparency** — the Principles page is linked from everywhere; every fact-check names the author(s).

**Full Fact** (UK) — the closest structural cousin to ours:
- **Fact-check feed organised by topic** (politics / health / immigration / economy / world) with plain-language headline + one-sentence dekko per item — no meter at all; the headline *is* the verdict ("Times figures for data centres' use of water don't reflect average daily demand").
- **"Quick checks"** — short-form verdicts for low-complexity claims, distinct from full reports. Two content lengths signal depth before you click.
- **Trend and "recurring claims" tracking** — Full Fact's reporting repeatedly highlights claims that *persist* ("false or misleading claims... keep coming back"), and their AI tools track the spread of specific narratives. The site surfaces when a debunked claim resurfaces.
- **Campaign/advocacy layer** — reports and policy recommendations aimed at decision-makers, separate from the reader-facing feed.
- **Newsletter** as a primary distribution channel (weekly email roundups per topic).
- **Tools**: browser extension and real-time alerts for newsrooms — B2B products alongside the public site.

**Snopes** — the oldest, and the one that learned hardest about *scale of claim variety*:
- **Rich, iconic rating taxonomy** — not just true/false: True, Mostly True, Mixture, Mostly False, False, **Miscaptioned** (real image, false context — their most-used rating for image claims), **Incorrect Attribution**, Outdated, Scam, Legit, Labeled Satire, plus retired ratings documented transparently (Unproven, Unfounded, Research In Progress — they *retired* these and now write "what is unknown" in bullets at the top of the article instead of a rating).
- **Claim-statement precision** — the exact claim wording is displayed above the rating, and the rating applies to *that wording*; users learn that changing a claim's phrasing changes its verdict. (This is the same principle as our claim-normalisation rule: rate the specific assertion, not the topic.)
- **Key points bulleted at top** — a "TL;DR" of what's known/unknown before the long analysis. Snopes learned that readers won't scroll for the answer.
- **App + FactBot** — ask-a-question AI chat over their archive, crossword, True/False game — gamification to build habit.
- **Ratings-next-to-headlines toggle** — browse the archive with rating icons visible inline.
- **Membership** (ad-free paid tier) is their revenue model.

**FactCheck.org** — the most journalistically conservative:
- **No ratings at all** — long-form articles with hyperlinked source material throughout; the argument *is* the verdict.
- **Ask FactCheck / Ask SciCheck** — reader questions answered as published articles.
- **VidCheck** — video-specific fact-checks.
- Deep commitment to showing the research trail in-line: every claim in the article is linked to its source.

## What this tells us about user behaviour

1. **The verdict must be visible without scrolling** — every successful site puts the answer at the top of the page (meter graphic, headline-as-verdict, or bulleted key points). Readers arrive from search/social with one question: *is this true?*
2. **The shareable verdict artefact matters more than the article** — PolitiFact's meter and Snopes' icons circulate far beyond the site. The verdict needs to exist as a standalone, embeddable, quotable object.
3. **Track records beat one-off verdicts for retention** — scorecards and entity pages give users a reason to return during a campaign; a feed alone does not.
4. **Two content lengths** — full analysis + quick check — matches how claims vary in complexity and keeps the feed lively.
5. **"Miscaptioned"/false-context is a first-class verdict type** for a social-media-heavy audience — Snopes uses it constantly.
6. **Show your work, but after the answer** — key points first, then the analysis with linked sources.
7. **Games/newsletters/apps** build habit, but are secondary to the core loop: claim → verdict → evidence.

## How ClaimWatch NZ should present the analysis

Our differentiators vs. the famous sites: **fully automated verdicts, contestable, with machine-checkable evidence packs** — none of the established sites can do this (they're limited by human throughput to ~2–10 fact-checks/day; we'll produce orders of magnitude more). The site should make that scale *visible* — it's the entertainment hook.

### Page 1: The claim card (the atom of the site)
Every claim gets a card modelled on the PolitiFact feed item but *richer* because we have structured data:
- **Verdict up top** — one of our four classes (Supported / Refuted / Not Enough Evidence / Accurate but incomplete) + confidence, rendered as a clean visual mark (a coloured band or glyph, not a smiley meter — we're NZ-serious, not US-quippy). "Accurate but incomplete" gets its own visual treatment distinct from plain Supported — that's the most interesting verdict and the one that teaches media literacy.
- **The claim, verbatim, attributed** — quote + who said it + where (linked to the publication/segment record from ADR-0016: the Beehive release, the RNZ interview at minute 14, the YouTube clip with a "hear it" button deep-linked to the audio timestamp).
- **One-sentence plain-language verdict** ("Immigration numbers are up 40%, but from the pre-pandemic baseline, not last year — the rise is real but the comparison chosen exaggerates it").
- **"As deployed" line** from ADR-0015 — what the claim was doing in its argument (supporting a policy proposal / attacking a record), shown as a small tag, not a paragraph.

### Page 2: The evidence pack (the "show your work" layer)
Expandable from the card; a full page for the engaged reader:
- **What we checked against** — the specific official series / documents, linked, with the authority tier (T1–T6) shown — this is our unique transparency feature: *the actual evidence authority and its provenance*, not just "experts say".
- **The reasoning** — the retrieval/verification narrative in plain language, with the confidence level and what would change it.
- **Contestation** — "Disagree? Here's how this verdict gets challenged" → links to the public contest form (ADR-0002). The contest status is displayed on the card (contested → under review → verdict mutated) — the *liveness* of contestation is itself a trust signal no static site offers.

### Page 3: The argument chain (from ADR-0017 — the entertainment layer)
This is what will make the site *fun* and shareable — nothing like it exists on PolitiFact/Snopes/Full Fact:
- Interactive graph of "the case for [policy proposal]" built from verified claims — the proposition node, supporting claims with their verdicts, load-bearing marks, and break marks where the chain fails.
- Rendered as a shareable graphic: "3 of 5 claims this argument rests on are Accurate but incomplete in ways material to the conclusion."
- Per-publication chains (one speech's argument) and cross-campaign chains (the campaign-long "case for X") as outlined in ADR-0017.

### Page 4: Entity pages (the scorecard layer — the retention driver)
- **Person pages**: every claim made by the person, verdict distribution over time, notable argument chains they deployed, corrections linked (claims they later retracted or had refuted), reliability profile.
- **Party pages**: same, plus manifesto claims vs. verified-record claims as the election approaches.
- **Institution pages** (ADR-0018): think tank / lobby / union — their reports' claims, verdict distribution, funding context linked (via Wikipedia/Democracy Project cross-links per ADR-0018).
- **Publisher pages**: which outlets' content carried the most refuted/incomplete claims — reported carefully as *claims carried*, not outlet verdicts, to stay within the claims-not-persons principle.

### Page 5: The live feed and debate tracker
- Homepage = chronological feed of new verdicts with claim cards, filterable by party/person/topic/verdict — this is the daily-check habit loop.
- **Debate-night live view** (from ADR-0014's broadcast lane): claims detected during the debate appear within minutes with provisional verdicts, confidence shown, updating as evidence accumulates — this is the "wow, it's automated" moment that earns the site its audience.

### Page 6: Methodology and accuracy (the trust foundation)
- Full methodology page: the four-verdict schema, how the grid works, what AVeriTeC alignment means, and — critically — **our measured accuracy published on a stats page** (live accuracy against the labelled dataset and contest outcomes). No major fact-checker publishes a live accuracy number; for an automated system it's both honest and a differentiator.
- Every verdict links to the specific pipeline version and prompt version used (ADR-0012's prompt-versioning carries through to the public page) — "this verdict was produced by pipeline vN; see the changelog."

## What to skip from the famous sites

- **No smiley Truth-O-Meter clone** — it's trademarked, US-connoted, and implies subjective judgment degrees we deliberately don't have (we show confidence separately).
- **No Snopes-scale rating taxonomy** — their 15+ ratings reflect their claim variety (scams, satire, miscaptions); we have four verdicts + pledge-not-yet-checkable by design. False-context/image-manipulation claims, if ingested, would need a verdict-language extension — flag for a later ADR, not for launch.
- **No reader claim submissions at launch** (PolitiFact/FactCheck.org model) — our pipeline auto-detects; submissions add moderation burden and the ADR-0009 proposal process covers source suggestions instead. Revisit post-launch.
- **No gamification at launch** (Snopes games/app) — the argument-chain view is our habit-forming feature; games would dilute the serious register.
- **No B2B newsroom tools at launch** (Full Fact's extension/alerts business) — the ClaimReview JSON-LD feed (already specced) gets our verdicts into Google's Fact Check Explorer and partner newsrooms without us building distribution infrastructure.

## The one-line summary

**Lead with the verdict, link every claim to its "hear it/watch it" moment, make the argument-chain view the shareable centrepiece, and publish our own accuracy live.** The famous sites' engagement comes from a memorable verdict artefact + track records + transparent method. We have all three *plus* two things they structurally can't offer: automation scale (hundreds of verdicts/day, live during debates) and contestability that visibly mutates verdicts — lean into both.