// Labels schema on the SEPARATE claimwatch_labels database (HARNESS §2.4).
// Postgres has no cross-database queries — the pipeline's connection string
// names only `claimwatch`, so even a compromised pipeline config cannot reach
// these tables. One-way data flow: claim objects flow pipeline → harness
// (typed against @cw/store); nothing flows back except published exports.

import type { Pool } from "pg";

export const LABELS_SCHEMA_VERSION = "0.1.0";

// Scratch semantics, same as the pipeline store: every application is from
// zero, so label counts are deterministic per test run and per scoring batch.
export async function applyLabelsMigrations(pool: Pool): Promise<void> {
  await pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);

  await pool.query(`
    CREATE TABLE label (
      label_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      label_set_version text NOT NULL DEFAULT 'unassigned',
      claim_id uuid NOT NULL,
      verdict text NOT NULL CHECK (verdict IN ('supported','refuted','not_enough_evidence','conflicting_cherry_picking')),
      confidence text NOT NULL CHECK (confidence IN ('high','medium','low')),
      cited_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
      labeller_reasoning text NOT NULL,
      evidence_availability text NOT NULL,
      source_ecosystem text NOT NULL,
      labeller_id text NOT NULL,
      label_date timestamptz NOT NULL,
      schema_version text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);

  await pool.query(`
    CREATE TABLE label_set (
      label_set_version text PRIMARY KEY,
      notes text,
      schema_version text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);

  await pool.query(`
    CREATE TABLE double_label (
      double_label_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      claim_id uuid NOT NULL,
      first_label_id uuid NOT NULL REFERENCES label(label_id),
      second_label_id uuid NOT NULL REFERENCES label(label_id),
      agreement boolean NOT NULL,
      CHECK (first_label_id <> second_label_id)
    )`);

  await pool.query(`
    CREATE TABLE stratum_assignment (
      claim_id uuid NOT NULL,
      stratum text NOT NULL,
      assignment_version text NOT NULL,
      assigned_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (claim_id, assignment_version)
    )`);

  await enforceGrants(pool);
}
// The blind rule, as GRANTs (HARNESS §2.4): harness may write labels; the
// pipeline role holds zero table privileges on this database.
async function enforceGrants(pool: Pool): Promise<void> {
  for (const role of ["pipeline", "harness"]) {
    await pool.query(
      `DO $$ BEGIN CREATE ROLE ${role}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    );
  }
  await pool.query(`REVOKE ALL ON SCHEMA public FROM PUBLIC`);
  await pool.query(`REVOKE ALL ON SCHEMA public FROM pipeline`);
  // Pipeline resolves table NAMES (USAGE) but holds zero table privileges, so
  // every read fails with permission denied — the denial mode the blind-rule
  // test asserts. Hiding names entirely (no USAGE) leaks structure through
  // "relation does not exist" side channels instead.
  await pool.query(`GRANT USAGE ON SCHEMA public TO pipeline`);
  await pool.query(`GRANT USAGE ON SCHEMA public TO harness`);
  await pool.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO harness`);
  await pool.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO harness`);
}
