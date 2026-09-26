// HAR-R5 / HAR-R12: exports are round-trip-safe and schema-pinned.
// Verdict vocabulary must match the pinned eval.py exactly.

import { STORE_SCHEMA_VERSION } from "@cw/store";
import { describe, expect, it } from "vitest";
import {
  type AveritecPrediction,
  type LabelRecord,
  parseDatasetA,
  parseDatasetB,
  type RunManifest,
  serializeDatasetA,
  toDatasetA,
  toDatasetB,
  verdictClassToAveritec,
} from "./export-api.ts";
import type { RunFile } from "./gate-api.ts";

const label = (over: Partial<LabelRecord> & { claimId: string }): LabelRecord => ({
  claim: {
    text: "Crime is up 30% since 2017",
    utteranceText: "Crime is up 30% since 2017",
    claimType: "statistical",
    claimDate: "2026-09-01",
    speaker: "A minister",
  },
  verdict: "conflicting_cherry_picking",
  confidence: "high",
  citedSources: [
    {
      url: "https://www.stats.govt.nz/x",
      archiveSnapshotUrl: "https://web.archive.org/x",
      snapshotTimestamp: "2026-09-05T00:00:00Z",
      vintageDate: "2026-06-30",
    },
  ],
  labellerReasoning: "Uses 2017 low base; per-capita contradicts.",
  evidenceAvailability: "available",
  sourceEcosystem: "A1-StatsNZ",
  labellerId: "labeller-1",
  labelDate: "2026-09-08",
  schemaVersion: STORE_SCHEMA_VERSION,
  ...over,
});

const run: RunFile = {
  runId: "run-1",
  layer: 2,
  overall: 0.72,
  strata: { stat_grid: { n: 30, accuracy: 0.8 } },
};

const manifest: RunManifest = {
  runId: "run-1",
  pipelineVersion: "0.1.0",
  modelVersions: { "citation-compare": "model-x@v1" },
  promptVersions: { "citation-compare": "citation-compare@1" },
  datasetVersion: "dev-2024",
  sampling: { temperature: 0, seed: null },
  evalToolCommit: "7c62d1ec8df3fb560d6efe2b85fa191135636f81",
  searchConfig: "brave-primary",
  strata: { stat_grid: { n: 30, accuracy: 0.8 } },
  overall: 0.72,
  layer: 2,
};

const prediction: AveritecPrediction = {
  claim: "Crime is up 30% since 2017",
  label: "Conflicting Evidence/Cherrypicking",
  questions: [
    {
      question: "What was the crime rate in 2017?",
      answers: [
        { answer: "12%", answer_type: "extractive", source_url: "https://www.stats.govt.nz/x" },
      ],
    },
  ],
};

describe("verdict vocabulary (HAR-R12)", () => {
  it("maps pipeline classes to the exact eval.py strings", () => {
    expect(verdictClassToAveritec("supported")).toBe("Supported");
    expect(verdictClassToAveritec("refuted")).toBe("Refuted");
    expect(verdictClassToAveritec("not_enough_evidence")).toBe("Not Enough Evidence");
    expect(verdictClassToAveritec("conflicting_cherry_picking")).toBe(
      "Conflicting Evidence/Cherrypicking",
    );
  });
});

describe("Dataset A — labelling export (CC BY 4.0)", () => {
  const dataset = toDatasetA(
    [label({ claimId: "c1" }), label({ claimId: "c2", verdict: "supported" })],
    [
      {
        claimId: "c1",
        firstVerdict: "conflicting_cherry_picking",
        secondVerdict: "conflicting_cherry_picking",
        agreement: true,
      },
    ],
    [{ claimId: "c3", reason: "unresolvable disagreement" }],
  );

  it("carries the licence and the store schema version", () => {
    expect(dataset.licence).toBe("CC BY 4.0");
    expect(dataset.schemaVersion).toBe(STORE_SCHEMA_VERSION);
  });

  it("round-trips through serialization without loss", () => {
    const parsed = parseDatasetA(serializeDatasetA(dataset));
    expect(parsed).toEqual(dataset);
  });

  it("carries cited sources with archive snapshots and vintages", () => {
    const src = dataset.claims[0]?.citedSources[0];
    expect(src?.archiveSnapshotUrl).toBeTruthy();
    expect(src?.snapshotTimestamp).toBeTruthy();
    expect(src?.vintageDate).toBeTruthy();
  });

  it("preserves the double-label block and exclusions (never silently dropped)", () => {
    expect(dataset.doubleLabels).toHaveLength(1);
    expect(dataset.exclusions).toHaveLength(1);
  });
});

describe("Dataset B — AVeriTeC-format predictions", () => {
  const jsonl = toDatasetB(run, [prediction], manifest);

  it("emits one prediction object per line in AVeriTeC format", () => {
    const lines = jsonl.trim().split("\n");
    const parsed = lines.map((l) => JSON.parse(l) as AveritecPrediction);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.label).toBe("Conflicting Evidence/Cherrypicking");
    expect(parsed[0]?.questions[0]?.answers[0]?.answer).toBe("12%");
  });

  it("round-trips predictions and manifest through parse", () => {
    const back = parseDatasetB(jsonl);
    expect(back.predictions[0]).toEqual(prediction);
    expect(back.manifest).toEqual(manifest);
    expect(back.run.runId).toBe("run-1");
  });
});
