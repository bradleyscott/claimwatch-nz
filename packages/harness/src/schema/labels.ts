// Harness label store, as Drizzle tables (HARNESS §2.1/§2.4, STORE §2.7).
//
// These live on the SEPARATE `claimwatch_labels` database. Postgres has no
// cross-database queries, so `claim_id` is a logical reference to the pipeline's
// claim object, never a foreign key: the claim record stays the pipeline's
// (HARNESS §2.1 — "the label schema does not redefine claim or verdict types").
//
// They were previously hand-written DDL strings inside `applyLabelsMigrations`.
// That left STO-R6/HAR-R5's mitigations ("cross-package typecheck; drizzle-kit
// diff") with nothing to check: there was no Drizzle definition to diff against
// the pipeline's objects, and `packages/harness` declared drizzle-orm without
// importing it. The tables are now generated against `claimwatch_labels` by
// `packages/harness/drizzle.config.ts` (Sept 2026).

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ADR-0004's four verdict classes — the ONLY vocabulary a label may carry, and
// the same four the pipeline publishes (`PipelineVerdictClass` in export-api.ts).
// Deliberately distinct from the pipeline's `verdictClass`, which also carries
// pledge/conditional: no AVeriTeC-scored label may use those.
export const label = pgTable(
  "label",
  {
    labelId: uuid("label_id").primaryKey().defaultRandom(),
    // Label sets version together with the objects they describe; a label whose
    // set is not yet assigned says so rather than being silently current.
    labelSetVersion: text("label_set_version").notNull().default("unassigned"),
    claimId: uuid("claim_id").notNull(),
    verdict: text("verdict").notNull(),
    confidence: text("confidence").notNull(),
    citedSources: jsonb("cited_sources").notNull().default([]),
    labellerReasoning: text("labeller_reasoning").notNull(),
    // The temporal-leakage control (EVALUATION §7).
    evidenceAvailability: text("evidence_availability").notNull(),
    // Which NZ sources the label rests on (T1–T6) — accuracy slices by
    // source-access difficulty.
    sourceEcosystem: text("source_ecosystem").notNull(),
    labellerId: text("labeller_id").notNull(),
    labelDate: timestamp("label_date", { withTimezone: true }).notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "label_verdict_valid",
      sql`${t.verdict} IN ('supported','refuted','not_enough_evidence','conflicting_cherry_picking')`,
    ),
    check("label_confidence_valid", sql`${t.confidence} IN ('high','medium','low')`),
  ],
);

export const labelSet = pgTable("label_set", {
  labelSetVersion: text("label_set_version").primaryKey(),
  notes: text("notes"),
  schemaVersion: text("schema_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const doubleLabel = pgTable(
  "double_label",
  {
    doubleLabelId: uuid("double_label_id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id").notNull(),
    firstLabelId: uuid("first_label_id")
      .notNull()
      .references(() => label.labelId),
    secondLabelId: uuid("second_label_id")
      .notNull()
      .references(() => label.labelId),
    agreement: boolean("agreement").notNull(),
  },
  (t) => [check("double_label_distinct", sql`${t.firstLabelId} <> ${t.secondLabelId}`)],
);

export const stratumAssignment = pgTable(
  "stratum_assignment",
  {
    claimId: uuid("claim_id").notNull(),
    stratum: text("stratum").notNull(),
    assignmentVersion: text("assignment_version").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.claimId, t.assignmentVersion] })],
);
