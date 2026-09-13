// Restore drill (STORE §5.2): the trust asset is one disk event from zero, so
// restore is rehearsed as a scripted assertion — dump → replay into a scratch
// restore target → assert integrity. Failure is a release blocker. Assertions:
// row counts per table, max(verdict version) per claim, publication content
// hashes, roles and grants intact. Pure SQL transport (no pg_dump dependency)
// so it runs anywhere the store runs.

import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema/index.ts";

/** One schema table and the tables it references (FK parents). */
export interface DrillTableNode {
  name: string;
  dependsOn: string[];
}

/**
 * The store schema as a dependency graph, read from the Drizzle table objects.
 * Nothing here is hand-listed: the drill used to carry literal table arrays and
 * they silently drifted — `authority` (the one table that persists across live
 * runs) was absent from every list, so the release-blocking drill reported PASS
 * while dropping the authority registry, and no grant was replayed for it
 * (Sept 2026). Deriving from the schema makes that class of omission
 * impossible. `drillTableGraph` is exported so the parity test can re-assert
 * the derivation rather than trust it.
 */
export function drillTableGraph(): DrillTableNode[] {
  const tables = Object.values(schema).filter((value) => is(value, PgTable));
  return tables.map((table) => {
    const config = getTableConfig(table);
    return {
      name: config.name,
      dependsOn: config.foreignKeys.map((fk) => getTableConfig(fk.reference().foreignTable).name),
    };
  });
}

/**
 * Every store table in FK-safe replay order (referenced tables first). The dump
 * is replayed as plain INSERTs, so a child row must not be inserted before its
 * parent; alphabetical order is not enough — `verdict_transition_log` references
 * `verdict_version`, which references both `evidence_pack` and
 * `verdict_provenance`. Depth-first over the schema's own foreign keys keeps the
 * order correct when a table gains a parent.
 */
export function drillTables(): string[] {
  const nodes = drillTableGraph();
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const ordered: string[] = [];
  const visiting = new Set<string>();

  const visit = (node: DrillTableNode): void => {
    if (ordered.includes(node.name)) return;
    if (visiting.has(node.name)) {
      throw new Error(`restore drill: FK cycle through ${node.name} — cannot order replay`);
    }
    visiting.add(node.name);
    for (const dep of node.dependsOn) {
      const parent = byName.get(dep);
      if (parent) visit(parent);
    }
    visiting.delete(node.name);
    ordered.push(node.name);
  };

  // Visit in name order so the result is deterministic: the schema module's
  // export order is a fact about import order, not a contract.
  for (const node of [...nodes].sort((a, b) => a.name.localeCompare(b.name))) visit(node);
  return ordered;
}

// One derived list, used for the dump, the row-count assertions AND the grant
// replay: migration 0003_roles grants the pipeline/site roles on every table in
// the schema, so "all tables" is the correct set for each. Previously the grant
// list was a second literal array, which is how `authority` lost its grants
// while the drill still passed.
const DRILL_TABLES = drillTables();

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
    // The statement TEXT is built here on purpose: the artefact IS a portable
    // SQL dump, and the drill exists so restore does not depend on pg_dump.
    // Every identifier interpolated below comes from `drillTables()`, i.e. from
    // the schema — never from input — so there is no injection surface; the
    // drill deliberately does not model the rows it transports (DB-agnostic
    // literals, including columns a future migration adds).
    for (const table of DRILL_TABLES) {
      const result = await pool.query(`SELECT * FROM ${table}`);
      lines.push(`-- ${table} (${result.rows.length} rows)`);
      for (const row of result.rows) {
        const columns = Object.keys(row);
        const values = columns.map((c) => sqlLiteral(row[c]));
        lines.push(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${values.join(", ")});`);
      }
    }
    // The audit mechanism is grants (STORE §2.4); a restore that loses them
    // loses the blind-rule separation with it.
    for (const table of DRILL_TABLES) {
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
    // The target must start EMPTY: the migration chain is schema + seed rows
    // (0001_seeds), and the dump carries those same seed rows as data, so
    // replaying over a freshly migrated target duplicates every seed. The
    // authority registry came back with 6 rows against a source of 3 — invisible
    // until `authority` joined the derived table set (Sept 2026).
    //
    // TRUNCATE, not DELETE: it does not fire the row-level append-only triggers,
    // and this is a throwaway scratch database, never history. The same trap
    // exists in a production restore of a seeded chain (migrate, then restore →
    // duplicated seeds); the durable fix is a deterministic
    // conflict-tolerant seed, which is a migration change, not a drill change.
    await pool.query(`TRUNCATE ${drillTables().join(", ")}`);
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
