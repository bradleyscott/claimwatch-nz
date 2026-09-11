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
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claim.claimId),
    authorityRef: text("authority_ref").notNull(),
    seriesIdentity: text("series_identity").notNull(),
    vintageDate: timestamp("vintage_date", { withTimezone: true }).notNull(),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    url: text("url").notNull(),
    archiveSnapshotUrl: text("archive_snapshot_url").notNull(),
    contentHash: text("content_hash").notNull(),
    version: integer("version").notNull().default(1),
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
