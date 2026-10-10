// Calibration arithmetic (ADR-0024). Pure, so these pin the numbers a routing
// decision turns on rather than re-running a model to check them.

import { describe, expect, it } from "vitest";
import {
  type CalibrationItem,
  calibrate,
  formatCalibrationReport,
  thresholdForAccuracy,
} from "./calibration.ts";

/** `n` items all stating `confidence`, `correct` of them actually right. */
function items(confidence: number, correct: number, wrong: number): CalibrationItem[] {
  return [
    ...Array.from({ length: correct }, () => ({ statedConfidence: confidence, correct: true })),
    ...Array.from({ length: wrong }, () => ({ statedConfidence: confidence, correct: false })),
  ];
}

describe("calibration (ADR-0024)", () => {
  it("reports a perfectly calibrated set as perfectly calibrated", () => {
    // 100 items at 0.9, 90 of them right: stated == actual, gap 0.
    const report = calibrate(items(0.9, 90, 10));
    expect(report.n).toBe(100);
    expect(report.meanStated).toBeCloseTo(0.9, 10);
    expect(report.accuracy).toBeCloseTo(0.9, 10);
    expect(report.overconfidenceGap).toBeCloseTo(0, 10);
    expect(report.expectedCalibrationError).toBeCloseTo(0, 10);
    expect(report.brier).toBeCloseTo(0.09, 10);
  });

  it("signs the overconfidence gap, because that is the number to read first", () => {
    // Overconfident: says 0.9, right 70% of the time. Every threshold is weaker
    // than it looks, and the gap is what says so.
    const over = calibrate(items(0.9, 70, 30));
    expect(over.overconfidenceGap).toBeCloseTo(0.2, 10);

    // Under-confident: says 0.6, right 80%. The gap goes negative.
    const under = calibrate(items(0.6, 80, 20));
    expect(under.overconfidenceGap).toBeCloseTo(-0.2, 10);
  });

  it("puts confidence 1.0 in the last bin, not past the end", () => {
    const report = calibrate(items(1.0, 10, 0), { bins: 10 });
    expect(report.bins).toHaveLength(1);
    expect(report.bins[0]?.from).toBeCloseTo(0.9, 10);
    expect(report.bins[0]?.to).toBeCloseTo(1.0, 10);
    expect(report.bins[0]?.n).toBe(10);
  });

  it("weights the calibration error by bin size", () => {
    // 99 items at 0.9 with 89 right (gap ~0.001), plus ONE item at 0.1 that is
    // right (gap -0.9). The outlier's own gap is huge but its weight is 1%, so a
    // size-weighted error stays near the large bin's. An unweighted mean of |gap|
    // would report ~0.45 and make a well-calibrated set look broken.
    const report = calibrate([...items(0.9, 89, 10), { statedConfidence: 0.1, correct: true }]);
    expect(report.expectedCalibrationError).toBeLessThan(0.02);
    // The outlier is still visible in its own bin, which is the point of printing
    // the curve rather than only the summary.
    const outlierBin = report.bins.find((b) => b.from === 0.1);
    expect(outlierBin?.gap).toBeCloseTo(-0.9, 6);
  });

  it("reports the settle-share and settled accuracy per threshold", () => {
    const report = calibrate([
      ...items(0.95, 40, 0), // 40 confident and right
      ...items(0.7, 10, 10), // 20 marginal, half wrong
    ]);
    const t95 = report.thresholds.find((t) => t.threshold === 0.95);
    expect(t95?.settled).toBe(40);
    expect(t95?.settledShare).toBeCloseTo(40 / 60, 10);
    expect(t95?.settledAccuracy).toBe(1);
    expect(t95?.escalated).toBe(20);

    const t07 = report.thresholds.find((t) => t.threshold === 0.7);
    expect(t07?.settled).toBe(60);
    expect(t07?.settledAccuracy).toBeCloseTo(50 / 60, 10);
  });

  it("returns a zero report for an empty set rather than a perfect one", () => {
    // A run that collected nothing must print as "nothing measured". A fabricated
    // 1.0 here would be the placeholder-confidence failure again.
    const report = calibrate([]);
    expect(report.n).toBe(0);
    expect(report.accuracy).toBe(0);
    expect(report.bins).toEqual([]);
    expect(report.thresholds).toEqual([]);
    expect(formatCalibrationReport(report, "speakership")).toContain("nothing measured");
  });

  it("picks the highest settle-share that clears the accuracy floor", () => {
    const report = calibrate([
      ...items(0.95, 40, 0), // settles at 0.95 and 0.9, accuracy 1.0
      ...items(0.6, 30, 10), // settles only at the low thresholds, accuracy 0.75
    ]);
    // Floor 0.99: 0.7/0.8/0.9/0.95 all settle the SAME 40 items at 1.0 accuracy,
    // so settle-share ties and the tie-break prefers the higher threshold — the
    // more conservative gate on future data, since it admits fewer items.
    const strict = thresholdForAccuracy(report, 0.99);
    expect(strict?.threshold).toBe(0.95);
    expect(strict?.settled).toBe(40);

    // Floor 0.85: the low-confidence group settles at 0.875, so it now qualifies
    // too — and the highest settle-share wins, which is the whole set. Ties break
    // to the higher threshold, so 0.5 beats 0.
    const loose = thresholdForAccuracy(report, 0.85);
    expect(loose?.settledShare).toBe(1);
    expect(loose?.threshold).toBe(0.5);
    expect(loose?.settledAccuracy).toBeCloseTo(0.875, 6);

    // And at 0.9 the same set does NOT clear the floor, so only the confident
    // bin is available. The floor is what decides, not the data.
    expect(thresholdForAccuracy(report, 0.9)?.settledShare).toBe(0.5);
  });

  it("returns null when no threshold clears the floor — the honest answer", () => {
    // A model that cannot settle anything accurately enough should not gate the
    // role at all, and that must be distinguishable from a low-but-acceptable
    // threshold.
    const report = calibrate(items(0.9, 50, 50));
    expect(thresholdForAccuracy(report, 0.99)).toBeNull();
  });

  it("prints a report a reviewer can read without decoding it", () => {
    const text = formatCalibrationReport(calibrate(items(0.9, 90, 10)), "triage-checkability");
    expect(text).toContain("triage-checkability: n=100");
    expect(text).toContain("overconfidence gap");
    expect(text).toContain("thresholds (settle without escalation)");
  });

  it("never reports a threshold row with zero settled items as accurate", () => {
    // 0/0 is not 1.0. A threshold above every item must read as "settles nothing",
    // not as a perfect gate.
    const report = calibrate(items(0.5, 5, 5), { thresholds: [0.99] });
    expect(report.thresholds[0]?.settled).toBe(0);
    expect(report.thresholds[0]?.settledAccuracy).toBe(0);
  });
});
