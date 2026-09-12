// Methodology accuracy-artifact contract (SITE-MVP §3.4): the L3 run writes a
// versioned JSON artifact; the methodology build step renders it verbatim —
// the published number is generated, never hand-edited. A missing or malformed
// artifact FAILS THE BUILD (SIT-R2): honesty can't silently go stale.

import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

export const AccuracyArtifact = z.object({
  runId: z.string(),
  generatedAt: z.string(),
  storeSchemaVersion: z.string(),
  modes: z.array(
    z.object({
      mode: z.enum(["stat-grid", "citation-check", "quote-fidelity", "provenance", "open-web"]),
      accuracy: z.number().min(0).max(1),
      n: z.number().int().positive(),
      costPerClaim: z.number().nonnegative(),
    }),
  ),
  overall: z.object({
    accuracy: z.number().min(0).max(1),
    iaa: z.number().min(0).max(1).nullable(),
    costPerClaim: z.number().nonnegative(),
  }),
});
export type AccuracyArtifact = z.infer<typeof AccuracyArtifact>;

export const ACCURACY_ARTIFACT_PATH = "packages/harness/output/latest-accuracy.json";

export function loadAccuracyArtifact(
  repoRoot: string,
  path = ACCURACY_ARTIFACT_PATH,
): AccuracyArtifact {
  const full = `${repoRoot}/${path}`;
  if (!existsSync(full)) {
    throw new Error(
      `accuracy artifact missing at ${path} — the methodology page renders a generated number, never a stale or hand-edited one (SIT-R2); run the harness scoring first`,
    );
  }
  const parsed = JSON.parse(readFileSync(full, "utf8"));
  const result = AccuracyArtifact.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `accuracy artifact malformed at ${issue?.path.join(".")}: ${issue?.message} — refusing to render (SIT-R2)`,
    );
  }
  return result.data;
}

const MODE_LABELS: Record<string, string> = {
  "stat-grid": "Statistical claims checked against official data",
  "citation-check": "Claims checked against the source they cite",
  "quote-fidelity": "Broadcast claims checked against the record we hold",
  provenance: "Claims shown in the wrong context (demonstration set)",
  "open-web": "Everything else, checked against the open web",
};

export interface AccuracyTableRow {
  mode: string;
  label: string;
  accuracyPercent: number;
  n: number;
  costPerClaim: number;
}

export function renderAccuracyTable(artifact: AccuracyArtifact): AccuracyTableRow[] {
  return artifact.modes.map((m) => ({
    mode: m.mode,
    label: MODE_LABELS[m.mode] ?? m.mode,
    accuracyPercent: Math.round(m.accuracy * 1000) / 10,
    n: m.n,
    costPerClaim: m.costPerClaim,
  }));
}

export function artifactEqualsRendered(
  artifact: AccuracyArtifact,
  rows: AccuracyTableRow[],
): boolean {
  const rendered = renderAccuracyTable(artifact);
  return (
    rows.length === rendered.length &&
    rows.every(
      (r, i) =>
        r.accuracyPercent === rendered[i]?.accuracyPercent &&
        r.n === rendered[i]?.n &&
        r.costPerClaim === rendered[i]?.costPerClaim,
    )
  );
}
