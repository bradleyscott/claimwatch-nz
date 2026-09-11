// HAR-R4: the gate never blocks, or always blocks. Fixture pairs for every
// rule; mutation test — a deliberately degraded run MUST be blocked.
// Thresholds: gated stratum (n≥20) −5 pts block · overall −3 pts block ·
// n<20 strata + provenance advisory (HARNESS §2.6, TEST-STRATEGY D2).

import { describe, expect, it } from "vitest";
import { evaluateGate, type RunFile, type StratumResult } from "./gate-api.ts";

const stratum = (n: number, accuracy: number): StratumResult => ({ n, accuracy });

const baseline: RunFile = {
  runId: "baseline-run",
  layer: 2,
  overall: 0.72,
  strata: {
    stat_grid: stratum(30, 0.8),
    quote_fidelity: stratum(25, 0.7),
    citation_check: stratum(20, 0.75),
    open_web: stratum(25, 0.6),
    provenance: stratum(10, 0.5),
  },
};

const current = (over: Partial<Record<string, StratumResult>>, overall?: number): RunFile => ({
  runId: "current-run",
  layer: 2,
  overall: overall ?? 0.72,
  strata: {
    stat_grid: stratum(30, 0.8),
    quote_fidelity: stratum(25, 0.7),
    citation_check: stratum(20, 0.75),
    open_web: stratum(25, 0.6),
    provenance: stratum(10, 0.5),
    ...over,
  },
});

describe("regression gate — pass", () => {
  it("identical run passes with no reasons", () => {
    const out = evaluateGate(baseline, current({}));
    expect(out.decision).toBe("pass");
    expect(out.reasons).toHaveLength(0);
  });

  it("an improvement passes", () => {
    const out = evaluateGate(baseline, current({ stat_grid: stratum(30, 0.85) }, 0.75));
    expect(out.decision).toBe("pass");
  });

  it("a stratum regression within tolerance passes (−4.9 pts)", () => {
    const out = evaluateGate(baseline, current({ stat_grid: stratum(30, 0.751) }));
    expect(out.decision).toBe("pass");
  });
});

describe("regression gate — block", () => {
  it("blocks when a gated stratum (n≥20) regresses beyond −5 pts", () => {
    const out = evaluateGate(baseline, current({ stat_grid: stratum(30, 0.74) }));
    expect(out.decision).toBe("block");
    expect(out.reasons.some((r) => r.includes("stat_grid"))).toBe(true);
  });

  it("blocks exactly at the −5 pt boundary (strict)", () => {
    const out = evaluateGate(baseline, current({ quote_fidelity: stratum(25, 0.65) }));
    expect(out.decision).toBe("block");
  });

  it("blocks when Layer-2 overall regresses beyond −3 pts", () => {
    const out = evaluateGate(baseline, current({}, 0.68));
    expect(out.decision).toBe("block");
    expect(out.reasons.some((r) => r.toLowerCase().includes("overall"))).toBe(true);
  });

  it("blocks when Layer-1 overall regresses beyond −3 pts (no strata on L1)", () => {
    const l1Baseline: RunFile = { runId: "l1-base", layer: 1, overall: 0.5, strata: {} };
    const l1Current: RunFile = { runId: "l1-cur", layer: 1, overall: 0.46, strata: {} };
    const out = evaluateGate(l1Baseline, l1Current);
    expect(out.decision).toBe("block");
  });

  it("mutation test: a deliberately degraded run can never pass (HAR-R4)", () => {
    const degraded = current(
      {
        stat_grid: stratum(30, 0.5),
        quote_fidelity: stratum(25, 0.4),
        citation_check: stratum(20, 0.45),
        open_web: stratum(25, 0.3),
      },
      0.4,
    );
    const out = evaluateGate(baseline, degraded);
    expect(out.decision).not.toBe("pass");
  });
});

describe("regression gate — advisory", () => {
  it("advises (never blocks) on provenance-stratum regression — n<20 by construction", () => {
    const out = evaluateGate(baseline, current({ provenance: stratum(10, 0.3) }));
    expect(out.decision).toBe("advisory");
  });

  it("advises on a gated stratum whose n dropped below the floor", () => {
    const out = evaluateGate(baseline, current({ citation_check: stratum(12, 0.4) }));
    expect(out.decision).toBe("advisory");
    expect(out.warnings.some((w) => w.includes("citation_check"))).toBe(true);
  });

  it("escalates to block when BOTH advisory and hard-threshold regressions occur", () => {
    const out = evaluateGate(
      baseline,
      current({ provenance: stratum(10, 0.2), stat_grid: stratum(30, 0.7) }),
    );
    expect(out.decision).toBe("block");
  });
});
