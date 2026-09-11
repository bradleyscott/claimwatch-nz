// AVeriTeC Layer-1 scoring runner (HARNESS §2.5 steps 4-6): predictions +
// references → pinned eval.py → parsed scores → immutable run file. The parser
// is pinned to the eval.py output format (HAR-R12); a truncated output fails
// loudly rather than publishing half a score.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AveritecScores, ScoreRunResult, ScoringRunInput } from "./scoring-api.ts";

export type { AveritecScores, ScoreRunResult, ScoringRunInput } from "./scoring-api.ts";

export function parseEvalOutput(stdout: string): AveritecScores {
  const veracityByLevel: Record<string, number> = {};
  const justificationByLevel: Record<string, number> = {};
  let questionOnly: number | null = null;
  let questionAnswer: number | null = null;
  let veracityAccuracy: number | null = null;

  for (const line of stdout.split(/\r?\n/)) {
    const qOnly = line.match(/Question-only score \(HU-\w+\):\s+([\d.]+)/);
    if (qOnly?.[1]) {
      questionOnly = Number(qOnly[1]);
      continue;
    }
    const qAnswer = line.match(/Question-answer score \(HU-\w+\):\s+([\d.]+)/);
    if (qAnswer?.[1]) {
      questionAnswer = Number(qAnswer[1]);
      continue;
    }
    const accuracy = line.match(/\*\s+acc:\s+([\d.]+)/);
    if (accuracy?.[1]) {
      veracityAccuracy = Number(accuracy[1]);
      continue;
    }
    const veracityLevel = line.match(/Veracity scores \(\w+ @ ([\d.]+)\):\s+([\d.]+)/);
    if (veracityLevel && veracityLevel[1] && veracityLevel[2]) {
      veracityByLevel[veracityLevel[1]] = Number(veracityLevel[2]);
      continue;
    }
    const justificationLevel = line.match(/Justification scores \(\w+ @ ([\d.]+)\):\s+([\d.]+)/);
    if (justificationLevel && justificationLevel[1] && justificationLevel[2]) {
      justificationByLevel[justificationLevel[1]] = Number(justificationLevel[2]);
    }
  }

  // Half-parsed output never publishes (HAR-R9): the eval script's headline
  // metrics are mandatory; their absence means the run is corrupt.
  if (
    questionOnly == null ||
    questionAnswer == null ||
    veracityAccuracy == null ||
    Object.keys(veracityByLevel).length === 0
  ) {
    throw new Error(
      "eval output parse error: missing headline scores — refusing to publish a half-parsed run",
    );
  }
  return { questionOnly, questionAnswer, veracityAccuracy, veracityByLevel, justificationByLevel };
}

export async function runAveritecScoring(input: ScoringRunInput): Promise<ScoreRunResult> {
  const runFilePath = join(input.outDir, `${input.manifest.runId}.json`);
  if (existsSync(runFilePath)) {
    throw new Error(
      `run file already exists: ${runFilePath} — scoring runs are immutable (HARNESS §2.5)`,
    );
  }
  mkdirSync(input.outDir, { recursive: true });

  const interpreter = input.interpreter ?? "python3";
  const evalScript = join(input.evalToolDir, "eval.py");
  const stdout = execFileSync(
    interpreter,
    [evalScript, "--predictions", input.predictionsPath, "--references", input.referencesPath],
    {
      encoding: "utf8",
      timeout: 300_000,
    },
  );
  const scores = parseEvalOutput(stdout);

  // The run file carries the manifest + parsed scores + the raw Dataset B
  // payload (HARNESS §2.5 step 6): the methodology page renders from this file,
  // generated, never hand-edited.
  const datasetB = readFileSync(input.predictionsPath, "utf8");
  const runFile = {
    manifest: input.manifest,
    run: input.run,
    scores,
    datasetB,
    parsedAt: new Date().toISOString(),
  };
  writeFileSync(runFilePath, JSON.stringify(runFile, null, 2));
  return { runFilePath, scores };
}
