// Golden-set L2 machinery + run manifest (TEST-STRATEGY §2 L2, HARNESS §2.8).
// L1 pins the MACHINERY: snapshot capture, compare, diff rendering, manifest
// completeness. The live L2 run happens per-PR with the real provider (budgeted
// ~pennies); L1 uses the mock port. Authored red.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

import { STORE_SCHEMA_VERSION } from "@cw/store";
import { parseDatasetB, toDatasetB } from "./export.ts";
import {
  assertManifestCompleteness,
  buildRunManifest,
  captureGoldenSnapshot,
  compareGoldenSnapshots,
  type GoldenSnapshot,
  type RunManifest,
  renderGoldenDiff,
} from "./golden.ts";

const goldenFixture = JSON.parse(readFixture("golden-set.json")) as {
  pinnedVersions: Record<string, unknown>;
  claims: Array<{
    id: string;
    lane: string;
    mode: string;
    claim: string;
    expectedVerdictClass: string;
  }>;
};

const snapshotFor = (over: Partial<GoldenSnapshot>): GoldenSnapshot => ({
  claimId: "gold-01",
  lane: "beehive-rss",
  mode: "stat-grid",
  verdictClass: "conflicting_cherry_picking",
  confidence: 0.72,
  evidencePath: ["policedata.nz/victimisations@2026-06-30"],
  justifications: [
    "Cited window shows +11.6%, per-capita +1.9% — alternatives contradict the 30% impression.",
  ],
  schemaVersion: STORE_SCHEMA_VERSION,
  ...over,
});

describe("golden-set corpus integrity", () => {
  it("carries 20 pinned claims spanning all five lanes and every mode", () => {
    expect(goldenFixture.claims).toHaveLength(20);
    const lanes = new Set(goldenFixture.claims.map((c) => c.lane));
    const modes = new Set(goldenFixture.claims.map((c) => c.mode));
    expect(lanes).toEqual(
      new Set(["beehive-rss", "rnz-politics", "youtube-captions", "institution", "false-context"]),
    );
    expect(modes).toEqual(
      new Set(["stat-grid", "open-web", "citation-check", "quote-fidelity", "provenance"]),
    );
  });

  it("every mode has at least one pinned claim (VERIFICATION §5 behavioural row)", () => {
    for (const mode of [
      "stat-grid",
      "open-web",
      "citation-check",
      "quote-fidelity",
      "provenance",
    ]) {
      expect(goldenFixture.claims.filter((c) => c.mode === mode).length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("snapshot capture + compare", () => {
  it("captures a full snapshot: verdict, confidence, evidence path, justifications, schema version", () => {
    const snap = captureGoldenSnapshot(snapshotFor({}));
    expect(snap.verdictClass).toBe("conflicting_cherry_picking");
    expect(snap.confidence).toBeCloseTo(0.72, 2);
    expect(snap.evidencePath).toHaveLength(1);
    expect(snap.schemaVersion).toBe(STORE_SCHEMA_VERSION);
  });

  it("identical snapshots compare clean", () => {
    const a = captureGoldenSnapshot(snapshotFor({}));
    const b = captureGoldenSnapshot(snapshotFor({}));
    expect(compareGoldenSnapshots(a, b)).toEqual({ changed: false, fields: [] });
  });

  it("a verdict-class flip is a visible diff, not a silent pass (the L2 contract)", () => {
    const baseline = captureGoldenSnapshot(snapshotFor({}));
    const changed = captureGoldenSnapshot(
      snapshotFor({ verdictClass: "supported", confidence: 0.81 }),
    );
    const cmp = compareGoldenSnapshots(baseline, changed);
    expect(cmp.changed).toBe(true);
    expect(cmp.fields).toContain("verdictClass");
    expect(cmp.fields).toContain("confidence");
  });

  it("renders a human-readable diff for review (prompt changes are reviewed via snapshot diff, CROSS-CUTTING §3)", () => {
    const baseline = captureGoldenSnapshot(snapshotFor({}));
    const changed = captureGoldenSnapshot(snapshotFor({ verdictClass: "supported" }));
    const diff = renderGoldenDiff(baseline, changed);
    expect(diff).toContain("verdictClass");
    expect(diff).toContain("conflicting_cherry_picking");
    expect(diff).toContain("supported");
  });
});

describe("run manifest (HARNESS §2.8 — reproducibility)", () => {
  it("pins everything we control: models, prompts, grid axes, fingerprint version, search config", () => {
    const manifest = buildRunManifest(goldenFixture.pinnedVersions as never, {
      runId: "run-1",
      layer: 2,
    });
    expect(manifest.modelVersions).toBeTruthy();
    expect(manifest.promptVersions).toBeTruthy();
    expect(manifest.gridAxesVersion).toBe("grid-axes-2026-09");
    expect(manifest.fingerprintNormalisationVersion).toBe("fp-norm-2025-01");
    expect(manifest.searchConfig).toBe("brave-primary");
    expect(manifest.storeSchemaVersion).toBe(STORE_SCHEMA_VERSION);
  });

  it("asserts completeness: a manifest missing any pin fails loudly before the run (HAR-R7)", () => {
    const complete = buildRunManifest(goldenFixture.pinnedVersions as never, {
      runId: "run-1",
      layer: 2,
    });
    expect(() => assertManifestCompleteness(complete)).not.toThrow();
    const incomplete = { ...complete, modelVersions: {} } as RunManifest;
    expect(() => assertManifestCompleteness(incomplete)).toThrow(/modelVersions/);
    const noPipeline = { ...complete, pipelineVersion: "" } as RunManifest;
    expect(() => assertManifestCompleteness(noPipeline)).toThrow(/pipelineVersion/);
  });

  it("manifest completeness recomputes content hashes, never trusts stored ones (HAR-R7)", () => {
    const complete = buildRunManifest(goldenFixture.pinnedVersions as never, {
      runId: "run-1",
      layer: 2,
    });
    const tampered = {
      ...complete,
      promptContentHashes: { adjudication: "deadbeef" },
    } as RunManifest;
    expect(() => assertManifestCompleteness(tampered)).toThrow(/hash/);
  });
});

describe("AVeriTeC Layer-1 export path (HARNESS §2.5)", () => {
  it("exports predictions and a manifest that parse back with matching schema versions", () => {
    const manifest = buildRunManifest(goldenFixture.pinnedVersions as never, {
      runId: "l1-run",
      layer: 1,
    });
    const predictions = [
      {
        claim: "Crime is up 30% since 2017.",
        label: "Conflicting Evidence/Cherrypicking" as const,
        questions: [],
      },
    ];
    const run = { runId: "l1-run", layer: 1 as const, overall: 0.5, strata: {} };
    const jsonl = toDatasetB(run, predictions, manifest);
    const back = parseDatasetB(jsonl);
    expect(back.predictions[0]?.label).toBe("Conflicting Evidence/Cherrypicking");
    expect(back.manifest.storeSchemaVersion).toBe(STORE_SCHEMA_VERSION);
  });
});
