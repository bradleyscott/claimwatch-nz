# Open questions

One index of every open question, so they can be found without knowing which component owns them.
**The owning doc is the source of truth** — this page carries titles and links only; edit the
question where it lives, then update its line here.

## Ingestion

[Full text](design/INGESTION.md#5-open-questions) · 13 open

1. Beehive/RNZ lookback and item caps
2. Caption revision policy
3. media_anchor context-pad size
4. Kākā paid-tier depth
5. Health-alert routing
6. NZIER entry criteria
7. False-context set redistribution
8. Embedding model for claim-level dedupe
9. Opinion-piece political relevance (ADR-0025 §2)
10. Attribution window (ADR-0025 §3)
11. unresolved handling
12. Existing mis-scoped verdicts
13. Genre detection source

## Triage

[Full text](design/TRIAGE.md#5-open-questions) · 8 open

1. Checkability calibration
2. One pass or two
3. Type-taxonomy closure
4. Drop-log sampling design
5. Pledge typing detail
6. Caption sentence splitting
7. Dedupe embedding model
8. Determinism, given no usable sampling knob

## Verification

[Full text](design/VERIFICATION.md#5-open-questions) · owned by [ADR-0026](adr/0026-the-adversarial-research-loop.md)

1. Search-provider order — **resolved**
2. **Reintroducing a deterministic series check** — a quantitative claim is researched like any other today (ADR-0026). Add a series check as an evidence *source* for the researcher, not as a separate procedure, so verification stays one loop
3. Critiquer calibration bar — what false-pass rate disqualifies the critiquer model?
4. Turn / search / tool-step cap values — calibrate against first L3 cost data
5. Causation — no check tests it; the loop reports timing evidence and names the bound on the page
6. Rounding tolerance for a misquoted-but-real number — the `refuted` vs `conflicting_cherry_picking` boundary

## Decision models

Owned by [ADR-0024](adr/0024-decision-models-and-calibration.md).

1. **A labelled triage set at n≥20 per class** — the calibration gate cannot be satisfied from
   hand-written smoke-test items (the first run had 13). This is the real blocker to rerouting
   `triage-checkability`, and it is a labelling task, not a code task
2. **Which role moves next** — `triage-checkability` and `evidence-critiquer` are the closed-vocabulary
   roles; `evidence-critiquer` is the publication gate and needs the strictest floor
3. **Ollama as the primary transport** — the local path is free and exempt from the foreign-operator
   rule, but adds a GPU availability dependency the pipeline has no failure discipline for yet
4. **Whether to bundle roles into one decision request** — the obvious latency win, blocked on a
   `role_bundle` concept so per-role provenance survives

## Store

[Full text](design/STORE.md#5-open-questions) · 11 open

1. Labels in the same database under a separate schema (current) vs a separate instance
2. Backup tooling: pg_dump + offload vs continuous archiving; retention policy
3. Verdict diff format: structured JSON field-diff vs unified text diff (or both)
4. Evidence packs: store full fetched series vs references + archive snapshots
5. HNSW rebuild policy after bulk backfills
6. Retention horizon for the transition log
7. claimant_entity seeds in the slice schema or post-slice
8. Entity seed review workflow (Wikipedia/Electoral Commission cross-links)
9. Provenance block: raw cost figures vs OTel span refs
10. Evidence rejections published via the raw log or a curated public view
11. Which lifecycle states beyond DRAFT/PUBLISHED/CONTESTED/FROZEN a reader may reach

## Harness

[Full text](design/HARNESS.md#5-open-questions) · 8 open

1. Second-labeller capacity
2. IAA metric
3. Calibration gate threshold
4. Held-out slice vs gate
5. Search-API result drift
6. Baseline re-baselining policy
7. Provenance stratum's future
8. AVeriTeC licence

## Site MVP

[Full text](design/SITE-MVP.md#5-open-questions) · 5 open, 1 resolved

1. ClaimReview reviewRating.ratingValue mapping — **resolved**
2. Revalidation transport
3. Feedback retention + privacy statement
4. Institution entity pages in the MVP
5. Site search
6. Verdict-share OG image generator

## Toolchain

[Full text](design/TOOLCHAIN.md#5-open-questions) · 3 open

1. Biome vs election-night's exact ESLint+Prettier parity
2. Semgrep ruleset beyond p/ci (e.g. p/typescript, custom rules for prompt handling)
3. Complexity/file-size thresholds

## Cross-cutting

[Full text](design/CROSS-CUTTING.md#13-open-questions) · 9 open

1. Vintage pinning mechanics: replay stored series at the recorded vintage, or pin a snapshot set at run time?
2. Config surface: one typed module in packages/llm, or per-package files with a shared loader?
3. Secret-scanning tooling: GitHub built-in vs gitleaks in CI
4. Alert routing + paging thresholds beyond ADR-0012's defaults at slice scale
5. Scoring-run trigger ownership: Graphile Worker crontab + manual pre-release trigger, or a release-pipeline step?
6. Backup off-box target: object storage (S3/R2)
7. Label-schema version publication: does it ride in the run tuple and the published dataset?
8. Does the false-context curated set run through the normal config surface or a pinned offline manifest?
9. Site analytics (Plausible/Matomo)

## Source taxonomy

[Full text](SOURCE-TAXONOMY.md#part-3-open-questions) · 5 open

1. 1News/TVNZ machine access
2. ODT, Te Ao Māori feeds
3. LDR network content licensing
4. Who maintains the authority map
5. Te reo Māori content in Māori/Pasifika media

## Research review (ADR coverage)

Not questions: the [research review](RESEARCH-REVIEW.md#5-open-questions-tracked-in-adrs) maps
each open topic to the ADR that decided it.
