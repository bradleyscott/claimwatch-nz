// Methodology accuracy-artifact contract (SITE-MVP §3.4): the L3 run writes a
// versioned JSON artifact; the methodology build step renders it verbatim —
// the published number is generated, never hand-edited. A missing or malformed
// artifact FAILS THE BUILD (SIT-R2): honesty can't silently go stale.

import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { assertRegisterSafe } from "./verdict-register.ts";

export const AccuracyArtifact = z.object({
  runId: z.string(),
  generatedAt: z.string(),
  storeSchemaVersion: z.string(),
  // The grouping axis is the harness's, and it changes when the pipeline does
  // (ADR-0026 makes it per-turn / per-class). So the VALUE is a non-empty string
  // rather than a closed enum.
  //
  // The structure is still validated — a missing or malformed artifact still
  // fails the build (SIT-R2) — because that rule is about refusing to render a
  // stale or invented number, not about the vocabulary of the labels. Failing the
  // build over a group name would block the site on a change it cannot make, which
  // is the opposite of the honesty SIT-R2 wants.
  modes: z.array(
    z.object({
      mode: z.string().min(1),
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

/**
 * Reader-facing labels for the groups the harness has reported so far.
 *
 * The five entries are the retired per-procedure axis, kept so an artifact from
 * The methodology page prints accuracy figures, and a mislabelled row is a worse
 * failure than a generically labelled one.
 */

/**
 * A label for a group this site has no copy for.
 *
 * The methodology page does NOT run the register scan (the scan guards verdict
 * copy), so an unknown key reaching the page would print internal vocabulary —
 * `stratum-3`, say — straight into public copy. So the key is humanised only
 * when it survives the register check, and otherwise replaced wholesale. A
 * reader gets a plain row either way; the exact group name is on the run record,
 * which is where an internal identifier belongs.
 *
 * This is deliberately STRICTER than AGENTS rule 9, which exempts `/methodology`
 * from the banned terms. A reader looking at accuracy figures gains nothing from
 * a group named after our internal axis, and "Claims checked" is honest where
 * "Stratum 3" is not.
 */
function labelForMode(mode: string): string {
  const humanised = mode.replace(/-/g, " ");
  try {
    assertRegisterSafe(humanised);
    return humanised.charAt(0).toUpperCase() + humanised.slice(1);
  } catch {
    return "Claims checked";
  }
}

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
    label: labelForMode(m.mode),
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
