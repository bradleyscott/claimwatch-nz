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
  /**
   * Which procedure library the run scored against (ADR-0023 §6). It replaces
   * `fingerprintNormalisationVersion`: the fingerprint was removed entirely, and
   * a scoring run now depends on the library's state rather than on how claim
   * parses were normalised.
   */
  procedureLibraryVersion: string;
  searchConfig: string;
  storeSchemaVersion: string;
  /**
   * The sampling settings the run made its calls with (CROSS-CUTTING §2,
   * `SAMPLING`). Part of the pinned tuple for the same reason the versions are:
   * two runs that differed only in temperature are not comparable, and without
   * this the manifest cannot say which is which (Sept 2026). The seed applies to
   * providers that accept one (OpenAI, OpenRouter); `modelVersions` names which
   * providers ran, and Anthropic accepts no seed.
   */
  sampling: { temperature: number; seed: number | null };
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
