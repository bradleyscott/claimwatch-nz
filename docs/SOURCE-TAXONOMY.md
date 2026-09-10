# Source taxonomy: claim sources and evidence authorities

*Two roles, kept separate by design: **claim sources** flow into ingestion and get checked; **evidence authorities** are consulted as evidence and never treated as claims. The same source can play both roles for different artefacts (a Hansard debate is a claim source; the official series behind a statistic is evidence). See `ARCHITECTURE.md` §1. Proposed; the ingestion mechanics are ADR-0006.*

The two decisions have different failure modes:

1. **Claim sources** — what we monitor for claims. Requirement: *breadth without bias* — a cross-section of NZ media so which claims we see isn't determined by which outlets we subscribe to. Failure mode: coverage bias (we never see the claim).
2. **Evidence sources** — what we verify against. Requirement: a *mapped, trusted authority per topic* — when a health-waitlist or crime-rate claim arrives, the pipeline knows which sources are authoritative, which are alternate framings, and how conflicts resolve. Failure mode: verification bias (we see the claim but judge it with the wrong baseline).

---

## Part 1: Claim sources — the coverage matrix

### 1.1 The bias risk

If claim ingestion leans on two or three outlets, the system inherits their editorial priorities, audience, and blind spots — and every published verdict corpus inherits it. NZ media is concentrated (few owners, shrinking newsrooms, most national political reporting from a handful of press-gallery journalists), which makes deliberate breadth cheap to buy but easy to fake (six outlets running the same wire copy is not breadth).

### 1.2 Coverage matrix

Sources are selected so every row and column below has at least two entries:

| Dimension | Cells that must be covered |
|---|---|
| **Ownership/funding model** | Public broadcaster · privately-owned national · trust/philanthropy-owned · independent/local · international-origin (for world claims NZ politicians cite) |
| **Geography** | National · main centres (Auckland/Wellington/Christchurch) · provincial/rural (LDR network covers council/local-democracy claims) |
| **Language/culture** | English · Māori-language and Māori-issues media · Pacific media · ethnic/community media |
| **Format** | Text/news · radio/TV transcripts · press releases (primary claim sources, not media) · Hansard (the on-the-record baseline) |
| **Audience/community served** | General national · business/economics readership · Māori audiences · Pacific audiences · ethnic/community audiences · youth/social · regional communities |

**Why "audience" and not "political position":** an outlet's audience is observable without the project publishing judgements about other outlets' politics — which would be subjective and attackable ("the fact-checkers labelled us X-leaning"). The monthly audit's question is a gap question — *which audiences/communities are not producing claims into our system* — answerable from audience descriptors. Verdict criteria are party-blind by construction (ADR-0002); no source is included or excluded on an assessment of its politics.

### 1.3 Proposed claim-source set (v1)

Access statuses live-probed 2026-09-07 (method in `COVERAGE.md`); "⚠️ unprobed" = not tested at that date.

| Outlet/source | Matrix cells | Access status (probe result) |
|---|---|---|
| **Beehive.govt.nz** | primary claims, executive | ✅ verified RSS (`/rss.xml`, 30 items) |
| **Hansard** | primary claims, parliament | ✅ verified |
| **RNZ** | public broadcaster, national, radio text, Māori (te-manu-korihi), Pacific, regional via LDR | ✅ verified RSS (~20 feeds; `political.xml` 16 items) |
| **TVNZ / 1News** | public TV, mass audience | ✅ reachable (2.6MB JS-heavy HTML; no RSS — headless rendering needed) |
| **Stuff** | private national + regional titles (dominant regional reach) | ✅ verified Atom (`/rss?section=/politics`, 25 items) |
| **NZ Herald** | private national, largest newsroom | ✅ accessible but feed degraded; paywall policy applies |
| **Newsroom** | trust-owned, public-interest journalism | ✅ verified RSS (`newsroom.co.nz/feed/`, 10 items) |
| **The Post** | private, Wellington+Christchurch daily | ✅ verified Atom (`/rss?section=/`, 79 items; `/politics` 28 items) |
| **The Press** | private, Christchurch | ✅ verified Atom (`/rss?section=/`, 55 items) |
| **Otago Daily Times** | independent, provincial, 2nd-most-trusted brand (Trust in News 2026) | ⚠️ site reachable; no feed found (404s) — headless scrape path |
| **Interest.co.nz** | economics/housing specialist — where economic claims often originate | ✅ verified RSS (`/rss`) |
| **Waatea News** | Māori radio/news | ⚠️ JS redirect to `/lander` — headless rendering needed |
| **Te Ao Māori News** | Māori perspectives | ✅ reachable (HTML; feed unknown) |
| **E-Tangata** | Māori long-form, trust-owned | ✅ reachable (static HTML — easy scrape) |
| **PMN (Pacific Media Network)** | Pacific communities | ✅ reachable (JS-heavy; headless path) |
| **Indian Weekender** | ethnic communities | ✅ reachable (HubSpot-built; scrapeable) |
| **National Party releases** | primary claims | ✅ reachable (Vercel/Next — headless) |
| **Labour Party releases** | primary claims | ✅ `labour.org.nz/news/` reachable; `/media_hub` 404 — use `/news/` |
| **ACT releases** | primary claims | ✅ reachable (Framer — headless) |
| **Green Party releases** | primary claims | ✅ reachable (JS-heavy — headless) |
| **NZ First releases** | primary claims | ✅ domain found — `www.nzfirst.nz` (the `.org.nz` is dead; `.co.nz` redirects there); news JS-rendered |
| **Te Pāti Māori releases** | primary claims | ✅ domain found — `www.maoriparty.org.nz` (the `.co.nz` is parked); JS-rendered |
| **User submissions** | everything else, crowd-prioritised | designed (ADR-0006 lane 5) |

**Wire-service note:** much NZ political copy originates from the press gallery via NZME/Stuff shared content. Dedupe-by-claim (not by outlet) stops the same wire story from three outlets counting as three independent claim sources.

**Coverage audit:** monthly, the pipeline reports claim volume and topic distribution per source. A dimension whose cells go silent for a month (e.g. no Māori-media-sourced claims) is a flagged coverage gap — fixed by source repair, not claim invention. User-submission rates by topic are the backstop signal for what the matrix missed.

### 1.4 What we deliberately do NOT monitor (with the stated consequence)

- Social platforms (crawl): gap delegated to user submissions (ADR-0006)
- Podcasts/talkback/broadcast beyond publisher-published text: deferred (ADR-0007); claims that live only on air are out of scope until post-election
- Overseas media except when cited by NZ actors (then it's a citation-check case)

---

## Part 2: Evidence authorities — the trusted-source map

### 2.1 Authority tiers (defined once, applied everywhere)

| Tier | Definition | Examples | Use |
|---|---|---|---|
| **T1 — Designated official statistics** | Stats NZ (the Statistics Act-designated national statistical office) | HLFS, CPI, GDP, migration, census, child-poverty stats | Primary verdict basis for statistical claims |
| **T2 — Official administrative data** | Government agencies' administrative collections | Police recorded crime, MoJ convictions, MoE enrolments, MSD benefit numbers, Te Whatu Ora waitlists | Primary where the claim is about the administrative thing itself; secondary cross-check for survey-based claims |
| **T3 — Official survey/research instruments** | Standalone official surveys | NZ Crime and Victims Survey (MoJ), Youth Health and Wellbeing Survey | The *other side* of denominator families (recorded crime vs victimisation) |
| **T4 — Independent Crown monitors / central agencies** | Treasury, Productivity-style monitors, Auditor-General | Treasury forecasts, OAG reports | Fiscal and institutional-performance claims |
| **T5 — Established research / secondary curators** | Figure NZ, IRANZ-style institutes, university research | Figure NZ chart library, NZIER | Context and pre-visualised series; never sole basis for a verdict |
| **T6 — International comparators** | OECD, IMF, WHO, peer-country statistical offices | OECD Education at a Glance | Only for explicitly comparative claims |

**Precedence rule:** T1 > T2 > T3 > T4 > T5 > T6 — *but* the conflict itself is often the finding (a claim quoting administrative data while the survey series tells a different story is exactly the "skewed picture" class). Verdicts cite the claim's own tier first, then report what the higher-precedence authority says. The verdict is about the *gap*.

### 2.2 Authority map by election-relevant policy domain

The v1 map; each row is retrieval guidance for the claim-anchored evidence store (ADR-0005). Domains are the ones where campaign claims concentrate (cross-checked against 2020/2023 campaign topic frequency). "Denominator family" lists the alternative framings the sensitivity grid must compute.

| Policy domain | T1/T2 primary authorities | T3/T4 alternates | Key denominator family |
|---|---|---|---|
| **Crime & justice** | Police recorded crime (policedata.nz); MoJ conviction/case data | NZ Crime & Victims Survey (MoJ); Corrections data | recorded offences vs victim-survey prevalence; raw counts vs per-capita; resolution rates |
| **Economy & fiscal** | Stats NZ (CPI, GDP, wage measures); Treasury (FOREs, HLY) | RBNZ (OCR, inflation expectations); NZIER | quarterly vs annual; real vs nominal; per-capita vs aggregate |
| **Employment** | Stats NZ HLFS | MSD benefit admin data | unemployment vs employment vs underutilisation; benefit numbers vs jobseeker duration |
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
- Every domain declares: primary authority (with series IDs), alternates, denominator family, series vintages, revision policy — these configure the retrieval loop (ADR-0005).
- A claim citing a source outside the map gets the open-web loop plus an explicit note that no pre-vetted authority exists for the domain.
- The map is versioned and public; domain experts (academic and official-statistics people) are invited to contest entries — same mutation model as verdicts.

### 2.3 Known gaps and honest limits

- **NZ Herald Premium analysis**: covered by the paywall policy, not the authority map (a claim source, never evidence).
- **Claims about the future** (forecasts, pledges): checkable only as *consistency* claims ("does this pledge match the published fiscal forecasts?"). Verdict vocabulary includes "pledge — not yet checkable."
- **International claims**: rely on T6 comparators with their own revision cycles; vintage-dating mandatory.
- **Domain coverage vs capacity**: v1 ships the eight highest-traffic domains fully specified (crime, economy, employment, immigration, housing, health, education, welfare); the rest are added as claim volume justifies (ADR-0005). The table above is the target state, not the v1 delivery.

---

## Part 3: Open questions

1. **1News/TVNZ machine access** — probe before build week (JS-heavy; transcript pages may be the practical route).
2. **ODT, Te Ao Māori feeds** — probe before build week; add to the COVERAGE matrix.
3. **LDR network content licensing** — RNZ's personal-use terms vs LDR's explicit republication model (confirm terms).
4. **Who maintains the authority map** — needs a named owner and review cadence (statistical-series URLs move; see `COVERAGE.md`).
5. **Te reo Māori content in Māori/Pasifika media** — v1 processes English; te reo claims are flagged out-of-scope-for-verdict rather than silently dropped (links to the Māori-language roadmap gap, `ARCHITECTURE.md` §6).

## Part 4: Public participation in the taxonomy

The coverage matrix and authority map accept public proposals (outlets to monitor, datasets to consider as evidence) through the pathway defined in **[ADR-0013](adr/0013-public-proposals.md)**: pre-launch, GitHub issues with proposal templates. Design principles: **the proposer describes, the project classifies** (no matrix/tier self-assessment asked); **the domain taxonomy is seeded up front** from established NZ policy groupings (select-committee subject areas, standard classification families) and refined claim-derived — domain proposals are not accepted; **decisions are recorded, not scheduled** — each proposal gets a public maintainer decision record with reasons. Proposals are consideration, not adoption; community-added entries carry provenance labels in this document's change history.