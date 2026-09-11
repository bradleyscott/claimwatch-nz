# Evidence & verdict store design

*Proposed. ADRs: 0002, 0005, 0009 (boundary), 0010, 0014. Companions: `ARCHITECTURE.md`, `VALIDATION-SLICE.md`, `TEST-STRATEGY.md`, `CROSS-CUTTING.md`.*

## 1. Purpose and slice scope

The store is the durable asset and single data plane: Postgres (pgvector + FTS + pg_cron), Drizzle schema in `packages/store`, shared by pipeline (write), site (read), harness (export) per ADR-0014. Everything the system claims about a claim — record, evidence, verdict, provenance — lives here, append-only and versioned, because **audit-log integrity is the trust mechanism** for a system with no editorial masthead (ADR-0001).

The slice exercises the store end-to-end on the five lanes and four modes plus harness label storage. The slice's deliverables (per-stratum accuracy, cost per claim) are only meaningful if the store faithfully records what the pipeline did: fallbacks, vintages, versions.

**In slice:** `publication`/`segment` (ADR-0008 hierarchy), `claim`, `evidence_item` (versioned, vintage-dated), `evidence_pack` (append-only), `verdict_version` + `verdict_transition_log`, `fallback_log`, `verdict_provenance`, `labels` (blind-rule isolated), job-state tables + `cron.job_run_details`.

**Out of slice (boundaries, not silent omissions):** `argument_chain` records (ADR-0009 post-slice; chain assembly reads this store but gains no schema here) · user submissions and verification requests · contest/mutation tooling beyond what the schema carries · reliability profiles and the public claim graph.

**Lifecycle in schema, not behaviour:** `verdict.status` + the transition log carry the full ADR-0002 lifecycle (DRAFT→PUBLISHED→CONTESTED→VALIDATING→MUTATED→AUDIT, plus FROZEN during the 5–27 Nov window). The slice exercises DRAFT→PUBLISHED only; everything else is schema-supported, unexercised — treated as a risk (STO-R10).

### 1.1 What the store is not

- **Not a claim source** — authority content enters only as referenced evidence items (ARCHITECTURE §1's structural distinction).
- **Not the harness's ground truth for verification** — the store holds both pipeline objects and labels; the boundary is access, not schema (§2.8).
- **Not a raw-web-content database** — publications store provenance + hash + raw document for reprocessing; the organising principle is the claim.
- **Not an argument-chain store yet.**

## 2. Design

### 2.1 Schema areas (Drizzle, `packages/store`)

| Table | Key columns | Notes |
|---|---|---|
| `publication` | source_id, canonical_url, content_hash, retrieved_at/method, publisher + publication metadata, transcript (once), `transcript_tier` | Unit of document dedupe, health checks, reprocessing. Hash enforces re-ingest identity. |
| `segment` | publication_id FK, span, descriptive summary, turn structure | Only where structure exists. |
| `claim` | text, type, fingerprint, embedding, `discourse_window`, optional context fields (all nullable, never defaulted), publication/segment FKs, `media_anchor`, `transcript_tier` | Fingerprint = the six-tuple; embedding powers repeat match. |
| `claimant_entity` | person/party, aliases, affiliation **at time of statement**, cross-links | Conservative attribution, never guessed. The verification loop never receives claimant identity. |
| `evidence_item` | claim_id, authority ref, series identity, **vintage_date**, URL, **archive_snapshot_url**, hash, version | One row per fetched version; re-fetch creates a version, never an update. |
| `evidence_pack` | claim_id, item refs, grid result, justifications, NLI outcome | Append-only; the pack that triggered a verdict is frozen and referenced by it. |
| `verdict_version` | claim_id, version (n), status, class (four + pledge/conditional), confidence, evidence_pack_id, **structured diff vs previous**, superseded_by, transition_reason | The mutation path is v(n)→v(n+1) with a stored public diff (ADR-0002). |
| `verdict_transition_log` | from_status, to_status, reason, actor, at | Every transition logged; nothing silently edited; carries public evidence rejections. |
| `fallback_log` | lane, source_id, stage, tier, reason | Feeds the per-lane Tier-2 fallback rate. |
| `verdict_provenance` | pipeline_version, prompt_versions, model_versions, search refs, cost/latency refs | Rendered as the site's provenance block. |
| `labels` (harness schema) | claim ref, verdict, cited sources, reasoning, evidence-availability, source-ecosystem, labeller, label-set version | Same object design as pipeline tables, versioned together; separate schema + access boundary (§2.8). |
| job state | job name, schedule, last_run, status | `cron.job_run_details` feeds silence-detection. |

Retrieval is native: HNSW on `claim.embedding`, `tsvector` FTS — hybrid dense+lexical is two indexes in one database. Hand-written SQL (hybrid retrieval, funnel views) stays typed via Drizzle's `sql` template.

### 2.2 Indexes and reconciliation

| Index | Type | Serves |
|---|---|---|
| `claim.embedding` | HNSW | repeat detection, adjacency, store retrieval |
| claim/publication text | FTS | keyword retrieval, claim-locating search |
| `claim.fingerprint` | composite | exact match into the evidence store (stat-mode fast path) |
| `publication.content_hash` | unique | idempotent writes on lane retries |
| `verdict_version (claim_id, version)` | unique | monotonic versioning per claim |
| funnel views | SQL views | ADR-0012 dashboards; daily reconciliation vs event counts |

The store is the reconcilable historical truth for the funnel; a daily job compares SQL-view counts to event telemetry and alerts on drift — dashboards disagreeing with the store indicate instrumentation bugs, which is itself monitored.

### 2.3 pg_cron job surface

Lane ingestion cadence · nightly evidence re-probe (link liveness) · nightly re-verification (post-slice; detects series revisions vs pinned vintages) · daily funnel reconciliation · L3 scoring-run triggers.

**pg_cron is trigger + ledger, never executor.** It can run SQL only — so the bridge to Node is a job-queue table, not `pg_cron` shelling out:

1. **Schedule**: `pg_cron` runs a plain SQL statement on its cadence — typically `INSERT INTO job_queue (kind, payload, run_key) VALUES (…)` (or `UPDATE … SET due_at = now()` for recurring jobs).
2. **Handoff**: a long-lived **worker container** (`pipeline worker`, one per VM; harness worker for L3) polls the queue on a short interval, claims the next due job with `SELECT … FOR UPDATE SKIP LOCKED`, takes an advisory lock keyed on the job id, and executes the Node work (lane fetch, LLM loop, scoring run).
3. **Ledger**: the worker writes status + duration + error back to `job_queue`/`job_run` rows. Combined with `cron.job_run_details` (the SQL schedule's own history) this feeds ADR-0012 job-health metrics and silence-detection.

Properties: schedule state survives restarts (it's rows, not a process); a dead worker leaves the job claimed-but-unfinished, visible in the queue and alertable; adding a job kind is an INSERT, not a deploy; `SKIP LOCKED` + advisory locks make double-verification structurally impossible (CRO-R11).

### 2.4 Append-only enforcement (database, not convention)

- **Roles and grants**: `pipeline` (INSERT/SELECT only), `site` (SELECT on published views), `harness` (labels schema). UPDATE/DELETE simply never granted; a `BEFORE UPDATE OR DELETE` trigger on the four append-only tables raises as defence-in-depth — executable documentation.
- **Correction = new row**: revised series, re-fetched document, mutated verdict — new row + `supersedes` pointer. Rejected evidence is logged, never deleted.
- **Forward-compatible evolution**: drizzle-kit migrations reviewed as SQL, applied in order, run in CI against a scratch Postgres before merge. No ad-hoc DDL against the live store, ever.
- **Backups as the outer envelope** — nightly dumps, off-box, restore-tested (§5.2).

### 2.5 Versioning and diff

- Every published verdict is a `verdict_version` row; versions monotonic per claim. The slice writes v1 only, but the schema carries v(n)→v(n+1): a validated evidence pack (post-slice) triggers a new version with a **structured field-level diff** — the "public diff" ADR-0002 requires is generated from this column, not recomputed.
- Evidence items versioned per fetch; a verdict pins the pack ID and therefore the exact item versions it rested on. Re-verification compares fresh vintages against pinned ones.
- Label sets versioned the same way; labels revised only through the contest-and-mutation process, history preserved.

### 2.6 Evidence durability

- **Vintage date** on every series row — the reference-period stamp, not retrieval time. "As deployed" and "as measured at publication" are computed from stored vintages; without them they're unverifiable.
- **Internet Archive caching** at verification/labelling time; snapshot URL stored — the rot defence.
- Publications store content hash + raw document, so reprocessing never re-fetches.

### 2.7 Blind-rule isolation

One schema design, two access boundaries: labels are generated from the **same Drizzle table definitions** as pipeline objects and versioned together — divergence is a schema-drift bug, not a feature. Isolation is by **Postgres role and grants**: same database, separate `labels` schema; the `pipeline` role has no grants on it. The pipeline structurally cannot read labels — enforced in code, tested in CI (§5.1). HARNESS.md owns the full mechanism; the store's commitment is that the boundary is testable from L1.

## 3. Interfaces

| Consumer | Reads | Writes | Contract |
|---|---|---|---|
| Verification engine | claim + context pack, fingerprint matches, accumulated evidence | claims, evidence, packs, verdict v1, transition log, fallback log, provenance | Never receives claimant identity. Append-only writes; confidence on every verdict; below-threshold → open questions. |
| Site | published verdicts, packs, context stack, provenance, entity records, funnel views | nothing | Read-only role. ClaimReview from store fields; methodology table from harness files, never hand-edited. |
| Harness | verdicts + evidence paths (read-only) | labels, label-set versions, scoring-run outputs | Blind rule: writes labels; pipeline cannot read them. |
| pg_cron | job state | queue inserts + `job_run` updates via SQL | Trigger + ledger, not executor. Node work runs in worker containers, claimed via the job-queue table (§2.3). |
| Grafana | funnel views, reconciliation counts, job health | nothing | Store is the reconcilable truth; drift alerts. |

**Freeze enforcement (schema contract):** the store rejects a transition into MUTATED (and any new verdict version on a PUBLISHED claim) while the freeze window is active — dates are configuration in the state machine, not a manual process. Contested verdicts during freeze render "contested — under review".

## 4. Test risks

| ID | Risk | Consequence if untested | Detection signal |
|---|---|---|---|
| STO-R1 | Append-only violated by UPDATE/DELETE paths | Audit-log integrity silently broken; a "fixed" verdict indistinguishable from an honest one | UPDATE/DELETE succeeding on append-only tables; row counts/hashes changing without a new version |
| STO-R2 | Versioning/diff missing — mutation path unimplementable | ADR-0002's core mechanism unbuildable; s 199A clarity lost | Mutation rehearsal can't write v2; diff column null |
| STO-R3 | Evidence URL rot — Archive snapshot never taken | Verdicts unverifiable after the fact; labels cite dead links | Snapshot fetch failing; null `archive_snapshot_url` |
| STO-R4 | Vintage-date gaps, or vintage conflated with retrieval time | "As deployed" unverifiable; revisions undetectable | Null vintage on series rows; vintage == retrieved_at everywhere |
| STO-R5 | pgvector/FTS index drift after bulk load or migration | Repeat claims re-verified at full cost; duplicates published | Repeat-occurrence ratio ~0; dedup counter divergence |
| STO-R6 | Migration failure corrupts live schema | Append-only store broken mid-campaign | CI scratch-Postgres migration failing |
| STO-R7 | Schema drift between harness labels and pipeline objects | Harness measures a different shape than production writes | Cross-package typecheck; drizzle-kit diff |
| STO-R8 | Backups untested — unrestorable | The trust asset is one disk event from zero | Restore drill result; post-restore reconciliation |
| STO-R9 | Blind-rule boundary failing (grant misconfig, escalation) | Accuracy numbers tunable against labels — harness credibility voids | Pipeline-role query on `labels` returning rows instead of denial |
| STO-R10 | Lifecycle transitions unexercised — freeze enforcement never runs | Discovered by the 5 Nov deadline, not by tests | Transition-constraint suite; October freeze rehearsal |
| STO-R11 | Provenance incompleteness | Golden snapshots can't pin what produced a verdict; site block renders empty | Null pipeline/prompt versions on any verdict |
| STO-R12 | Fingerprint instability across pipeline versions | Repeat claims double-verified with contradictory verdicts; compounding stops | Same pinned claim yielding two rows after a version bump (L2) |
| STO-R13 | Fallback log incomplete / not per-lane queryable | R7 unmeasured; markup drift invisible | Counter fires but lands nowhere; rate zero across all lanes |
| STO-R14 | Store writes not idempotent on re-ingest | Duplicate publications → duplicate verdicts; permanent reconciliation alerts | Same fixture re-ingested → second publication row |
| STO-R15 | Status enum/constraint drift vs state-machine code | Illegal transitions accepted; freeze gaps | Exhaustive from→to pair test vs the ADR-0002 lifecycle |
| STO-R16 | Context fields defaulted instead of absent | "As deployed" fabricated from non-context; ablation measurement meaningless | No-proposal fixtures yielding non-null `attached_proposal` |
| STO-R17 | Reconciliation drift persists silently | Site coverage numbers diverge from reality | Reconciliation heartbeat missing; no-data alert |
| STO-R18 | Label revisions without history | Contested-label value destroyed; old runs unreproducible | In-place UPDATE succeeding where insert-with-history was required |
| STO-R19 | Worker dies mid-job — queue entry claimed but never completed | Lane silently stops until its next cadence; L3 run missing with no alert | Job stuck in `running` past its max duration; no completion row |

## 5. Test strategy

Every risk maps to a layer per TEST-STRATEGY, plus two operational drills (restore, freeze rehearsal) — scheduled, scripted, reported like tests. Highlights:

| Risk | Mitigation | Layer |
|---|---|---|
| STO-R1 | Assert UPDATE/DELETE raise on all four append-only tables (real Postgres in CI); grants deny UPDATE to pipeline/site; hash-before/after immutability check | L1 |
| STO-R2 | Write v1 → simulate validated pack → write v2; assert monotonic version, non-null diff, superseded_by | L1 |
| STO-R3 | Archive snapshot asserted per cited URL at labelling; nightly re-probe; alert on null snapshots | L3 + pg_cron |
| STO-R4 | Vintage stored, distinct from retrieved_at, propagated to "as deployed"; no null vintages on series rows | L1 |
| STO-R5 | Bulk-load-then-query on scratch Postgres — indexes return fixture neighbours post-migration; L2 repeat pair dedups every PR | L1 + L2 |
| STO-R6 | drizzle-kit migrations in CI before merge; suite runs on the migrated schema; rollback tested | L1 (CI) |
| STO-R7 | Shared tables are the single definition; typecheck across packages; drizzle-kit diff on `labels` | L1 |
| STO-R8 | **Restore drill**: scripted restore into scratch; assert row counts, max(version), content hashes, label checksums, grants survive | Ops drill (L1-scripted), monthly + pre-release |
| STO-R9 | **Blind-rule access test** (§5.1): pipeline role denied on every labels table, against real grants, every push; re-verified against live Postgres at release | L1 |
| STO-R10 | Every legal transition logs; every illegal one rejected (incl. FROZEN→MUTATED); **freeze rehearsal** staged in October | L1 + rehearsal |
| STO-R11 | Write-path constraint: no verdict without full provenance; L2 snapshots must reproduce from pinned versions | L1 + L2 |
| STO-R12 | Pinned repeat-claim pair must still match after any pipeline change — visible golden diff flags drift | L2 |
| STO-R13 | Tier-2 fixture asserts the fallback_log row lands with lane/stage/reason; funnel view returns per-lane rates | L1 |
| STO-R14 | Same fixture re-ingested → one publication row; daily reconciliation detects injected drift | L1 + daily job |
| STO-R15 | Exhaustive transition-pair test vs the lifecycle; enum asserted equal to check constraints | L1 |
| STO-R16 | No-proposal fixtures keep context fields null; write path rejects defaulted values | L1 + L2 |
| STO-R17 | Reconciliation job detects injected drift; silence alert on missing heartbeat | L1 |
| STO-R18 | Revising a label requires a new versioned row; two runs pinning different label-set versions reproduce their outputs | L1 |
| STO-R19 | Worker claims job with lease + writes completion row; queue sweep (part of the nightly SQL job) requeues or flags jobs past max duration; no-data alert on missing completions | L1 + pg_cron |

### 5.1 Blind-rule access test (the load-bearing one)

- **Fixture**: scratch Postgres from the actual migration chain, actual role grants (never a mocked grant layer).
- **Assert**: as `pipeline` — SELECT/INSERT on every `labels` table → permission denied (schema-qualified and search_path-hidden variants both attempted); same for `site`. As `harness` — write succeeds; a concurrent pipeline session sees nothing.
- **Anti-leak**: no `labels` content appears in any pipeline-readable artefact.
- **Run**: every push (cheap), re-verified against live Postgres at every release — a grant fix applied outside the migration chain is exactly the drift this catches.

### 5.2 Restore drill

Scripted runbook (restore → grants → reconciliation queries). Assertions: row counts, `max(version)` per claim, sampled evidence hashes, label checksums, roles/grants intact. Cadence: monthly, pre-release, and immediately pre-freeze. Failed assertion = release blocker.

### 5.3 Slice acceptance

Store portion done when: L1 store tests pass on the migrated scratch schema · blind-rule test passes against real grants · golden snapshots round-trip with complete provenance · first restore drill clean · per-lane fallback log queryable.

## 6. Open questions

| # | Question | Notes |
|---|---|---|
| 1 | Labels in the same database under a separate schema (current) vs a separate instance | Same-DB is simpler, grant-enforced; separate DB is belt-and-braces. Needs Bradley's call before the schema lands (D1) |
| 2 | Backup tooling: pg_dump + offload vs continuous archiving; retention policy | Decide before the first real label batch exists |
| 3 | Verdict diff format: structured JSON field-diff vs unified text diff (or both) | ADR-0002 requires a *public* diff; affects the diff column and the site's mutation view |
| 4 | Evidence packs: store full fetched series vs references + archive snapshots | Storage growth vs rot risk |
| 5 | HNSW rebuild policy after bulk backfills | Pick once backfill volume is known |
| 6 | Retention horizon for the transition log | Rejections are public per ADR-0002 — implied permanent; confirm no pruning job ever touches it |
| 7 | `claimant_entity` seeds in the slice schema or post-slice | Slice entity pages need minimal columns; full schema now? |
| 8 | Freeze-window configuration source and change authority | Freeze dates as configuration; change-control story undecided |
| 9 | Nightly re-verification in-slice or post-slice | Recommend post-slice — the slice measures; re-verification adds cost with little measurement value |
| 10 | Entity seed review workflow (Wikipedia/Electoral Commission cross-links) — owner and timing | Human review required before entity pages render |
| 11 | Provenance block: raw cost figures vs OTel span refs | Store-lite (refs) vs store-full (figures); Grafana retention vs self-containment |
| 12 | Evidence rejections published via the raw log or a curated public view | Site-design decision the store shouldn't pre-empt |
| 13 | Worker queue-visibility gap: `cron.job_run_details` records the SQL schedule only; the queue table carries Node-side status. One combined view, or reconcile the two in the job-health metric? | Affects the ADR-0012 job-health dashboard; trivial either way — decide at dashboard build |