// Restore drill (STORE §5.2): the trust asset is one disk event from zero, so
// restore is rehearsed as a scripted assertion — dump → replay into a scratch
// restore target → assert integrity. Failure is a release blocker. Assertions:
// row counts per table, max(verdict version) per claim, publication content
// hashes, roles and grants intact. Pure SQL transport (no pg_dump dependency)
// so it runs anywhere the store runs.

import { Pool } from "pg";

// FK-safe order: verdict_provenance BEFORE verdict_version (its FK parent).
const DRILL_TABLES = [
  "publication",
  "segment",
  "claim",
  "claimant_entity",
  "evidence_item",
  "evidence_pack",
  "verdict_provenance",
  "verdict_version",
  "verdict_transition_log",
  "fallback_log",
] as const;

// Grants replayed with the data — the audit mechanism is grants (STORE §2.4);
// a restore that loses them loses the blind-rule enforcement with it.
const GRANTED_TABLES = [
  "publication",
  "segment",
  "claim",
  "claimant_entity",
  "evidence_item",
  "evidence_pack",
  "verdict_version",
  "verdict_transition_log",
  "fallback_log",
  "verdict_provenance",
] as const;

export interface DrillAssertion {
  name: string;
  passed: boolean;
  detail?: string;
}

export async function exportDrillDump(databaseUrl: string): Promise<string> {
  const pool = new Pool({ connectionString: databaseUrl });
  const lines: string[] = [];
  try {
    await pool.query("BEGIN READ ONLY");
    for (const table of DRILL_TABLES) {
      const result = await pool.query(`SELECT * FROM ${table}`);
      lines.push(`-- ${table} (${result.rows.length} rows)`);
      for (const row of result.rows) {
        const columns = Object.keys(row);
        const values = columns.map((c) => sqlLiteral(row[c]));
        lines.push(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${values.join(", ")});`);
      }
    }
    for (const table of GRANTED_TABLES) {
      lines.push(`GRANT INSERT, SELECT ON ${table} TO pipeline;`);
      lines.push(`GRANT SELECT ON ${table} TO site;`);
    }
    await pool.query("COMMIT");
  } finally {
    await pool.end();
  }
  return lines.join("\n");
}

function sqlLiteral(value: unknown): string {
  if (value === null) return "NULL";
  if (typeof value === "object" && !(value instanceof Date)) {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replace(/'/g, "''")}'`;
}

// The caller applies the schema to the target via the migration chain
// (createTestStore with a scratch suffix) BEFORE replaying; the dump is data +
// grants only. Replay succeeds through the append-only triggers because they
// block UPDATE/DELETE, never INSERT.
export async function replayDrillDump(targetDatabaseUrl: string, dumpSql: string): Promise<void> {
  const pool = new Pool({ connectionString: targetDatabaseUrl });
  try {
    await pool.query(dumpSql);
  } finally {
    await pool.end();
  }
}

export async function assertRestoreIntegrity(
  sourceDatabaseUrl: string,
  restoredDatabaseUrl: string,
): Promise<DrillAssertion[]> {
  const source = new Pool({ connectionString: sourceDatabaseUrl });
  const restored = new Pool({ connectionString: restoredDatabaseUrl });
  const assertions: DrillAssertion[] = [];
  try {
    // 1. Row counts per table (STORE §5.2).
    for (const table of DRILL_TABLES) {
      const s = await source.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
      const r = await restored.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
      const equal = s.rows[0].n === r.rows[0].n;
      assertions.push({
        name: `row counts: ${table}`,
        passed: equal,
        ...(equal ? {} : { detail: `source ${s.rows[0].n} ≠ restored ${r.rows[0].n}` }),
      });
    }

    // 2. max(verdict version) per claim — monotonic versions survive (STO-R2).
    const sMax = await source.query(
      "SELECT claim_id, MAX(version) AS v FROM verdict_version GROUP BY claim_id ORDER BY claim_id",
    );
    const rMax = await restored.query(
      "SELECT claim_id, MAX(version) AS v FROM verdict_version GROUP BY claim_id ORDER BY claim_id",
    );
    assertions.push({
      name: "max(verdict version) per claim",
      passed: JSON.stringify(sMax.rows) === JSON.stringify(rMax.rows),
      detail: "monotonic versions must survive restore (STO-R2)",
    });

    // 3. Publication content hashes row-for-row (STO-R7: silently corrupted
    // content is detected by the drill, never discovered later).
    const sHashes = await source.query(
      "SELECT content_hash FROM publication ORDER BY content_hash",
    );
    const rHashes = await restored.query(
      "SELECT content_hash FROM publication ORDER BY content_hash",
    );
    assertions.push({
      name: "publication content hashes",
      passed: JSON.stringify(sHashes.rows) === JSON.stringify(rHashes.rows),
      detail: "row-for-row hash equality (STO-R7)",
    });

    // 4. Roles and grants survive (STORE §2.4 — the audit mechanism is grants;
    // if grants don't survive, the blind-rule enforcement doesn't either).
    for (const role of ["pipeline", "site", "harness"]) {
      const r = await restored.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
      assertions.push({
        name: `role survives: ${role}`,
        passed: (r.rowCount ?? 0) === 1,
        ...((r.rowCount ?? 0) === 1 ? {} : { detail: "role missing after restore" }),
      });
    }
    const grant = await restored.query(
      "SELECT has_table_privilege('pipeline', 'publication', 'INSERT') AS ok",
    );
    assertions.push({
      name: "grants survive: pipeline INSERT on publication",
      passed: grant.rows[0].ok === true,
      ...(grant.rows[0].ok === true ? {} : { detail: "grant missing after restore" }),
    });
  } finally {
    await source.end();
    await restored.end();
  }
  return assertions;
}

// The drill's failure reporting lists EVERY failed assertion rather than
// stopping at the first — an operator needs the full picture.
export function drillFailures(assertions: DrillAssertion[]): DrillAssertion[] {
  return assertions.filter((a) => !a.passed);
}

export function runRestoreDrillCheck(assertions: DrillAssertion[]): void {
  const failures = drillFailures(assertions);
  if (failures.length > 0) {
    const details = failures.map((f) => `${f.name}: ${f.detail ?? "failed"}`).join("; ");
    throw new Error(`restore drill FAILED — release blocker (STORE §5.2): ${details}`);
  }
}
