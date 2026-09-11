# Website MVP design

*Proposed. ADRs: 0002, 0004, 0007, 0014. Companions: `WEBSITE-UX-RESEARCH.md`, `VALIDATION-SLICE.md`, `TEST-STRATEGY.md`, `CROSS-CUTTING.md`.*

## 1. Purpose and slice scope

The "sufficient to publicise and get feedback" surface from VALIDATION-SLICE: the discovery + presentation spine over the store — no accounts, no contestation, no submissions. It exists to (a) make the slice's verdicts publicly demoable, including the "hear it / watch it" moment, (b) open the ClaimReview JSON-LD discovery channel from day one, and (c) collect site feedback while the campaign is still building.

**In scope (7 components):**

| # | Component | Summary |
|---|---|---|
| 1 | Claim cards + verdict pages | SSR Next.js: verdict + confidence up top, verbatim quote + attribution, one-sentence plain verdict, "as deployed" tag, hear-it/watch-it deep links |
| 2 | ClaimReview JSON-LD | schema.org `ClaimReview` on every verdict page — the Google Fact Check Explorer channel |
| 3 | Feed + topic facets | recency-ranked homepage; facet filters from the structured store |
| 4 | Entity pages | person / party / institution pages with verdict distributions |
| 5 | Methodology page | four-verdict schema + AVeriTeC mapping + pipeline description + the **accuracy table generated from the harness output file** |
| 6 | Feedback widget | thumbs + free text + optional email; feedback *about the site*, not claim intake |
| 7 | Per-claim provenance block | pipeline version, prompt version, confidence, transcript tier |

**Out of scope** (follow-on slices): contestation UI · submissions · argument-chain views · debate-night live tracker · newsletters · reliability profiles. Concretely: no contest form or "disagree?" flow (the methodology page may *name* that contestation exists post-slice), no argument graphs, no real-time views, no scorecard aggregates beyond verdict-distribution counts.

**Realised from `docs/mockups/`:** `claim-page.html` → verdict page template · `claim-page-stat.html` → statistical variant · `claim-page-promise.html` → pledge/conditional rendering only · `feed.html` → homepage · `mockup-claim-v6-fold.png` / `mockup-claim-stat.png` / `mockup-claim-promise.png` / `mockup-feed.png` → visual references · `entity-chain-submit.html` → **no** (chains + submission are out of scope; don't build from it).

## 2. Design

### 2.1 Page set

| Route | Purpose |
|---|---|
| `/` | Recency-ranked feed of verdict cards; facet rail (person / party / topic / verdict) |
| `/claim/[id]` | Verdict page — the atom; canonical ClaimReview URL |
| `/person/[slug]`, `/party/[slug]`, `/institution/[slug]` | Entity pages: claim list + verdict distribution |
| `/topic/[slug]` | Topic facet as a shareable page |
| `/methodology` | Verdict schema, AVeriTeC mapping, pipeline description, measured-accuracy table, coverage gaps named |
| `/about` | Short project page |
| every page | Feedback widget (fixed, dismissible) |

Anything else visible in the mockups is out of scope (§1) or an open question (§6).

### 2.2 Register rules

Two registers are a hard rule: **public layperson pages** vs **internal technical docs**. The MVP must not leak the technical register onto public pages. The methodology page is the one public page whose job is explaining the machinery — plain-English descriptions allowed, unexplained jargon and untranslated internal vocabulary not.

1. **Verdict-first hierarchy, fixed order on every verdict page:** verbatim claim + attribution → verdict mark (band + pin, not a smiley meter) → one-sentence plain verdict → "as deployed" tag (one line) → hear-it control → evidence pack → provenance → related claims last.
2. **Confidence de-emphasised:** small metadata text only — never a meter, bar, star rating, or headline element. Design says it; the tests enforce it (SIT-R6).
3. **Claims, not persons (ADR-0002):** character statements structurally impossible in generated copy and banned in template strings. Verdict language is the ADR-0004 mapping; no degree-slider language anywhere.
4. **Layperson language:** no "sensitivity grid", "extraction ladder", "NLI audit", "Tier-2 caption", "stratum" on public pages. The methodology page translates each; technical terms appear only in the provenance block, visually secondary.
5. **Gaps named, not hidden:** coverage limits (audio-only sources out of scope; caption claims flagged) stated in the same plain register.

### 2.3 Verdict-page anatomy (data → section)

| Section (order) | Store field(s) |
|---|---|
| Claim quote + attribution | `claim.text` (verbatim, highlighted), speaker → entity ref, publication/segment ref |
| Verdict mark + label | `verdict.class` → colour/glyph; "Accurate but incomplete" gets its own treatment |
| One-sentence plain verdict | `verdict.plain_summary` — must pass register checks |
| "As deployed" tag | `claim.deployment_context` (ADR-0008) |
| Hear it / watch it | `claim.media_anchor` — rendered only when present (§3.3) |
| Evidence pack | items with source link + authority tier (T1–T6) + plain reasoning |
| Provenance block | pipeline/prompt versions, confidence, transcript tier |
| Related claims | fingerprint/pgvector adjacency — last; chains de-scoped |

Ordering is a design invariant, not a suggestion: verdict visible without scrolling (UX finding 1); show-your-work after the answer (finding 6). The §5 register/snapshot tests assert section order, not just presence.

### 2.4 Data flow

```
pipeline ──writes──▶ Postgres (packages/store)
                        │  site reads (server components, read-only)
        apps/site ── SSR HTML (verdict in first response) + ClaimReview JSON-LD
                 ── feedback POST ──▶ feedback table
```

- **Stack per ADR-0014**: TypeScript, SSR Next.js (`apps/site`), shared Drizzle schema — the site is a *reader* over the typed store. No new services; no client-side fetching for verdict-first content (it must be in the SSR HTML for SEO and no-JS resilience).
- **Freshness**: on-demand revalidation — the pipeline's store writer triggers the site's revalidation webhook for affected routes on every verdict mutation. Verdict-page cache is short; the feed renders live.
- **Accuracy-table path**: L3 run writes a versioned JSON artifact → methodology build step reads it with Zod validation → renders. Missing/invalid artifact **fails the site build**; a CI equality test asserts rendered table == file. The table displays the run id, so a published number carries its own audit trail.
- **Feedback widget**: POST `{page_url, thumbs, text, email?}` to one endpoint; rate-limited; email optional, never displayed. Not a claim-submission intake — no field that looks like "submit a claim".

### 2.5 Component notes

- **Claim card** (feed atom): quote (highlighted) + subtle attribution → verdict mark + plain verdict → "as deployed" tag when present → hear-it pill when anchored → link. Self-contained and quotable — a screenshot carries the whole finding. Confidence only in the small meta row.
- **Verdict page**: SSR atom (§2.3). Canonical URL stable per claim id; mutations change content, not the URL. "Not enough evidence" renders as an honest open question ("we could not verify this"), never a failure state.
- **Feed**: recency-ranked; facets filter server-side via URL params (shareable, crawlable). Pagination, not infinite scroll — every card URL-addressable.
- **Entity pages**: header + verdict distribution (counts per class — a bar of segments, not a score) + claim list. Publisher-level framing avoided to stay within claims-not-persons.
- **Methodology page**: what ClaimWatch is and isn't → four-verdict schema with the AVeriTeC mapping stated verbatim → how verification works per mode, plainly → the generated accuracy table → known gaps (audio-only out of scope; caption claims flagged; Māori-language out of scope).
- **Provenance block**: small, collapsed by default, visually secondary — the one place technical vocabulary is permitted.

### 2.6 SEO and crawlability

- **SSR everywhere that matters** — verdict content, JSON-LD, hear-it control in the initial HTML (Fact Check Explorer, unfurlers, no-JS).
- **Metadata**: title "claim (short) — verdict — ClaimWatch NZ"; description from the plain verdict.
- **Structured data**: `ClaimReview` on verdict pages; `BreadcrumbList` on entity/methodology; `Organization` site-wide. Nothing else — a verdict page is a review, not news; no fabricated `Article` markup.
- **Crawl discipline**: only canonical facet/entity pages are linked; query-param permutations `rel="nofollow"`; robots rule keeps empty-state facets out.
- **Mutation → URL stability**: mutations update content + `datePublished`; claim ids never change, so shared links and indexed ClaimReview entries converge on the current verdict.

### 2.7 Observability

Site telemetry routes to Grafana via the same OTel stack: request spans, feedback-endpoint spans, revalidation-webhook events (a mutation whose revalidation silently fails is *visible*). A periodic liveness check renders one pinned verdict page and asserts verdict text + ClaimReview present in the SSR HTML — a template regression alarms instead of quietly blanking the page. Hydration errors are a L4a CI assertion and a production metric.

## 3. Interfaces

### 3.1 Store reads (site ⇄ store)

| Query | Used by |
|---|---|
| claim by id (+ verdict + pack + media_anchor) | verdict page, ClaimReview |
| feed page (ordered by `published_at`, paginated) | homepage |
| facet counts (group-by person/party/topic/verdict) | facet rail, entity pages |
| verdict distribution per entity | entity pages |
| related claims (adjacency, capped) | verdict page |
| harness accuracy file (build-time read) | methodology page |

The site holds **no write path** to claims/verdicts (the feedback table is the only write) — a structural boundary enforced by package-export rules, not convention.

### 3.2 ClaimReview JSON-LD

One `ClaimReview` per verdict page, rendered server-side in the initial HTML: canonical `url`, `author` (ClaimWatch Organization), `datePublished` (updated on mutation), `itemReviewed` (verbatim quote + appearance), `reviewRating` (class → `alternateName` + numeric `ratingValue` — mapping undecided, §6), `reviewBody` (the plain verdict). Malformed JSON-LD fails silently in the wild — Google drops the page with no error anywhere — so CI validation is mandatory, not advisory (SIT-R1).

### 3.3 media_anchor link contract

- Render the hear-it/watch-it control **iff** `media_anchor` is present — no dead controls; no claim with an anchor rendering without the control.
- `deep_link` resolves to a player state at (or within a pad of) `start_s` — YouTube `t=`/`end=` for uploads; item-page embeds for RNZ/ZB written items.
- The href is built **only** from the stored anchor — no client-side timestamp re-derivation (that's how deep links rot).
- Tier-2 claims render the caption-quality note next to the control.
- Wording follows the medium: "hear it" / "watch it"; the anchor contract is the store's.

### 3.4 Harness-output contract

Producer: L3 run → versioned JSON artifact (`packages/harness/output/latest-accuracy.json`). Consumer: methodology build step renders the table verbatim — per mode accuracy, IAA, cost/claim. Rule: **the published number is generated, never hand-edited**; CI asserts rendered values == artifact values. The AVeriTeC mapping table is static prose and may be hand-written; only the measured-accuracy table is artifact-bound.

## 4. Test risks

| ID | Risk | Consequence if untested | Detection signal |
|---|---|---|---|
| SIT-R1 | Malformed/missing ClaimReview JSON-LD | Silent SEO death — discovery channel dead while the site looks fine | JSON-LD absent or schema-invalid in rendered HTML |
| SIT-R2 | Methodology table drifting from harness output (stale or hand-edited) | The honesty differentiator becomes a liability | Rendered table ≠ artifact values |
| SIT-R3 | Broken hear-it deep links (wrong time, dead URL, control without anchor) | The demo moment fails live; broadcast claims become dead-ends | Deep link resolves wrong/absent |
| SIT-R4 | Register violations — jargon on public pages | Public pages read like internal docs; engagement goal fails | Banned-pattern scan on rendered text |
| SIT-R5 | Verdict language violating ADR-0002 (character statements, degree-slider, wrong class label) | Legal exposure; benchmark-mapping opacity | Banned-pattern scan + label-set check |
| SIT-R6 | Confidence over-emphasised (meter/headline) | Implies subjective truth degrees we don't have (ADR-0004) | Confidence rendered outside meta slots |
| SIT-R7 | Stale verdict pages after store mutations | Public verdict contradicts the store — worst-case trust failure | Page HTML ≠ store state for the claim id |
| SIT-R8 | SSR/hydration failures | Blank verdict above the fold; crawlers get nothing | Initial HTML lacks verdict content; hydration errors |
| SIT-R9 | Accessibility failures (verdict by colour alone, contrast, keyboard) | Core artefact unreadable to screen readers | axe violations; colour-only signal |
| SIT-R10 | Mobile layout failures | Broken on the likely-dominant voter device | Playwright mobile-viewport smoke |
| SIT-R11 | Facet/aggregation errors — entity counts disagree with claims | Wrong track records; wrong filter counts | Counts ≠ independent SQL recomputation |
| SIT-R12 | Feedback widget abuse / PII mishandling | Noise, privacy exposure, moderation burden the MVP avoided | Rate limiting; schema rejects unexpected fields |
| SIT-R13 | Out-of-scope creep shipping accidentally | Timeline risk | Route inventory vs in-scope list; component-import scan |
| SIT-R14 | Feed/pagination defects (empty store → blank homepage; past-end → 500) | First demo on a sparse store looks broken | 200-with-content assertions on edge pages |

## 5. Test strategy

The site's failure modes are disproportionately **silent** (JSON-LD dropped by the crawler, stale pages, links that render but resolve wrong, register drift), so the strategy leans on L4a rendered-HTML assertions every push. Pure logic (anchor→href builder, JSON-LD serializer, facet queries, banned-pattern checks) is unit-tested at L1 — L4 catches that *a page* is wrong only where a fixture covers it; L1 catches *every input shape*.

| Risk | Mitigation | Layer |
|---|---|---|
| SIT-R1 | Extract `<script type="application/ld+json">` from every rendered verdict page; validate against schema.org `ClaimReview`; fail the build loudly. Serializer unit-tested incl. pledge states | L1 + L4a |
| SIT-R2 | Render the table from the artifact in CI; assert numeric equality; build fails if the artifact is missing/malformed | L1 + L4a |
| SIT-R3 | For every fixture broadcast claim: control rendered iff anchor present; href matches the stored anchor; URL 200s to the expected item. Builder unit-tested | L1 + L4a (live URLs at L4b) |
| SIT-R4 | Snapshot rendered public pages; banned-lexicon scan (grid, ladder, NLI, tier, stratum…); methodology page checked separately for sanctioned sections | L2 + L4a |
| SIT-R5 | Banned-pattern check over generated verdict text + rendered pages: character statements, slider vocabulary, label-set == ADR-0004 rendering | L1 + L4a |
| SIT-R6 | Confidence renders only in designated meta slots — no meter/progress/headline carries it | L1 + L4a |
| SIT-R7 | Fixture mutation → revalidation → page (and ClaimReview `datePublished`) reflects the new verdict; webhook fires for claim/entity/topic routes | L1 + L4a |
| SIT-R8 | Playwright asserts verdict class, plain verdict, ClaimReview present in the **pre-hydration SSR HTML**; zero console hydration errors | L4a |
| SIT-R9 | axe tests on verdict card + feed; verdict conveyed in text (label always co-rendered with colour); contrast assertions | L1 |
| SIT-R10 | Verdict-page + feed smoke at 375px; no horizontal scroll | L4a |
| SIT-R11 | Facet/distribution queries vs independent SQL recomputation on a seeded fixture | L1 |
| SIT-R12 | Endpoint tests: rate limiting, schema rejects unexpected fields, email optional | L1 |
| SIT-R13 | Route inventory == in-scope page set; no chain/submission/contest components imported | L4a |
| SIT-R14 | Empty-store fixture renders the honest empty state; past-end pagination renders clean | L1 + L4a |

**Two structural rules:**
1. **Smoke-set claims are fixtures, not live data** — one claim per verdict class, one broadcast claim per anchor form, one pledge, one caption-flagged claim. Live-data variance never makes CI flaky; live behaviour is covered at L4b.
2. **Silent-failure asymmetry** — where the wild failure mode is silent (JSON-LD, staleness, table drift), the CI check must *fail the build loudly*; a warning or skipped test is treated as the failure it would become in production.

Deliberately not covered (consistent with TEST-STRATEGY §5): load/performance testing; pixel-diff visual regression (snapshot tests cover structure and register); E2E contestation flows; multi-browser matrices beyond one engine + mobile viewport.

## 6. Open questions

| # | Question | Notes |
|---|---|---|
| 1 | ClaimReview `reviewRating.ratingValue` mapping — schema.org expects a number; our verdicts deliberately have no degrees. Which ordering, or none? | Blocks SIT-R1's schema test; resolve before the first verdict page ships |
| 2 | Revalidation transport — webhook (shared secret + URL) vs polling an `updated_at` watermark | Webhook lower-latency; polling simpler; behaviour tests identical |
| 3 | Feedback retention + privacy statement — where the copy lives, how long the table is kept, email usage | Legal/UX call |
| 4 | Institution entity pages in the MVP — slice has one institution source | Affects the route inventory |
| 5 | Site search — structured facets may suffice at slice volume; in or out? | If out, remove the header box |
| 6 | Verdict-share OG image generator — the verdict as a standalone shareable object (PolitiFact-meter lesson) | Post-slice is the safe default |