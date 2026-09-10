# ADR-0006: Ingestion — six lanes, extraction ladder, health checking, dedupe, and retrieval discipline

*Status: Proposed · Date: 2026-09-08 · Deciders: Bradley, Dave*

*(Consolidates the 2026-cycle ingestion scope decision with the ingestion architecture; the broadcast-scope boundary is ADR-0007.)*

## Context

We are inside the regulated period (7 Aug 2026) with roughly eight weeks to a working system. Ingestion is where scope creep most naturally happens: Parliament TV transcription, social-platform monitoring, podcast capture are all buildable but none are essential (the broadcast question is resolved separately — ADR-0007). ADR-0013 provides the public-proposal pathway for new sources; `COVERAGE.md` holds live probe results for every source. The destination is the claim-anchored evidence store (ADR-0005), whose claimant-entity resolution needs **attributed, source-linked documents** from day one.

## Decision

**Six lanes, one pipeline, idempotent at every stage boundary.**

### Pipeline shape

```
[6 lanes] → normalise → attribute (claimant resolution) → dedupe-by-claim
          → claim detection (LLM triage) → evidence store → verification queue
```

Ingestion produces **documents with provenance** — never bare text: source ID, canonical URL, retrieval timestamp, retrieval method, content hash. This provenance makes verdict pages auditable and anchors claimant attribution (ADR-0008).

### The six lanes (2026 scope)

1. **Beehive.govt.nz** releases + speeches (official RSS) — the primary lane; ministers' releases pair policy proposition + claimed evidence in one self-published package.
2. **Party press-release pages** (Playwright headless render; per-party parsers; no party offers RSS — `COVERAGE.md` §3). Verified domains: `www.nzfirst.nz`, `www.maoriparty.org.nz`; others located at build week.
3. **Hansard** (official daily transcripts) — speaker attribution is structural; the cleanest claimant-entity source.
4. **News RSS** — RNZ (~20 feeds), Stuff, NZ Herald (thin — see COVERAGE risks), Newsroom, The Post, The Press. Fetch-on-verify: headlines are cheap, full articles are not.
5. **User submissions** — URL or pasted text as claim pointers (`USER-SUBMISSIONS.md`). **Fetch-from-source rule**: never verify from the submission's rendering; server-side re-fetch (direct → archive.today → Wayback); submissions bump queue priority; rate-limited; HDCA process attached. A submission is a claim pointer, never evidence.
6. **Commentator watchlist** — prominent personalities commenting on politics; reach-based party-blind inclusion via public decision record; per-commentator access paths (outlet RSS, own-site scrape, platform RSS where legitimate, submissions otherwise); only factual claims *within* opinion are checked, never the opinion; register frozen during the regulated period.

**Paywalled sources:** no circumvention (Copyright Act TPM provisions, ToS). Paywalled content is a claim source, never an evidence source; minimal fair-dealing quotation with attribution; "claim origin paywalled — verification limited to the quoted claim" labelling. Verification runs against official and primary sources, which are never paywalled.

**Explicitly deferred:** Parliament TV/broadcast transcription beyond publisher-published text (ADR-0007), proactive social-platform crawling (cost, gating, moderation surface; submissions cover the highest-value social claims).

### Format-aware extraction (not one generic parser)

The AVeriTeC shared task's clearest operational lesson: a generic single-strategy extractor (Trafilatura) **silently failed to retrieve the gold document for 297 of 500 development examples** — PDFs, video transcripts, and tables were the failure modes. The parser contract is per-format: HTML articles (readability), PDF (pdfplumber-style, table-aware), tables/spreadsheets (row/column identity preserved), official data APIs (native SDMX/JSON), transcripts (speaker-turn-preserving). Extraction failures raise health alerts like fetch failures.

### The extraction ladder (deterministic first, LLM to get unstuck)

| Tier | Mechanism | When |
|---|---|---|
| **1 — deterministic** | per-format parsers | always, first |
| **2 — LLM-assisted** | schema-constrained extraction over the raw document | Tier-1 failure or validation miss |
| **3 — degraded** | headless render retry → source marked degraded | Tier-2 failure |

Trust mechanisms: `extraction_method` provenance carried to the verdict page; **the Tier-2 fallback rate is itself the markup-drift monitoring instrument** (rising rate = earliest drift signal); numeric cross-checks where both tiers see the same field (disagreement flags for review — LLM number extraction is the riskiest rung); downstream fetch-from-source re-check catches mis-extraction; **Tier-2 invocations persist failure-cause records** (what Tier-1 attempted, which validation failed, raw snapshot, what Tier-2 did differently, structured failure class) — a labelled failure corpus from which Tier-1 parsers are improved, with the captured case as the repaired parser's regression test. The LLM solves it; the failure record explains it; the code keeps the solution.

### Reprocessing (every stage is re-runnable)

The pipeline is idempotent at every stage boundary with inputs retained (raw documents, extraction outputs, claim records, verdicts, plus **pipeline version + model version** per artefact). Any claim set can be reprocessed at any scope against any pipeline version. Reprocessed verdicts **append, never overwrite** — new version with its provenance; a changed verdict triggers the mutation flow (public diff, audit log; ADR-0002) and the freeze hold. **Harness-gated**: mass re-verdicts only after an ADR-0010 regression pass. Raw-document retention is the enabling cost.

### Health checking (the silently-empty-feed failure mode)

Per-source monitors: liveness (200-but-zero-items is a distinct alarm), structural drift detection for unversioned party markup, volume anomaly bands, and an escalation ladder (retry → headless fallback → degraded → maintainer alert) ending at a public coverage page — never silently absent. Extraction failures join fetch failures as alertable defects. Re-probe cadence: build week 1, before campaign peak, monthly in production.

### Deduplication (by claim, not by document)

Document-level dedupe only for identical syndicated copies. Claim-level: fingerprint + embedding match — a repeat claim gains a **source-occurrence** ("claimed by X in Hansard, repeated by Y on RNZ") rather than a new queue entry; occurrences strengthen the importance score. Cross-lane provenance preserved — "everyone was saying it" is auditable as fact.

### Fetch-from-source discipline

Uniform across lanes: stored canonical URL → server-side re-fetch at verification time → verify against what the source serves now, with the archive fallback ladder. Paywall policy applies uniformly.

### Verification-loop handoff: retrieval discipline

From the evidence base (AVeriTeC shared task, FIRE, FEVER workshops): **question generation beats claim-string search**; multi-hop conditional retrieval; hybrid BM25 + dense (gte-family embedders); **confidence-capped dynamic depth** (FIRE: 7.6× LLM / 16.5× search cost reduction at comparable accuracy); **NLI justification auditing** before publication (CLEF 2026 pattern — every justification sentence must be entailed by its cited evidence; failures route to the review queue).

### Attribution handoff

Ingestion resolves where the claim came from and passes claimant-entity candidates to the store; Hansard's speaker markup is the strongest signal; attribution never guesses (ADR-0005). Entity linking is budgeted as its own component with its own failure accounting (the iCheck post-mortem lesson). **Ingestion never writes verdicts** — the separation structurally enforces the ADR-0005 firewall (ingestion knows claimant identity; verification must not use it).

## Alternatives considered

- **Single monolithic scraper with per-source plugins.** Rejected: hides lane-specific failure modes; lanes share stages but run as separate workers.
- **One generic text extractor.** Rejected on shared-task evidence (Trafilatura silently missed gold docs in a majority of AVeriTeC dev examples where PDFs/tables/transcripts were the evidence).
- **Retrieval by claim-string search only.** Rejected: question generation was the most consistent top-vs-bottom differentiator across 21 shared-task systems.
- **Fixed-depth retrieval loops.** Rejected on FIRE's measured results.
- **Third-party news-aggregation API.** Rejected: cost, licence terms, reintroduces a dependency ADR-0003 rejected.
- **Document-level dedupe only.** Rejected: the unit of public value is the claim; would show the same claim as six separate verdicts.
- **Statically-queued source importance.** Deferred: queue priority is dynamic; a static table invites "you prioritised our opponents" arguments.
- **Full Fact AI licence instead of building ingestion.** Rejected per ADR-0003.
- **Instrument later.** Rejected: observability added after the first silent failure is archaeology.

## Evidence base

AVeriTeC shared task (arXiv:2410.23850) — question generation, multi-hop retrieval, hybrid BM25+dense (gte-family), Trafilatura failure (297/500), Dunamu-ML's PDF/YouTube extraction; FIRE (NAACL 2025) — confidence-based depth; Full Fact production papers; CLEF CheckThat! 2025–2026; Fathom/HerO/AIC CTU (FEVER 2025); iCheck post-mortem. Full citations in the git history of this ADR's predecessors.

## Consequences

- **Build order**: RSS lanes first (week 1), Hansard parser + headless party renderers (week 1–2), submissions form (week 2, ships with HDCA process), commentator watchlist last (week 3).
- **The parser contract (per-format) and the failure-cause corpus are the reusable units**; new sources are new parser instances registered via config (with the ADR-0013 public pathway for proposals); new formats are new extractors.
- **Health monitoring ships with the first lane**; extraction failures join fetch failures as alertable defects; the public coverage page is its user-facing face.
- **Playwright headless rendering is a bounded known cost** (~6 party sites + commentator sites, few times daily, NZ-routed egress; re-probe per COVERAGE cadence).
- **Raw-document retention is the price of reprocessability** — modest storage, budgeted from day one.
- **Coverage is a maintained property of the system**, not a one-time setup decision (COVERAGE cadence).