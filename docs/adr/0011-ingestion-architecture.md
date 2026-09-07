# ADR-0011: Ingestion architecture — six lanes, health-checked, feeding the evidence store

*Status: Proposed · Date: 2026-09-08 · Deciders: Bradley, Dave*

## Context

ADR-0002 fixes the ingestion **scope** (six lanes: Beehive, party releases, Hansard, news RSS, user submissions, commentator watchlist) and its **legal posture** (fetch-from-source, paywall policy, HDCA). `docs/COVERAGE.md` holds live probe results for every source. ADR-0009 provides the public-proposal pathway for new sources. ADR-0010 defines the destination: the claim-anchored evidence store, whose claimant-entity resolution needs **attributed, source-linked documents** from day one.

What remains is the ingestion **architecture**: the pipeline shape, per-lane mechanics, deduplication, health checking, and how ingested documents become attributed claims. This ADR assumes the scope decisions in ADR-0002 and does not revisit them.

## Decision

### Pipeline shape

```
[6 lanes] → normalise → attribute (claimant resolution) → dedupe-by-claim
          → claim detection (LLM triage) → evidence store → verification queue
```

Ingestion produces **documents with provenance** — never bare text. Every document entering the pipeline carries: source ID, canonical URL, retrieval timestamp, retrieval method (feed / scrape / headless render / submission re-fetch), and content hash. This provenance is what makes verdict pages auditable and what anchors ADR-0010's attribution.

### Lane mechanics

| Lane | Mechanism | Cadence | Notes |
|---|---|---|---|
| **Beehive** | RSS (`/rss.xml`) + full-item fetch | 15 min | Primary lane; ministers' releases. Full text from item pages (static HTML, cheap) |
| **Party releases** | Playwright headless render of release-listing pages; per-party parser | 2 h, staggered | No party offers RSS (COVERAGE §3); sites are JS-rendered. Verified domains: `www.nzfirst.nz`, `www.maoriparty.org.nz`; others located at build week (Labour hub 404s, TPM `/news` 404 — discover by crawl). Parser per site, sharing a common "listing → item → clean text" contract |
| **Hansard** | Official daily transcripts (download + parse) | Daily batch | Speaker attribution is structural (Hansard markup) — the cleanest claimant-entity source. Feeds person-entity resolution directly |
| **News RSS** | RNZ (~20 feeds), Stuff Atom, NZH `arc/outboundfeeds` (thin — see risks), Newsroom, The Post, The Press | 15 min | Claim-source and context lane. Full-item fetch only for items that pass triage (fetch-on-verify: headlines are cheap, articles are not) |
| **User submissions** | Form → server-side re-fetch (ADR-0002 rules) | Event-driven | Never trusted; rate-limited; HDCA process attached |
| **Commentator watchlist** | Per-register-entry: outlet RSS where free, own-site scrape, platform RSS where legitimate (Substack), submissions otherwise | 2 h, staggered | Register mechanics per ADR-0002 |

### Health checking (the silently-empty-feed failure mode)

Every lane and every feed has a **health record** with per-source monitors:

- **Liveness**: fetch succeeded, parse succeeded, N items in window. A source returning 200 with zero items for 24 h (the NZH politics-feed failure mode) alerts — "valid feed, no content" is a distinct alarm from "fetch failed".
- **Structural drift detection**: party parsers depend on unversioned site markup. A parser returning zero items while the site is up (checked via a known-stable marker element) means the site changed — alert, don't silently ingest nothing.
- **Volume anomaly**: item counts outside the source's rolling band (a party suddenly publishing 10× releases, a feed going quiet) alert for review.
- **Escalation ladder**: retry with backoff → headless-render fallback → source marked degraded (visible on the site's public coverage page) → maintainer alert. Never silently absent: if the pipeline can't see a source, the site says so.
- **Re-probe cadence**: full COVERAGE.md re-verification at build week 1, before campaign peak, and monthly in production.

### Deduplication (by claim, not by document)

The same claim surfaces in a Beehive release, three party sites, and five outlets. Dedupe operates at the **claim** level after claim detection, not the document level before it:

1. **Document-level** dedupe only for identical content (syndicated copies).
2. **Claim-level**: fingerprint + embedding match (the ADR-0010 repeat mechanism). A repeat claim gains a source-occurrence ("claimed by X in Hansard, repeated by Y on RNZ") rather than a new queue entry — occurrences strengthen the claim's importance score.
3. **Cross-lane provenance** is preserved: the claim's page shows everywhere it appeared — that's part of the fuller picture (and is what makes "everyone was saying it" auditable as fact, not memory).

### Fetch-from-source discipline (uniform)

Every lane obeys the ADR-0002 rule, implemented once: **stored canonical URL → server-side re-fetch at verification time → verify against what the source serves now**. Submission lane, commentator lane, and news lane share the same fetcher with the same archive-fallback ladder (direct → archive.today → Wayback). Paywall policy per ADR-0002 applies uniformly.

### Attribution handoff

Ingestion resolves **where the claim came from** (document + speaker, conservatively per ADR-0010) and passes claimant-entity candidates to the store. Hansard provides the strongest attribution signal; party releases attribute to the party entity; news items attribute to the quoted speaker with the article as source link. Attribution never guesses (ADR-0010).

## Alternatives considered

- **Single monolithic scraper with per-source plugins.** Rejected for v1: six lanes have genuinely different shapes (feed / headless / batch / event); a common interface over all of them hides lane-specific failure modes (a plugin that breaks inside a monolith is invisible until its health record alerts anyway). Lanes share the normalise/attribute/dedupe stages but run as separate workers.
- **Third-party news-aggregation API** (e.g. commercial media monitoring) for the news lane. Rejected: cost, licence terms, and it reintroduces a dependency ADR-0003 rejected; RSS + targeted headless fetch covers the need.
- **Deduplicate at document level only.** Rejected: the unit of public value is the claim; document-level dedupe would show the same claim as six separate verdicts, fracturing the record and triple-charging verification cost.
- **Queue sources by reach/importance statically.** Deferred: queue priority is dynamic (submissions bump, occurrences accumulate); a static importance table invites "you prioritised our opponents' outlets" arguments. Order of ingestion ≠ order of verification.

## Consequences

- **Build order**: RSS lanes first (week 1), Hansard parser + headless party renderers (week 1–2), submissions form (week 2, ships with HDCA process), commentator watchlist last (week 3) — it is a configuration of mechanisms the other lanes already provide.
- **The parser contract** (listing → item → clean text + provenance) is the reusable unit; a new party site or commentator outlet is a new parser instance, registered via config, proposed publicly via ADR-0009.
- **Health monitoring is not optional infrastructure** — it ships with the first lane, not after launch; the public coverage page is its user-facing face.
- **Playwright headless rendering is a bounded, known cost**: ~6 party sites + a few commentator sites, checked a few times daily, from a NZ-routed egress. Re-probe before relying on it at scale (COVERAGE.md cadence).
- **Ingestion never writes verdicts** — it fills the store with attributed, provenance-carrying documents and detected claims; verification is a separate queue (separation that also enforces the ADR-0010 firewall: ingestion knows claimant identity, verification must not use it).