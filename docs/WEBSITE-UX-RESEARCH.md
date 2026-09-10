# Website UX research — what famous fact-check sites do, and how ours should present the analysis

*Companion research note for ADR-0008 (publication/segment context) and the site build. Sources: live pages of PolitiFact, Full Fact, Snopes, FactCheck.org, plus secondary coverage, September 2026.*

## What the famous sites actually let users do

**PolitiFact** — the most imitated fact-check UI in the world:
- **Truth-O-Meter graphic per claim** — a six-point visual meter (True → Pants on Fire) rendered as a shareable, embeddable, recognisable image. The meter is the brand; much traffic arrives from the graphic being quoted in news articles and social posts.
- **Claim cards**: quote → who said it → where/when → rating → short summary. Self-contained and quotable.
- **Per-person scorecards** — the stickiest feature: people return to check "what's this person's overall record?", not just one claim.
- **Live debate fact-checking** — a running feed during major debates.
- **Promise tracker / Obameter lineage** — pledge ratings, a separate product from statement checking.
- **Reader suggestions** — email intake, editorially selected.
- **Methodology transparency** — the Principles page is linked from everywhere; every fact-check names the author(s).

**Full Fact** (UK) — the closest structural cousin:
- **Feed organised by topic** with a plain-language headline that *is* the verdict ("Times figures for data centres' use of water don't reflect average daily demand") — no meter at all.
- **"Quick checks"** — short-form verdicts for low-complexity claims; two content lengths signal depth before you click.
- **Trend / recurring-claims tracking** — surfacing when a debunked claim resurfaces; their AI tools track narrative spread.
- **Campaign/advocacy layer** — reports aimed at decision-makers, separate from the reader feed.
- **Newsletter** as a primary distribution channel.
- **B2B tools** — browser extension, real-time newsroom alerts.

**Snopes** — the oldest, and the one that learned hardest about claim variety:
- **Rich rating taxonomy** — True, Mostly True, Mixture, Mostly False, False, **Miscaptioned** (their most-used rating for image claims), Incorrect Attribution, Outdated, Scam, Legit, Labeled Satire; retired ratings documented transparently (Unproven/Unfounded/Research In Progress were retired — they now write "what is unknown" in bullets instead).
- **Claim-statement precision** — the exact claim wording sits above the rating, and the rating applies to *that wording* (the same principle as our claim-normalisation rule: rate the specific assertion, not the topic).
- **Key points bulleted at top** — readers won't scroll for the answer.
- **App + FactBot** (ask-a-question AI chat), crossword, True/False game — gamification for habit.
- **Ratings-next-to-headlines toggle**; **membership** (ad-free paid tier) is the revenue model.

**FactCheck.org** — the most journalistically conservative: **no ratings** — long-form articles with hyperlinked sources; the argument *is* the verdict. Plus Ask FactCheck / Ask SciCheck and VidCheck.

## What this tells us about user behaviour

1. **The verdict must be visible without scrolling** — every successful site puts the answer at the top (meter, headline-as-verdict, or bulleted key points). Readers arrive asking *is this true?*
2. **The shareable verdict artefact matters more than the article** — PolitiFact's meter and Snopes' icons circulate far beyond the site; the verdict must exist as a standalone, embeddable, quotable object.
3. **Track records beat one-off verdicts for retention** — scorecards give users a reason to return during a campaign; a feed alone does not.
4. **Two content lengths** (full analysis + quick check) match how claims vary in complexity.
5. **"Miscaptioned"/false-context is a first-class verdict type** for a social-media-heavy audience.
6. **Show your work, but after the answer.**
7. **Games/newsletters/apps build habit** but are secondary to the core loop: claim → verdict → evidence.

## How ClaimWatch NZ should present the analysis

Our differentiators vs the famous sites: **fully automated verdicts, contestable, with machine-checkable evidence packs** — they're limited by human throughput to ~2–10 checks/day; we produce orders of magnitude more, and the site should make that scale visible.

### Page 1: The claim card (the atom of the site)
- **Verdict up top** — one of the four classes + confidence, rendered as a clean visual mark (a coloured band or glyph, not a smiley meter — we're NZ-serious, not US-quippy). "Accurate but incomplete" gets its own visual treatment — the most interesting verdict and the one that teaches media literacy.
- **The claim, verbatim, attributed** — quote + who said it + where, linked to the publication/segment record (ADR-0008): the Beehive release, the RNZ interview at minute 14, the YouTube clip with a "hear it" button deep-linked to the audio timestamp.
- **One-sentence plain-language verdict** ("Immigration numbers are up 40%, but from the pre-pandemic baseline, not last year — the rise is real but the comparison chosen exaggerates it").
- **"As deployed" tag** (ADR-0008) — what the claim was doing in its argument, as a small tag, not a paragraph.

### Page 2: The evidence pack (the "show your work" layer)
Expandable from the card; a full page for the engaged reader:
- **What we checked against** — the specific official series / documents, linked, with the authority tier (T1–T6) shown. Our unique transparency feature: *the actual evidence authority and its provenance*, not "experts say".
- **The reasoning** — the retrieval/verification narrative in plain language, with the confidence level and what would change it.
- **Contestation** — "Disagree? Here's how this verdict gets challenged" → the contest form (ADR-0002). Contest status displays on the card (contested → under review → verdict mutated) — the *liveness* of contestation is a trust signal no static site offers.

### Page 3: The argument chain (ADR-0009 — the shareable centrepiece)
Nothing like it exists on PolitiFact/Snopes/Full Fact: an interactive graph of "the case for [policy proposal]" built from verified claims — proposition node, supporting claims with verdicts, load-bearing marks, break marks where the chain fails. Renderable as a shareable graphic: "3 of 5 claims this argument rests on are Accurate but incomplete in ways material to the conclusion." Per-publication chains (one speech's argument) and cross-campaign chains (the campaign-long "case for X") per ADR-0009.

### Page 4: Entity pages (the scorecard layer — the retention driver)
- **Person pages**: every claim, verdict distribution over time, notable argument chains, corrections linked, reliability profile.
- **Party pages**: same, plus manifesto claims vs verified-record claims.
- **Institution pages** (ADR-0018): think tank / lobby / union — their reports' claims, verdict distribution, funding context linked (Wikipedia/Democracy Project cross-links per ADR-0018).
- **Publisher pages**: which outlets' content carried the most refuted/incomplete claims — reported carefully as *claims carried*, not outlet verdicts, to stay within claims-not-persons.

### Page 5: The live feed and debate tracker
- Homepage = chronological feed of new verdicts, filterable by party/person/topic/verdict — the daily-check habit loop.
- **Debate-night live view** (ADR-0007's broadcast lane): claims detected during the debate appear within minutes with provisional verdicts, confidence shown, updating as evidence accumulates — the "wow, it's automated" moment that earns the site its audience.

### Page 6: Methodology and accuracy (the trust foundation)
- The four-verdict schema, how the grid works, what AVeriTeC alignment means, and — critically — **our measured accuracy published live** (against the labelled dataset and contest outcomes). No major fact-checker publishes a live accuracy number; for an automated system it's both honest and a differentiator.
- Every verdict links to the specific pipeline and prompt versions used (ADR-0012's prompt-versioning carries through to the public page): "this verdict was produced by pipeline vN; see the changelog."

## What to skip from the famous sites

- **No Truth-O-Meter clone** — trademarked, US-connoted, implies subjective judgement degrees we don't have (confidence is shown separately).
- **No Snopes-scale rating taxonomy** — their 15+ ratings reflect their claim variety (scams, satire, miscaptions); we have four verdicts + pledge-not-yet-checkable by design. False-context/image-manipulation claims, if ingested, would need a verdict-language extension — a later ADR, not launch.
- **No unstructured reader claim submissions at launch** — the pipeline auto-detects from ingested sources first; the structured, account-gated intake (`USER-SUBMISSIONS.md`) follows the validation slice once real usage shape is known, and ADR-0013 covers source suggestions meanwhile.
- **No gamification at launch** — the argument-chain view is our habit-forming feature; games would dilute the serious register.
- **No B2B newsroom tools at launch** — the ClaimReview JSON-LD feed gets verdicts into Google's Fact Check Explorer and partner newsrooms without building distribution infrastructure.

## One-line summary

**Lead with the verdict, link every claim to its "hear it/watch it" moment, make the argument-chain view the shareable centrepiece, and publish our own accuracy live.** The famous sites' engagement comes from a memorable verdict artefact + track records + transparent method — we have all three *plus* two things they structurally can't offer: automation scale (hundreds of verdicts/day, live during debates) and contestability that visibly mutates verdicts. Lean into both.