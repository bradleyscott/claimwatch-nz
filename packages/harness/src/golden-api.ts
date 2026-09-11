// Golden-set L2 machinery + run manifest contract (HARNESS §2.8). Authored
// red: types real, bodies throw until the green phase lands.

import type { StratumResult } from "./gate-api.ts";

export interface GoldenSnapshot {
  claimId: string;
  lane: string;
  mode: string;
  verdictClass: string;
  confidence: number;
  evidencePath: string[];
  justifications: string[];
  schemaVersion: string;
}

export function captureGoldenSnapshot(_snapshot: GoldenSnapshot): GoldenSnapshot {
  throw new Error("NOT IMPLEMENTED: captureGoldenSnapshot");
}

export function compareGoldenSnapshots(
  _baseline: GoldenSnapshot,
  _current: GoldenSnapshot,
): { changed: boolean; fields: string[] } {
  throw new Error("NOT IMPLEMENTED: compareGoldenSnapshots");
}

export function renderGoldenDiff(_baseline: GoldenSnapshot, _current: GoldenSnapshot): string {
  throw new Error("NOT IMPLEMENTED: renderGoldenDiff");
}

export interface RunManifest {
  runId: string;
  layer: 1 | 2;
  pipelineVersion: string;
  modelVersions: Record<string, string>;
  promptVersions: Record<string, string>;
  promptContentHashes: Record<string, string>;
  gridAxesVersion: string;
  fingerprintNormalisationVersion: string;
  searchConfig: string;
  storeSchemaVersion: string;
  datasetVersion: string;
  evalToolCommit: string;
  strata: Record<string, StratumResult>;
  overall: number;
}

export function buildRunManifest(
  _pinned: Record<string, unknown>,
  _opts: { runId: string; layer: 1 | 2 },
): RunManifest {
  throw new Error("NOT IMPLEMENTED: buildRunManifest");
}

export function assertManifestCompleteness(_manifest: RunManifest): void {
  throw new Error("NOT IMPLEMENTED: assertManifestCompleteness");
}
