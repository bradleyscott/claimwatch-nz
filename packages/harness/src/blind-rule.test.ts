// HAR-R1 / CRO-R14: the blind rule, enforced structurally and tested against
// REAL grants (never a mocked grant layer). Three mechanisms:
//   1. Role denial — as `pipeline`, every labels read fails on claimwatch_labels.
//   2. Dependency direction — packages/pipeline must not import packages/harness.
//   3. Env separation — the pipeline store surface never carries the labels URL.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyLabelsMigrations, createTestLabelsPool } from "./migrate.ts";

const LABELS_URL = requireEnv("LABELS_DATABASE_URL");
const ADMIN_URL = requireEnv("DATABASE_URL");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — copy .env.example to .env (gitignored) and fill it in`);
  }
  return value;
}

const LABELS_TABLES = ["label", "label_set", "double_label", "stratum_assignment"] as const;

const repoRoot = new URL("../../..", import.meta.url).pathname;

function pathExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function listTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listTsFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

// Every test in this file writes labels, so the suite runs against its OWN
// database: `createTestLabelsPool` drops and recreates `<labels db>_blind` and
// migrates it from zero (the labels counterpart of the store's createTestStore).
// The shared labels database is the future home of real labels — a fixture row
// left there would contaminate IAA counts and the Dataset A export.
let pool: Pool;

beforeAll(async () => {
  pool = await createTestLabelsPool({
    adminDatabaseUrl: ADMIN_URL,
    labelsDatabaseUrl: LABELS_URL,
    scratchSuffix: "_blind",
  });
});

afterAll(async () => {
  await pool.end();
});

describe("labels database migrations", () => {
  it("applies the generated chain from zero on a labels database", async () => {
    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name`,
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual([...LABELS_TABLES].sort());
    const r = await pool.query("SELECT COUNT(*)::int AS n FROM label");
    expect(r.rows[0].n).toBe(0);
  });

  it("re-applies without destroying label history (STO-R17)", async () => {
    // The previous migrator began with DROP SCHEMA public CASCADE, so this is a
    // regression pin: bringing the schema up to date must never cost labels.
    const inserted = await pool.query(
      `INSERT INTO label (claim_id, verdict, confidence, cited_sources, labeller_reasoning, evidence_availability, source_ecosystem, labeller_id, label_date, schema_version)
       VALUES (gen_random_uuid(), 'supported', 'high', '[]'::jsonb, 'kept', 'available', 'T1', 'labeller-keep', now(), '0.1.0')
       RETURNING label_id`,
    );
    await applyLabelsMigrations(pool);
    const kept = await pool.query("SELECT labeller_reasoning FROM label WHERE label_id = $1", [
      inserted.rows[0].label_id,
    ]);
    expect(kept.rows[0]?.labeller_reasoning).toBe("kept");
  });
});

describe("blind-rule access (real grants)", () => {
  it("denies the pipeline role SELECT on every labels table", async () => {
    const client = await pool.connect();
    try {
      await client.query("SET ROLE pipeline");
      for (const table of LABELS_TABLES) {
        await expect(client.query(`SELECT * FROM ${table}`)).rejects.toThrow(/permission denied/i);
      }
    } finally {
      await client.query("RESET ROLE");
      client.release();
    }
  });

  it("denies the pipeline role even via schema-qualified names", async () => {
    const client = await pool.connect();
    try {
      await client.query("SET ROLE pipeline");
      await expect(client.query("SELECT count(*) FROM public.label")).rejects.toThrow(
        /permission denied|schema/i,
      );
    } finally {
      await client.query("RESET ROLE");
      client.release();
    }
  });

  it("allows the harness role to write labels", async () => {
    const client = await pool.connect();
    try {
      await client.query("SET ROLE harness");
      const r = await client.query(
        `INSERT INTO label (claim_id, verdict, confidence, cited_sources, labeller_reasoning, evidence_availability, source_ecosystem, labeller_id, label_date, schema_version)
         VALUES (gen_random_uuid(), 'supported', 'high', '[]'::jsonb, 'reasoning', 'available', 'T1', 'labeller-1', now(), '0.1.0') RETURNING label_id`,
      );
      expect(r.rows[0].label_id).toBeTruthy();
    } finally {
      await client.query("RESET ROLE");
      client.release();
    }
  });

  it("keeps the pipeline session from reading label content concurrently (isolation)", async () => {
    const writer = await pool.connect();
    try {
      await writer.query("SET ROLE harness");
      await writer.query(
        `INSERT INTO label (claim_id, verdict, confidence, cited_sources, labeller_reasoning, evidence_availability, source_ecosystem, labeller_id, label_date, schema_version)
         VALUES ('11111111-1111-1111-1111-111111111111', 'supported', 'high', '[]', 'secret reasoning', 'available', 'T1', 'labeller-1', now(), '0.1.0')`,
      );
    } finally {
      await writer.query("RESET ROLE");
      writer.release();
    }

    const reader = await pool.connect();
    try {
      await reader.query("SET ROLE pipeline");
      await expect(reader.query("SELECT labeller_reasoning FROM label LIMIT 1")).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await reader.query("RESET ROLE");
      reader.release();
    }
  });
});

describe("dependency direction (HAR-R1)", () => {
  const pipelinePkg = join(repoRoot, "packages/pipeline/package.json");

  it("packages/pipeline never depends on packages/harness", () => {
    if (!pathExists(pipelinePkg)) {
      return; // pipeline arrives in the Ingestion phase; enforced the moment it exists
    }
    const pkg = JSON.parse(readFileSync(pipelinePkg, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps).not.toContain("@cw/harness");
  });

  it("packages/harness does not import pipeline source", () => {
    const harnessSrc = join(repoRoot, "packages/harness/src");
    for (const file of listTsFiles(harnessSrc)) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/from ["']@cw\/pipeline/);
      expect(src).not.toMatch(/from ["'].*packages\/pipeline/);
    }
  });
});

describe("env separation", () => {
  it("the pipeline store package never references the labels database", () => {
    const storeDir = join(repoRoot, "packages/store/src");
    for (const file of listTsFiles(storeDir)) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/LABELS_DATABASE_URL/);
      expect(src).not.toMatch(/claimwatch_labels/);
    }
  });
});
