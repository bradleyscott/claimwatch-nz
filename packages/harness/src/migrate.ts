// Labels-DB migration runner (harness side). Creates the labels database if
// absent, applies the labels chain from packages/harness/drizzle/ via Drizzle's
// NATIVE migrator, and enforces the blind-rule grants. Deliberately lives in
// packages/harness: the pipeline store's runner must never reach into harness
// code (one-way data flow, HARNESS §2.4).
//
// The chain is generated against `claimwatch_labels` by
// `packages/harness/drizzle.config.ts` from the Drizzle tables in
// `./schema/labels.ts`, so STO-R6/HAR-R5's mitigations ("cross-package
// typecheck; drizzle-kit diff") have a definition to check — the schema used to
// be DDL strings with nothing to diff (Sept 2026).

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as migrateDb } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export interface LabelsMigrateOptions {
  /** Superuser URL on the SAME server (used only to CREATE DATABASE). */
  adminDatabaseUrl: string;
  labelsDatabaseUrl: string;
}

/**
 * Brings an existing labels database up to the current schema. Idempotent:
 * Drizzle tracks applied migrations in `drizzle.__drizzle_migrations`, so this
 * is safe on every harness start.
 *
 * It does NOT drop the schema. The previous implementation began with
 * `DROP SCHEMA public CASCADE` — scratch-test semantics applied to the
 * harness's ground truth, where one mis-set `LABELS_DATABASE_URL` would erase
 * every label and the revision history STO-R17 exists to preserve. Tests that
 * want a from-zero labels database create a scratch one
 * (`runLabelsMigrations` against `<labels db>_something`), the same split the
 * pipeline store uses (`createTestStore` vs `createStore`).
 */
export async function applyLabelsMigrations(pool: Pool): Promise<void> {
  const db = drizzle(pool);
  // The migrations folder ships inside @cw/harness. Bundlers can rewrite
  // import.meta.url, so anchor on the package location via require.resolve of
  // our own package.json (same reasoning as the pipeline store's migrate()).
  const pkgJsonPath = createRequire(import.meta.url).resolve("../package.json");
  const migrationsFolder = join(dirname(pkgJsonPath), "drizzle");
  await migrateDb(db, { migrationsFolder });
  await enforceGrants(pool);
}

// The blind rule, as GRANTs (HARNESS §2.4): harness may write labels; the
// pipeline role holds zero table privileges on this database.
//
// Kept in code rather than in a migration on purpose: it is idempotent, it must
// cover tables added by LATER migrations (`GRANT ALL ON ALL TABLES`), and it
// encodes a security invariant — the REVOKE that keeps the pipeline role out —
// which has to hold on every apply, not just at schema-creation time.
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

export interface LabelsTestOptions extends LabelsMigrateOptions {
  /** Appended to the labels database name, e.g. `_blind`. */
  scratchSuffix: string;
}

/**
 * Test support: DROP and recreate an entire scratch labels database, migrate it,
 * and hand back a pool to it. The labels counterpart of the pipeline store's
 * `createTestStore` (STORE §5.1) — the blind-rule suite writes label rows, and
 * those must never land in the database that will hold real labels: a leftover
 * fixture would contaminate IAA counts and the Dataset A export.
 */
export async function createTestLabelsPool(options: LabelsTestOptions): Promise<Pool> {
  const scratchName = `${new URL(options.labelsDatabaseUrl).pathname.replace(/^\//, "")}${options.scratchSuffix}`;
  assertSafeIdentifier(scratchName);

  const admin = new Pool({ connectionString: options.adminDatabaseUrl });
  try {
    // Whole database, not just the public schema: Drizzle records applied
    // migrations in its own schema, so dropping public alone leaves stale
    // "applied" rows and the next migrate() no-ops on an empty database.
    await admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${scratchName}"`);
  } finally {
    await admin.end();
  }

  const scratchUrl = new URL(options.labelsDatabaseUrl);
  scratchUrl.pathname = `/${scratchName}`;
  const pool = new Pool({ connectionString: scratchUrl.toString() });
  await applyLabelsMigrations(pool);
  return pool;
}

export async function runLabelsMigrations(options: LabelsMigrateOptions): Promise<void> {
  const labelsDbName = new URL(options.labelsDatabaseUrl).pathname.replace(/^\//, "");
  assertSafeIdentifier(labelsDbName);

  const admin = new Pool({ connectionString: options.adminDatabaseUrl });
  try {
    const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [
      labelsDbName,
    ]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${labelsDbName}"`);
    }
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: options.labelsDatabaseUrl });
  try {
    await applyLabelsMigrations(pool);
  } finally {
    await pool.end();
  }
}

function assertSafeIdentifier(name: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`unsafe database name: ${name}`);
  }
}

const invokedDirectly =
  process.argv[1]?.endsWith("migrate-labels.ts") || process.argv[1]?.endsWith("migrate.ts");
if (invokedDirectly) {
  const adminDatabaseUrl = process.env.DATABASE_URL;
  const labelsDatabaseUrl = process.env.LABELS_DATABASE_URL;
  if (!adminDatabaseUrl || !labelsDatabaseUrl) {
    throw new Error("DATABASE_URL and LABELS_DATABASE_URL are both required");
  }
  runLabelsMigrations({ adminDatabaseUrl, labelsDatabaseUrl }).then(() => {
    console.log(`labels DB migrated: ${new URL(labelsDatabaseUrl).pathname}`);
  });
}
