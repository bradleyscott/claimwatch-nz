# ADR-0018: Institutional claim sources — think tanks, lobby groups, and sector peak bodies

*Status: Proposed · Date: 2026-09-08 · Deciders: Bradley, Dave*

## Context

A large share of the most consequential campaign claims originates not from politicians, parties, or media but from **advocacy institutions**: think tanks, business lobbies, union federations, sector peak bodies, and community-sector organisations. BusinessNZ and its members, the NZ Council of Trade Unions and its affiliates, The New Zealand Initiative, the Taxpayers' Union, NZIER, BERL, Federated Farmers, the Salvation Army's Social Policy Unit, the Child Poverty Action Group — these bodies produce reports, economic analysis, press releases, manifestos, and poll-based claims that politicians then quote and campaigns adopt. A fact-checking resource that covers parties and media but not this layer misses the *upstream supply* of campaign claims: think-tank reports get quoted by ministers within days; lobby-group press releases become party talking points; polls from advocacy-owned pollsters (the Taxpayers' Union–Curia poll) shape coverage weekly.

This ADR maps the institutional claim-source landscape (researched 2026-09-08, with live probes for machine access) and defines how these organisations are ingested.

**A structural note first:** these bodies span a spectrum from research organisations (NZIER publishes forecasts and peer-reviewable economic analysis) to advocacy groups (the Taxpayers' Union campaigns for lower taxes) to hybrid membership organisations (the NZ Initiative describes itself as a think tank *and* a business membership organisation). The pipeline treats them **as claim sources, never evidence authorities** — their reports and analysis are exactly the class of content that gets checked (their numbers against official series). Several maintain their own statistics or polls (Taxpayers' Union–Curia, NZIER Consensus Forecasts); a poll or model output published by an advocacy body is a *claim about the world*, not evidence of the world. This aligns with the T1–T6 authority map: advocacy-produced data is at best T6, and the provenance flag always travels with the claim. The audience/community descriptors in SOURCE-TAXONOMY §1.2 apply here too — organisations are described by observable characteristics (membership, funding type, stated mission), never by political-leaning labels.

## Decision

**A seventh ingestion lane — institutional advocacy — covering the organisations below, with per-organisation parsers following the ADR-0006 lane mechanics.**

### The landscape, mapped

**Think tanks and research bodies** (reports, working papers, polls, media releases):

| Organisation | Orientation (observable) | Output rhythm | Machine access (probed 2026-09-08) |
|---|---|---|---|
| **The New Zealand Initiative** | Business-funded policy think tank; free-market; 3 of NZ's "big three" think tanks | Reports, media releases, weekly member newsletter; high media pickup | Site 200 (87KB) at `/reports-and-media`; no RSS found (404 on `/rss`, `/rss.xml`) → headless listing scrape |
| **NZIER** | NZ Institute of Economic Research; economic forecaster; publishes **Consensus Forecasts** (quarterly) and Quarterly Survey of Business Opinion — quoted weekly in coverage | Publications cadence ~weekly | Site 200 (174KB) at `/publications`; no RSS found → scrape; note: NZIER *forecasts* are claims about the future (consistency-checkable only) |
| **BERL** | Third of the big three; Māori economic development focus | Reports, commentary | Not yet probed; likely scrape |
| **Taxpayers' Union** | Free-market advocacy; co-publishes the **weekly Taxpayers' Union–Curia poll** (margins of error ±3.1%); Atlas Network member | Weekly poll, reports, media releases, high media pickup | Site 200; no RSS (404s) → headless scrape; polls are claims about public opinion (checkable against other polls' methodology, not official series) |
| **NZCPR** (Centre for Political Research) | Right-of-centre commentary think tank (private company); weekly newsletter, Breaking Views blog, weekly polls | Weekly commentary; campaigns/petitions | Site 200 (80KB) — static HTML, easily parseable |
| **The Helen Clark Foundation** | Centrist-left public-policy think tank; registered charity | Reports (mahi a Rongo series) | Site 200 (353KB); no RSS → scrape |
| **The Kākā** (Bernard Hickey, Substack) | Independent political-economy newsletter; housing/climate/poverty focus; election project 2026/50 | Substack posts, paid+free tiers | **Substack RSS verified working** (`thekaka.substack.com/feed`) |
| **Democracy Project** (Bryce Edwards) | Political analysis; detailed organisation profiles (a rich source of *meta* context about advocacy bodies) | Substack | **Substack RSS verified (200, 329KB)** |
| **The Spinoff / NZ on the Record / Newsroom** media-analysis arms | Political commentary with factual claims | Editorially published | Already covered via news lane or own-site scrape |
| **Fabian Society NZ / other left-of-centre policy bodies** | Books, sessions, policy papers | Occasional | Scrape; lower volume |

**Business lobbies:**

| Organisation | Role | Notes |
|---|---|---|
| **BusinessNZ** | NZ's largest business advocacy network; engages government daily | Submissions, reports, media releases; `/articles` 404s, `/latest-news` 403 (bot protection on listing paths) → headless or sitemap path needed; probes at build week |
| **EMA** (Employers & Manufacturers Association) | NZ's largest business association; employment-relations advocacy | `/about-ema/media` 200 (287KB) — scrape; strong election-season output on employment policy |
| **ExportNZ** (BusinessNZ division) | Export/trade advocacy | scrape |
| **Sustainable Business Council** (BusinessNZ network) | Sustainability advocacy | scrape |

**Union bodies:**

| Organisation | Role | Notes |
|---|---|---|
| **NZCTU** (Te Kauae Kaimahi) | National union centre; ~360,000 members; policy submissions across wages, employment, housing | `union.org.nz/news` 200 (121KB) — scrape |
| **E tū** | Largest private-sector union (~48,600) | own site; scrape |
| **FIRST Union** (~30,500), **PSA** (largest public-sector union), **PPTA** (secondary teachers), **NZEI** (primary teachers), **ASMS** (salaried medical specialists) | Sector unions with election-season campaigns | scrape per-organisation |

**Sector peak bodies** (the organisations whose manifestos and data claims feed campaign material):

| Sector | Organisations | Notes |
|---|---|---|
| Rural/primary | **Federated Farmers**, **DairyNZ**, **Beef + Lamb NZ**, **Horticulture NZ**, **Forest Owners Association** | DairyNZ's advocacy pages verified extensive (freshwater, RMA reform submissions); these bodies publish sector statistics that get quoted by parties — checkable against official series |
| Infrastructure/construction | **Infrastructure NZ**, **Civil Contractors NZ**, **NZ Construction Industry Council**, **Property Council NZ** | Submissions and manifesto-style advocacy on housing/infrastructure policy |
| Health | **Cancer Society NZ** (Election Manifesto 2026 published), **NZ Medical Association**, **Royal NZ College of GPs**, **Mental Health Foundation**, **Public Health Association** | Manifesto season makes these directly claim-bearing |
| Social/community | **Salvation Army Social Policy Unit** (regular budget/child-poverty data analysis), **Child Poverty Action Group** (active in Election 2026 — challenging every party), **NZ Council of Christian Social Services**, **Age Concern**, **Disability sector bodies** (DPA, Access Matters), **Mental Health Foundation** | CPAG's election challenge series is exactly the claim class the pipeline checks |
| Māori/institutional | **National Iwi Chairs Forum** (and its Pou working groups), **FOMANA** (Māori business), iwi Post-Treaty entities (e.g. Ngāti Whātua Ōrākei, Wakatu Incorporation) | The Iwi Chairs Forum's Pou working groups produce policy positions across nearly all domains where policy affects Māori interests; iwi economic data claims are checkable against Stats NZ's Māori business data. Māori-language content remains out of scope for claim processing (SOURCE-TAXONOMY), but English-language releases from these bodies are in scope |
| Climate/environment | Major environmental NGOs' campaign claims; energy sector bodies (BusinessNZ Energy Council) | Checkable against emissions/environment series (MfE, NIWA) |

### Ingestion mechanics

- **Volume profile is modest**: most of these organisations publish weekly-to-monthly; the whole institutional lane is expected at ~30–80 items/day across all bodies during campaign peak — far below the news lane, but each item is a *primary claim source* (press releases and reports are self-published packages pairing claims with their own evidence, exactly the pattern the citation-check and stat-engine modes are built for).
- **No feeds found on the major bodies** (probed: NZ Initiative, Taxpayers' Union, NZCTU, BusinessNZ, NZIER all 404/403 on standard feed paths — BusinessNZ even 403s listing pages): the lane runs on **headless listing scrapes** per the ADR-0006 lane-3 mechanism, plus **Substack RSS where available** (verified for The Kākā and Democracy Project).
- **Parser-per-organisation** following the shared listing→item→clean-text contract; registered via config; publicly proposed via ADR-0013's source-proposal pathway — the register is published and party-blind, with organisations added by reach-in-their-sector criteria (the same criterion as the commentator watchlist, applied to institutions).
- **Polls get special handling**: advocacy-owned polls (Taxpayers' Union–Curia) are claims about public opinion — verifiable as methodological claims (sample, weighting, margin of error — against the declared methodology and other polls), not as evidence of party support. The provenance flag (who paid for the poll) rides on the record.
- **Manifestos**: election manifestos (Cancer Society 2026, CPAG challenge-to-parties, etc.) are ingested as claims-with-context documents at the publication level (ADR-0008) — each manifesto claim becomes a checkable pledge where quantified ("pledge — not yet checkable" where prospective).

### Guardrails

- **The lane is party-blind by construction** — organisations are added by sector-reach criteria via public decision record (ADR-0013), never by their political position (SOURCE-TAXONOMY §1.2's rule). The table above spans the spectrum because that is what sector reach produces, not by design.
- **Organisation pages are claim sources, never evidence** — an NZ Initiative report's statistics are checked against Stats NZ series; a Federated Farmers claim about farm-gate prices is checked against official data. The T1–T6 map (SOURCE-TAXONOMY) governs evidence; these organisations do not appear in it.
- **Institutional claims are attributed to organisation entities** (ADR-0005's entity model) — reliability profiles accrue per organisation, with the same guardrails as person/party profiles.
- **Lobbying-context provenance**: the Democracy Project's organisation profiles (and Bryce Edwards' lobbyist-watch writing) provide meta-context on funding and advocacy structures — useful as *link-out* provenance on organisation pages (like Wikipedia cross-links), never as verdict inputs.

## Alternatives considered

- **Treat these as commentator-watchlist entries.** Rejected: the watchlist handles *personalities*; institutions persist beyond individuals, publish reports/polls/manifestos as organisations, and need entity-level attribution. A separate lane with organisation entities is the cleaner model (and the commentator register mechanics are reused for the institutional register).
- **Include advocacy-produced data/polls as evidence.** Rejected: contradicts the authority map's design — evidence authorities are independently assessed for their domain; an advocacy body's own poll or analysis is exactly the thing to check, not to check with.
- **Only track the "big three" think tanks.** Rejected: the union federations, business lobbies, and sector manifestos are at least as claim-dense; sector bodies' data claims (Federated Farmers on rural crime, DairyNZ on freshwater) are quotable by parties within days.
- **Crawl their member organisations too** (e.g. every NZCTU affiliate, every BusinessNZ member). Deferred: the national bodies aggregate and publish the claims that circulate; affiliate-level content enters via submissions and media coverage. Extend lane coverage if claim volume justifies (the parser-contract makes a new org a config entry).
- **Skip institutional sources for 2026.** Rejected: this layer supplies the policy-relevant statistics and manifestos that campaign claims cite; missing it would blind the system to the upstream supply of the very claims parties repeat.

## Consequences

- **Ingestion gains a seventh lane** — institutional-claims — on the ADR-0006 lane-3 mechanics (headless scrapes, per-org parsers, health records per organisation).
- **~20–30 parser instances** at v1 scale (the table above), added progressively; Substack-RSS organisations first (zero marginal cost), scrape-based orgs by sector priority.
- **The claimant-entity model covers organisations** — already designed in ADR-0005; organisation pages become a public navigation surface ("what has BusinessNZ claimed, and what happened when we checked it?").
- **Advocacy-poll handling** is a new record shape (poll metadata: commissioner, field dates, sample, margin) — checkable for methodological claims, party-support numbers reported against the polling field with the provenance flag.
- **Volume estimate**: ~10–30 items/day across the lane at campaign peak; each a short document; batch-priced triage.