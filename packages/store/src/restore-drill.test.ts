// Restore drill L1 (STORE §5.2, STO-R7): seed a real store → export a drill
// dump → apply the migration chain to a scratch restore target → replay data →
// integrity assertions pass. The negative case proves the drill DETECTS
// corruption: an extra injected row must fail the row-count assertion and the
// drill check must throw naming it.

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertRestoreIntegrity,
  drillFailures,
  exportDrillDump,
  replayDrillDump,
  runRestoreDrillCheck,
} from "./restore-drill.ts";
import { createTestStore, scratchDatabaseUrl } from "./store.ts";
import type { Store } from "./store-api.ts";

// No committed connection strings (Sept 2026) — same contract as
// store.test.ts: credentials come from .env or the CI environment.
const DATABASE_URL = requireEnv("DATABASE_URL");
const RESTORED_URL = scratchDatabaseUrl(DATABASE_URL, "_restore_drill");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — copy .env.example to .env (gitignored) and fill it in`);
  }
  return value;
}

// Own scratch source: vitest forks run suites concurrently, and another
// suite's from-zero wipe on a shared DB corrupts the drill mid-flight.
let store: Store;

beforeAll(async () => {
  store = await createTestStore(DATABASE_URL, { scratchSuffix: "_drill" });
});

afterAll(async () => {
  await store.close();
});

async function seedSource(): Promise<void> {
  await store.recordPublication(store.fixtures.beehiveRelease());
  await store.recordPublication(store.fixtures.rnzArticle());
  const claim = await store.recordClaim(store.fixtures.statClaim());
  await store.recordEvidenceItem({ ...store.fixtures.statsNzSeries(), claimId: claim.claimId });
  const pack = await store.appendEvidencePack(claim.claimId, store.fixtures.evidencePack());
  const v1 = await store.writeVerdict(claim.claimId, pack.packId, {
    provenance: store.fixtures.fullProvenance(),
    verdictClass: "conflicting_cherry_picking",
    confidence: 0.72,
  });
  await store.logTransition(v1.verdictId, { from: "DRAFT", to: "PUBLISHED", reason: "verified" });
}

describe("restore drill (STO-R7)", () => {
  it("exports, replays into a schema-applied scratch target, and passes every integrity assertion", async () => {
    await seedSource();

    const dump = await exportDrillDump(scratchDatabaseUrl(DATABASE_URL, "_drill"));
    expect(dump).toContain("INSERT INTO publication");
    expect(dump).toContain("GRANT INSERT, SELECT ON publication TO pipeline");
    // The authority registry is data AND grants: it is seeded by the migration
    // chain and written to by live runs, so a restore that skips it loses the
    // discovered authorities the live-run store deliberately persists.
    expect(dump).toContain("INSERT INTO authority");
    expect(dump).toContain("GRANT SELECT ON authority TO site");

    // Target: schema applied via the SAME migration chain (createTestStore =
    // wipe + migrate + roles + guards), then data replay — the drill only
    // INSERTs, which append-only guards permit.
    const targetStore = await createTestStore(DATABASE_URL, { scratchSuffix: "_restore_drill" });
    await targetStore.close();
    await replayDrillDump(RESTORED_URL, dump);

    const assertions = await assertRestoreIntegrity(
      scratchDatabaseUrl(DATABASE_URL, "_drill"),
      RESTORED_URL,
    );
    runRestoreDrillCheck(assertions);
  });

  it("detects corruption: an extra injected row fails the drill check naming it", async () => {
    await seedSource();
    const dump = await exportDrillDump(scratchDatabaseUrl(DATABASE_URL, "_drill"));

    const targetStore = await createTestStore(DATABASE_URL, { scratchSuffix: "_restore_drill" });
    await targetStore.close();
    await replayDrillDump(RESTORED_URL, dump);

    // Inject corruption into the restored copy: an extra publication row the
    // source never had (INSERT is permitted; the drill's job is to notice).
    const pool = new Pool({ connectionString: RESTORED_URL });
    try {
      await pool.query(
        `INSERT INTO publication (source_id, canonical_url, content_hash, retrieved_at, retrieval_method, pipeline_version, raw_ref, text)
         VALUES ('tamper', 'https://tampered.example/x', 'tampered-hash', now(), 'drill', '0.1.0', 'raw', 'tampered')`,
      );
    } finally {
      await pool.end();
    }

    const assertions = await assertRestoreIntegrity(
      scratchDatabaseUrl(DATABASE_URL, "_drill"),
      RESTORED_URL,
    );
    expect(drillFailures(assertions).some((a) => a.name === "row counts: publication")).toBe(true);
    expect(() => runRestoreDrillCheck(assertions)).toThrow(
      /restore drill FAILED.*row counts: publication/,
    );
  });
});
