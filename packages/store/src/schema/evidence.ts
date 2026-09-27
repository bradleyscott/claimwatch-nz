// Evidence + verdicts (ADR-0005): append-only by grant and by trigger (STO-R1),
// vintage-dated series (STO-R3), monotonic verdict versions with structured
// diff (STO-R2), full provenance required on every verdict (STO-R10).

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { claim } from "./documents.ts";

export const evidenceItem = pgTable(
  "evidence_item",
  {
    itemId: uuid("item_id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id").references(() => claim.claimId),
    authorityRef: text("authority_ref").notNull(),
    seriesIdentity: text("series_identity").notNull(),
    vintageDate: timestamp("vintage_date", { withTimezone: true }).notNull(),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    url: text("url").notNull(),
    archiveSnapshotUrl: text("archive_snapshot_url").notNull(),
    contentHash: text("content_hash").notNull(),
    version: integer("version").notNull().default(1),
    // Open-web evidence: what this source says relevant to the claim + its
    // source class (1-6, from the open-web classifier; null when the row
    // carries none — an adjudicated finding returned without a code, or a
    // stat-grid series row where the series IS the finding). Nothing orders by
    // it at rest: the site sorts for display, strongest source first
    // (apps/site/src/lib/evidence-source-labels.ts).
    plainFinding: text("plain_finding"),
    tier: integer("tier"),
  },
  (t) => [
    uniqueIndex("evidence_item_series_vintage_uq").on(t.seriesIdentity, t.vintageDate, t.version),
    index("evidence_item_claim_idx").on(t.claimId),
  ],
);

export const evidencePack = pgTable(
  "evidence_pack",
  {
    packId: uuid("pack_id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claim.claimId),
    itemRefs: jsonb("item_refs").notNull(),
    gridResult: jsonb("grid_result"),
    justifications: jsonb("justifications").notNull().default([]),
    nliOutcome: text("nli_outcome").notNull(), // pass | fail
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("evidence_pack_claim_idx").on(t.claimId)],
);

export const verdictProvenance = pgTable(
  "verdict_provenance",
  {
    provenanceId: uuid("provenance_id").primaryKey().defaultRandom(),
    pipelineVersion: text("pipeline_version").notNull(),
    promptVersions: jsonb("prompt_versions").notNull(),
    modelVersions: jsonb("model_versions").notNull(),
    searchRefs: jsonb("search_refs").notNull().default([]),
    costLatencyRefs: jsonb("cost_latency_refs"),
  },
  (t) => [index("verdict_provenance_pipeline_idx").on(t.pipelineVersion)],
);

export const verdictVersion = pgTable(
  "verdict_version",
  {
    verdictId: uuid("verdict_id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claim.claimId),
    version: integer("version").notNull(),
    status: text("status").notNull().default("DRAFT"),
    verdictClass: text("verdict_class").notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    evidencePackId: uuid("evidence_pack_id")
      .notNull()
      .references(() => evidencePack.packId),
    provenanceId: uuid("provenance_id")
      .notNull()
      .references(() => verdictProvenance.provenanceId),
    diff: jsonb("diff"),
    supersededBy: uuid("superseded_by"),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("verdict_version_claim_version_uq").on(t.claimId, t.version),
    check(
      "verdict_class_valid",
      sql`${t.verdictClass} IN ('supported','refuted','not_enough_evidence','conflicting_cherry_picking','pledge','conditional')`,
    ),
    check(
      "verdict_status_valid",
      sql`${t.status} IN ('DRAFT','PUBLISHED','CONTESTED','VALIDATING','MUTATED','FROZEN')`,
    ),
  ],
);

export const verdictTransitionLog = pgTable(
  "verdict_transition_log",
  {
    transitionId: uuid("transition_id").primaryKey().defaultRandom(),
    verdictId: uuid("verdict_id")
      .notNull()
      .references(() => verdictVersion.verdictId),
    fromStatus: text("from_status").notNull(),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    actor: text("actor").notNull().default("pipeline"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verdict_transition_verdict_idx").on(t.verdictId)],
);

export const fallbackLog = pgTable(
  "fallback_log",
  {
    eventId: uuid("event_id").primaryKey().defaultRandom(),
    lane: text("lane").notNull(),
    sourceId: text("source_id").notNull(),
    stage: text("stage").notNull(),
    tier: integer("tier").notNull(),
    reason: text("reason").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fallback_log_lane_idx").on(t.lane),
    index("fallback_log_source_stage_idx").on(t.sourceId, t.stage),
  ],
);

// Procedure library (ADR-0023): the auditable instruments a verification plan
// may invoke. Seeded with the five former modes; grows from past plans.
//
// Modelled deliberately on `authority` below — fixed schema, emergent rows,
// append-only, retired by STATUS CHANGE rather than deletion — because the same
// argument applies to both: a precomputed set bets on a prediction that cannot be
// checked in advance (ADR-0005), and an unauditable instrument is worse than a
// wrong one because it cannot be found, versioned or compared.
//
// The FIXED part is the shape. `consumes`/`produces` are declared so two
// procedures can be compared and a reader can see what one needed;
// `cannot_establish` is the published bound. The EMERGENT part is which rows
// exist. A procedure may compute anything it likes but may NOT define its own
// thresholds: tolerances and admissibility tiers are published criteria that live
// in code (ADR-0004, ADR-0020) and are referenced, not owned.
export const procedure = pgTable(
  "procedure",
  {
    procedureId: uuid("procedure_id").primaryKey().defaultRandom(),
    procedureRef: text("procedure_ref").notNull(),
    version: text("version").notNull(),
    // `deterministic` computes from evidence we hold; `research` retrieves.
    // The distinction matters at plan time: a research step can be repeated and
    // refined, a deterministic one either has its inputs or abstains.
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    consumes: jsonb("consumes").notNull(),
    produces: jsonb("produces").notNull(),
    cannotEstablish: text("cannot_establish").notNull(),
    rationale: text("rationale").notNull(),
    discoveredBy: text("discovered_by").notNull(),
    searchRefs: jsonb("search_refs").notNull().default([]),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("procedure_ref_version_uq").on(t.procedureRef, t.version),
    index("procedure_status_idx").on(t.status),
    check("procedure_kind_valid", sql`${t.kind} IN ('deterministic','research')`),
    check("procedure_status_valid", sql`${t.status} IN ('active','retired')`),
  ],
);

// The PLAN a verification ran (ADR-0023): an ordered list of steps, each naming
// the procedure and version it invoked, why it was chosen, whether a required
// procedure was declined and why, and — once it ran — its outcome.
//
// This replaces `claim.verification_mode`, which could hold exactly one of five
// values and so could not record that a claim was checked two ways.
//
// It is its OWN table rather than a column on `evidence_pack` deliberately:
// `evidence_pack` is append-only (STO-R1/CRO-R12) and a migration that backfills
// a new column into historical rows mutates them. A separate row inserts cleanly
// and gives the plan its own identity, which it needs anyway — the plan is the
// published record of what was established and what was not attempted.
// `libraryVersion` records which procedure library suggested it, so a run can be
// reproduced against the same library state (ADR-0023 §6).
export const verificationPlan = pgTable(
  "verification_plan",
  {
    planId: uuid("plan_id").primaryKey().defaultRandom(),
    packId: uuid("pack_id")
      .notNull()
      .references(() => evidencePack.packId),
    // The whole plan as one validated document, rather than columns per field.
    // Reassembling a plan from columns is how `Fingerprint` and
    // `FingerprintTuple` came to disagree — one shape, one column, one parse
    // (`VerificationPlan` in `../procedure.ts`, applied at both the write and
    // the read boundary).
    plan: jsonb("plan").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_plan_pack_idx").on(t.packId)],
);

// Authority registry (user direction, Sept 2026): discovered authorities with
// recorded provenance; append-only like evidence vintages.
export const authority = pgTable("authority", {
  authorityId: uuid("authority_id").primaryKey().defaultRandom(),
  domain: text("domain").notNull(),
  authorityRef: text("authority_ref").notNull(),
  sourceUrl: text("source_url").notNull(),
  tier: integer("tier").notNull(),
  rationale: text("rationale").notNull(),
  confidence: numeric("confidence").notNull(),
  discoveredBy: text("discovered_by").notNull(),
  searchRefs: jsonb("search_refs").notNull().default([]),
  status: text("status").notNull().default("active"),
  discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
});
