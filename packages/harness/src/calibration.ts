// Calibration (ADR-0024): does "0.9 sure" actually mean 90% right, on OUR claims?
//
// WHY THIS EXISTS AT ALL. A decision model's central claim is calibration — when
// it says 0.9, it is right about 90% of the time. That is a claim about the data
// it was trained and evaluated on. The routing design gates on a threshold, so if
// the claim does not hold on NZ political text, the threshold is not a criterion
// — it is a guess wearing a number, which is the failure mode this project
// removed once already (the fabricated 0.7 confidence that put "Confidence: 70%"
// on every page).
//
// So the rule is the project's own: measured, not asserted. This module is the
// measurement. It is pure — no network, no model — so the arithmetic is L1-tested
// and a live run only has to produce the pairs.
//
// WHAT IS MEASURED. For a set of items with a known correct answer, and a model
// answer carrying a probability, three things:
//
//  1. A reliability curve — bin the answers by stated confidence and compare the
//     mean stated confidence with the observed accuracy in that bin. A perfectly
//     calibrated model has the two equal in every bin.
//  2. The Brier score — mean squared error of the probability, which penalises
//     both overconfidence and hedging in one number.
//  3. The threshold table — for each candidate threshold, how much of the set is
//     settled by the decision model, and how accurate it is on that settled part.
//     This is the number the routing decision actually turns on: a threshold that
//     settles 90% of sentences at 97% accuracy is a different proposition from one
//     that settles 40% at 99%.
//
// THE OVERCONFIDENCE GAP IS THE HEADLINE. If mean stated confidence exceeds
// observed accuracy, the model is overconfident and every threshold is weaker
// than it looks. That single signed number is what a reviewer should read first.

export interface CalibrationItem {
  /** What the model said, 0..1. For a `choice`, the probability of the chosen class. */
  statedConfidence: number;
  /** Whether that answer was right. */
  correct: boolean;
  /** Optional label, so a failure can be pointed at a specific item. */
  id?: string;
}

export interface ReliabilityBin {
  /** Bin edges, inclusive lower / exclusive upper except the last, which closes at 1. */
  from: number;
  to: number;
  /** How many items landed in this bin. */
  n: number;
  /** Mean confidence the model stated, over this bin's items. */
  meanStated: number;
  /** Share of this bin's items that were actually correct. */
  observedAccuracy: number;
  /** `meanStated − observedAccuracy`. Positive means overconfident here. */
  gap: number;
}

export interface ThresholdRow {
  threshold: number;
  /** Items at or above the threshold — settled without escalation. */
  settled: number;
  /** Share of the whole set settled without escalation. */
  settledShare: number;
  /** Accuracy over the settled items only. */
  settledAccuracy: number;
  /** Items below the threshold, which the design escalates. */
  escalated: number;
}

export interface CalibrationReport {
  n: number;
  /** Mean stated confidence across the set. */
  meanStated: number;
  /** Overall accuracy across the set. */
  accuracy: number;
  /** `meanStated − accuracy`. Positive = overconfident overall. */
  overconfidenceGap: number;
  /** Mean squared error of the probability. Lower is better; 0.25 is a coin flip. */
  brier: number;
  /** Expected calibration error: the n-weighted mean of |gap| across bins. */
  expectedCalibrationError: number;
  bins: ReliabilityBin[];
  thresholds: ThresholdRow[];
}

/** Ten equal bins by stated confidence. */
export const CALIBRATION_BINS = 10;

function binIndex(confidence: number, bins: number): number {
  // Confidence 1.0 belongs in the last bin, not in a bin past the end.
  const idx = Math.floor(confidence * bins);
  return Math.min(Math.max(idx, 0), bins - 1);
}

/**
 * Measure a set of decisions.
 *
 * Empty input returns a zero report rather than throwing: a live run that
 * collected nothing is a real outcome (every call failed, or the labelled set was
 * empty), and it has to print as "nothing was measured" instead of as a
 * perfectly-calibrated model with no data behind it. `n: 0` is the tell.
 */
export function calibrate(
  items: CalibrationItem[],
  options: { bins?: number; thresholds?: number[] } = {},
): CalibrationReport {
  const bins = options.bins ?? CALIBRATION_BINS;
  const thresholds = options.thresholds ?? [0, 0.5, 0.7, 0.8, 0.9, 0.95, 0.99];

  if (items.length === 0) {
    return {
      n: 0,
      meanStated: 0,
      accuracy: 0,
      overconfidenceGap: 0,
      brier: 0,
      expectedCalibrationError: 0,
      bins: [],
      thresholds: [],
    };
  }

  const meanStated = items.reduce((sum, i) => sum + i.statedConfidence, 0) / items.length;
  const accuracy = items.filter((i) => i.correct).length / items.length;
  const brier =
    items.reduce((sum, i) => sum + (i.statedConfidence - (i.correct ? 1 : 0)) ** 2, 0) /
    items.length;

  const reliability: ReliabilityBin[] = [];
  for (let b = 0; b < bins; b += 1) {
    const from = b / bins;
    const to = (b + 1) / bins;
    const inBin = items.filter((i) => binIndex(i.statedConfidence, bins) === b);
    if (inBin.length === 0) continue;
    const binStated = inBin.reduce((sum, i) => sum + i.statedConfidence, 0) / inBin.length;
    const binAccuracy = inBin.filter((i) => i.correct).length / inBin.length;
    reliability.push({
      from,
      to,
      n: inBin.length,
      meanStated: binStated,
      observedAccuracy: binAccuracy,
      gap: binStated - binAccuracy,
    });
  }

  const ece =
    reliability.reduce((sum, bin) => sum + (bin.n / items.length) * Math.abs(bin.gap), 0) || 0;

  const thresholdRows: ThresholdRow[] = thresholds.map((threshold) => {
    const settled = items.filter((i) => i.statedConfidence >= threshold);
    return {
      threshold,
      settled: settled.length,
      settledShare: settled.length / items.length,
      settledAccuracy:
        settled.length === 0 ? 0 : settled.filter((i) => i.correct).length / settled.length,
      escalated: items.length - settled.length,
    };
  });

  return {
    n: items.length,
    meanStated,
    accuracy,
    overconfidenceGap: meanStated - accuracy,
    brier,
    expectedCalibrationError: ece,
    bins: reliability,
    thresholds: thresholdRows,
  };
}

/**
 * The threshold to use, given a measured report and a floor on accuracy.
 *
 * Chosen rather than assumed: the highest settle-share whose settled accuracy
 * still clears `minimumAccuracy`. Returns null when no candidate threshold clears
 * the floor, which is the honest answer — it means the decision model should not
 * be gating this role at any of the thresholds tested, and the role stays on the
 * generative model.
 *
 * Note the floor applies to the SETTLED SUBSET, not to the whole set: the whole-set
 * accuracy is the generative model's problem for the escalated remainder.
 */
export function thresholdForAccuracy(
  report: CalibrationReport,
  minimumAccuracy: number,
): ThresholdRow | null {
  const clearing = report.thresholds.filter(
    (row) => row.settled > 0 && row.settledAccuracy >= minimumAccuracy,
  );
  if (clearing.length === 0) return null;
  // Highest settle-share wins; ties break to the higher threshold, which is the
  // more conservative gate.
  return clearing.reduce((best, row) =>
    row.settledShare > best.settledShare ||
    (row.settledShare === best.settledShare && row.threshold > best.threshold)
      ? row
      : best,
  );
}

/** A plain-text report, for a run's console output. */
export function formatCalibrationReport(report: CalibrationReport, label: string): string {
  if (report.n === 0) return `${label}: nothing measured (no items)`;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines = [
    `${label}: n=${report.n}`,
    `  stated ${pct(report.meanStated)} · actual ${pct(report.accuracy)} · overconfidence gap ${
      report.overconfidenceGap >= 0 ? "+" : ""
    }${pct(report.overconfidenceGap)}`,
    `  brier ${report.brier.toFixed(4)} · expected calibration error ${pct(report.expectedCalibrationError)}`,
    "  reliability:",
    ...report.bins.map(
      (b) =>
        `    ${pct(b.from).padStart(6)}–${pct(b.to).padStart(6)}  n=${String(b.n).padStart(4)}  stated ${pct(
          b.meanStated,
        ).padStart(6)}  actual ${pct(b.observedAccuracy).padStart(6)}  gap ${
          b.gap >= 0 ? "+" : ""
        }${pct(b.gap)}`,
    ),
    "  thresholds (settle without escalation):",
    ...report.thresholds.map(
      (t) =>
        `    ≥${t.threshold.toFixed(2)}  settles ${pct(t.settledShare).padStart(6)} (${t.settled}) at ${pct(
          t.settledAccuracy,
        )} accuracy`,
    ),
  ];
  return lines.join("\n");
}
