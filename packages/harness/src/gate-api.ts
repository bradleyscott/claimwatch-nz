// Regression gate contract (HARNESS §2.6). Pure function over two run files.
// Thresholds per TEST-STRATEGY D2 / HARNESS §2.6 — frozen by gate.test.ts.

export interface StratumResult {
  n: number;
  accuracy: number; // 0..1
}

export interface RunFile {
  runId: string;
  layer: 1 | 2;
  // Stratum name → result. Layer 1 (AVeriTeC) has none: overall-only.
  strata: Record<string, StratumResult>;
  overall: number; // 0..1
}

export type GateDecision = "pass" | "block" | "advisory";

export interface GateOutcome {
  decision: GateDecision;
  /** Block/advisory reasons, each naming the check that fired. */
  reasons: string[];
  /** Structural warnings (e.g. strata below the n≥20 floor) — never alone decisive. */
  warnings: string[];
}

// Thresholds, published with the gate (HARNESS §2.6 table).
export const GATE_THRESHOLDS = {
  gatedStratumBlockPts: 5, // n ≥ 20
  overallBlockPts: 3,
  stratumNFloor: 20,
} as const;

const PROVENANCE_STRATUM = "provenance";

// All arithmetic in thousandths of a fraction (integer) — float drift must
// never decide a gate boundary: 0.7 − 0.65 = 0.049999… would silently pass at −5.
const SCALE = 1000;
// 1 point = 0.01 accuracy = 10 thousandths of a fraction. Thresholds are
// published in points (HARNESS §2.6); comparisons run in thousandths.
const THOUSANDTHS_PER_POINT = 10;

export function evaluateGate(baseline: RunFile, current: RunFile): GateOutcome {
  const reasons: string[] = [];
  const warnings: string[] = [];

  for (const [name, cur] of Object.entries(current.strata)) {
    const base = baseline.strata[name];
    if (!base) {
      warnings.push(`stratum ${name} has no baseline — reported, not gated`);
      continue;
    }
    const drop = Math.round((base.accuracy - cur.accuracy) * SCALE); // thousandths of a point
    const thinNow = cur.n < GATE_THRESHOLDS.stratumNFloor;
    const thinBefore = base.n < GATE_THRESHOLDS.stratumNFloor;

    if (thinNow || thinBefore) {
      if (drop > 0) {
        reasons.push(
          `advisory: ${name} regressed ${drop / THOUSANDTHS_PER_POINT} pts but n<20 (now ${cur.n}) — advisory only`,
        );
      }
      if (thinNow) {
        warnings.push(`stratum ${name} below n≥20 floor (n=${cur.n})`);
      }
      continue;
    }

    if (name === PROVENANCE_STRATUM) {
      if (drop > 0) {
        reasons.push(
          `advisory: ${PROVENANCE_STRATUM} regressed ${drop / THOUSANDTHS_PER_POINT} pts — advisory by construction`,
        );
      }
      continue;
    }

    if (drop >= GATE_THRESHOLDS.gatedStratumBlockPts * THOUSANDTHS_PER_POINT) {
      reasons.push(
        `block: gated stratum ${name} regressed ${drop / THOUSANDTHS_PER_POINT} pts (n=${cur.n})`,
      );
    }
  }

  const overallDrop = Math.round((baseline.overall - current.overall) * SCALE);
  const overallThreshold = GATE_THRESHOLDS.overallBlockPts * THOUSANDTHS_PER_POINT;
  if (overallDrop >= overallThreshold) {
    reasons.push(
      `block: layer-${current.layer} overall regressed ${overallDrop / THOUSANDTHS_PER_POINT} pts`,
    );
  }

  const decision: GateDecision = reasons.some((r) => r.startsWith("block"))
    ? "block"
    : reasons.some((r) => r.startsWith("advisory"))
      ? "advisory"
      : "pass";
  return { decision, reasons, warnings };
}
