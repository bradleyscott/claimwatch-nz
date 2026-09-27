# Evidence & verdict store design

*ADRs: 0002, 0005, 0009 (boundary), 0010, 0014. Companions: `ARCHITECTURE.md`, `VALIDATION-SLICE.md`, `TEST-STRATEGY.md`, `CROSS-CUTTING.md`.*

## 1. Purpose and slice scope

The store is the durable asset and the single data plane: Postgres with pgvector and full-text search,
with the Drizzle schema in `packages/store`, shared by the pipeline (writes), the site (reads), and the
harness (exports), and with Graphile Worker as the job queue on the same database (§2.3). Everything
the system records about a claim — the record, the evidence, the verdict, the provenance — lives here,
append-only and versioned, because **audit-log integrity is the trust mechanism** for a system with no
editorial masthead (ADR-0001, ADR-0014).

The slice exercises the store end to end on the five lanes and four modes, plus label storage for the
harness. Its deliverables — per-group accuracy and cost per claim — are only meaningful if the store
faithfully records what the pipeline did: fallbacks, vintages, and versions.

**In slice:** `publication`/`segment` (ADR-0008 hierarchy), `claim`, `evidence_item` (versioned, vintage-dated), `evidence_pack` (append-only), `verdict_version` + `verdict_transition_log`, `fallback_log`, `verdict_provenance`, `labels` (blind-rule isolated), Graphile Worker job tables (§2.3).

**Out of slice (boundaries, not silent omissions):** `argument_chain` records (ADR-0009 post-slice; chain assembly reads this store but gains no schema here) · user submissions and verification requests · contest/mutation tooling beyond what the schema carries · reliability profiles and the public claim graph.

**Lifecycle in schema, not behaviour:** `verdict.status` + the transition log carry the full ADR-0002 lifecycle (DRAFT→PUBLISHED→CONTESTED→VALIDATING→MUTATED→AUDIT, plus FROZEN during the 5–27 Nov window). The slice exercises DRAFT→PUBLISHED only; everything else is schema-supported, unexercised — treated as a risk (STO-R9).

### 1.1 What the store is not

- **Not a claim source.** Authority content enters only as referenced evidence items (the structural
  distinction in ARCHITECTURE §1).
- **Not the harness's ground truth.** The store holds both pipeline objects and labels; the boundary is
  access, not schema (§2.8).
- **Not a raw-web-content database.** Publications keep provenance, a hash, and the raw document for
  reprocessing. The organising principle is the claim.
- **Not an argument-chain store yet** (ADR-0009).

## 2. Design

### 2.1 Schema areas (Drizzle, `packages/store`)

| Table | Key columns | Notes |
|---|---|---|
| `publication` | source_id, canonical_url, content_hash, retrieved_at/method, publisher + publication metadata, transcript (once), `transcript_tier` | Unit of document dedupe, health checks, reprocessing. Hash enforces re-ingest identity. |
| `segment` | publication_id FK, span, descriptive summary, turn structure | Only where structure exists. |
| `claim` | text, type, embedding, `discourse_window`, optional context fields (all nullable, never defaulted), publication/segment FKs, `media_anchor`, `transcript_tier`, `spoken_at` | The embedding powers repeat match. The fingerprint and `verification_mode` columns were removed by ADR-0023: a claim carries a PLAN (`verification_plan`), and its window and magnitude are parsed inside the procedure that needs them. `spoken_at` is when the claim was MADE (broadcast moment / item publication date), distinct from `created_at` (when we ingested it) — the public trail states both dates and omits the step when this one is absent rather than guessing (SITE-MVP §2.3). |
| `claimant_entity` | person/party, aliases, affiliation **at time of statement**, cross-links | Conservative attribution, never guessed. The verification loop never receives claimant identity. The candidate stored on the claim itself (`attribution_candidates`) requires only a `name`: `kind` and `confidence` are optional and are **not defaulted**, because the stage that produces it can honestly state the name the text attributes the words to, and nothing has yet resolved the entity. A required confidence forced the first wired lane to write `1` — the placeholder-confidence pattern already removed once for verdict confidence (SIT-R6). |
| `evidence_item` | claim_id, authority ref, series identity, **vintage_date**, URL, **archive_snapshot_url**, hash, version | One row per fetched version; re-fetch creates a version, never an update. |
| `evidence_pack` | claim_id, item refs, grid result, justifications, NLI outcome | Append-only; the pack that triggered a verdict is frozen and referenced by it. |
| `verdict_version` | claim_id, version (n), status, class (four + pledge/conditional), confidence, evidence_pack_id, **structured diff vs previous**, superseded_by, transition_reason | The mutation path is v(n)→v(n+1) with a stored public diff (ADR-0002). |
| `verdict_transition_log` | from_status, to_status, reason, actor, at | Every transition logged; nothing silently edited; carries public evidence rejections. |
| `fallback_log` | lane, source_id, stage, tier, reason | Feeds the per-lane Tier-2 fallback rate. |
| `verdict_provenance` | pipeline_version, prompt_versions, model_versions, search refs, cost/latency refs | Rendered as the site's provenance block. |
| `procedure` | procedure_ref, version, kind, title, consumes, produces, cannot_establish, rationale, discovered_by, status | The procedure library (ADR-0023). Fixed shape, emergent population, append-only; `retired` is a status change, never a deletion. Seeded with the five former modes. |
| `verification_plan` | pack_id FK, plan (jsonb) | The plan a verification ran: ordered steps, each naming a procedure and version, its reason, whether it ran or was declined and why, and its outcome. Its own table rather than a column on `evidence_pack`, which is append-only and would have had history backfilled into it. |
| `labels` (harness schema) | claim ref, verdict, cited sources, reasoning, evidence-availability, source-ecosystem, labeller, label-set version | Same object design as pipeline tables, versioned together; separate schema + access boundary (§2.8). |
| job state | job name, schedule, last_run, status | `cron.job_run_details` feeds silence-detection. |

Retrieval is native: HNSW on `claim.embedding`, `tsvector` FTS — hybrid dense+lexical is two indexes in one database. Hand-written SQL (hybrid retrieval, funnel views) stays typed via Drizzle's `sql` template.

The site's reads are part of this package, not `apps/site` (Sept 2026): `site-reader.ts` holds the read model (Zod-validated `VerdictPageData`/`FeedEntry`) and the only queries the reader plane runs, so "latest verdict per claim" and "the pack this verdict pins" are written once against the schema instead of as string SQL in a consumer. The site's connection is opened read-only at the session level (`default_transaction_read_only`), so "the site has no write path" survives a future query-list mistake.

**The reader serves only eligible claims by default**, on two conditions the pipeline decides and the
store records. The site cannot infer either, so it does not guess.

- **Document provenance** (`claim.publication_id` present). The `publication → segment → claim`
  hierarchy is what makes a check traceable to a document a reader can open (ADR-0008). Records without
  one are the AVeriTeC evaluation corpus and anything a slice script wrote straight into the store. On
  13 September 2026 the live store served 26 published verdicts, 25 with no publication and 19 citing
  no evidence, with one claim text appearing up to twelve times carrying contradictory classes —
  ING-R10's "fixture records treated as a production lane" reaching the public site.
- **Speakership** (`claim.speakership_class`, ADR-0019 §1) — whether the sentence was ours to check at
  all. The first live lane published a verdict about RNZ's own narration: a compound sentence the
  reporter synthesised, with no speaker, so the verdict could not say whose claim it assessed. Only
  `quoted-actor` and `author-claim` publish; `outlet-prose` and `unresolved` are recorded, never
  verified. The decision must also be **complete**: `speakership_method` and `genre` have to be
  recorded, because the page discloses how a claim was attributed and a class with no provenance
  behind it cannot be disclosed honestly. A **null class, or a null method or genre, fails closed** —
  no decision recorded means not publishable, which is the state of every row ingested before ADR-0019
  existed.

`SiteReadOptions.includeIneligible` (the site's `?corpus=all`) is the explicit escape hatch, so the corpus stays reachable for inspection without being the default and without deleting anything. One predicate gates both the page and the feed, so a record cannot be listable but unreadable.

**Raw SQL is an enumerated exception, not a style choice.** Everything that reads or writes claim,
verdict, or evidence rows goes through the Drizzle query builder. The `sql` template is used only where
the expression is genuinely SQL-shaped: jsonb path extraction, CHECK constraints, and `count(*)`
projections. Every hand-written statement, with its reason:

| Where | Statement | Why not the builder |
|---|---|---|
| `store.ts` `tryUpdate`/`tryDelete` | `UPDATE`/`DELETE` on an append-only table | The test's subject is the DATABASE guard; the builder would test Drizzle. Sent to the raw pool, not `db.execute`, because Drizzle wraps driver failures and would hide the guard's own `… is append-only` message. |
| `store.ts` `hasPrivilege` | `has_table_privilege(...)` | Catalog introspection, not a table query. Arguments are bound. |
| `store.ts` `createTestStore` | `DROP`/`CREATE DATABASE` | Admin DDL on a scratch database, outside a query builder's remit. |
| `restore-drill.ts` | dump/replay/`COUNT(*)`/hash reads | The artefact IS a portable SQL dump; the drill deliberately does not model the rows it transports. Identifiers come from the schema (`drillTables()`), never from input. |
| `packages/harness/src/migrate.ts` `enforceGrants` | `CREATE ROLE`, `GRANT`, `REVOKE` | Privilege management, not schema or data; must be re-asserted on every apply and cover tables added by later migrations. |
| `ops/slice-acceptance.ts` | `has_table_privilege` on the LABELS database | The grant boundary the blind rule rests on (HARNESS §2.4), on a database the store API does not model. |

Every other parallel encoding of a schema fact (the drill's table lists, the store's id-column map) has been deleted and derived from the schema instead; `APPEND_ONLY_TABLES` is the one that cannot be derived (append-only-ness lives in a trigger, not a column type) and is asserted against the database's guard triggers by `store.test.ts`.

### 2.2 Indexes and reconciliation

| Index | Type | Serves |
|---|---|---|
| `claim.embedding` | HNSW | repeat detection, adjacency, store retrieval |
| claim/publication text | FTS | keyword retrieval, claim-locating search |
| `publication.content_hash` | unique | idempotent writes on lane retries |
| `verdict_version (claim_id, version)` | unique | monotonic versioning per claim |
| funnel views | SQL views | ADR-0012 dashboards; daily reconciliation vs event counts |

The store is the reconcilable historical truth for the funnel; a daily job compares SQL-view counts to event telemetry and alerts on drift — dashboards disagreeing with the store indicate instrumentation bugs, which is itself monitored.

### 2.3 Job scheduling: Graphile Worker

**Graphile Worker is the scheduler and the executor bridge** — a Postgres-backed Node job queue: jobs are rows, workers are long-lived Node processes using `LISTEN/NOTIFY` (jobs start in milliseconds) with `SKIP LOCKED` claiming. It schedules *and* runs; no SQL-only middle layer.

| Job | Schedule |
|---|---|
| Lane ingestion cadence | crontab, per lane |
| Daily funnel reconciliation | crontab, daily |
| L3 scoring-run triggers | crontab, weekly + pre-release |
| Ad-hoc jobs (reprocess this document, backfill) | `add_job` at runtime |

This is not the "extra service" ADR-0014 rejected. That rejection was about *Redis* — a second stateful
service to run. Graphile Worker keeps everything in the existing Postgres: no new infrastructure, one
more npm dependency. It also replaces what we would otherwise hand-roll: a built-in crontab with
**backfill** (a job missed while the worker was down is created on restart), exponential-backoff
retries, serial execution through named queues, and distributed-crontab safety (identical crontabs on
several workers are ACID-safe, and a `known_crontabs` lock table makes double-scheduling impossible).

Properties: schedule state survives restarts (rows, not processes); a dead worker leaves the job visibly unfinished and backfillable; adding a job kind is code, not a deploy; `SKIP LOCKED` + job-key uniqueness make double-verification structurally impossible (CRO-R11). Job health (status, duration, retries, `run_at` history) lives in `graphile_worker.jobs` — feeding ADR-0012 job-health metrics and silence-detection.

### 2.4 Append-only enforcement (database, not convention)

- **Roles and grants.** `pipeline` gets INSERT and SELECT only; `site` gets SELECT on published views;
  `harness` gets the labels schema. UPDATE and DELETE are never granted, and a `BEFORE UPDATE OR
  DELETE` trigger on the append-only tables raises as defence in depth.
- **A correction is a new row.** A revised series, a re-fetched document, or a mutated verdict adds a row
  with a `supersedes` pointer. Rejected evidence is logged, never deleted.
- **Evolution.** drizzle-kit migrations are reviewed as SQL, applied in order, and run in CI against a
  scratch Postgres before merge. No ad-hoc DDL against the live store, ever.
- **Backups as the outer envelope.** Nightly dumps, off-box, restore-tested (§5.2).

### 2.5 Versioning and diff

- Every published verdict is a `verdict_version` row; versions monotonic per claim. The slice writes v1 only, but the schema carries v(n)→v(n+1): a validated evidence pack (post-slice) triggers a new version with a **structured field-level diff** — the "public diff" ADR-0002 requires is generated from this column, not recomputed.
- Evidence items versioned per fetch; a verdict pins the pack ID and therefore the exact item versions it rested on. A revised series fetched later creates a new version — the pinned vintage shows exactly what the verdict used; users contest with the newer figures.
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
| Verification engine | claim + context pack + procedure library, accumulated evidence | claims, evidence, packs, verdict v1, transition log, fallback log, provenance | Never receives claimant identity. Append-only writes; confidence on every verdict; below-threshold → open questions. |
| Site | published verdicts, packs, context stack, provenance, entity records, funnel views | nothing | Read-only role, and the read path is the store's own typed read model (`packages/store/src/site-reader.ts`) — the site holds no SQL and its connection is a read-only session. Serves **eligible** records only: document provenance present (ADR-0008) and a positively in-scope speakership class (ADR-0019); everything else is reachable only through an explicit reader option (the site's `?corpus=all`). ClaimReview from store fields; methodology table from harness files, never hand-edited. |
| Harness | verdicts + evidence paths (read-only) | labels, label-set versions, scoring-run outputs | Blind rule: writes labels; pipeline cannot read them. |
| Graphile Worker | claims, evidence, verdicts (via task handlers) | jobs, job runs, retries | Postgres-backed scheduler + executor (§2.3). Node work runs in worker containers; no separate queue service. |
| Grafana | funnel views, reconciliation counts, job health | nothing | Store is the reconcilable truth; drift alerts. |

**Freeze enforcement (schema contract):** the store rejects a transition into MUTATED (and any new verdict version on a PUBLISHED claim) while the freeze window is active — dates are configuration in the state machine, not a manual process. Contested verdicts during freeze render "contested — under review".

## 4. Tests

Every risk maps to a layer in `TEST-STRATEGY.md`: **L1** every push, **L2** every PR, **L3** weekly and pre-release, **L4a** every push, **L4b** pre-release.

Highlights:

| ID | Risk | Consequence if untested | Test | Signal | Layer |
|---|---|---|---|---|---|
| STO-R1 | Append-only violated by UPDATE/DELETE paths | Audit-log integrity silently broken; a "fixed" verdict indistinguishable from an honest one | Assert UPDATE/DELETE raise on all four append-only tables (real Postgres in CI); grants deny UPDATE to pipeline/site; hash-before/after immutability check | UPDATE/DELETE succeeding on append-only tables; row counts/hashes changing without a new version | L1 |
| STO-R2 | Versioning/diff missing — mutation path unimplementable | ADR-0002's core mechanism unbuildable; s 199A clarity lost | Write v1 → simulate validated pack → write v2; assert monotonic version, non-null diff, superseded_by | Mutation rehearsal can't write v2; diff column null | L1 |
| STO-R3 | Vintage-date gaps, or vintage conflated with retrieval time | "As deployed" unverifiable; revisions undetectable | Vintage stored, distinct from retrieved_at, propagated to "as deployed"; no null vintages on series rows | Null vintage on series rows; vintage == retrieved_at everywhere | L1 |
| STO-R4 | pgvector/FTS index drift after bulk load or migration | Repeat claims re-verified at full cost; duplicates published | Bulk-load-then-query on scratch Postgres — indexes return fixture neighbours post-migration; L2 repeat pair dedups every PR | Repeat-occurrence ratio ~0; dedup counter divergence | L1 + L2 |
| STO-R5 | Migration failure corrupts live schema | Append-only store broken mid-campaign | drizzle-kit migrations in CI before merge; suite runs on the migrated schema; rollback tested | CI scratch-Postgres migration failing | L1 (CI) |
| STO-R6 | Schema drift between harness labels and pipeline objects | Harness measures a different shape than production writes | Shared tables are the single definition; typecheck across packages; drizzle-kit diff on `labels` | Cross-package typecheck; drizzle-kit diff | L1 |
| STO-R7 | Backups untested — unrestorable | The trust asset is one disk event from zero | **Restore drill**: scripted restore into scratch; assert row counts, max(version), content hashes, label checksums, grants survive | Restore drill result; post-restore reconciliation | Ops drill (L1-scripted), monthly + pre-release |
| STO-R8 | Blind-rule boundary failing (grant misconfig, escalation) | Accuracy numbers tunable against labels — harness credibility voids | **Blind-rule access test** (§5.1): pipeline role denied on every labels table, against real grants, every push; re-verified against live Postgres at release | Pipeline-role query on `labels` returning rows instead of denial | L1 |
| STO-R9 | Lifecycle transitions unexercised — freeze enforcement never runs | Discovered by the 5 Nov deadline, not by tests | Every legal transition logs; every illegal one rejected (incl. FROZEN→MUTATED); **freeze rehearsal** staged in October | Transition-constraint suite; October freeze rehearsal | L1 + rehearsal |
| STO-R10 | Provenance incompleteness | Golden snapshots can't pin what produced a verdict; site block renders empty | Write-path constraint: no verdict without full provenance; L2 snapshots must reproduce from pinned versions | Null pipeline/prompt versions on any verdict | L1 + L2 |
| STO-R11 | Fingerprint instability across pipeline versions | Repeat claims double-verified with contradictory verdicts; compounding stops | Pinned repeat-claim pair must still match after any pipeline change — visible golden diff flags drift | Same pinned claim yielding two rows after a version bump (L2) | L2 |
| STO-R12 | Fallback log incomplete / not per-lane queryable | R7 unmeasured; markup drift invisible | Tier-2 fixture asserts the fallback_log row lands with lane/stage/reason; funnel view returns per-lane rates | Counter fires but lands nowhere; rate zero across all lanes | L1 |
| STO-R13 | Store writes not idempotent on re-ingest | Duplicate publications → duplicate verdicts; permanent reconciliation alerts | Same fixture re-ingested → one publication row; daily reconciliation detects injected drift | Same fixture re-ingested → second publication row | L1 + daily job |
| STO-R14 | Status enum/constraint drift vs state-machine code | Illegal transitions accepted; freeze gaps | Exhaustive transition-pair test vs the lifecycle; enum asserted equal to check constraints | Exhaustive from→to pair test vs the ADR-0002 lifecycle | L1 |
| STO-R15 | Context fields defaulted instead of absent | "As deployed" fabricated from non-context; ablation measurement meaningless | No-proposal fixtures keep context fields null; write path rejects defaulted values | No-proposal fixtures yielding non-null `attached_proposal` | L1 + L2 |
| STO-R16 | Reconciliation drift persists silently | Site coverage numbers diverge from reality | Reconciliation job detects injected drift; silence alert on missing heartbeat | Reconciliation heartbeat missing; no-data alert | L1 |
| STO-R17 | Label revisions without history | Contested-label value destroyed; old runs unreproducible | Revising a label requires a new versioned row; two runs pinning different label-set versions reproduce their outputs | In-place UPDATE succeeding where insert-with-history was required | L1 |
| STO-R18 | Worker dies mid-job — job claimed but never completed | Lane silently stops until its next cadence; L3 run missing with no alert | Graphile Worker's own retry/backoff + job-key uniqueness; job stuck `running` past max duration → no-data alert on missing completion; backfill recovers missed crontab fires | Job stuck `running` past max duration; no completion row; crontab fire missed and unbackfilled | L1 + Graphile Worker |

### 5.1 Blind-rule access test (the load-bearing one)

- **Fixture**: scratch Postgres from the actual migration chain, actual role grants (never a mocked grant layer).
- **Assert**: as `pipeline` — SELECT/INSERT on every `labels` table → permission denied (schema-qualified and search_path-hidden variants both attempted); same for `site`. As `harness` — write succeeds; a concurrent pipeline session sees nothing.
- **Anti-leak**: no `labels` content appears in any pipeline-readable artefact.
- **Run**: every push (cheap), re-verified against live Postgres at every release — a grant fix applied outside the migration chain is exactly the drift this catches.

### 5.2 Restore drill

Scripted runbook (restore → grants → reconciliation queries). Assertions: row counts, `max(version)` per claim, sampled evidence hashes, label checksums, roles/grants intact. Cadence: monthly, pre-release, and immediately pre-freeze. Failed assertion = release blocker.

### 5.3 Slice acceptance

Store portion done when: L1 store tests pass on the migrated scratch schema · blind-rule test passes against real grants · golden snapshots round-trip with complete provenance · first restore drill clean · per-lane fallback log queryable.

## 5. Open questions

| # | Question | Notes |
|---|---|---|
| 1 | Labels in the same database under a separate schema (current) vs a separate instance | Same-DB is simpler, grant-enforced; separate DB is belt-and-braces. Needs a call before the schema lands (D1) |
| 2 | Backup tooling: pg_dump + offload vs continuous archiving; retention policy | Decide before the first real label batch exists |
| 3 | Verdict diff format: structured JSON field-diff vs unified text diff (or both) | ADR-0002 requires a *public* diff; affects the diff column and the site's mutation view |
| 4 | Evidence packs: store full fetched series vs references + archive snapshots | Storage growth vs rot risk |
| 5 | HNSW rebuild policy after bulk backfills | Pick once backfill volume is known |
| 6 | Retention horizon for the transition log | Rejections are public per ADR-0002 — implied permanent; confirm no pruning job ever touches it |
| 7 | `claimant_entity` seeds in the slice schema or post-slice | Slice entity pages need minimal columns; full schema now? |
| 8 | Entity seed review workflow (Wikipedia/Electoral Commission cross-links) — owner and timing | Human review required before entity pages render |
| 9 | Provenance block: raw cost figures vs OTel span refs | Store-lite (refs) vs store-full (figures); Grafana retention vs self-containment |
| 10 | Evidence rejections published via the raw log or a curated public view | Site-design decision the store shouldn't pre-empt |
| 11 | Which lifecycle states beyond DRAFT/PUBLISHED/CONTESTED/FROZEN a reader may reach | `site-reader.ts` serves those four, per SITE-MVP §2.3 and §3 above. `VALIDATING`, `MUTATED` and `AUDIT` have no public rendering decision: a verdict in VALIDATING is arguably still contested-and-under-review from the reader's view, but the page's state vocabulary does not name it. Unexercised (STO-R9), so the decision is cheap now and a migration later |