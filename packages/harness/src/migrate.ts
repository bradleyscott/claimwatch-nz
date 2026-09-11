// Labels-DB migration runner (harness side). Creates the labels database if
// absent, applies the labels chain from zero, and enforces the blind-rule
// grants. Deliberately lives in packages/harness: the pipeline store's runner
// must never reach into harness code (one-way data flow, HARNESS §2.4).

import { Pool } from "pg";
import { applyLabelsMigrations } from "./schema.ts";

export interface LabelsMigrateOptions {
  /** Superuser URL on the SAME server (used only to CREATE DATABASE). */
  adminDatabaseUrl: string;
  labelsDatabaseUrl: string;
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
