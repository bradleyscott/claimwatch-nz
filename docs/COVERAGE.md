# Source coverage: verified access map

*Live probe results, 2026-09-07, NZ-routed connection, standard browser User-Agent (`Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0`, curl). Complements ADR-0006. Bot protection, dead feeds, or API gating on any cited source is a design risk, not a detail — everything here was tested, not assumed. Single-point-in-time; re-verify at build week and monitor in production.*

## 1. Verified working (tested, content confirmed)

| Source | Endpoint | Result | Notes |
|---|---|---|---|
| **Beehive releases** | `https://www.beehive.govt.nz/rss.xml` | **200, valid RSS, 30 items** | Primary lane confirmed. Feed index also at `/feeds`. |
| **RNZ politics** | `https://www.rnz.co.nz/rss/political.xml` | **200, valid RSS, 16 items** | Full feed index at `/rss` (~20 feeds). Licence: personal-use terms; claim source only, never syndicated. |
| **Stuff politics** | `https://www.stuff.co.nz/rss?section=/politics` | **200, valid Atom, 25 items** | Section is `/politics` (not `/nz-politics`); feed root `stuff.co.nz/rss`. |
| **NZ Herald NZ section** | `https://www.nzherald.co.nz/arc/outboundfeeds/rss/section/nz/?outputType=xml&_website=nzh` | **200, valid RSS, but only 2 items** | Exists and is unprotected, but thin/flaky — see risks. |
| **NZ Herald article pages** | e.g. `nzherald.co.nz/nz/politics/` | **200, 1.1MB HTML** | No bot challenge (openresty serves standard UA). Listing pages JS-rendered Next.js — headless rendering or feed-only ingestion. |
| **Hansard** | `https://hansard.parliament.nz/hansard-debates` | **200** | Official transcripts; downloadable debates. |
| **Parliament TV on-demand** | `parliament.nz/en/watch-listen-act/in-demand/` | **200** | Deferred for v1 (ADR-0007) but access confirmed for post-election transcription. |
| **Stats NZ Aotearoa Data Explorer** | `https://explore.data.stats.govt.nz/` | **200** | SDMX/JSON API (documented); `robots: noindex` on the SPA shell but the data API is the intended machine access. The claim-anchored evidence store (ADR-0005) depends on this. |

## 2. Verified problematic (tested, degraded or blocked)
| Source | Problem | Impact | Mitigation |
|---|---|---|---|
| **NZ Herald politics feed** | `section/politics` returns valid-but-empty RSS (811B, 0 items); `section/nz` only 2 items | The most important commercial outlet's feed is effectively non-functional for politics | (a) `/section/nz` + headless listing scrape as backup; (b) NZH political claims nearly always surface same-day in free outlets (RNZ/Stuff/1News) — dedupe handles it; (c) user submissions; (d) NZH is paywalled per ADR-0006 policy — lower priority anyway |
| **NZ Herald legacy feed URLs** (`rss.nzherald.co.nz/*`) | 404 | Old documented endpoints dead | Use the `arc/outboundfeeds` URLs only |
| **Scoop.co.nz** | All known feed paths 404; `/feeds/` 403 (Apache/1.3.41) | The party-release aggregator backstop isn't machine-accessible | Drop as a feed source; keep as manual reference. Party sites scraped directly |
| **Labour Party media hub** | `labour.org.nz/media_hub` → 404 | Path wrong or moved | Locate current path at build; the site serves (404 from their CMS, not a block) |
| **NZ First** | `www.nzfirst.org.nz` — DNS does not resolve | Domain changed | **Resolved by second probe: `www.nzfirst.nz`** |
| **Te Pāti Māori** | `tepatimaori.co.nz` serves a domain-parking page | Wrong/abandoned domain | **Resolved by second probe: `www.maoriparty.org.nz`** |
| **MoJ data page** | Probed path 404 | Wrong path, not protection | Find correct URL from justice.govt.nz sitemap at build |

## 3. Party sites: no RSS anywhere; JS-rendered

All party sites tested (National on Vercel/Next.js, ACT on Framer, Greens JS-heavy) return HTML shells with client-rendered content — **no party offers RSS**. Consequences:

- Ingestion needs **headless-browser rendering** (Playwright) for party pages — bounded: 6 sites, checked a few times daily.
- Parties' releases are mirrored within hours by Beehive (for ministers) and news outlets; scraping covers the rest (backbench releases, opposition attacks).

## 4. Bot-protection posture (overall finding)

**No source tested presented a bot challenge** (no Cloudflare interstitials, no 403s on content) to a standard browser UA from a NZ connection. Caveats:

- Single-probe results; no rate-limit testing. At production crawl volume, rate limiting may appear — build ingestion with per-source polite rate limits, cached responses, exponential backoff, and a **headless-render fallback**.
- NZ Herald runs openresty + Arc (WP Engine); the Arc feeds are the *intended* machine interface — prefer them over scraping.
- The dev environment is NZ-routed; if hosted offshore later, re-test (some CDNs geo-challenge).

## 5. Feed inventory (for the ingestion config)

Working endpoints as of this probe — to be pinned in ingestion config:

```
beehive-releases: https://www.beehive.govt.nz/rss.xml              (RSS, 30 items)
rnz-politics:     https://www.rnz.co.nz/rss/political.xml          (RSS, 16 items)
rnz-national:     https://www.rnz.co.nz/rss/national.xml           (index at /rss)
stuff-politics:   https://www.stuff.co.nz/rss?section=/politics    (Atom, 25 items)
nzh-nz:           https://www.nzherald.co.nz/arc/outboundfeeds/rss/section/nz/?outputType=xml&_website=nzh  (RSS, thin)
```

RNZ also offers: `national.xml`, `world.xml`, `te-manu-korihi.xml`, `health.xml`, `education.xml`, `ldr.xml` (Local Democracy Reporting — good regional politics coverage), `pacific.xml`.

## 6. Actions arising

1. Pin the verified feed inventory in ingestion config; per-source health checks with alerting (a silently empty feed is the failure mode NZH just demonstrated).
2. Playwright headless-render path for party sites; per-party parsers in one module so site redesigns are a one-file fix.
3. Re-probe all sources at build week 1 and before the campaign peak (feeds get withdrawn without notice — RNZ's terms already restrict reuse).
4. **Coverage is a maintained property, not a one-time setup** — the health-check dashboard is part of the pipeline (ADR-0006), not an ops afterthought.
5. Verify NZ First / Te Pāti Māori domains (second probe found `www.nzfirst.nz` and `www.maoriparty.org.nz`) and Labour's media-hub path at build week 1.