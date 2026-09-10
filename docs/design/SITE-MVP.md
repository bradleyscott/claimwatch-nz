# Website MVP design

*Status: proposed. Companion docs: docs/WEBSITE-UX-RESEARCH.md, docs/VALIDATION-SLICE.md, docs/TEST-STRATEGY.md, docs/design/CROSS-CUTTING.md. ADRs: 0002, 0004, 0007, 0014.*

## 1. Purpose and slice scope

The site MVP is the "sufficient to publicise and get feedback" surface from VALIDATION-SLICE §"The website MVP": the discovery + presentation spine over the store, with no accounts, no contestation, no submissions. It exists to (a) make the slice's verdicts publicly demoable — including the "hear it / watch it" broadcast moment, (b) open the ClaimReview JSON-LD discovery channel from day one, and (c) collect user feedback about the site while the campaign is still building.

### In scope (7 components)

| # | Component | Summary |
|---|---|---|
| 1 | Claim cards + verdict pages | SSR Next.js pages: verdict + confidence up top, verbatim quote with attribution, one-sentence plain verdict, "as deployed" tag, "hear it / watch it" media_anchor deep links (ADR-0007) |
| 2 | ClaimReview JSON-LD | schema.org `ClaimReview` on every verdict page — the Google Fact Check Explorer / SEO discovery channel (VALIDATION-SLICE, UX research §"What to skip") |
| 3 | Feed + topic facets | recency-ranked feed on the homepage; facet filters by person / party / topic / verdict, all from the structured store |
| 4 | Entity pages | person / party / institution pages with verdict distributions (the track-record retention driver per UX research §"Page 4") |
| 5 | Methodology page | four-verdict schema + AVeriTeC mapping + pipeline description + the **measured accuracy table generated from the harness output file** (never hand-edited) |
| 6 | Feedback widget | thumbs + free text + optional email on every page; feedback *about the site*, not a claim-submission system |
| 7 | Per-claim pipeline provenance block | pipeline version, prompt version, confidence, transcript tier — the transparency feature visible to early users |

### Explicitly out of scope (VALIDATION-SLICE, verbatim list)

Contestation UI · submission system · argument-chain views · debate-night live tracker · newsletters · entity reliability profiles. Each is a follow-on slice. Concretely, this means: no contest form, no "disagree?" flow (the verdict page may *name* that contestation exists post-slice, but renders no UI for it), no argument-graph rendering, no real-time updating views, no reliability/scorecard aggregates beyond the verdict-distribution counts on entity pages.

### What the MVP realises from docs/mockups/

| Mockup | Realised in MVP? |
|---|---|
| `claim-page.html` (v7 card arrangement) | Yes — the verdict page template |
| `claim-page-stat.html` | Yes — statistical-claim variant (stat grid rendering, "as deployed" tag) |
| `claim-page-promise.html` | Partial — pledge/conditional state rendering only (ADR-0004), no promise tracker |
| `feed.html` | Yes — homepage feed + facets |
| `mockup-claim-v6-fold.png`, `mockup-claim-stat.png`, `mockup-claim-promise.png`, `mockup-feed.png`, `verdict-card-detail.png` | Visual references for the above |
| `mockup-entity.png` | Partial — entity pages without reliability profiles or chains |
| `entity-chain-submit.html` | **No** — chain + submission views are out of scope; do not build from it |

## 2. Design

### 2.1 Page set

| Route | Purpose | Source |
|---|---|---|
| `/` | Recency-ranked feed of verdict cards; facet rail (person / party / topic / verdict) | claim cards |
| `/claim/[id]` | Verdict page (the atom; canonical URL for ClaimReview) | claim cards + evidence pack |
| `/person/[slug]`, `/party/[slug]`, `/institution/[slug]` | Entity pages: claim list + verdict distribution | entity pages |
| `/topic/[slug]` | Topic facet as a page (shareable) | facets |
| `/methodology` | Four-verdict schema, AVeriTeC mapping stated verbatim, pipeline description, coverage gaps named honestly (ADR-0007), measured-accuracy table | methodology page |
| `/about` | Short project page: what ClaimWatch is, open-source posture, link to methodology | methodology page |
| every page | Feedback widget (fixed, dismissible) | feedback capture |

Non-route components: the feedback widget (§2.5) and the per-claim provenance block (rendered inside verdict pages, §2.5). No sitemap-page beyond these ships — anything else visible in the mockups is either out of scope (§1) or an open question (§6).

### 2.2 Register rules (from Bradley's direction + UX research)

Two registers are a hard rule: **public layperson pages** (everything in this component) vs **internal technical docs** (repo docs). The MVP must not leak the technical register onto public pages. The register is also asymmetric by page: the methodology page is the *one* public page whose job is explaining the machinery, so it is allowed plain-English descriptions of technical concepts — but it still avoids unexplained jargon and never uses the internal vocabulary without translation.

1. **Verdict-first hierarchy, fixed order on every verdict page:** (a) verbatim claim + subtle attribution → (b) big coloured verdict mark (the v7 verdict card arrangement — band + pin, not a smiley meter) → (c) one-sentence plain-language verdict → (d) "as deployed" tag (one line, not a paragraph) → (e) "hear it / watch it" control (broadcast claims) → (f) evidence pack / "what we checked against" → (g) pipeline provenance → (h) related claims last.
2. **Confidence de-emphasised:** confidence appears as small metadata text (e.g. in the verdict card's meta row and the provenance block), never as a meter, bar, star rating, or headline element. Design says it; the tests enforce it (SIT-R6).
3. **Claims, not persons (ADR-0002):** generated verdict text and all site copy address claims and evidence; character statements ("lied", "dishonest") are structurally impossible in generated copy and banned in template strings. The verdict language is the ADR-0004 mapping: Supported / Refuted / Not enough evidence (open question) / **Accurate but incomplete**. No degree-slider language ("mostly true") anywhere.
4. **Layperson language:** no "sensitivity grid", "extraction ladder", "NLI audit", "Tier-2 caption", "stratum" on public pages. The methodology page translates each to plain English and states the AVeriTeC mapping verbatim. Technical terms appear only in the provenance block, which is explicitly a technical transparency feature and is visually secondary.
5. **Gaps named, not hidden:** the methodology page states coverage limits (e.g. audio-only sources out of scope per ADR-0007; caption-derived claims flagged) in the same plain register.

### 2.3 Verdict-page anatomy (data → section mapping)

| Section (order) | Store field(s) | Notes |
|---|---|---|
| Claim quote + attribution | `claim.text` (verbatim, highlighted span), speaker → entity ref, publication/segment ref (ADR-0008) | Attribution subtle; the quote is the anchor (Snopes lesson) |
| Verdict mark + label | `verdict.class` (four classes) → colour/glyph per v7 palette | "Accurate but incomplete" gets its own distinct visual treatment |
| One-sentence plain verdict | `verdict.plain_summary` | Generated, must pass register checks |
| "As deployed" tag | `claim.deployment_context` (ADR-0008) | Small tag |
| Hear it / watch it | `claim.media_anchor` `{media_url, start_s, end_s, deep_link}` | Rendered only when present; see §3.3 |
| Evidence pack | evidence items: linked source, authority tier (T1–T6), plain-language reasoning | "Show your work" after the answer |
| Pipeline provenance block | `verdict.pipeline_version`, `verdict.prompt_version`, `verdict.confidence`, `claim.transcript_tier`, caption-quality flag | Small type; the honesty feature |
| Related claims | store adjacency (fingerprint/pgvector) | Last; de-scoped chains do not appear |

Ordering is a design invariant, not a suggestion: the verdict must be visible without scrolling (UX research finding 1) and "show your work" comes after the answer (finding 6). The §5 register/snapshot tests assert section order, not just presence.

### 2.4 Data flow

```
packages/pipeline ──writes──▶ Postgres (packages/store, Drizzle schema)
                                 │
                    site reads (server components, read-only)
                                 │
      apps/site ── SSR HTML (verdict in first response) + ClaimReview JSON-LD
                                 │
      apps/site ── feedback widget POST ──▶ feedback table (thumbs, text, optional email)
```

- **Stack per ADR-0014:** TypeScript, SSR Next.js (`apps/site`), shared Drizzle schema in `packages/store` — the site is a *reader* over the same typed store the pipeline writes. No new services; no client-side data fetching for the verdict-first content (it must be in the SSR HTML for SEO and no-JS resilience).
- **Freshness:** verdict pages must reflect store mutations (contestation mutations, re-verifications). Mechanism: on-demand revalidation — the pipeline's store writer triggers the site's revalidation webhook for affected claim/entity/feed routes on every verdict mutation. Cache lifetime on verdict pages is short; the feed is always rendered from the live store.
- **Accuracy-table generation path:** the L3 harness run writes a versioned output file (JSON: per-stratum accuracy, agreement stats, cost per claim) into the repo/registry (TEST-STRATEGY §2 L3: "a scoring run's output lands in a versioned file that the site's methodology page renders"). The methodology page imports that file at build time and renders the table from it. There is no code path that edits the numbers by hand; a CI equality test asserts rendered table == harness file (§5). When a new harness run lands, the file changes, the table changes with it.
- **Feedback widget:** client component POSTs `{page_url, thumbs, text, email?}` to one endpoint writing to a feedback table. Rate-limited; email optional and never displayed. It is not a claim-submission intake and stores no claim pointers.

### 2.5 Component notes

**Claim card (feed atom).** Each card: verbatim quote (highlighted span) + subtle attribution line → verdict mark (coloured band + label) + one-sentence plain verdict → "as deployed" tag when present → "hear it / watch it" pill when `media_anchor` present → link to the verdict page. The card is self-contained and quotable (PolitiFact feed-item lesson): a user should be able to screenshot a card and have it carry the whole finding. No confidence on the card face except in the small meta row.

**Verdict page.** The SSR-rendered atom (§2.3 anatomy). Canonical URL is stable per claim id; verdict mutations change content, not the URL. The verdict card uses the v7 arrangement (band + pin + big verdict word) with "Accurate but incomplete" visually distinct from Supported — that class is the flagship (ADR-0004) and its plain verdict teaches the media-literacy point. "Not enough evidence" renders as an honest open question ("we could not verify this") per ADR-0004's abstention posture, never as a failure state.

**Feed.** Recency-ranked by verdict publication; facet rail (person / party / topic / verdict) filters server-side (URL-encoded query params, so filtered views are shareable and crawlable). Pagination, not infinite scroll — keeps SSR simple and every card URL-addressable.

**Entity pages.** Person / party / institution: header (name, description), verdict distribution (counts per class with the same colour coding — a bar of segments, not a score), claim list (cards). Person pages group by deployment context where present. Publisher-level framing ("claims carried") is deliberately avoided in v1 copy to stay within claims-not-persons.

**Methodology page.** Sections: (1) what ClaimWatch is and is not (automated, contestable; not a human fact-check desk); (2) the four-verdict schema with the AVeriTeC harness-label mapping stated verbatim (ADR-0004) — static prose, hand-written is fine; (3) how verification works per mode, in plain language (stat series checked against official data; quotes checked against the recorded clip; cited sources checked; gaps named); (4) the measured-accuracy table, generated (§3.4); (5) known coverage gaps (audio-only sources out of scope; caption-derived claims flagged; Māori-language claims out of scope).

**Feedback widget.** Fixed dismissible control on every page: thumbs up/down, free text, optional email, submit → single endpoint. Copy states what is stored and why. No claim-pointer input field — anything that looks like "submit a claim for checking" is the post-slice submission system and must not appear.

**Provenance block.** Small-collapsed "how this verdict was produced" block: pipeline version, prompt version, confidence, transcript tier ("publisher-reviewed" vs "auto-generated captions" in plain words), caption-quality note where applicable. It is the one place technical vocabulary is permitted, and it is visually secondary (grey, small, collapsed by default).

**Methodology-table generation, concretely.** Build sequence: L3 harness run → writes `packages/harness/output/latest-accuracy.json` (schema: run id, model/prompt versions, per-stratum accuracy, agreement, cost/claim, generated timestamp) → `apps/site` methodology build step reads the file with Zod validation → renders the table. A missing or schema-invalid artifact **fails the site build** (no table rendered from stale cache); the CI equality test then compares the rendered table's numbers to the file. The table also displays the run id and generation provenance, so a published number carries its own audit trail.

### 2.6 What the MVP deliberately does not render

No contest form or "disagree?" flow (the methodology page may say contestation exists post-slice). No argument-chain graphs or load-bearing/break marks. No live tracker or debate view (debate claims enter the normal feed when verified). No newsletters. No reliability profiles or trust scores on entity pages — verdict *distributions* (counts) only. No reader claim intake.

### 2.7 Rendering, SEO, and crawlability

- **SSR everywhere that matters.** Verdict content (quote, verdict mark, plain verdict, ClaimReview JSON-LD, hear-it control) is rendered in server components and present in the initial HTML — for Google's Fact Check Explorer, for social unfurlers, and for no-JS resilience. Client components are limited to the feedback widget and progressive interactions; none of them gate content.
- **Per-page metadata:** title pattern "claim (short) — verdict — ClaimWatch NZ"; description from the plain verdict; OG image either the shared verdict-card image or (if SIT-Q6 resolves yes) a generated per-verdict OG image.
- **Structured data inventory:** `ClaimReview` on verdict pages; `BreadcrumbList` on entity/methodology pages; `Organization` site-wide. Nothing else — no fabricated `Article` markup, since a verdict page is a review, not news.
- **Crawl discipline:** facet combinations explode combinatorially, so only the canonical facet pages (`/topic/[slug]`, plus entity pages) are linked and crawlable; query-param filter permutations carry `rel="nofollow"`, and a robots rule keeps empty-state facet permutations out of the index.
- **Mutation → URL stability:** verdict mutations update page content and `datePublished`; claim ids never change. A mutated verdict keeps its URL so that shared links and indexed ClaimReview entries converge on the current verdict.

### 2.8 Observability and operations (per ADR-0012)

- **Site telemetry routes to Grafana Cloud** via the same OTel stack as the pipeline: request spans (route, status, p95 latency) from the Next.js server; feedback-endpoint spans (accept/reject/rate-limit counts); revalidation-webhook events (claim id, mutation → revalidate → confirm) so a mutation whose revalidation silently fails is *visible*, not just a stale page (SIT-R7's detection signal).
- **Liveness checks** (ADR-0012's silence-detection): a periodic check renders one pinned verdict page fixture and asserts the verdict text and ClaimReview script are present in the SSR HTML — an SSR template regression or empty store read alarms instead of quietly blanking the page.
- **Error surface:** server-side render errors and hydration-error counts are captured as metrics/logs (hydration errors are also a L4a CI assertion, but production hydration failures — e.g. from live data edge cases — need the runtime signal too).
- **Config:** env + `.env` per ADR-0014 (store DSN, revalidation secret, feedback rate-limit config); no new services beyond Postgres + the Next.js app.

## 3. Interfaces and contracts

### 3.1 Store reads (site ⇄ packages/store)

The site consumes the same typed Drizzle schema as the pipeline (ADR-0014: single definition). Reads used:

| Query | Shape | Used by |
|---|---|---|
| claim by id (+ verdict + evidence pack + media_anchor) | full claim record | verdict page, ClaimReview |
| feed page | claim cards ordered by verdict `published_at` desc, paginated | homepage |
| facet counts | group-by person / party / topic / verdict class | facet rail, entity pages |
| verdict distribution per entity | counts per class + n | entity pages |
| related claims | fingerprint/pgvector adjacency, capped | verdict page |
| harness accuracy file | JSON artifact (build-time read, not a DB query) | methodology page |

The site package holds **no write path** to claims/verdicts (the only write is the feedback table). This is a structural boundary, not a convention: `apps/site` imports only the store package's read-query module, and a lint rule (or package-export boundary) prevents importing the writer.

### 3.2 ClaimReview JSON-LD shape

Every `/claim/[id]` page emits one `ClaimReview` object in a `<script type="application/ld+json">` rendered server-side:

| Field | Source | Notes |
|---|---|---|
| `@type` / `@context` | constant | `https://schema.org` |
| `url` | canonical claim URL | absolute |
| `author` | ClaimWatch NZ `Organization` | the reviewer of record |
| `datePublished` | verdict `published_at` | updated on mutation (revalidate) |
| `itemReviewed` | claim text + appearance (speaker, publication/segment ref) | verbatim quote |
| `reviewRating` | verdict class mapped to `alternateName` + numeric `ratingValue` (worst/best declared) | **mapping of the four classes to numbers is undecided → §6** |
| `reviewBody` | the one-sentence plain verdict | must pass register checks |

Contract: schema-valid per schema.org, present in the initial SSR HTML (not injected client-side), one object per verdict page. Malformed JSON-LD fails silently in the wild — Google simply drops the page from Fact Check Explorer with no error anywhere — so CI validation is mandatory, not advisory (SIT-R1).

### 3.3 media_anchor link contract (the "hear it / watch it" demo moment)

Per ADR-0007, the claim record carries `media_anchor = {media_url, start_s, end_s, deep_link}` for every caption/video-derived claim.

- The verdict page renders a **"hear it / watch it"** control **iff** `media_anchor` is present. No claim shows a dead or placeholder control; the inverse also holds — a claim with an anchor must never render without the control.
- `deep_link` must resolve to a player state at (or within a small pad of) `start_s` — YouTube `t=`/`end=` parameters for broadcaster uploads; item-page embeds with segment identification for RNZ/ZB written items (ADR-0007).
- The rendered control's href is built **only** from the stored anchor; no client-side rewriting or timestamp re-derivation (re-deriving timestamps in JS is how deep links silently rot).
- Tier-2 (auto-generated caption) claims render the caption-quality note next to the control, linking video + timestamp for reader verification (ADR-0007).
- Label wording follows the medium: "hear it" for audio-bearing items, "watch it" for video; the wording is a rendering decision on the site, the anchor contract is the store's.

### 3.4 Harness-output contract (methodology table)

- **Producer:** L3 harness run (TEST-STRATEGY §2) → versioned JSON artifact in the repo (path fixed; e.g. `packages/harness/output/latest-accuracy.json`).
- **Consumer:** methodology page build step renders the table verbatim from the artifact: per media type × verification mode accuracy, inter-annotator agreement, cost/claim per stratum.
- **Rule:** the published number is generated, never hand-edited (TEST-STRATEGY §2: "the published number is generated, never hand-edited"). CI equality test: rendered table values == artifact values, byte-for-byte on the numbers.
- The AVeriTeC mapping table (ADR-0004) is static prose and *may* be hand-written; only the measured-accuracy table is artifact-bound.

## 4. Test risks

| ID | Risk | Where it lives | Consequence if untested | Detection signal |
|---|---|---|---|---|
| SIT-R1 | Malformed or missing ClaimReview JSON-LD on verdict pages | `/claim/[id]` server component, JSON-LD serializer | Silent SEO death — Google drops the page from Fact Check Explorer with no visible error; discovery channel dead while the site looks fine | JSON-LD absent or schema-invalid in rendered HTML |
| SIT-R2 | Methodology accuracy table drifting from harness output (stale or hand-edited number) | methodology page build step vs `packages/harness/output/` artifact | Published accuracy diverges from the measured number — the honesty differentiator becomes a liability; TEST-STRATEGY success criterion 3 fails | Rendered table ≠ artifact values |
| SIT-R3 | Broken "hear it / watch it" deep links (wrong anchor time, dead URL, control rendered without anchor) | media_anchor → href builder on verdict page | The demo moment fails live: click plays the wrong segment or nothing; broadcast claims become dead-end assertions | Deep link resolves to wrong/absent media anchor |
| SIT-R4 | Register violations: technical jargon on public pages | generated plain-verdict text, site copy, methodology page | Public pages read like internal docs; voter engagement goal fails; UX research register split broken | Banned-pattern scan on rendered public text |
| SIT-R5 | Verdict language violating ADR-0002 (character statements; degree-slider language; wrong class label vs ADR-0004 mapping) | generated verdict text, verdict card labels | Legal exposure (defamation-adjacent), benchmark-mapping opacity, epistemics drift | Banned-pattern scan on verdict text + label-set check |
| SIT-R6 | Confidence over-emphasised (rendered as meter/headline rather than de-emphasised meta) | verdict page/card templates | Implies subjective degrees of truth we explicitly do not have (ADR-0004); contradicts design intent | Confidence rendered outside meta/provenance slots |
| SIT-R7 | Stale verdict pages after store mutations (mutation → page still shows old verdict/ClaimReview) | revalidation path, cache config | Public verdict contradicts the store — worst-case trust failure; mutated verdict's ClaimReview also stale | Page HTML ≠ store state for same claim id |
| SIT-R8 | SSR/hydration failures (verdict content missing from initial HTML; hydration mismatch) | Next.js server/client component boundary | Blank or flickering verdict above the fold; SEO crawlers get no verdict; no-JS users get nothing | Initial HTML lacks verdict content; hydration errors in console |
| SIT-R9 | Accessibility failures (verdict conveyed by colour alone, contrast, keyboard, no verdict text for screen readers) | verdict card component | Verdict unreadable to screen-reader/low-vision users; WCAG failure on the core artefact | axe/vitest-axe violations; colour-only verdict signal |
| SIT-R10 | Mobile layout failures (verdict band, quote, facets unusable on small viewports) | card/feed CSS | Broken for the likely-dominant voter device (social-referral mobile traffic) | Playwright mobile-viewport smoke |
| SIT-R11 | Facet/verdict-distribution aggregation errors (entity page counts disagree with claims; facet counts drift) | store read queries, facet rail, entity pages | Entity pages (the retention driver) show wrong track records; feeds show wrong filter counts | Facet counts ≠ store group-by recomputation |
| SIT-R12 | Feedback widget abuse / PII mishandling (spam volume, email stored/used beyond stated purpose) | feedback endpoint + table | Noise data, privacy exposure, moderation burden the MVP explicitly avoided | Missing rate limiting; schema allows unexpected PII |
| SIT-R13 | Out-of-scope creep shipping accidentally (contestation UI, submission intake, argument chains rendered from mockup or shared components) | page set, shared components | Scope creep threatens the slice timeline (VALIDATION-SLICE's stated risk) | Rendered page inventory vs in-scope route list |
| SIT-R14 | Feed/facet pagination and empty-state defects (empty store → blank homepage with no explanation; pagination past the end → 500) | feed rendering, pagination logic | First demo on a sparse store looks broken; crawler indexes an error page | 200-with-content assertions on empty/edge pages |

## 5. Test strategy

The site's failure modes are disproportionately **silent** (JSON-LD dropped by the crawler, stale verdict pages, deep links that render but resolve wrong, register drift in generated copy), so the strategy leans on L4a: rendered-HTML assertions on every push, not just component-level unit tests. Component units are still tested (L1) where the logic is pure — the anchor→href builder, the JSON-LD serializer, facet queries, banned-pattern checks — because L4 catches *that a page is wrong* only where a fixture page covers it; L1 catches *every input shape* cheaply.

Every §4 risk maps to a test layer (L1–L4 as defined in docs/TEST-STRATEGY.md §2) and a run cadence: **L1 and L4a every push; L2 every PR; L4b pre-release.**

| Risk | Mitigation | Layer | When it runs |
|---|---|---|---|
| SIT-R1 | **L4: JSON-LD schema validation in CI** — Playwright/cheerio extract `<script type="application/ld+json">` from every rendered verdict page in the smoke set; validate against schema.org `ClaimReview` (required fields present, parseable, `reviewRating` well-formed); fail the build loudly. L1 unit tests cover the serializer itself (fixture claim → expected JSON-LD, including pledge/conditional states) | L1 + L4a | Every push |
| SIT-R2 | **L4: table-generation equality test** — render the methodology table from the artifact in CI and assert numeric equality with `packages/harness/output/` (and that the file parses). L1 test asserts the build step fails loudly if the artifact is missing/malformed rather than rendering an empty or stale table | L1 + L4a | Every push |
| SIT-R3 | **L4: Playwright deep-link resolution** — for every fixture broadcast claim: control rendered iff `media_anchor` present; href equals the stored anchor's contract (correct `t=`/`end=` or segment ref); URL returns 200 and the resolved page is the expected media item. L1 tests the anchor→href builder in isolation (YouTube params, RNZ/ZB item refs) | L1 + L4a | Every push (deep-link resolution against live URLs at L4b pre-release, since external pages rot) |
| SIT-R4 | **L4: register check via snapshot tests** — snapshot the rendered public pages; a banned-lexicon scan (grid, ladder, NLI, tier, stratum, AVeriTeC…) over rendered public text; methodology page checked separately for its sanctioned technical sections. L2 golden snapshots make register drift visible in PR diffs | L2 + L4a | Every push (scan); every PR (snapshot diff) |
| SIT-R5 | Banned-pattern check (ADR-0002: "written into every LLM prompt… and the site copy") over generated plain-verdict text and rendered pages: character-statement patterns, degree-slider vocabulary ("mostly true", "half-true"), and label-set check that rendered verdict labels are exactly the ADR-0004 four-class rendering. Runs at L1 on fixtures and L4a on rendered pages | L1 + L4a | Every push |
| SIT-R6 | Component test (L1): confidence renders only inside the designated meta/provenance slots; assert no meter/progress/headline element carries the confidence value. Covered by the same snapshot tests as SIT-R4 | L1 + L4a | Every push |
| SIT-R7 | L4a: after a fixture mutation in the store, trigger revalidation and assert the page (and its ClaimReview `datePublished`/rating) reflects the new verdict. L1: the store-writer→revalidation webhook fires for claim + entity + topic routes. Freeze-window behaviour (ADR-0002) is state-machine-side; the site test asserts mutated-or-not pages always match the store | L1 + L4a | Every push |
| SIT-R8 | L4a: Playwright asserts the verdict class, plain verdict, and ClaimReview are present in the **pre-hydration SSR HTML** (page.on('response') body, not post-JS DOM); console-error assertion (zero hydration errors) per TEST-STRATEGY's silent-failure principle | L4a | Every push |
| SIT-R9 | L1 component tests with axe (vitest-axe) on the verdict card and feed; explicit test that verdict is conveyed in text (not colour alone: text label always co-rendered with the colour band); contrast assertions on the verdict palette | L1 | Every push |
| SIT-R10 | L4a Playwright runs the verdict-page + feed smoke at a mobile viewport (375px); verdict and hear-it control visible without horizontal scroll | L4a | Every push |
| SIT-R11 | L1: facet/distribution queries tested against a seeded store fixture — counts recomputed independently (SQL group-by) and compared to the site's read API output | L1 | Every push |
| SIT-R12 | L1: endpoint tests — rate limiting responds, schema rejects/rejects-ignores unexpected fields, email optional. Manual review item (§6) on the retention/privacy statement | L1 | Every push |
| SIT-R13 | L4a: route inventory test — the rendered sitemap/route list equals the in-scope page set; shared-component scan asserts no chain/submission/contest components are imported into `apps/site` | L4a | Every push |
| SIT-R14 | L4a Playwright: empty-store fixture renders the homepage's honest empty state ("no verdicts yet"), not a blank page; pagination past the end renders a clean page. L1: pagination logic unit tests | L1 + L4a | Every push |

Cadence summary (matches TEST-STRATEGY §4): every PR runs L1 + L2 + L4a; pre-release adds L4b (live deep-link resolution + full site smoke after an L3 harness run regenerates the accuracy artifact).

Two structural test-design rules:

1. **Smoke-set claims are fixtures, not live data.** The L4a Playwright set runs against a seeded store fixture with one claim per verdict class, one broadcast claim per media-anchor form (YouTube upload, RNZ item, ZB item), one pledge/conditional claim, and one caption-quality-flagged claim. Live-data variance never makes CI flaky; live behaviour is covered at L4b pre-release.
2. **Silent-failure asymmetry:** where the wild failure mode is silent (SIT-R1 JSON-LD, SIT-R7 staleness, SIT-R2 table drift), the CI check must *fail the build loudly* — a warning or a skipped test is treated as the failure it would become in production.

What this strategy deliberately does not cover (consistent with TEST-STRATEGY §5): load/performance testing; visual-regression pixel-diffing (snapshot tests cover structure and register; pixel diffs are a polish-slice tool); E2E contestation flows (no contestation UI in this slice); multi-browser matrices beyond one engine + mobile viewport (Playwright WebKit/Firefox runs are a post-slice hardening item).

## 6. Open questions

| # | Question | Notes |
|---|---|---|
| SIT-Q1 | ClaimReview `reviewRating.ratingValue` mapping — do the four ADR-0004 classes get numeric values (and which ordering, 1–4 vs 0–3), given schema.org expects a number while our verdicts deliberately have no degrees? Google's Fact Check Explorer guidance historically expects a numeric scale; assigning numbers risks implying a truth gradient ADR-0004 rejects. | Blocks SIT-R1's schema test until decided; recommendation to resolve before first verdict page ships. |
| SIT-Q2 | Revalidation transport — does the pipeline's store writer call a Next.js on-demand revalidation webhook (needs a shared secret + URL config), or does the site poll a store `updated_at` watermark? Webhook is lower-latency; polling is simpler. Undecided. | Affects SIT-R7's design; behaviour tests are identical either way. |
| SIT-Q3 | Feedback retention and privacy statement — where does the "what happens to your feedback" copy live (footer vs widget), how long is the feedback table kept, and is the optional email used for any reply? Needs a legal/UX call (docs/LEGAL-COMPLIANCE.md review). | Affects SIT-R12. |
| SIT-Q4 | Institution entity pages in the MVP — ADR-0018's funding-context cross-links are designed but the slice has one institution source; do institution pages launch with the MVP or only person/party? | Affects the entity-page route list (SIT-R13 inventory). |
| SIT-Q5 | Search — the mockups show a site search box; structured facets may suffice for the slice's claim volume. In or out of the MVP? Undecided. | If out, remove from the header (register/scope discipline, SIT-R13). |
| SIT-Q6 | Verdict-share artefact — UX research says the verdict must exist as a standalone shareable object (PolitiFact-meter lesson). The v7 verdict card is a candidate; is an OG-image generator for verdict cards in the MVP or post-slice? Undecided. | Post-slice is the safe default; note for the publicity slice. |