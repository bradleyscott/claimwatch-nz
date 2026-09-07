# Source taxonomy: claim sources and evidence authorities

*Status: proposed. This document separates two decisions that ADR-0002 (ingestion scope) and ADR-0004 (statistical engine) both depend on but neither fully defines:*

1. **Claim sources** — what we monitor for claims. The requirement is *breadth without bias*: a cross-section of NZ media so that which claims we see isn't determined by which outlets we happen to subscribe to.
2. **Evidence sources** — what we verify against. The requirement is a *mapped, trusted authority per topic*: when a claim about health waitlists or crime rates arrives, the pipeline must know exactly which sources are authoritative, which are alternate framings, and how conflicts between them are resolved.

*These are different problems with different failure modes. Claim-source failure = coverage bias (we never see the claim). Evidence-source failure = verification bias (we see the claim but judge it with the wrong baseline). This doc is the map; the ingestion-architecture ADR (parked) will define the mechanics.*

---

## Part 1: Claim sources — the coverage matrix

### 1.1 The bias risk, stated plainly

If claim ingestion leans on two or three outlets, the system inherits their editorial priorities, their audience, and their blind spots — and every verdict corpus we publish inherits it too. NZ media is concentrated (few owners, shrinking newsrooms, most national political reporting originates from a handful of parliamentary press-gallery journalists), which makes deliberate breadth cheap to buy but also easy to fake (subscribing to six outlets that all run the same wire copy is not breadth).

### 1.2 Coverage matrix (the standard a claim-source set must meet)

Sources are selected to cover the matrix — every row and column should have at least two entries:

| Dimension | Cells that must be covered |
|---|---|
| **Ownership/funding model** | Public broadcaster · privately-owned national · trust/philanthropy-owned · independent/local · international-origin (for world claims NZ politicians cite) |
| **Geography** | National · main centres (Auckland/Wellington/Christchurch) · provincial/rural (LDR network covers council/local-democracy claims) |
| **Language/culture** | English · Māori-language and Māori-issues media · Pacific media · ethnic/community media |
| **Format** | Text/news · radio/TV transcripts · press releases (primary claim sources, not media) · Hansard (the on-the-record baseline) |
| **Audience/community served** | General national · business/economics readership · Māori audiences · Pacific audiences · ethnic/community audiences · youth/social · regional communities |

**Why "audience" and not "political position":** an outlet's audience is observable (who reads/watches it, what it covers for whom) without the project publishing judgements about other outlets' political leanings — which would be subjective, attackable ("the fact-checkers labelled us X-leaning"), and unnecessary for the audit's job. The audit's question is **"which audiences and communities are not producing claims into our system?"** — a gap question answerable from audience descriptors, not a leaning question. Verdict criteria are party-blind by construction (ADR-0006), and no source is included or excluded based on any assessment of its politics.

### 1.3 Proposed claim-source set (v1)

Access statuses below were **live-probed 2026-09-07** (see `docs/COVERAGE.md` for method); "⚠️ unprobed" means not yet tested at that date.

| Outlet/source | Matrix cells | Access status (probe result) |
|---|---|---|
| **Beehive.govt.nz** | primary claims, executive | ✅ verified RSS (`/rss.xml`, 30 items) |
| **Hansard** | primary claims, parliament | ✅ verified |
| **RNZ** | public broadcaster, national, radio text, Māori (te-manu-korihi), Pacific, regional via LDR | ✅ verified RSS (~20 feeds; `political.xml` 16 items) |
| **TVNZ / 1News** | public TV, mass audience | ✅ site reachable (2.6MB JS-heavy HTML; no RSS found — headless rendering needed) |
| **Stuff** | private national + regional titles (dominant regional reach) | ✅ verified Atom feeds (`/rss?section=/politics`, 25 items) |
| **NZ Herald** | private national, largest newsroom | ✅ accessible but feed degraded; paywall policy applies |
| **Newsroom** | trust-owned, public-interest journalism | ✅ **verified RSS** (`newsroom.co.nz/feed/`, 10 items) |
| **The Post** | private, Wellington+Christchurch daily | ✅ **verified Atom** (`/rss?section=/`, 79 items; `/politics` section 28 items) |
| **The Press** | private, Christchurch | ✅ **verified Atom** (`/rss?section=/`, 55 items) |
| **Otago Daily Times** | independent, provincial, 2nd-most-trusted brand (Trust in News 2026) | ⚠️ site reachable; **no feed found** (404s) — headless scrape path |
| **Interest.co.nz** | economics/housing specialist — where economic claims often originate | ✅ **verified RSS** (`/rss`, working feed) |
| **Waatea News** | Māori radio/news | ⚠️ JS redirect to `/lander` — needs headless rendering |
| **Te Ao Māori News** | Māori perspectives | ✅ reachable (HTML; feed unknown) |
| **E-Tangata** | Māori long-form, trust-owned | ✅ reachable (static HTML — easy scrape) |
| **PMN (Pacific Media Network)** | Pacific communities | ✅ reachable (JS-heavy; headless path) |
| **Indian Weekender** | ethnic communities | ✅ reachable (HubSpot-built; scrapeable) |
| **National Party releases** | primary claims | ✅ reachable (Vercel/Next — headless) |
| **Labour Party releases** | primary claims | ✅ `labour.org.nz/news/` reachable (200; `/media_hub` 404 — use `/news/`) |
| **ACT releases** | primary claims | ✅ reachable (Framer-built — headless) |
| **Green Party releases** | primary claims | ✅ reachable (JS-heavy — headless) |
| **NZ First releases** | primary claims | ✅ **domain found** — `www.nzfirst.nz` (the `.org.nz` we had recorded is dead; `nzfirst.co.nz` redirects there); news at `nzfirst.nz/news` (JS-rendered — headless) |
| **Te Pāti Māori releases** | primary claims | ✅ **domain found** — `www.maoriparty.org.nz` (the `.co.nz` we had recorded is parked); JS-rendered — headless; news path TBD at build week |
| **User submissions** | everything else, crowd-prioritised | designed (ADR-0002 lane 5) |

**Probe notes (2026-09-07):**
- **Newsroom, The Post, The Press all have working feeds** — the earlier "⚠️ not yet probed" row entries resolve favourably. The Post's feed carries 79 items at root with a working `/politics` section (28 items).
- **1News**: no RSS found (404s on `/rss` and `/feeds/`); site is JS-rendered (Next.js, same Arc stack family as NZ Herald). Headless render or their sitemap is the ingestion path.
- **Waatea**: JS redirect pattern (`/lander`) — needs headless rendering, not a simple scrape.
- **Party domains re-verified after initial probe failures**: NZ First is at **www.nzfirst.nz** (the `.org.nz` we had recorded is dead; `nzfirst.co.nz` redirects there) with news at `/news` (JS-rendered). Te Pāti Māori is at **www.maoriparty.org.nz** (the `.co.nz` is parked). Party websites get re-verified at build week 1 — expected finding for minor-party web presences, not a blocker.
- **Otago Daily Times**: site serves 200 to pages but all probed feed paths 404. Headless scrape path assumed.

**Wire service note:** much NZ political copy originates from the NZ press gallery via NZME/Stuff shared content. Dedupe-by-claim (not by outlet) prevents the same wire story from three outlets counting as three independent claim sources.

**Coverage audit (the mechanism that keeps this honest):** monthly, the pipeline reports claim volume and topic distribution per source. If a dimension's cells are silent for a month (e.g. no Māori-media-sourced claims), that's flagged as a coverage gap — the fix is source repair, not claim invention. User-submission rates by topic are the backstop signal for what the matrix missed.

### 1.4 What we deliberately do NOT monitor (and the stated consequence)

- Social platforms (crawl): coverage gap delegated to user submissions (ADR-0002)
- Podcasts/talkback/broadcast: deferred (transcription); consequence stated in methodology — claims that live only on air are out of scope until post-election
- Overseas media except when cited by NZ actors (then it's a citation-check case)

---

## Part 2: Evidence authorities — the trusted-source map

### 2.1 Authority tiers (defined once, applied everywhere)

| Tier | Definition | Examples | Use |
|---|---|---|---|
| **T1 — Designated official statistics** | Stats NZ (the Statistics Act-designated national statistical office) | HLFS, CPI, GDP, migration, census, child-poverty stats | Primary verdict basis for statistical claims |
| **T2 — Official administrative data** | Government agencies' administrative collections | Police recorded crime, MoJ convictions, MoE enrolments, MSD benefit numbers, Te Whatu Ora waitlists | Primary basis where the claim is about the administrative thing itself; secondary cross-check for survey-based claims |
| **T3 — Official survey/research instruments** | Standalone official surveys | NZ Crime and Victims Survey (MoJ), Youth Health and Wellbeing Survey | The *other side* of denominator families (e.g. recorded crime vs victimisation) |
| **T4 — Independent Crown monitors / central agencies** | Treasury, Productivity-style monitors, Auditor-General | Treasury forecasts, OAG reports | Fiscal claims; institutional-performance claims |
| **T5 — Established research / secondary curators** | Figure NZ, IRANZ-style research institutes, university research | Figure NZ chart library, NZIER | Context and pre-visualised series; never sole basis for a verdict |
| **T6 — International comparators** | OECD, IMF, WHO, peer-country statistical offices | OECD Education at a Glance, comparable-country crime/vaccination data | Only for claims that are explicitly comparative |

**Precedence rule (goes in the methodology):** when tiers conflict, T1 > T2 > T3 > T4 > T5 > T6 — *but* the conflict itself is often the finding (a claim quoting administrative data while the survey series tells a different story is exactly the "skewed picture" class). So: verdicts cite the claim's own tier first, then report what the higher-precedence authority says. The verdict is about the *gap*.

### 2.2 Authority map by election-relevant policy domain

This is the v1 map — each row is retrieval guidance for the claim-anchored evidence store under ADR-0010. The selection criterion: **domains where campaign claims concentrate**, cross-checked against 2020/2023 campaign topic frequency and news volume. "Denominator family" lists the alternative framings the sensitivity grid must compute.

| Policy domain | T1/T2 primary authorities | T3/T4 alternates | Key denominator family |
|---|---|---|---|
| **Crime & justice** | Police recorded crime (policedata.nz); MoJ conviction/case data | **NZ Crime & Victims Survey** (MoJ); Corrections data | recorded offences vs victim-survey prevalence; raw counts vs per-capita; resolution rates |
| **Economy & fiscal** | Stats NZ (CPI, GDP, wage measures); Treasury (FOREs, HLY) | RBNZ (OCR, inflation expectations); NZIER | quarterly vs annual; real vs nominal; per-capita vs aggregate |
| **Employment** | Stats NZ HLFS | MSD benefit admin data | unemployment rate vs employment rate vs underutilisation; benefit numbers vs jobseeker duration |
| **Immigration** | Stats NZ international migration (net vs arrivals vs departures) | MBIE visa data | net vs gross; citizen vs non-citizen; annual vs rolling-12 |
| **Housing** | Stats NZ building consents; LINZ/HUD house-price series (RBNZ also) | MSD public-housing register; KiwiBuild delivery | consents vs completions; prices vs rents; waiting list vs housed |
| **Health** | Te Whatu Ora / MoH waitlist and treatment data; Stats NZ health indicators | NZ Health Survey (T3) | first-specialist-assessment vs treatment vs surgery; waitlist size vs wait *time*; per-capita |
| **Education** | MoE (NCEA, attendance, roll data); ERO reports | PISA/TIMSS (T6 for comparative claims) | attendance vs achievement; raw pass rates vs cohort-based |
| **Welfare & child wellbeing** | MSD benefit data; Stats NZ child-poverty statistics (the three official measures — BHC50, AHC50, material hardship) | Household income/outlay series | the three child-poverty measures; before/after-housing-cost |
| **Climate & environment** | Stats NZ GHG inventory; MfE emissions; LAWA water data | Climate Change Commission advice | gross vs net emissions; production vs consumption basis; long-term vs yearly |
| **Energy** | MBIE energy statistics; Transpower | — | generation vs capacity; wholesale price vs retail |
| **Transport/infrastructure** | Waka Kotahi; Te Manatū Waka; National Land Transport Fund | Auditor-General reports on major projects | road deaths per capita vs per km vs per vehicle-km (Ministry of Transport series) |
| **Primary/rural** | MPI; Beef+Lamb economic series; Stats NZ ag stats | Federated Farmers' cited research (T5) | export volumes vs values; farm-gate vs retail |
| **Māori outcomes** | Te Puni Kōkiri; Stats NZ (iwi data, Māori-purposed series); Oranga Tamariki | Whāiā te Māori / iwi research | ethnic-total vs Māori-purposed measures; age-standardised rates |
| **Public service/state sector** | Public Service Commission workforce data | Treasury/DIA | headcount vs spend; per-capita admin cost |

**Map hygiene rules:**
- Every domain declares: primary authority (with series IDs), alternates, denominator family, series vintages, and revision policy — these configure the retrieval loop (ADR-0010).
- A claim citing a source *outside* the map gets the open-web loop plus an explicit note that no pre-vetted authority exists for the domain.
- The map is versioned and public; domain experts (academic and official-statistics people) are invited to contest entries — same mutation model as verdicts.

### 2.3 Known gaps and honest limits

- **NZ Herald Premium analysis**: covered by the paywall policy, not the authority map (it's a claim source, never evidence).
- **Claims about the future** (forecasts, pledges): checkable only as *consistency* claims ("does this pledge match the published fiscal forecasts?") — the map supports that; outcome verification is impossible. The verdict vocabulary includes "pledge — not yet checkable."
- **International claims** rely on T6 comparators with their own revision cycles; vintage-dating is mandatory here.
- **Domain coverage vs capacity**: the v1 map ships with the eight highest-traffic domains fully specified (crime, economy, employment, immigration, housing, health, education, welfare); the rest are added to the authority map as claim volume justifies (ADR-0010) — the table above is the target state, not the v1 delivery.

---

## Part 3: Open questions

1. **1News/TVNZ machine access** — probe before build week (likely JS-heavy; transcript pages may be the practical route).
2. **Newsroom, ODT, The Post, Interest.co.nz feeds** — probe before build week; add to COVERAGE.md matrix.
3. **LDR network content licensing** — RNZ's personal-use terms vs LDR's explicit republication model (LDR content is *designed* for reuse; confirm terms).
4. **Who maintains the authority map** — needs a named owner and a review cadence (statistical-series URLs move; see COVERAGE.md health-check item).
5. **Māori/pasifika media ingestion with te reo content** — v1 processes English; te reo claims are flagged as out-of-scope-for-verdict rather than silently dropped (links to the Māori-language roadmap gap in ARCHITECTURE.md §6).

## Part 4: Public participation in the taxonomy

The coverage matrix and authority map accept public proposals — outlets to monitor, datasets to consider as evidence — through a scoped, vetted pathway defined in **[ADR-0009](adr/0009-public-proposal-of-sources-and-authorities.md)**. Pre-launch: GitHub issues with proposal templates. Design principles: **the proposer describes, the project classifies** (no matrix or tier self-assessment is asked of the public); **the domain taxonomy is seeded up front** from established NZ policy groupings (select-committee subject areas, standard classification families) and refined claim-derived — domain proposals are not accepted; and **decisions are recorded, not scheduled** — each proposal gets a public maintainer decision record with reasons, no fixed review window. Proposals are *consideration, not adoption*: automated scope-checks and maintainer decision records gate adoption; authority-tier changes above T4 additionally require subject-matter review. Community-added entries carry provenance labels in this document's change history.