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

### Reprocessing (every stage is re-runnable, by design)

The pipeline is **idempotent at every stage boundary**: each stage (normalise → attribute → dedupe → triage → verify) is a pure function from stored inputs to stored outputs, with its inputs retained. That makes reprocessing a first-class operation, not a rebuild:

- **What is retained**: raw fetched documents (with provenance), extraction outputs, claim records, fingerprints, verdicts, and the pipeline **version + model version** that produced each — every artefact is reproducible and attributable to the code/model that made it.
- **What can be reprocessed**: any claim set, at any scope (one claim, one source, one lane, everything), against any pipeline version — improved claim detection, a fixed parser, a new fingerprint scheme, an upgraded verification model. Because inputs are stored, reprocessing consumes the same originals, not a lossy downstream copy.
- **How it runs**: reprocessing is a batch job per ADR-0007 (50% batch pricing — another reason the batch posture pays). Backfills are rate-limited and prioritised (e.g. claims with live verdict pages first, since those are published).
- **What changes on the record**: a reprocessed verdict does not silently overwrite. The new verdict version is appended with its pipeline/model version; if the verdict changes, ADR-0005's mutation flow applies — public diff, audit log entry, and (during the freeze window) the ADR-0006 hold. Verdict *history* is the record; the current verdict is just the latest version. This is what makes "we improved the algorithm and re-checked" an auditable, publishable statement rather than a quiet rewrite.
- **Harness-gated reprocessing**: a pipeline change that triggers a reprocess must have passed the ADR-0008 regression gate first — reprocessing is how an improvement ships, and the harness is what proves it's an improvement. Mass re-verdictions without a harness pass is the failure mode this rule exists to prevent (an unvetted "improvement" rewriting hundreds of published verdicts is precisely the "they rewrote history" attack the project's audit posture exists to repel).
- **The extraction ladder composes with reprocessing**: a repaired deterministic parser (Tier-1) can reprocess everything a drift period pushed through Tier-2, with the numeric cross-checks validating the two agree.

### Format-aware extraction (not one generic parser)

The AVeriTeC shared task's clearest operational lesson: a generic single-strategy extractor (Trafilatura) **silently failed to retrieve the gold document for 297 of 500 development examples** — PDFs, video transcripts, and tables were the failure modes, and the system that added PDF/YouTube extraction (Dunamu-ML) achieved the task's best retrieval score. A generic "clean text" contract would fail the same way here, and the failure would be invisible (the health record sees a successful parse of the wrong thing, or nothing).

The parser contract is therefore **per-format, not per-site**: a shared interface (`extract(document) → clean text + structure + provenance`) with format-specific implementations:

- **HTML articles** (Beehive, news, party items): readability-style extraction;
- **PDF** (agency reports cited as evidence, some party releases): pdfplumber-style extraction with table awareness;
- **Tables/spreadsheets** (Stats NZ series exports, Treasury tables): structured extraction preserving row/column identity — a statistic without its row/column context is worthless for the sensitivity grid;
- **Official data APIs** (Stats NZ Aotearoa Data Explorer SDMX/JSON, per COVERAGE): native JSON parsing, not scraping;
- **Transcripts** (Hansard XML, any YouTube evidence): speaker-turn-preserving extraction — speaker turns are attribution signals, and flattening them destroys them.

Extraction failures raise health alerts like fetch failures — an extracted-empty result from a known-nonempty document is a defect, not a quiet zero.

### The extraction ladder (deterministic first, LLM to get unstuck)

Deterministic extractors and LLMs have complementary failure modes, and the design uses each for what it does best:

- **Deterministic parsers are cheap, fast, and stable** — but brittle: they get *stuck* when markup drifts, and a stuck parser produces silence, not errors.
- **LLMs are flexible and get *unstuck*** — they can find the content through an unfamiliar layout, a half-changed template, or a format nobody wrote a parser for — but they are comparatively expensive, slower, and can mis-extract with confidence.

So extraction is a **ladder**, not a choice:

| Tier | Mechanism | When | Cost posture |
|---|---|---|---|
| **1 — deterministic** | per-format parsers above | always, first | negligible; the steady state |
| **2 — LLM-assisted** | schema-constrained LLM extraction over the raw document (same output schema as Tier 1: text + structure + provenance) | Tier-1 failure *or* Tier-1 output failing its validation checks (empty body, no title, schema mismatch) | rare by construction; batch-priced per ADR-0007 |
| **3 — degraded** | headless render retry, then mark source degraded | Tier-2 failure | escalated via the health ladder |

Design details that make the ladder trustworthy:

- **Provenance records which tier produced every extraction** (`extraction_method: deterministic | llm-assisted | llm-only`), carried through to the verdict page's evidence chain. Deterministic and LLM output are never silently equivalent — the audit trail distinguishes them.
- **The Tier-2 rate is itself a monitoring instrument.** A source's LLM-fallback rate should be near zero in steady state; a rising rate is the earliest possible signal of markup drift — the LLM keeps the pipeline running *and* its invocation pattern tells you the deterministic parser needs fixing. Stuck-ness becomes measurable instead of silent.
- **Numeric cross-checks.** Where both tiers extract the same numeric field (the case that matters for the sensitivity grid), values are compared: agreement → high confidence; disagreement → the field is flagged for review rather than silently taking either. LLM extraction of numbers is the riskiest point of the ladder, and the grid is only as good as its numbers.
- **Downstream verification still checks against the re-fetched source** (fetch-from-source discipline), so an LLM mis-extraction is caught by the loop's claim-vs-source check — the ladder never becomes a single point of failure for accuracy.
- **The ladder learns toward determinism — by data capture, not intention.** Every Tier-2 invocation persists its **failure-cause record** so Tier-1 parsers can be improved from evidence: what Tier-1 attempted (parser ID + version), which validation failed and why (empty body / schema mismatch / specific missing field), the raw document snapshot, what Tier-2 had to do differently to extract the content (the resolved output plus the strategy that found it), and a structured failure classification (markup drift / new layout variant / unhandled format / edge-case content). These records accumulate as a **labelled failure corpus**: recurring classes become Tier-1 parser fixes or new parser instances, with the before/after Tier-1-vs-Tier-2 output comparison serving as the test case the repaired parser must pass. The LLM solves it, the failure record explains it, and the code keeps the solution — with the regression test written from the captured case.

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

Entity linking is budgeted as its own component with its own failure accounting — the iCheck team's post-mortem (ClaimBuster/ClaimReview lineage) records that "data extraction, cleaning, and linking took huge amounts of effort", and entity linking was where systems of this class historically bled time. Name disambiguation (two MPs with similar names; "the Minister" without a name; commentator name variants) is a known-hard problem: candidates are proposed by the pipeline, resolved conservatively (ADR-0010's "never guessed" rule), and unresolvable attributions surface as **"unattributed"** with the evidence chain shown — never silently guessed into a person entity.

### Verification-loop handoff: question generation and retrieval discipline

What ingestion hands the verification loop, and how the loop retrieves, follows the strongest measured finding across the AVeriTeC shared task (21 systems), FEVER/CheckThat workshops, and FIRE: **generating search questions beats searching for the claim verbatim**. Top systems generated fact-checking questions (decomposing the claim into what would need to be true), retrieved against those questions, and iterated multi-hop — each retrieval round conditioned on the previous round's findings. Question generation is also cheap: smaller models were competitive at it (per ADR-0007's tiering, this is a Flash-class task).

Concretely, adopted into the verification loop's retrieval stage (informed by ADR-0004/0010, specified here because it's the ingestion→verification interface):

- **Question decomposition before retrieval**: each claim yields multiple targeted questions (per sub-fact), not a single claim-string query.
- **Multi-hop conditional retrieval**: retrieve → assess what's still missing → generate next question → retrieve again. Not one-shot.
- **Hybrid retrieval over the evidence store**: BM25-style keyword match + dense embeddings (gte-family perform well per shared-task results) → rerank top candidates.
- **Confidence-based retrieval depth** (FIRE's core mechanism): the loop decides per step whether the evidence is sufficient or a further query is needed — dynamic depth, capped. This is the mechanism that makes the open-web lane affordable (7.6× LLM / 16.5× search cost reduction measured by FIRE vs fixed-depth loops).
- **Justification auditing**: generated justifications are NLI-audited against their cited evidence before publication (the CLEF 2026 CheckThat Task 3 pattern — citation-precision scoring): every justification sentence must be entailed by the evidence it cites; audit failures route to the mutation-review queue rather than publishing.

## Alternatives considered

- **Single monolithic scraper with per-source plugins.** Rejected for v1: six lanes have genuinely different shapes (feed / headless / batch / event); a common interface over all of them hides lane-specific failure modes (a plugin that breaks inside a monolith is invisible until its health record alerts anyway). Lanes share the normalise/attribute/dedupe stages but run as separate workers.
- **One generic text extractor for all document types.** Rejected on shared-task evidence: generic extraction (Trafilatura-class) silently missed the gold document in a majority of AVeriTeC dev examples where PDFs/tables/transcripts were the evidence; format-aware extraction with per-format failure alerts is the direct response.
- **Retrieval by claim-string search only** (no question decomposition). Rejected on shared-task evidence: question generation was the most consistent differentiator between top and bottom systems; verbatim claim search is the baseline behaviour that scores lowest.
- **Fixed-depth retrieval loops.** Rejected on FIRE's measured results: confidence-based dynamic depth achieves comparable accuracy at 7.6× lower LLM and 16.5× lower search cost — the difference between the open-web lane being affordable or not.
- **Third-party news-aggregation API** (e.g. commercial media monitoring) for the news lane. Rejected: cost, licence terms, and it reintroduces a dependency ADR-0003 rejected; RSS + targeted headless fetch covers the need.
- **Deduplicate at document level only.** Rejected: the unit of public value is the claim; document-level dedupe would show the same claim as six separate verdicts, fracturing the record and triple-charging verification cost.
- **Queue sources by reach/importance statically.** Deferred: queue priority is dynamic (submissions bump, occurrences accumulate); a static importance table invites "you prioritised our opponents' outlets" arguments. Order of ingestion ≠ order of verification.

## Evidence base

Design elements in this ADR trace to measured results in the open-source fact-checking literature, reviewed 2026-09-08:

- **AVeriTeC shared task (FEVER 2024, 21 systems)**: question generation as the top-system differentiator; multi-hop conditional retrieval; hybrid BM25+dense retrieval with gte-family embedders; Trafilatura scraper failure (297/500 dev examples missing gold docs); Dunamu-ML's PDF/YouTube extraction achieving best retrieval; veracity prediction benefiting from large models while question generation did not. Primary source: "The Automated Verification of Textual Claims (AVeriTeC) Shared Task" (arXiv 2410.23850).
- **FIRE (FEVER/NAACL 2025)**: confidence-based iterative retrieval with unified decision mechanism; 7.6× LLM / 16.5× search cost reduction at comparable accuracy. Primary source: mbzuai-nlp/fire.
- **Full Fact production system**: check-worthiness scoring, repeat-claim matching as the central asset, extraction/cleaning/linking as the dominant engineering cost. Primary source: Full Fact automation papers and blog.
- **CLEF CheckThat! 2025–2026**: hybrid retrieval + question enrichment pipelines; Task 3 (2026) introduced NLI-based citation auditing of generated fact-checking articles — the pattern adopted for justification auditing.
- **Fathom (FEVER 2025) / HerO (AVeriTeC runner-up) / AIC CTU (long-context on-prem RAG)**: HyDE-style question expansion and modular lightweight pipelines as the reproducible open-source pattern.

## Consequences

- **Build order**: RSS lanes first (week 1), Hansard parser + headless party renderers (week 1–2), submissions form (week 2, ships with HDCA process), commentator watchlist last (week 3) — it is a configuration of mechanisms the other lanes already provide.
- **The extraction ladder makes markup drift non-fatal**: Tier-2 keeps content flowing through site changes while the deterministic parser is repaired — the difference between a two-hour parse gap and a two-day one during the campaign.
- **LLM-extraction spend is bounded by construction**: Tier-2 fires only on Tier-1 failure/validation miss, so its cost scales with drift events, not document volume; the per-source fallback rate is tracked and the drift signal is the actionable output.
- **The parser contract** (per-format extraction interface: listing → item → clean text + structure + provenance) is the reusable unit; a new party site or commentator outlet is a new parser instance, registered via config, proposed publicly via ADR-0009. New *formats* (a new PDF layout, a new data API) are new extractor implementations.
- **The verification loop inherits question decomposition, multi-hop retrieval, hybrid store search, dynamic depth, and NLI justification auditing** from this ADR — these are its accuracy-critical behaviours, and the harness (ADR-0008) should exercise each of them as separable stages.
- **Health monitoring is not optional infrastructure** — it ships with the first lane, not after launch; extraction failures join fetch failures as alertable defects; the public coverage page is its user-facing face.
- **Playwright headless rendering is a bounded, known cost**: ~6 party sites + a few commentator sites, checked a few times daily, from a NZ-routed egress. Re-probe before relying on it at scale (COVERAGE.md cadence).
- **Ingestion never writes verdicts** — it fills the store with attributed, provenance-carrying documents and detected claims; verification is a separate queue (separation that also enforces the ADR-0010 firewall: ingestion knows claimant identity, verification must not use it).
- **Raw-document retention is the price of reprocessability** — storage for the campaign corpus (documents, extractions, claim records, verdict versions) is modest at our volumes and is the enabling cost for every other reprocessing property above.