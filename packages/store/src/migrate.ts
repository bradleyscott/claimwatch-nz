// Scratch-DB migration runner: the single entry point CI + local scripts use
// to bring the PIPELINE store from zero to current. Re-runnable by design
// (drops + recreates), so "migrations" here are the full DDL chain, not deltas.
//
// The harness labels DB is a separate concern with its own runner
// (packages/harness/src/migrate.ts) — one-way data flow: the pipeline store
// never reaches into harness code (HARNESS §2.4).

import { Pool } from "pg";
import { ensureAppendOnlyGuards, migrate } from "./store.ts";

export interface MigrateOptions {
  databaseUrl: string;
}

export async function runMigrations(options: MigrateOptions): Promise<{ applied: string[] }> {
  const pool = new Pool({ connectionString: options.databaseUrl });
  try {
    const applied = await migrate(pool);
    await ensureAppendOnlyGuards(pool);
    return { applied };
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1]?.endsWith("migrate.ts");
if (invokedDirectly) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  runMigrations({ databaseUrl }).then((result) => {
    console.log(`applied: ${result.applied.join(", ")}`);
  });
}
