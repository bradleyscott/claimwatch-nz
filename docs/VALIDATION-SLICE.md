# The validation slice v2 — risk-representative sample plus a publicisable site MVP

*Refines the original slice scope (Beehive/RNZ/Stuff RSS → triage → verify → store → export) per Bradley's direction: (a) carry a small representative sample of ALL the technical-viability and accuracy risks, across media types and extraction methods, so measured accuracy attests to the system rather than to a lane; (b) include a sufficient website MVP to publicise and get user feedback.*

## The design question

The original slice covered three text-RSS lanes — clean HTML text, deterministic extraction, official prose. That measures one point of the risk surface and attests *nothing* about the risks that dominate the system: broadcast speech (Tier-2 captions), statistical cherry-picking (grid arithmetic), false context (provenance), extraction-ladder fallback rates. Accuracy and cost-per-claim are only meaningful if the input sample spans the risk surface. So the slice is designed around **risk coverage**, not lane simplicity.

## What the risks actually are

| # | Risk | Where it lives | What it threatens |
|---|---|---|---|
| R1 | Structured/official prose extraction | Beehive releases, RNZ articles | Baseline extraction quality; false-comparison detection in stats |
| R2 | Statistical claim verification | Any claim citing a number | The stat-engine grid path (denominator selection, vintage, "as deployed") — the highest-complexity mode |
| R3 | Broadcast speech via Tier-2 captions | YouTube broadcaster uploads (1News, Q+A) | media_anchor extraction, transcript_tier handling, quote fidelity against audio the user can "hear it" |
| R4 | Long-document / PDF evidence | Policy documents, budget docs, official reports | PDF/table extraction (the AVeriTeC 297/500 lesson — format-aware parsers, not Trafilatura-only) |
| R5 | False-context / miscaptioned material | Social posts, screenshots, mislabelled clips | The mode with no text-claim anchor; provenance checking |
| R6 | Institution-published claims | Think tanks, lobbies, unions (ADR-0018) | Claims paired with their own evidence — citation-check mode |
| R7 | Extraction-ladder stress | All lanes | Tier-2 fallback rate, entity-linking accuracy |
| R8 | Repeat/correction detection | Claims that recur or get corrected | Claim-graph links, mutation path |

## The slice scope (v2)

### Ingestion: five lanes, deliberately sampled

1. **Beehive RSS** (R1, R2) — official releases; structured prose, statistical claims against official series. *In the original slice.*
2. **RNZ politics RSS** (R1, R2) — news articles. *In the original slice.*
3. **YouTube broadcaster captions** (R3, R8) — 1News + Q+A uploads: caption-track ingestion, `kind:"asr"` detection, media_anchor capture, transcript_tier=Tier-2 flags. Exercises the broadcast risk and the "hear it/watch it" demo.
4. **One institution source** (R6) — The Kākā (Substack RSS, zero-cost, verified) or NZIER (scrape). Claims paired with own evidence → citation-check mode.
5. **One false-context sample set** (R5) — NOT a live lane: a **hand-curated set of ~10 known miscaptioned/false-context items** (real NZ examples with documented provenance). Provenance verification is the least mature mode; the slice *demonstrates* it on curated items and measures how the pipeline handles them, rather than pretending it's production-ready.

**PDF/long-document lane (R4): deferred to the next slice** — one slice can't carry everything, and PDF extraction is a known-solvable engineering problem, not an open accuracy risk; its accuracy risk surfaces through evidence documents the verification loop fetches regardless of lane.

### Verification: the full multi-mode path

- Statistical claims → stat-engine grid mode (official series retrieved, denominators selected, "as deployed" framing evaluated)
- Institution claims → citation-check mode (do the cited sources say what they're claimed to say)
- Broadcast claims → quote-fidelity mode (claim text against caption text; media anchor generated)
- False-context samples → provenance mode, curated set only
- All claims: question decomposition, confidence-capped retrieval depth, **NLI justification audit before publication** — the accuracy gate
- The extraction ladder runs everywhere, with **Tier-2 fallback rate logged per lane** (R7 measured as a by-product)

### Labelling and accuracy: the representative sample design

The human-labelling set (target **~100 claims**) mirrors the risk surface, not lane volumes:

- **Stratified across the five lanes** and the verification modes (stat / citation / quote-fidelity / provenance)
- **Verdict-mix targets** per the AVeriTeC lessons (ADR-0010): a Supported-heavy natural mix, plus deliberate oversampling of "Accurate but incomplete" (the hardest and most valuable class to label)
- **Double-labelling on ~30%** for inter-annotator agreement
- **Per-stratum accuracy reporting**: the deliverable is not one number but accuracy *per media type × verification mode* — "stat-engine on official prose: X%; quote-fidelity on Tier-2 captions: Y%; citation-check on institutional claims: Z%". That table shows where the system is production-grade and where it needs hardening before the election, which is the entire point of validating early.
- Dataset A (labelling export) and Dataset B (AVeriTeC L1 harness) generated per the ADR-0010 design; Layer-2 NZ set construction continues from these labels.

### The website MVP — "sufficient to publicise and get feedback"

Scope = the discovery + presentation spine; no accounts, contestation, or submissions yet:

1. **Claim cards + verdict pages** (SSR, Next.js) — verdict + confidence up top, verbatim quote, one-sentence plain verdict, "as deployed" tag, and the demo moment: **"hear it / watch it" deep links** on every broadcast claim (ADR-0007's design made visible)
2. **ClaimReview JSON-LD on every verdict page** — the Google/Fact-Check-Explorer discovery channel, live from day one
3. **The feed** (recency-ranked) + **topic facets** (person/party/topic/verdict off the structured store)
4. **Entity pages** (person, party, institution) — verdict distributions, the track-record view
5. **Methodology page** — the four-verdict schema, pipeline description, the measured-accuracy table published live
6. **Feedback capture** — a lightweight widget on every page (thumbs + free text + optional email). User feedback *about the site* is the goal; the claim-submission system is explicitly post-slice.
7. **Per-claim "pipeline provenance" block** — pipeline version, prompt versions, confidence — demonstrating the transparency feature to early users

Explicitly **out of the site MVP**: contestation UI, submission system, argument-chain views, debate-night live tracker, newsletters, entity reliability profiles. Each is a follow-on slice; cramming them into the publicise-and-learn slice risks the timeline.

### Timeline reality

Bigger than the original (five lanes vs three, site MVP vs none), but each added piece exercises already-designed machinery (ADR-0007's caption lane, ADR-0018's institution lane, the UX research's page set). Two weeks of focused build is realistic given the design completeness; the early-October soft launch holds **only if this slice starts this week** — the queue is: slice → measure → harden worst stratum → site polish → soft launch.

## What success looks like

1. **The per-stratum accuracy table exists** — accuracy per media type × verification mode, double-labelled agreement stats, cost per claim per stratum
2. **The site is demoable** — real NZ claims from five source types, verdict pages with evidence packs and "hear it" links, discoverable via ClaimReview, methodology + measured accuracy published
3. **The risk map is empirical** — which strata are production-grade, which need hardening, with numbers
4. **Feedback channels are live** — collecting what early users think while the campaign is still building