// AVeriTeC Layer-1 scoring runner contract (HARNESS §2.5). Authored red.

import type { RunFile } from "./gate-api.ts";
import type { RunManifest } from "./golden-api.ts";

export interface AveritecScores {
  questionOnly: number;
  questionAnswer: number;
  veracityAccuracy: number;
  veracityByLevel: Record<string, number>;
  justificationByLevel: Record<string, number>;
}

export interface ScoringRunInput {
  predictionsPath: string;
  referencesPath: string;
  evalToolDir: string;
  /** Interpreter override — tests use a stub; production uses python3. */
  interpreter?: string;
  outDir: string;
  manifest: RunManifest;
  run: RunFile;
}

export interface ScoreRunResult {
  runFilePath: string;
  scores: AveritecScores;
}

export function parseEvalOutput(_stdout: string): AveritecScores {
  throw new Error("NOT IMPLEMENTED: parseEvalOutput");
}

export async function runAveritecScoring(_input: ScoringRunInput): Promise<ScoreRunResult> {
  throw new Error("NOT IMPLEMENTED: runAveritecScoring");
}
