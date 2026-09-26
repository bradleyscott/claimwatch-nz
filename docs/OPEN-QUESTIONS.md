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
9. Opinion-piece political relevance (ADR-0019 §2)
10. Attribution window (ADR-0019 §1)
11. unresolved handling
12. Existing mis-scoped verdicts
13. Genre detection source

## Triage

[Full text](design/TRIAGE.md#5-open-questions) · 9 open

1. Checkability calibration
2. One pass or two
3. Fingerprint normalisation rules
4. Type-taxonomy closure
5. Drop-log sampling design
6. Pledge typing detail
7. Caption sentence splitting
8. Dedupe embedding model
9. Determinism, given no usable sampling knob (Sept 2026)

## Verification

[Full text](design/VERIFICATION.md#5-open-questions) · 7 open, 1 resolved

1. Search-provider order — **resolved**
2. Materiality-selection rubric sign-off
3. Quote-fidelity tolerance policy
4. Provenance-mode graduation criteria
5. NLI-auditor calibration bar
6. Depth-cap values per mode
7. Stat-mode verdict for misquoted-but-real numbers (right indicator, wrong figure)
8. Causal claims have no mode (VERIFICATION §2.1). 11% of the corpus is causal; timing evidence is currently reported under the open-web bound. Needs either a sixth mode (pre-trend tests, unaffected comparison group, difference-in-differences) or an explicit out-of-scope refusal

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
