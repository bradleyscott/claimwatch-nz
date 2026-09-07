# Source coverage: verified access map

*Status: live probe results, 2026-09-07, from a NZ-routed connection using a standard browser User-Agent. Complements ADR-0002. This document exists because bot protection, dead feeds, or API gating on any cited source is a design risk, not a detail — everything here was tested, not assumed.*

*Probes used `curl` with `Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0` from the project's dev environment. Single-point-in-time results; re-verify before build week and monitor in production.*

---

## 1. Verified working (tested, content confirmed)

| Source | Endpoint | Result | Notes |
|---|---|---|---|
| **Beehive releases** | `https://www.beehive.govt.nz/rss.xml` | **200, valid RSS, 30 items** | Primary lane confirmed. Feed index also at `/feeds`. |
| **RNZ politics** | `https://www.rnz.co.nz/rss/political.xml` | **200, valid RSS, 16 items** | Full feed index at `/rss` (national, world, te-manu-korihi, māori, health, education, ldr, pacific, etc. — ~20 feeds). Licence: personal-use terms; use as claim source, never syndicate. |
| **Stuff politics** | `https://www.stuff.co.nz/rss?section=/politics` | **200, valid Atom, 25 items** | Note: section is `/politics` (not `/nz-politics`). Feed root: `stuff.co.nz/rss`. |
| **NZ Herald NZ section** | `https://www.nzherald.co.nz/arc/outboundfeeds/rss/section/nz/?outputType=xml&_website=nzh` | **200, valid RSS, but only 2 items** | Feed exists and is unprotected, but thin/flaky. See risks below. |
| **NZ Herald article pages** | e.g. `nzherald.co.nz/nz/politics/` | **200, 1.1MB HTML** | No bot challenge (Cloudflare-era openresty serves content to standard UA). Listing pages are JS-rendered Next.js — needs headless rendering or feed-only ingestion. |
| **Hansard** | `https://hansard.parliament.nz/hansard-debates` | **200** | Official transcripts; downloadable debates. |
| **Parliament TV on-demand** | `parliament.nz/en/watch-listen-act/in-demand/` | **200** | Deferred for v1 (ADR-0002) but access confirmed for the post-election transcription path. |
| **Stats NZ Aotearoa Data Explorer** | `https://explore.data.stats.govt.nz/` | **200** | Serves an SDMX/JSON API (documented); `robots: noindex` on the SPA shell but data API is the intended machine access. Topic packs depend on this. |

## 2. Verified problematic (tested, degraded or blocked)

| Source | Problem | Impact | Mitigation |
|---|---|---|---|
| **NZ Herald politics feed** | `section/politics` returns a valid-but-empty RSS (811B, 0 items); `section/nz` returns only 2 items | The most important commercial outlet's feed is effectively non-functional for politics | (a) Use `/section/nz` + headless listing scrape as backup; (b) NZH political claims nearly always surface same-day in free outlets (RNZ/Stuff/1News) — dedupe handles it; (c) user submissions; (d) NZH is also the paywalled source per ADR-0002 policy — lower priority anyway |
| **NZ Herald legacy feed URLs** (`rss.nzherald.co.nz/*`) | 404 | Old documented endpoints are dead | Use the `arc/outboundfeeds` URLs only |
| **Scoop.co.nz** | All known feed paths 404; `/feeds/` directory 403 (Apache/1.3.41 — ancient stack) | The party-release aggregator backstop isn't machine-accessible | Drop as a feed source; keep as a manual reference. Party sites scraped directly instead |
| **Labour Party media hub** | `labour.org.nz/media_hub` → 404 | Path wrong or moved | Locate current path at build time; site itself serves (404 came from their CMS, not a block) |
| **NZ First** | `www.nzfirst.org.nz` — DNS does not resolve | Site down or domain changed | Verify current domain at build time; NZ First releases also appear on Scoop (manual) and in news coverage |
| **Te Pāti Māori** | `tepatimaori.co.nz` serves a domain-parking page | Wrong/abandoned domain | Verify current domain at build time |
| **MoJ data page** | Probed path 404 | Wrong path, not protection | Find correct URL from justice.govt.nz sitemap at build time |

## 3. Party sites: no RSS anywhere; JS-rendered

All party sites tested (National on Vercel/Next.js, ACT on Framer, Greens JS-heavy) return HTML shells with client-rendered content — **no RSS feeds offered by any party**. Consequences:

- Ingestion needs **headless-browser rendering** (Playwright) for party pages — a known, bounded cost: 6 sites, checked a few times daily.
- Alternative: parties' releases are mirrored within hours by Beehive (for ministers) and news outlets; scraping covers the rest (backbench releases, opposition attacks).

## 4. Bot-protection posture (overall finding)

**No source tested presented a bot challenge** (no Cloudflare interstitials, no 403s on content) to a standard browser UA from a NZ connection. Caveats, honestly stated:

- Single-probe results: no rate-limit testing was done. At production crawl volume, rate limiting or challenges may appear — build the ingestion layer with: per-source polite rate limits, cached responses, exponential backoff, and a **headless-render fallback** for JS-protected pages.
- NZ Herald runs openresty + Arc (WP Engine) stack; the Arc feeds are the *intended* machine interface — prefer them over scraping.
- The project's dev environment is NZ-routed; if hosted offshore later, re-test (some CDNs geo-challenge).

## 5. Feed inventory (for the ingestion config)

Working endpoints as of this probe — to be pinned in ingestion config:

```
behive-releases:  https://www.beehive.govt.nz/rss.xml              (RSS, 30 items)
rnz-politics:     https://www.rnz.co.nz/rss/political.xml          (RSS, 16 items)
rnz-national:     https://www.rnz.co.nz/rss/national.xml           (index at /rss)
stuff-politics:   https://www.stuff.co.nz/rss?section=/politics    (Atom, 25 items)
nzh-nz:           https://www.nzherald.co.nz/arc/outboundfeeds/rss/section/nz/?outputType=xml&_website=nzh  (RSS, thin)
```

RNZ also offers: `national.xml`, `world.xml`, `te-manu-korihi.xml`, `health.xml`, `education.xml`, `ldr.xml` (Local Democracy Reporting — good regional politics coverage), `pacific.xml`.

## 6. Actions arising

1. Pin the verified feed inventory in ingestion config; add per-source health checks with alerting (a silently empty feed is the failure mode NZH just demonstrated).
2. Playwright headless-render path for party sites; keep per-party parsers in one module so site redesigns are a one-file fix.
4. Re-probe all sources during build week 1 and before the campaign peak (feeds get withdrawn without notice — RNZ's terms already restrict reuse). See `docs/COVERAGE.md` for the verified access map.
5. Add the monitoring note to ADR-0002: **coverage is a maintained property, not a one-time setup** — the health-check dashboard is part of the pipeline, not ops afterthought.
6. Verify NZ First / Te Pāti Māori current domains and Labour's media-hub path at build week 1.