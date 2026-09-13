// Export serializers contract (HARNESS §2.3.3). Dataset A = labelling export
// (CC BY 4.0); Dataset B = AVeriTeC-format predictions. Frozen by export.test.ts.

import { STORE_SCHEMA_VERSION } from "@cw/store";
import type { RunFile, StratumResult } from "./gate-api.ts";

/** Exact verdict strings the pinned eval.py understands (HAR-R12). */
export type AveritecVerdict =
  | "Supported"
  | "Refuted"
  | "Not Enough Evidence"
  | "Conflicting Evidence/Cherrypicking";

export type PipelineVerdictClass =
  | "supported"
  | "refuted"
  | "not_enough_evidence"
  | "conflicting_cherry_picking";

// Static vocabulary table — the eval.py `verdicts` list, order-significant
// (F1 labels= in eval.py uses the same order).
const VERDICT_CLASS_TO_AVERITEC: Record<PipelineVerdictClass, AveritecVerdict> = {
  supported: "Supported",
  refuted: "Refuted",
  not_enough_evidence: "Not Enough Evidence",
  conflicting_cherry_picking: "Conflicting Evidence/Cherrypicking",
};

export function verdictClassToAveritec(v: PipelineVerdictClass): AveritecVerdict {
  return VERDICT_CLASS_TO_AVERITEC[v];
}

export interface LabelRecord {
  claimId: string;
  claim: {
    text: string;
    utteranceText: string;
    claimType: string;
    claimDate: string;
    speaker: string | null;
  };
  verdict: PipelineVerdictClass;
  confidence: "high" | "medium" | "low";
  citedSources: Array<{
    url: string;
    archiveSnapshotUrl: string;
    snapshotTimestamp: string;
    vintageDate: string | null;
  }>;
  labellerReasoning: string;
  evidenceAvailability: string;
  sourceEcosystem: string;
  labellerId: string;
  labelDate: string;
  schemaVersion: string;
}

export interface DoubleLabelBlock {
  claimId: string;
  firstVerdict: PipelineVerdictClass;
  secondVerdict: PipelineVerdictClass;
  agreement: boolean;
}

export interface DatasetA {
  schemaVersion: string;
  licence: "CC BY 4.0";
  claims: LabelRecord[];
  doubleLabels: DoubleLabelBlock[];
  exclusions: Array<{ claimId: string; reason: string }>;
}

export function toDatasetA(
  labels: LabelRecord[],
  doubleLabels: DoubleLabelBlock[],
  exclusions: DatasetA["exclusions"],
): DatasetA {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    licence: "CC BY 4.0",
    claims: labels,
    doubleLabels,
    exclusions,
  };
}

export function serializeDatasetA(dataset: DatasetA): string {
  return JSON.stringify(dataset, null, 2);
}

export function parseDatasetA(json: string): DatasetA {
  const parsed = JSON.parse(json) as DatasetA;
  if (parsed.licence !== "CC BY 4.0") {
    throw new Error(`Dataset A licence mismatch: ${String(parsed.licence)}`);
  }
  if (typeof parsed.schemaVersion !== "string") {
    throw new Error("Dataset A missing schemaVersion");
  }
  return parsed;
}

export interface AveritecPrediction {
  claim: string;
  label: AveritecVerdict;
  questions: Array<{
    question: string;
    answers: Array<{ answer: string; answer_type: string; source_url: string }>;
  }>;
}

export interface RunManifest {
  runId: string;
  pipelineVersion: string;
  storeSchemaVersion?: string;
  modelVersions: Record<string, string>;
  promptVersions: Record<string, string>;
  /**
   * The sampling settings the run made its calls with (CROSS-CUTTING §2,
   * `SAMPLING`). Required, because the published accuracy table is rendered from
   * these files and two runs that differed only in temperature are not
   * comparable: without this, a run at the provider's default and a run at
   * temperature 0 produce the same manifest and different numbers, and nothing
   * in the file says which is which (Sept 2026).
   *
   * The seed is the value passed to providers that ACCEPT one (OpenAI,
   * OpenRouter); Anthropic exposes no seed parameter, so a Claude-served run is
   * reproducible only as far as temperature takes it. `modelVersions` names the
   * providers that ran, and `seed: null` means no seed is configured at all —
   * neither is a gap in the record.
   */
  sampling: { temperature: number; seed: number | null };
  datasetVersion: string;
  evalToolCommit: string;
  searchConfig: string;
  strata: Record<string, StratumResult>;
  overall: number;
  layer: 1 | 2;
}

// Dataset B is JSONL: one AVeriTeC prediction per line; the run + manifest ride
// on every line under private `_` keys so the file is self-describing (the
// official eval.py ignores unknown keys) while parseDatasetB can reconstruct.
interface DatasetBLine extends AveritecPrediction {
  _run: { runId: string; layer: 1 | 2; overall: number };
  _manifest: RunManifest;
}

export function toDatasetB(
  run: RunFile,
  predictions: AveritecPrediction[],
  manifest: RunManifest,
): string {
  const lines = predictions.map((p) =>
    JSON.stringify({
      ...p,
      _run: { runId: run.runId, layer: run.layer, overall: run.overall },
      _manifest: manifest,
    } satisfies DatasetBLine),
  );
  return `${lines.join("\n")}\n`;
}

export function parseDatasetB(jsonl: string): {
  predictions: AveritecPrediction[];
  run: RunFile;
  manifest: RunManifest;
} {
  const lines = jsonl
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as DatasetBLine);
  const first = lines[0];
  if (!first) {
    throw new Error("Dataset B is empty");
  }
  const predictions: AveritecPrediction[] = lines.map((line) => ({
    claim: line.claim,
    label: line.label,
    questions: line.questions,
  }));
  const run: RunFile = {
    runId: first._run.runId,
    layer: first._run.layer,
    overall: first._run.overall,
    strata: first._manifest.strata,
  };
  return { predictions, run, manifest: first._manifest };
}
