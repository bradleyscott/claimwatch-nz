# Evidence & verdict store design

*Status: proposed. Companion docs: docs/ARCHITECTURE.md, docs/VALIDATION-SLICE.md, docs/TEST-STRATEGY.md, docs/design/CROSS-CUTTING.md. ADRs: 0002, 0005, 0009 (boundary), 0010, 0014.*

---

## 1. Purpose and slice scope

The store is the project's durable asset and its single data plane: Postgres (pgvector + FTS + pg_cron) with a Drizzle schema in `packages/store`, shared by pipeline (write), site (read), and harness (export) per ADR-0014. Everything the system claims about a claim — the claim record, the evidence that justified the verdict, the verdict itself, and the provenance of how the verdict was produced — lives here, append-only and versioned, because **audit-log integrity is the trust mechanism** for an automated verdict system with no editorial masthead (ADR-0001, ADR-0005).

The validation slice exercises the store end-to-end on five lanes (Beehive RSS, RNZ RSS, YouTube broadcaster captions, one institution source, the curated false-context set) and all four verification modes, plus the harness label storage. Per docs/VALIDATION-SLICE.md the slice's deliverables — the per-stratum accuracy table and cost per claim — are only meaningful if the store faithfully records what the pipeline actually did: Tier-2 fallbacks, evidence vintages, pipeline/prompt versions.

**In slice:**

| Object | Purpose |
|---|---|
| `publication` / `segment` | ADR-0008 document hierarchy; provenance, content hash, transcript tier, media anchor source |
| `claim` | text, type, fingerprint, embedding, discourse context fields, publication/segment FKs |
| `evidence_item` | claim-anchored official series + documents, versioned, with vintage dates |
| `evidence_pack` | append-only pack per verification run (items + grid result + justifications) |
| `verdict` (+ `verdict_version`) | versioned, append-only, four AVeriTeC classes + confidence + status |
| `fallback_log` | per-lane Tier-2 fallback events (R7 by-product measurement) |
| `provenance` | pipeline version, prompt versions, model versions, confidence per verdict |
| `label` + harness objects | blind-rule isolated; same claim/verdict/evidence object design as the pipeline |
| job-state tables + `cron.job_run_details` | pg_cron scheduling ledger feeding Grafana job-health |

**Out of slice (boundaries, not silent omissions):** `argument_chain` records (ADR-0009 is explicitly post-slice — chain assembly reads this store but gains no schema here); user submissions and verification requests (docs/USER-SUBMISSIONS.md is post-slice — the claim/verification-request tables are not defined in this slice's migrations); contest intake and mutation tooling beyond what the schema carries (below); reliability profiles and the public claim-graph view.

**Lifecycle in schema, not in behaviour:** the `verdict.status` column and transition log carry the full ADR-0002 lifecycle — DRAFT→PUBLISHED→CONTESTED→VALIDATING→MUTATED→AUDIT, plus FROZEN during the 5–27 Nov 2026 window. The slice only exercises DRAFT→PUBLISHED; every other transition is schema-supported but unexercised, and §4 treats that as a risk.

### 1.1 What the store is not

- **Not a claim source.** Verifier-authority content enters only as referenced evidence items; claim-source content enters only through claim extraction (docs/ARCHITECTURE.md §1 structural distinction — one-directional evidence lookup, never a claim feed).
- **Not the harness's ground truth for verification.** Labels score the pipeline; the pipeline never reads them (§2.8). The store holds both, but the boundary is access, not schema.
- **Not a document database of raw web content.** Publications store provenance + content hash + raw document for reprocessing (ADR-0006); the store's organising principle is the claim, and everything else is claim-anchored.
- **Not an argument-chain store yet.** ADR-0009's `argument_chain` records are post-slice; the schema reserves nothing for them beyond what claims, publications, and segments already carry (nodes reference claim IDs; edges cite stored text).

## 2. Design

### 2.1 Schema areas (Drizzle, `packages/store`)

| Table | Key columns | Notes |
|---|---|---|
| `publication` | source_id, canonical_url, content_hash, retrieved_at/method, publisher metadata, publication metadata, transcript (once per doc), transcript_tier, transcript_provenance | Unit of document-level dedupe, health checks, reprocessing (ADR-0008). Content hash enforces re-ingest identity. |
| `segment` | publication_id FK, span (timecode or text range), descriptive summary, turn structure | Created only where structure exists; unstructured articles have none. |
| `claim` | text, type (statistical/citation-backed/quote-fidelity/provenance), fingerprint, embedding (`pgvector`), discourse_window, optional typed context fields (`speech_context`, `policy_topic`, `attached_proposal`, `argument_direction`, `context_qualifiers` — all nullable, never defaulted), publication_id, segment_id?, media_anchor, transcript_tier | Fingerprint = indicator × population × geography × time window × baseline × unit. Embedding powers repeat/adjacent-claim match (ADR-0005). |
| `claimant_entity` | person/party, aliases, affiliation **at time of statement**, attribution source links, cross-links (Wikipedia, Electoral Commission) | First-class store object; conservative attribution, never guessed. The verification loop never receives claimant identity — structural firewall (ADR-0005). |
| `evidence_item` | claim_id, authority source ref, series/document identity, **vintage_date**, retrieved_at, URL, **archive_snapshot_url**, content hash, version | One row per fetched version of a series; re-fetch creates a new version, never an update. |
| `evidence_pack` | claim_id, item refs, grid computation result, justifications, NLI audit outcome, created_at | Append-only; the pack that triggered a verdict is frozen and referenced by that verdict version. |
| `verdict_version` | claim_id, version (n), status, verdict class (four AVeriTeC classes + pledge/conditional), confidence, evidence_pack_id, **structured diff vs previous version**, superseded_by, transition_reason | The mutation path is v(n)→v(n+1) with a stored public diff (ADR-0002). Status enum carries the full lifecycle incl. FROZEN. |
| `verdict_transition_log` | verdict_version_id, from_status, to_status, reason, actor (pipeline/validator/audit), at | Every transition logged; nothing silently edited. Also carries evidence rejections (public, with reason). |
| `fallback_log` | lane, source_id, stage, tier (1/2), reason, claim_id?, at | Feeds the per-lane Tier-2 fallback rate (TEST-STRATEGY L1). |
| `verdict_provenance` | verdict_version_id, pipeline_version, prompt_versions (per stage), model_versions, search-provider refs, cost/latency spans ref | Rendered as the per-claim "pipeline provenance" block on the site (VALIDATION-SLICE site MVP item 7). |
| `labels` (harness schema) | claim text/speaker/party/date/source URL, verdict, cited primary sources, labeller reasoning, evidence-availability note, source-ecosystem field, labeller ID, label date, label-set version | Same claim/verdict/evidence object design as the pipeline tables; versioned together (TEST-STRATEGY §1). Lives in a separate Postgres schema with an access boundary (§2.5). |
| `job_state` / pg_cron history | job name, schedule, last_run, status | `cron.job_run_details` feeds ADR-0012 silence-detection. |

Retrieval is native: HNSW index on `claim.embedding`, `tsvector` FTS index on claim/publication text — the hybrid dense+lexical retrieval is two indexes in one database (ADR-0014). Hand-written SQL (hybrid retrieval, funnel views) stays typed via Drizzle's `sql` template.

### 2.2 Indexes, retrieval, and reconciliation

| Index | Type | Serves |
|---|---|---|
| `claim.embedding` | pgvector HNSW | repeat detection, fingerprint adjacency, store retrieval, submission fuzzy-match (post-slice consumer) |
| `claim.text`, `publication` text | Postgres FTS (`tsvector`, `websearch_to_tsquery`) | keyword retrieval, claim-locating search |
| `claim.fingerprint` | btree/composite | exact fingerprint match into the evidence store (stat-mode fast path) |
| `publication.content_hash` | unique | re-ingest identity; idempotent writes on lane retries |
| `verdict_version (claim_id, version)` | unique composite | monotonic versioning per claim |
| funnel views | SQL views over store tables | ADR-0012 funnel dashboards; daily reconciliation vs event counts |

The store is the reconcilable historical truth for the funnel (ADR-0012): counts per stage × lane × hour are SQL views; a daily reconciliation job compares them to event-count telemetry and alerts on drift — dashboards disagreeing with the store indicate instrumentation bugs, which is itself monitored. Funnel semantics (stages, drop-off definitions) are a published methodology artefact.

### 2.3 pg_cron job surface

| Job | Trigger | Ledger |
|---|---|---|
| Lane ingestion cadence | pg_cron schedule | `job_state` + `cron.job_run_details` |
| Nightly evidence re-probe (link liveness, STO-R3) | pg_cron | job history |
| Nightly re-verification (post-slice) | pg_cron → worker container | job history; detects series revisions vs pinned vintages |
| Daily funnel reconciliation | pg_cron | job history; alert on drift |
| Migration-time index checks | CI (not cron) | CI log |

pg_cron is the trigger and the ledger, never the executor — LLM-shaped jobs run in worker processes; advisory locks handle worker mutual exclusion (ADR-0014).

### 2.4 Append-only enforcement approach

Append-only is enforced by the database, not by convention:

- **Roles and grants.** Three Postgres roles: `pipeline` (INSERT/SELECT on pipeline schema; no UPDATE/DELETE anywhere), `site` (SELECT on published views only), `harness` (INSERT/SELECT on `labels` schema; no access to pipeline write tables' mutation). UPDATE/DELETE privileges are simply never granted; a `BEFORE UPDATE OR DELETE` trigger on `evidence_item`, `evidence_pack`, `verdict_version`, and `verdict_transition_log` raises an exception as defence-in-depth (catches superuser/owner mistakes and makes the intent executable documentation).
- **Correction = new row.** A revised series, a re-fetched document, a mutated verdict: new row + `supersedes`/`superseded_by` pointer. Rejected evidence is logged in `verdict_transition_log` with reason (public per ADR-0002), never deleted.
- **Schema evolution is forward-compatible**: drizzle-kit generates versioned SQL migrations, reviewed in PRs, applied in order; migrations run in CI against a scratch Postgres before merge (ADR-0014's schema-drift alarm). No ad-hoc DDL against the live store, ever.
- **Backups are the outer envelope**: the store, audit log, and labelled datasets are the durable assets backed up outside the election-window lifecycle (docs/ARCHITECTURE.md §7).

### 2.6 Versioning and diff

- Every published verdict is a `verdict_version` row; version numbers are monotonic per claim. The slice writes v1 only, but the schema carries v(n)→v(n+1): a validated evidence pack (post-slice) triggers a new version with a **structured field-level diff** (verdict class, confidence, material grid findings, context fields) stored on the new version — the "public diff" ADR-0002 requires is generated from this column, not recomputed.
- Evidence items are versioned per fetch; a verdict pins the evidence-pack ID and therefore the exact item versions it rested on. Re-verification (nightly, post-slice) compares fresh vintages against the pinned ones and detects revisions (EVALUATION.md §7).
- The original verdict is kept as history on any correction linkage (s 199A first-publication clarity, ADR-0005).
- Label sets are versioned the same way (`label_set_version`); existing labels are revised only through the contest-and-mutation process with history preserved (EVALUATION.md §2.3).

### 2.7 Evidence durability

- Every evidence item stores its **vintage date** — the statistical series' reference period/data-as-at stamp — not just retrieval time. "As deployed" lines and "as measured at publication" notes are computed from stored vintages; without them 'as deployed' is unverifiable (EVALUATION.md §7).
- Evidence URLs cited in verdicts and labels are **cached to the Internet Archive at labelling/verification time** and the snapshot URL is stored (`archive_snapshot_url`) — the rot defence (AVeriTeC's own practice, EVALUATION.md §2.2).
- Publications store content hashes and the raw document (ADR-0006 raw-document retention), so reprocessing never re-fetches to reconstruct.
- Series vintages + the revision policy mean verdicts can note "as measured at publication" and re-verification can detect official revisions (ADR-0005).

### 2.8 Blind-rule isolation

One schema design, two access boundaries:

- The `labels` objects are generated by the **same Drizzle table definitions** as the pipeline objects (claim/verdict/evidence shaped identically) and versioned together — divergence between harness labels and pipeline objects is a schema-drift bug, not a design feature (TEST-STRATEGY §1).
- Isolation is by **Postgres role and grants**, in the same database but a separate `labels` schema: the `pipeline` role has no SELECT/INSERT on `labels`; the harness process runs as `harness` role. The pipeline process structurally cannot read labels — enforced in code, not convention (TEST-STRATEGY L3). Belt-and-braces: labels also live behind a distinct storage path for export artefacts.
- Scoring runs read labels only via the harness role; the pipeline never sees label content, held-out slices, or label revisions.

## 3. Interfaces and contracts

| Consumer | Reads | Writes | Contract |
|---|---|---|---|
| Verification engine | claim record + context pack (window/segment/publication), fingerprint matches, accumulated evidence items (resumes retrieval, doesn't restart), authority map config | claim records, evidence items, evidence packs, verdict versions v1, transition log, fallback log, provenance | Never receives claimant identity (structural firewall). Writes are append-only; every verdict carries confidence; below-threshold claims publish as open questions, not verdicts (ADR-0004). |
| Site (Next.js) | published verdict versions (latest per claim), evidence packs, context stack, provenance block, entity records, funnel views, entity-page aggregates | nothing | Read-only role. ClaimReview JSON-LD generated from store fields; "hear it / watch it" deep links from `media_anchor`; methodology-page accuracy table generated from harness output files, never hand-edited (TEST-STRATEGY L4). |
| Harness | verdicts + evidence paths (export to AVeriTeC JSONL via `harness` role read on pipeline schema) | `labels` rows, label-set versions, scoring-run outputs | Blind rule: writes labels; pipeline role cannot read them. Exports Dataset A (labelling) and Dataset B (AVeriTeC L1) per VALIDATION-SLICE. |
| pg_cron jobs | job-state tables, `cron.job_run_details` | nightly re-verification triggers, backfills, re-probes | pg_cron is trigger + ledger, not executor; heavy LLM jobs run in worker containers (ADR-0014). |
| Grafana (ADR-0012) | funnel SQL views, reconciliation counts, job health | nothing | Store is the reconcilable historical truth; daily reconciliation compares event counts to store counts and alerts on drift. |

**Freeze enforcement (schema contract):** the store rejects a status transition into MUTATED (and any new verdict version on a PUBLISHED claim) while the freeze window is active — freeze dates are configuration, implemented in the verdict state machine, not a manual process (ADR-0002). Contested verdicts during freeze render "contested — under review" with the contest logged.

## 4. Test risks

| ID | Risk | Where it lives | Consequence if untested | Detection signal |
|---|---|---|---|---|
| STO-R1 | Append-only violated by UPDATE/DELETE paths (ORM convenience, migrations, admin scripts) | `evidence_item`, `evidence_pack`, `verdict_version`, transition log; grants/triggers | Audit-log integrity — the trust mechanism — silently broken; a "fixed" verdict is indistinguishable from an honest one | Any UPDATE/DELETE succeeding on append-only tables; row counts that shrink or row hashes that change without a new version row |
| STO-R2 | Verdict versioning missing or diff not stored — mutation path cannot produce v(n)→v(n+1) with a public diff | `verdict_version` (version column, diff column, superseded_by) | ADR-0002's core mechanism (mutation with public diff) is unimplementable on the schema; s 199A first-publication clarity lost | Mutation rehearsal cannot write v2; diff column null or unrenderable |
| STO-R3 | Evidence URL rot — cited evidence disappears before readers or auditors can check it; Archive snapshot never taken at labelling time | `evidence_item.archive_snapshot_url`; label evidence URLs | Verdicts become unverifiable after the fact; harness labels cite dead links | Archive-snapshot fetch failing; snapshot URL null on labelled/published items; periodic link re-probe failures |
| STO-R4 | Vintage-date storage gaps — series stored without vintage dates, or vintage conflated with retrieval time | `evidence_item.vintage_date` | "As deployed" / "as measured at publication" unverifiable; official revisions undetectable; temporal-leakage controls (EVALUATION §7) hollow | Null vintage_date on series-typed items; vintage == retrieved_at on 100% of rows (suspicious uniformity) |
| STO-R5 | pgvector/FTS index drift — HNSW or tsvector indexes stale/absent after bulk load or migration, breaking fingerprint-adjacent match + dedup + site search | pgvector HNSW + FTS indexes; reindex behaviour | Repeat claims re-verified at full cost (compounding fails, cost model breaks); duplicate claims published; harness sampling contaminated by duplicates | Repeat-occurrence ratio dropping to ~0 (ADR-0012 funnel metric); dedup counter vs raw claim count divergence; query latency shift |
| STO-R6 | Migration failure or non-idempotent migration corrupts/partially applies schema on live store | drizzle-kit migrations in `packages/store` | Append-only store with broken schema mid-campaign; unrecoverable without restore | CI scratch-Postgres migration run failing; `cron.job_run_details` gaps post-migration |
| STO-R7 | Schema drift between harness labels and pipeline objects (same objects, two definitions) | `packages/store` shared Drizzle tables; `labels` schema | Harness measures a different object shape than the pipeline writes; per-stratum accuracy numbers uninterpretable | Type-check across packages failing; label export rejected by AVeriTeC-format validation; drizzle-kit diff detecting divergence |
| STO-R8 | Backups untested — restore never rehearsed; backup exists but is unrestorable | Backup tooling + restore runbook (docs/ARCHITECTURE §7) | Store, audit log, labelled sets are the durable assets; an unrestorable backup means the campaign's trust asset is one disk event from zero | Scheduled restore drill result; restored-DB row-count + hash reconciliation vs live |
| STO-R9 | Access boundary between `pipeline` role and `labels` failing the blind rule (grant misconfiguration, role escalation, shared connection pool) | Postgres roles/grants; `labels` schema; harness/pipeline connection config | Blind rule broken in code despite convention — accuracy numbers tunable-against-labels; the harness's entire credibility voids | Pipeline-role query against `labels` returning rows instead of permission-denied |
| STO-R10 | Lifecycle transitions unexercised — schema carries full DRAFT→…→AUDIT + FROZEN but slice only exercises DRAFT→PUBLISHED; invalid transitions and freeze enforcement never run | `verdict.status` enum + transition constraints + freeze config | Post-slice, a malformed transition or a mutation during the freeze window is discovered by the 5 Nov deadline, not by tests | Transition-constraint test suite; freeze-rehearsal (staged freeze in October, ADR-0002) |
| STO-R11 | Provenance block incompleteness — pipeline/prompt/model versions not recorded per verdict | `verdict_provenance` | Golden-set snapshots (L2) can't pin what produced a verdict; reproducibility of published numbers fails; provenance block on site renders empty | Null pipeline_version or prompt_versions on any verdict_version; L2 snapshot unable to reproduce |
| STO-R12 | Fingerprint instability — fingerprint extraction changes between pipeline versions so the same claim fails to match its earlier record (dedup + resume-retrieval break) | `claim.fingerprint` + embedding match | Repeat claims double-verified with contradictory verdicts; the compounding store silently stops compounding | Repeat-occurrence ratio shift; same pinned claim yielding two claim rows after pipeline version bump (L2 catches) |
| STO-R13 | Tier-2 fallback log incomplete or not per-lane queryable | `fallback_log` | R7 (extraction-ladder stress) unmeasured — the slice's by-product deliverable lost; markup drift invisible | Fallback counter firing in tests but landing nowhere; fallback rate zero across all lanes (implausible) |
| STO-R14 | Store writes not idempotent on re-ingest — content-hash identity not enforced, duplicates on lane retries | `publication.content_hash` unique constraint; upsert logic | Duplicate publications → duplicate claims → duplicated verdicts; funnel reconciliation drift alerts fire permanently | Re-ingest of the same fixture creating a second publication row |
| STO-R15 | Verdict status enum/constraint drift — status values or transition constraints diverge between schema and the state machine code | `verdict_version.status` enum; check constraints; state-machine config | Illegal transitions accepted silently; lifecycle states recorded that the lifecycle doc doesn't define; freeze enforcement gaps (ties to STO-R10) | Transition-constraint test enumerating every from→to pair against the ADR-0002 lifecycle diagram |
| STO-R16 | Context fields defaulted instead of absent — nullable context fields filled with inferred values, violating ADR-0008's extract-if-present-never-assumed rule | `claim` optional context columns; triage write path | "As deployed" lines fabricated from non-context; contestation of context records breaks; context-ablation harness measurement (ADR-0008) meaningless | Fixture claims with no discourse proposal yielding non-null `attached_proposal`; null-rate implausibly low |
| STO-R17 | Reconciliation drift persists silently — daily reconciliation job itself fails or is never scheduled, so funnel dashboards and store disagree undetected | pg_cron reconciliation job; `cron.job_run_details` | ADR-0012's "store is the truth" invariant lost; site coverage numbers diverge from reality | Reconciliation job heartbeat missing (silence alert); Grafana no-data condition |
| STO-R18 | Label revisions without history — labels updated in place rather than versioned through the contest-and-mutation process | `labels` versioning; `label_set_version` | EVALUATION §2.3's update policy violated; contested-label value (the most valuable entries) destroyed; reproducibility of older scoring runs lost | Label row UPDATE succeeding where an insert-with-history was required; missing prior label versions for a revised label |

## 5. Test strategy

Every §4 risk maps to a layer per docs/TEST-STRATEGY.md (L1 deterministic/every push; L2 golden snapshots/every PR; L3 harness/weekly + pre-release; L4 site/every push + pre-release) plus two operational drills that sit outside the four layers by design (restore drill, freeze rehearsal) — they are scheduled, scripted, and reported like tests.

| Risk | Mitigation | Layer | When it runs |
|---|---|---|---|
| STO-R1 | L1: assert UPDATE/DELETE raise exceptions on all four append-only tables (fixtures + real Postgres in CI); assert grants deny UPDATE to `pipeline`/`site` roles. L1 row-immutability check: hash-before/hash-after after a full pipeline-fixture run | L1 | Every push |
| STO-R2 | L1: schema-level test — write v1, simulate validated pack, write v2; assert monotonic version, non-null structured diff, superseded_by link. Mutation-path rehearsal against scratch DB | L1 | Every push |
| STO-R3 | L3: Archive snapshot capture asserted for every cited evidence URL at labelling time (EVALUATION §2.2 control); nightly pg_cron re-probe stores link liveness; alert on null `archive_snapshot_url` after N days | L3 + pg_cron probe | Weekly + pre-release; probe nightly |
| STO-R4 | L1: fixture series with known vintages — assert vintage_date stored, distinct from retrieved_at, and propagated to the "as deployed" computation; assert no series-typed evidence_item has null vintage | L1 | Every push |
| STO-R5 | L1: bulk-load-then-query test on scratch Postgres — assert HNSW + FTS indexes exist and return the fixture nearest-neighbours/keyword hits post-load and post-migration. L2: pinned repeat-claim pair must dedup to one claim every PR | L1 + L2 | Every push / every PR |
| STO-R6 | CI: drizzle-kit migrations run in order against scratch Postgres before merge, then L1 suite runs on the migrated schema (the schema-drift alarm, ADR-0014). Migration rollback tested for the forward-only path | L1 (CI job) | Every PR touching `packages/store` |
| STO-R7 | Shared Drizzle tables are the single definition; typecheck across pipeline/site/harness in CI; drizzle-kit diff asserts `labels` schema matches the shared definitions; AVeriTeC-format export validated on fixture labels | L1 | Every push |
| STO-R8 | **Backup/restore drill** (operational): scripted pg_dump/base-backup restore into a scratch instance; assert row counts, max(verdict version), evidence-item content hashes, and label-set checksums reconcile with the live store; report in CI-artefact form. Cadence: monthly + before any release. Restore is rehearsed, never assumed | Ops drill (L1-scripted) | Monthly + pre-release |
| STO-R9 | **Blind-rule access test**: L1 integration test running as the `pipeline` role asserts `SELECT`/`INSERT` on every `labels` table returns permission-denied; same for `site` role. Runs against the real grant configuration (not a mock) in CI, and re-verified against live Postgres at every release. Harness-role write + pipeline-role zero-read asserted on fixture data | L1 | Every push; re-verified at pre-release |
| STO-R10 | L1: transition-table test — every legal lifecycle transition writes a log row; every illegal transition (incl. FROZEN→MUTATED, DRAFT→PUBLISHED without evidence pack) is rejected. **Freeze rehearsal**: staged freeze in October (per ADR-0002) exercises freeze enforcement end-to-end before 5 Nov | L1 + ops rehearsal | Every push; rehearsal in October |
| STO-R11 | L1: no verdict_version may be written with null pipeline_version/prompt_versions/model versions (write-path constraint + test). L2: golden snapshots must reproduce from pinned versions — a mismatch is the detection signal | L1 + L2 | Every push / every PR |
| STO-R12 | L2: pinned repeat-claim pair — after any pipeline change the pair must still match to one claim record (fingerprint + embedding); visible diff in golden snapshots flags fingerprint drift | L2 | Every PR |
| STO-R13 | L1: fixture with a Tier-2 fallback asserts the fallback_log row lands with lane + stage + reason (TEST-STRATEGY L1 bullet); funnel SQL view returns per-lane fallback rates | L1 | Every push |
| STO-R14 | L1: re-ingest the same fixture twice — assert one publication row (content-hash unique), idempotent claims; reconciliation job compares event counts to store counts and alerts on drift (ADR-0012) | L1 + daily reconciliation | Every push; reconciliation daily |
| STO-R15 | L1: exhaustive transition-pair test — every from→to status pair asserted against the ADR-0002 lifecycle (legal pairs log a row; all others rejected, incl. FROZEN states). Enum values asserted equal to the schema's check constraint | L1 | Every push |
| STO-R16 | L1: fixture claims with no discourse proposal/qualifiers in the window — assert context fields remain null (absent ≠ defaulted); assert write-path rejects defaulted values; golden snapshots include null-field assertions | L1 + L2 | Every push / every PR |
| STO-R17 | L1: reconciliation job runs against fixture store/event counts and detects an injected drift. Grafana no-data/silence alert asserted on missing heartbeat (ADR-0012 job monitoring) | L1 | Every push |
| STO-R18 | L1: label-revision path test — revising a label requires a new versioned row + history pointer; in-place UPDATE denied (append-only grant pattern extended to labels); two scoring runs pinning different label-set versions reproduce their original outputs | L1 | Every push |

**Cadence summary:** L1 suite (all schema/immutability/blind-rule/vintage/fallback/idempotence tests) every push; L2 golden snapshots every PR and at slice milestones; L3 harness weekly + pre-release with evidence-durability controls; L4 site checks every push (ClaimReview JSON-LD, Playwright smoke, methodology-table integrity); restore drill monthly + pre-release; freeze rehearsal October. Migration CI runs on every PR touching the schema, before merge.

### 5.1 The blind-rule access test (detail)

Because the harness's credibility rests entirely on the blind rule, this test is specified precisely:

- **Fixture**: a scratch Postgres built from the actual migration chain, with the actual role grants applied (never a mocked grant layer).
- **Assert**: as `pipeline` role — `SELECT` on every `labels` table → permission denied; `INSERT` → permission denied; schema-qualified and search_path-hidden variants both attempted. As `site` role — same. As `harness` role — write succeeds, read-back succeeds, and a pipeline-role session running concurrently still sees nothing.
- **Anti-leak check**: the harness export path writes only to files/payloads outside the pipeline's storage boundary; a test asserts no `labels` content appears in any pipeline-readable artefact.
- **Run**: every push in CI (cheap), plus re-verification against the live instance at every release — a grant fix applied to the live DB outside the migration chain is exactly the drift this catches (STO-R9).

### 5.2 The backup/restore drill (detail)

- **Scripted, not ad-hoc**: the restore runbook is a committed script (restore into a scratch instance, apply role grants, run reconciliation queries).
- **Assertions after restore**: publication/claim/verdict row counts match the live store; `max(version)` per claim matches; evidence-item content hashes reconcile on a sampled basis; label-set checksums match; roles and grants exist as expected (an unrestorable-but-complete dataset is still a failed drill if the boundary grants are gone).
- **Cadence**: monthly, plus before any release, plus immediately before the freeze window (the store must not need a mutation until after 27 Nov, so a restore capability verified pre-freeze is the last checkpoint).
- **Report**: drill output lands as a CI-style artefact; a failed assertion is a release blocker.

### 5.3 Slice acceptance for the store

The store portion of the slice is done when: (1) all L1 store tests pass on the migrated scratch schema; (2) the blind-rule access test passes against real grants; (3) the golden-set snapshots round-trip through the store with provenance blocks complete; (4) the first restore drill has run clean; (5) the per-lane fallback log is queryable per TEST-STRATEGY L1.

## 6. Open questions

| # | Question | Notes |
|---|---|---|
| STO-Q1 | Labels in the same Postgres database under a separate schema (current design) vs a separate database instance for the harness | Same-DB/separate-schema is simpler and grant-enforced; separate DB is belt-and-braces if role-escalation risk is judged material. Needs Bradley's call before the schema lands (TEST-STRATEGY D1) |
| STO-Q2 | Backup tooling and schedule: pg_dump + object-storage offload vs pgBackRest-style continuous archiving; retention policy outside the election lifecycle | ADR-0014 names no backup tool; docs/ARCHITECTURE §7 requires out-of-window lifecycle backup. Decide before the first real label batch exists |
| STO-Q3 | Verdict diff format: structured JSON field-diff (renderable, machine-checkable) vs unified text diff (human-scannable) — or both | ADR-0002 requires a *public* diff; the rendering choice affects the `verdict_version` diff column and the site's mutation view. Undecided |
| STO-Q4 | Evidence-pack retention of full fetched series snapshots vs references + archive snapshots | Storing full series per item grows the store fast; referencing the authority source risks rot (STO-R3). Trade-off (storage vs self-containment) unresolved |
| STO-Q5 | HNSW index rebuild policy after bulk backfills (manual `REINDEX` vs pg_cron job vs deferred build) | Tied to STO-R5; pick once backfill volume is known |
| STO-Q6 | Retention horizon for `verdict_transition_log` and rejection records | Rejections are public and reasoned per ADR-0002 — implied permanent; confirm no pruning job ever touches it |
| STO-Q7 | Whether `claimant_entity` seeds and affiliation history land in the slice schema or post-slice | ADR-0005 makes entities first-class store objects, but the slice's site MVP needs only entity pages for verdict distributions — minimal-columns-first, or full schema now? |
| STO-Q8 | Freeze-window configuration source (env/config table vs hardcoded) and who is authorised to change it | ADR-0002 requires freeze dates as configuration; the change-control story for that configuration is undecided |
| STO-Q9 | Nightly re-verification in the slice or post-slice: the schema pins vintages now, but whether revision detection (fresh fetch vs pinned vintage) runs during the slice is undecided | ADR-0005 keeps series vintages + revision policy as a build item; the slice's job is measurement — re-verification adds retrieval cost with little measurement value. Recommend post-slice; needs Bradley's call |
| STO-Q10 | Entity seed data (Wikipedia/Electoral Commission cross-links) fetched and human-reviewed for which seed set before the site's entity pages render | ADR-0005 requires human review for seed entities; the review workflow owner and timing are undecided |
| STO-Q11 | Whether the `provenance` block stores raw cost/latency figures or references OTel span IDs only (Grafana retention vs store self-containment) | ADR-0012 keeps telemetry in Grafana; but the site renders the provenance block from the store — if Grafana retention lapses, cost figures vanish. Store-lite (refs) vs store-full (figures) unresolved |
| STO-Q12 | Whether `verdict_transition_log` rows for evidence rejections are published via the site read role directly or via a curated public view | ADR-0002 makes rejections public with reason; the moderation question (raw log row vs rendered view with the language standard applied) is a site-design decision the store should not pre-empt |