// Labels are append-only (STO-R17, STORE §2.5, HARNESS §2.1). A correction is a
// NEW row — a new label, a new `label_set_version`, a new `assignment_version` —
// never an edit of the row a published run was scored against.
//
// Grants cannot carry this here: the `harness` role deliberately holds ALL
// privileges on this database (it is the labeller's role; the blind rule
// constrains `pipeline`, not `harness`), so the guard has to be a trigger.
// Before migration 0001 there were zero triggers on any labels table.
//
// ADR-0019 is why this is tested now rather than later: re-deriving the HARNESS
// §2.2 strata is exactly when a previously in-scope claim becomes out of scope,
// and `UPDATE stratum_assignment SET stratum = …` is the cheap move that would
// silently rewrite the grid an L3 run rested on. Pinned in both directions —
// the edit must fail AND the versioned-write it is supposed to force must work.

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestLabelsPool } from "./migrate.ts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — copy .env.example to .env (gitignored) and fill it in`);
  }
  return value;
}

// Its own scratch database: createTestLabelsPool drops and recreates
// `<labels db>_append_only`, so the suite never writes to the shared labels DB.
const LABELS_URL = requireEnv("LABELS_DATABASE_URL");
const ADMIN_URL = requireEnv("DATABASE_URL");

let pool: Pool;

beforeAll(async () => {
  pool = await createTestLabelsPool({
    adminDatabaseUrl: ADMIN_URL,
    labelsDatabaseUrl: LABELS_URL,
    scratchSuffix: "_append_only",
  });
});

afterAll(async () => {
  await pool.end();
});

async function insertLabel(claimId: string, labelSetVersion = "set-1"): Promise<string> {
  const result = await pool.query(
    `INSERT INTO label (label_set_version, claim_id, verdict, confidence, cited_sources,
                        labeller_reasoning, evidence_availability, source_ecosystem,
                        labeller_id, label_date, schema_version)
     VALUES ($1, $2, 'supported', 'high', '[]'::jsonb, 'reasoning', 'available', 'T1',
             'labeller-1', now(), '0.1.0')
     RETURNING label_id`,
    [labelSetVersion, claimId],
  );
  return result.rows[0].label_id as string;
}

describe("labels append-only guards (STO-R17)", () => {
  it("rejects UPDATE and DELETE on every labels table", async () => {
    // Seed one row per table, because a row-level trigger only fires on a row
    // that actually exists (a no-op statement on an empty table must not count
    // as a pass).
    const claimId = "22222222-2222-2222-2222-222222222222";
    const first = await insertLabel(claimId);
    const second = await insertLabel(claimId, "set-2");
    await pool.query(
      `INSERT INTO label_set (label_set_version, schema_version) VALUES ('set-1', '0.1.0')`,
    );
    await pool.query(
      `INSERT INTO double_label (claim_id, first_label_id, second_label_id, agreement)
       VALUES ($1, $2, $3, true)`,
      [claimId, first, second],
    );
    await pool.query(
      `INSERT INTO stratum_assignment (claim_id, stratum, assignment_version)
       VALUES ($1, 'stat-grid/interview', 'assignment-1')`,
      [claimId],
    );

    await expect(
      pool.query(`UPDATE label SET labeller_reasoning = 'edited' WHERE label_id = $1`, [first]),
    ).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM label WHERE label_id = $1`, [first])).rejects.toThrow(
      /append-only/,
    );
    await expect(
      pool.query(`UPDATE label_set SET notes = 'edited' WHERE label_set_version = 'set-1'`),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query(`DELETE FROM label_set WHERE label_set_version = 'set-1'`),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query(`UPDATE double_label SET agreement = false WHERE claim_id = $1`, [claimId]),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query(`DELETE FROM double_label WHERE claim_id = $1`, [claimId]),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query(`UPDATE stratum_assignment SET stratum = 'open-web/news' WHERE claim_id = $1`, [
        claimId,
      ]),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query(`DELETE FROM stratum_assignment WHERE claim_id = $1`, [claimId]),
    ).rejects.toThrow(/append-only/);
  });

  it("names the table it refused, so the failure explains itself", async () => {
    // The guard is executable documentation (STORE §2.4): whoever hits it should
    // learn which record is append-only and what to do instead, without reading
    // this migration.
    const claimId = "33333333-3333-3333-3333-333333333333";
    await pool.query(
      `INSERT INTO stratum_assignment (claim_id, stratum, assignment_version)
       VALUES ($1, 'citation-check/hansard', 'assignment-1')`,
      [claimId],
    );
    await expect(
      pool.query(`UPDATE stratum_assignment SET stratum = 'x' WHERE claim_id = $1`, [claimId]),
    ).rejects.toThrow(/stratum_assignment is append-only/);
  });

  it("still accepts a revision written as a new row — the re-derivation path (ADR-0019)", async () => {
    // The guard must force the versioned write, not block the correction. This is
    // the shape a scope re-derivation takes: the same claim, a new assignment
    // version and a new label set, with the old rows intact and both readable.
    const claimId = "44444444-4444-4444-4444-444444444444";
    await pool.query(
      `INSERT INTO stratum_assignment (claim_id, stratum, assignment_version)
       VALUES ($1, 'open-web/news', 'assignment-1')`,
      [claimId],
    );
    await pool.query(
      `INSERT INTO stratum_assignment (claim_id, stratum, assignment_version)
       VALUES ($1, 'out-of-scope/outlet-prose', 'assignment-2')`,
      [claimId],
    );
    const v1 = await insertLabel(claimId, "set-1");
    const v2 = await insertLabel(claimId, "set-2");

    const assignments = await pool.query(
      `SELECT stratum, assignment_version FROM stratum_assignment WHERE claim_id = $1 ORDER BY assignment_version`,
      [claimId],
    );
    expect(assignments.rows).toEqual([
      { stratum: "open-web/news", assignment_version: "assignment-1" },
      { stratum: "out-of-scope/outlet-prose", assignment_version: "assignment-2" },
    ]);
    const labels = await pool.query(
      `SELECT label_id, label_set_version FROM label WHERE claim_id = $1 ORDER BY label_set_version`,
      [claimId],
    );
    expect(labels.rows).toEqual([
      { label_id: v1, label_set_version: "set-1" },
      { label_id: v2, label_set_version: "set-2" },
    ]);
  });
});
