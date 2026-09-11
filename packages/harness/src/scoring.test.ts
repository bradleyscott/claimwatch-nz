// AVeriTeC Layer-1 scoring runner (HARNESS §2.5 steps 4-6): predictions +
// references → pinned eval.py → parsed scores → immutable run file. L1 tests
// the PARSER against the eval.py output format using a stub interpreter (no
// live egress, CRO-R6); the env-gated smoke exercises the real script.

import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STORE_SCHEMA_VERSION } from "@cw/store";
import { describe, expect, it } from "vitest";
import { assertManifestCompleteness, buildRunManifest } from "./golden.ts";
import { type AveritecScores, parseEvalOutput, runAveritecScoring } from "./scoring.ts";

const STUB_SCRIPT = `#!/usr/bin/env node
console.log("AVeriTeC evaluation:");
console.log("====================");
console.log("Question-only score (HU-meteor):                   0.412");
console.log("Question-answer score (HU-meteor):                 0.385");
console.log("Veracity F1 scores:");
console.log(" * Supported:                                      0.44");
console.log(" * macro:                                          0.40");
console.log(" * acc:                                            0.42");
console.log("Averitec scores:");
console.log(" * Veracity scores (meteor @ 0.1): 0.33");
console.log(" * Veracity scores (meteor @ 0.2): 0.31");
console.log(" * Veracity scores (meteor @ 0.5): 0.33");
console.log(" * Justification scores (meteor @ 0.5): 0.29");
`;

const evalOutputFixture = `AVeriTeC evaluation:
====================
Question-only score (HU-meteor):                   0.412
Question-answer score (HU-meteor):                 0.385
Veracity F1 scores:
 * Supported:                                      0.44
 * macro:                                          0.40
 * acc:                                            0.42
--------------------
Averitec scores:
 * Veracity scores (meteor @ 0.1): 0.33
 * Veracity scores (meteor @ 0.2): 0.31
 * Veracity scores (meteor @ 0.3): 0.30
 * Veracity scores (meteor @ 0.4): 0.28
 * Veracity scores (meteor @ 0.5): 0.27
 * Justification scores (meteor @ 0.5): 0.29
`;

describe("eval.py output parser (HAR-R12 known format)", () => {
  it("extracts the AVeriTeC veracity score at every reporting level", () => {
    const scores = parseEvalOutput(evalOutputFixture) as AveritecScores;
    expect(scores.veracityByLevel["0.1"]).toBeCloseTo(0.33, 3);
    expect(scores.veracityByLevel["0.2"]).toBeCloseTo(0.31, 3);
    expect(scores.veracityByLevel["0.5"]).toBeCloseTo(0.27, 3);
    expect(scores.justificationByLevel["0.5"]).toBeCloseTo(0.29, 3);
  });

  it("extracts question-only and QA scores plus veracity accuracy", () => {
    const scores = parseEvalOutput(evalOutputFixture) as AveritecScores;
    expect(scores.questionOnly).toBeCloseTo(0.412, 3);
    expect(scores.questionAnswer).toBeCloseTo(0.385, 3);
    expect(scores.veracityAccuracy).toBeCloseTo(0.42, 3);
  });

  it("fails loudly on truncated output — a half-parsed score must never publish (HAR-R9)", () => {
    expect(() => parseEvalOutput("AVeriTeC evaluation:\n====================\n")).toThrow(/score/i);
  });
});

describe("scoring run → run file (HARNESS §2.5 step 6)", () => {
  it("writes an immutable run file carrying the manifest and parsed scores", async () => {
    const dir = mkdtempSync(join(tmpdir(), "averitec-run-"));
    const scriptPath = join(dir, "stub-eval.mjs");
    const predictionsPath = join(dir, "predictions.json");
    const referencesPath = join(dir, "references.json");
    writeFileSync(scriptPath, STUB_SCRIPT);
    chmodSync(scriptPath, 0o755);
    writeFileSync(predictionsPath, JSON.stringify([{ claim: "c", label: "Supported" }]));
    writeFileSync(
      referencesPath,
      JSON.stringify([{ claim: "c", label: "Supported", questions: [] }]),
    );

    const manifest = buildRunManifest(
      {
        pipelineVersion: "0.1.0",
        promptVersions: { triage: "triage@1" },
        modelVersions: { triage: "flash@v1" },
        gridAxesVersion: "grid-axes-2026-09",
        searchConfig: "brave-primary",
      },
      { runId: "l1-run-1", layer: 1 },
    );
    assertManifestCompleteness(manifest);

    const outDir = join(dir, "runs");
    const result = await runAveritecScoring({
      predictionsPath,
      referencesPath,
      evalToolDir: join(dir, "tool"),
      interpreter: scriptPath,
      outDir,
      manifest,
      run: { runId: "l1-run-1", layer: 1, overall: 0.27, strata: {} },
    });

    const runFile = JSON.parse(readFileSync(join(outDir, "l1-run-1.json"), "utf8")) as {
      manifest: { storeSchemaVersion: string; runId: string };
      scores: AveritecScores;
      datasetB: unknown;
    };
    expect(runFile.manifest.runId).toBe("l1-run-1");
    expect(runFile.manifest.storeSchemaVersion).toBe(STORE_SCHEMA_VERSION);
    expect(runFile.scores.veracityByLevel["0.5"]).toBeCloseTo(0.33, 3);
    expect(runFile.datasetB).toBeTruthy();
  });

  it("refuses to overwrite an existing run file — runs are immutable (HARNESS §2.5)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "averitec-run-"));
    const scriptPath = join(dir, "stub-eval.mjs");
    writeFileSync(scriptPath, STUB_SCRIPT);
    chmodSync(scriptPath, 0o755);
    const predictionsPath = join(dir, "predictions.json");
    const referencesPath = join(dir, "references.json");
    writeFileSync(predictionsPath, "[]");
    writeFileSync(referencesPath, "[]");

    const manifest = buildRunManifest(
      {
        pipelineVersion: "0.1.0",
        promptVersions: { triage: "triage@1" },
        modelVersions: { triage: "flash@v1" },
        gridAxesVersion: "grid-axes-2026-09",
        searchConfig: "brave-primary",
      },
      { runId: "l1-run-1", layer: 1 },
    );
    const opts = {
      predictionsPath,
      referencesPath,
      evalToolDir: join(dir, "tool"),
      interpreter: scriptPath,
      outDir: join(dir, "runs"),
      manifest,
      run: { runId: "l1-run-1", layer: 1 as const, overall: 0.27, strata: {} },
    };
    await runAveritecScoring(opts);
    await expect(runAveritecScoring(opts)).rejects.toThrow(/immutable/i);
  });
});
