// Slice acceptance checklist (STORE §5.3, VALIDATION-SLICE §4): the SCRIPTED
// portion of slice acceptance, runnable at any time. Non-scripted criteria
// (per-stratum accuracy table, demoable site on live data) are outputs of the
// live run and listed as pending — never silently marked done.
//
// Exit code 0 = every scripted check green; non-zero = release blocker.

import { execFileSync } from "node:child_process";
import { Pool } from "pg";

interface Check {
  name: string;
  passed: boolean;
  detail?: string;
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Check {
  try {
    execFileSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env }, stdio: "pipe" });
    return { name: `${cmd} ${args.join(" ")}`.slice(0, 60), passed: true };
  } catch (e) {
    return {
      name: `${cmd} ${args.join(" ")}`.slice(0, 60),
      passed: false,
      detail: (e as Error).message.slice(0, 200),
    };
  }
}

async function checkDb(databaseUrl: string, name: string, sql: string): Promise<Check> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query(sql);
    return { name, passed: true, detail: `${result.rowCount} rows` };
  } catch (e) {
    return { name, passed: false, detail: (e as Error).message.slice(0, 160) };
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const labelsDatabaseUrl = process.env.LABELS_DATABASE_URL;
  if (!databaseUrl || !labelsDatabaseUrl) {
    console.error("DATABASE_URL and LABELS_DATABASE_URL must be set — copy .env.example to .env");
    process.exit(2);
  }

  const checks: Check[] = [];

  // 1. The full L1 suite (every push gate) — typecheck + lint + tests.
  console.error("→ typecheck");
  for (const pkg of [
    "packages/store",
    "packages/harness",
    "packages/pipeline",
    "packages/llm",
    "apps/site",
  ]) {
    const name = pkg.replace("packages/", "@cw/").replace("apps/", "apps/");
    const check = run("./node_modules/.bin/tsc", ["--noEmit", "-p", pkg], {});
    console.error(`  ${check.passed ? "PASS" : "FAIL"}  typecheck ${name}`);
    if (!check.passed) {
      console.error(`    ${check.detail}`);
    }
    void name;
  }
  console.error("→ lint");
  const lint = run("./node_modules/.bin/biome", ["check", "packages", "apps"], {});
  console.error(`  ${lint.passed ? "PASS" : "FAIL"}  biome`);
  if (!lint.passed) {
    console.error(`    ${lint.detail}`);
  }
  console.error("→ L1 suites");
  const testCheck = run("./node_modules/.bin/vitest", ["run", "packages", "apps/site"], {});
  console.error(`  ${testCheck.passed ? "PASS" : "FAIL"}  vitest (L1)`);
  if (!testCheck.passed) {
    console.error(`    ${testCheck.detail}`);
  }

  // 2. Blind-rule grants against the LIVE labels database (re-verified at every
  // release per HARNESS §5.1, not just the scratch test).
  console.error("→ blind rule against live labels DB");
  let blindCheck: Check;
  {
    const blindPool = new Pool({ connectionString: labelsDatabaseUrl });
    try {
      // The guarantee the frozen L1 test pins: names resolve (USAGE granted)
      // but every labels TABLE read is denied — "permission denied", not
      // "relation does not exist".
      const result = await blindPool.query(
        "SELECT NOT has_table_privilege('pipeline', 'label', 'SELECT') AS denied",
      );
      const denied = result.rows[0]?.denied === true;
      blindCheck = {
        name: "pipeline role denied on labels DB (HAR-R1)",
        passed: denied,
        detail: denied ? undefined : "pipeline role can READ labels — blind rule breach (HAR-R1)",
      };
    } catch (e) {
      blindCheck = {
        name: "pipeline role denied on labels DB (HAR-R1)",
        passed: false,
        detail: (e as Error).message.slice(0, 160),
      };
    } finally {
      await blindPool.end();
    }
    console.error(`  ${blindCheck.passed ? "PASS" : "FAIL"}  ${blindCheck.name}`);
    if (!blindCheck.passed) {
      console.error(`    ${blindCheck.detail}`);
    }
    checks.push(blindCheck);
  }

  // 3. Per-lane fallback log queryable (STORE §5.3).
  console.error("→ store probes");
  const fallback = await checkDb(
    databaseUrl,
    "per-lane fallback log queryable",
    "SELECT lane, COUNT(*) FROM fallback_log GROUP BY lane",
  );
  console.error(`  ${fallback.passed ? "PASS" : "FAIL"}  fallback_log per-lane queryable`);
  if (!fallback.passed) {
    console.error(`    ${fallback.detail}`);
  }
  checks.push(fallback);

  // 4. Restore drill (scripted above; the drill test asserts corruption
  // detection — here we run the assertion suite against the live store).
  console.error("→ restore drill");
  try {
    const { exportDrillDump, replayDrillDump, assertRestoreIntegrity, runRestoreDrillCheck } =
      await import("../packages/store/src/restore-drill.ts");
    const { createTestStore } = await import("../packages/store/src/store.ts");
    const targetStore = await createTestStore(databaseUrl, { scratchSuffix: "_restore_drill" });
    await targetStore.close();
    const dump = await (await import("../packages/store/src/restore-drill.ts")).exportDrillDump(
      databaseUrl,
    );
    await replayDrillDump(`${databaseUrl}_restore_drill`, dump);
    const assertions = await assertRestoreIntegrity(databaseUrl, `${databaseUrl}_restore_drill`);
    runRestoreDrillCheck(assertions);
    console.error("  PASS  restore drill");
  } catch (e) {
    console.error(`  FAIL  restore drill: ${(e as Error).message.slice(0, 160)}`);
    process.exitCode = 1;
  }

  // Report.
  console.log("\nSlice acceptance — scripted checks:");
  console.log(
    [
      `Acceptance criteria NOT yet scriptable (outputs of the live run):`,
      `  [ ] per-stratum accuracy table exists (per mode × media type, double-labelled IAA, cost/claim)`,
      `  [ ] site demoable on live data from five source types with hear-it links`,
      `  [ ] risk map empirical (which strata are production-grade)`,
      `  [ ] feedback channels live with early-user input`,
      `Scripted checks above must all be PASS before the live run starts.`,
    ].join("\n"),
  );
  if (process.exitCode === 1) {
    console.log("\nBLOCKED: fix the failed checks above before the live run (release blocker).");
  }
}

await main();
