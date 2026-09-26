// Stat-grid mode (VER-R1, ADR-0005): pure grid arithmetic plus the one LLM
// role that selects material rows. The grid axes are pre-declared and identical
// for every claimant; the LLM never authors the grid.

import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  EvidenceSeries,
  GridRow,
  SeriesData,
  StatGridInput,
  StatGridOutcome,
} from "../verification-api.ts";
import type { VerificationLlm } from "../verification-llm.ts";

// Class-boundary tolerances, pre-declared: a claim number within
// MATCH_TOLERANCE_PTS of the cited-window row is supported; beyond
// REFUTED_CAP × the row it matches nothing in the field (refuted); in between
// it is an inflated framing (conflicting_cherry_picking).
const MATCH_TOLERANCE_PTS = 10;
const REFUTED_CAP = 3;

export const MaterialityOutput = z.object({ materialRows: z.array(z.string()) });

// ---------- pure grid arithmetic (VER-R1) ----------

function pct(from: number, to: number): number | null {
  if (from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

function findPoint(
  series: { points: Array<{ period: string; value: number }> },
  period: string,
): number | null {
  return series.points.find((p) => p.period === period)?.value ?? null;
}

function parseQuantity(q: string | null | undefined): number | null {
  if (!q) return null;
  const m = q.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function windowStart(temporal: string | null | undefined): string | null {
  const m = temporal?.match(/(?:since|from)\s+(\d{4})/i);
  return m?.[1] ?? null;
}

function rowName(row: GridRow): string {
  if (row.axis === "per-capita") {
    const m = row.variant.match(/(\d{4})→(\d{4})/);
    return m && m[1] && m[2] ? `per-capita-${m[1]}-${m[2]}` : row.variant;
  }
  const start = row.variant.slice(0, 4);
  const end = row.variant.slice(-4);
  return `window-${start}-${end}`;
}

/**
 * The rows a check marked material, resolved back to `GridRow` objects.
 *
 * `materialRows` holds internal names (`window-2017-2026`), which are the strings the materiality
 * LLM selects among — not `row.variant` (`2017→2026`). A consumer that filters on `variant` gets an
 * empty list and shows a check no evidence: the live one-claim script did exactly that, and the NLI
 * gate then (correctly) refused to publish. Resolve through here instead of matching names.
 */
export function materialGridRows(grid: { rows: GridRow[]; materialRows: string[] }): GridRow[] {
  return grid.rows.filter((row) => grid.materialRows.includes(rowName(row)));
}

function citedRowName(row: GridRow): string | null {
  const m = row.variant.match(/^(\d{4})→(\d{4})$/);
  return m && m[1] && m[2] ? `raw-total-window-${m[1]}-${m[2]}` : null;
}

function asDeployedLine(input: StatGridInput): string | undefined {
  // Absent stays absent (ADR-0008): a claim with no attached proposal renders
  // no "as deployed" line — never defaulted from speaker identity.
  const proposal = input.discourseContext?.attachedProposal;
  return proposal ? `deployed in support of ${proposal}` : undefined;
}

function withAsDeployed(
  input: StatGridInput,
  series: SeriesData,
  outcome: StatGridOutcome,
): StatGridOutcome & { vintageDate: string } {
  const line = asDeployedLine(input);
  const withVintage = { ...outcome, vintageDate: series.vintageDate };
  return line === undefined ? withVintage : { ...withVintage, asDeployed: line };
}

export async function computeStatGrid(
  llm: VerificationLlm,
  input: StatGridInput,
): Promise<StatGridOutcome & { vintageDate: string }> {
  const series = input.series;

  // No canonical series → NEI (visibly lower reliability, VERIFICATION §2.2).
  if (series.points.length === 0) {
    return withAsDeployed(input, series, {
      verdictClass: "not_enough_evidence",
      grid: {
        rows: [],
        materialRows: [],
        robust: false,
        claimQuantityPercent: parseQuantity(input.fingerprint.quantity),
      },
      matchedRow: null,
      reason: "no canonical series for this domain — abstention is a measured capability",
    });
  }

  const start = windowStart(input.fingerprint.temporal);
  const end = series.points.at(-1)?.period ?? null;
  const rows: GridRow[] = [];
  const yoyRows: GridRow[] = [];

  if (start != null && end != null && findPoint(series, start) != null) {
    const s = findPoint(series, start);
    const e = findPoint(series, end);
    rows.push({
      axis: "window",
      variant: `${start}→${end}`,
      periods: [start, end],
      percentChange: s != null && e != null ? pct(s, e) : null,
    });

    // Pre-declared adjacent-window variant (+2 years from the cited start).
    const adjacent = String(Number(start) + 2);
    const a = findPoint(series, adjacent);
    const lastValue = series.points.at(-1)?.value ?? null;
    if (a != null && lastValue != null) {
      rows.push({
        axis: "window",
        variant: `${adjacent}→${end}`,
        periods: [adjacent, end],
        percentChange: pct(a, lastValue),
      });
    }

    // Pre-declared per-capita axis; missing/zero population → null, never a fake rate.
    const pop = series.populationSeries;
    const vTo = series.points.at(-1)?.value ?? null;
    const pFrom = pop ? findPoint(pop, start) : null;
    const pTo = pop ? (pop.points.at(-1)?.value ?? null) : null;
    const rateFrom = s != null && pFrom != null && pFrom !== 0 ? s / pFrom : null;
    const rateTo = vTo != null && pTo != null && pTo !== 0 ? vTo / pTo : null;
    rows.push({
      axis: "per-capita",
      variant: `per-capita ${start}→${end}`,
      periods: [start, end],
      percentChange: rateFrom != null && rateTo != null ? pct(rateFrom, rateTo) : null,
    });
  }

  // Year-over-year rows across available consecutive points.
  for (let i = 1; i < series.points.length; i++) {
    const prev = series.points[i - 1];
    const curr = series.points[i];
    if (prev && curr) {
      yoyRows.push({
        axis: "window",
        variant: `${prev.period}→${curr.period}`,
        periods: [prev.period, curr.period],
        percentChange: pct(prev.value, curr.value),
      });
    }
  }

  const allRows = [...rows, ...yoyRows];
  const claimQty = parseQuantity(input.fingerprint.quantity);
  const cited =
    start != null && end != null
      ? rows.find((r) => r.axis === "window" && r.variant === `${start}→${end}`)
      : undefined;
  const matchedRow = cited ? citedRowName(cited) : null;

  // Materiality is the LLM's ONLY grid role (§2.2 step 3): it selects rows.
  const materiality = await llm.generateObject(
    "grid-materiality",
    { claim: input.fingerprint.core, rows: allRows.map(rowName) },
    { parse: (raw: unknown) => MaterialityOutput.parse(raw) },
  );
  const materialNames = materiality.ok ? materiality.value.materialRows : [];

  // Direction-robustness path (no numeric quantity in the claim).
  if (claimQty == null) {
    const relevantYoY = yoyRows.filter(
      (r) => r.periods != null && (start == null || Number(r.periods[0]) >= Number(start)),
    );
    const robust = relevantYoY.length > 0 && relevantYoY.every((r) => (r.percentChange ?? 0) > 0);
    return withAsDeployed(input, series, {
      verdictClass: robust ? "supported" : "not_enough_evidence",
      grid: { rows: allRows, materialRows: materialNames, robust, claimQuantityPercent: null },
      matchedRow: null,
      reason: robust
        ? "every year-over-year change in the window is positive — robust across the grid"
        : "direction not robust across the grid",
    });
  }

  // Quantity path (VER-R11): the class boundary is arithmetic.
  if (!cited || cited.percentChange == null) {
    return withAsDeployed(input, series, {
      verdictClass: "not_enough_evidence",
      grid: {
        rows: allRows,
        materialRows: materialNames,
        robust: false,
        claimQuantityPercent: claimQty,
      },
      matchedRow: null,
      reason: "no row for the claim's cited window",
    });
  }
  const citedPct = cited.percentChange ?? 0;
  const sameDirection = Math.sign(claimQty) === Math.sign(citedPct);

  if (sameDirection && Math.abs(claimQty - citedPct) <= MATCH_TOLERANCE_PTS) {
    return withAsDeployed(input, series, {
      verdictClass: "supported",
      grid: {
        rows: allRows,
        materialRows: materialNames,
        robust: true,
        claimQuantityPercent: claimQty,
      },
      matchedRow,
      reason: "claim matches the cited-window row within the pre-declared tolerance",
    });
  }
  if (!sameDirection || Math.abs(claimQty) > REFUTED_CAP * Math.abs(citedPct)) {
    return withAsDeployed(input, series, {
      verdictClass: "refuted",
      grid: {
        rows: allRows,
        materialRows: materialNames,
        robust: false,
        claimQuantityPercent: claimQty,
      },
      matchedRow: null,
      reason:
        "number matches no grid row — the class boundary is arithmetic, never characterisation",
    });
  }
  // Direction right, magnitude inflated → the flagship class: accurate but
  // incomplete (cherry-picking). Material alternatives weaken it further.
  return withAsDeployed(input, series, {
    verdictClass: "conflicting_cherry_picking",
    grid: {
      rows: allRows,
      materialRows: materialNames,
      robust: false,
      claimQuantityPercent: claimQty,
    },
    matchedRow,
    reason:
      "material alternatives contradict the impression: the cited window shows a smaller change than claimed",
  });
}

export function recordSeriesRetrieval(input: { series: SeriesData; url: string }): EvidenceSeries {
  return {
    authorityRef: input.series.authorityRef,
    seriesIdentity: input.series.seriesIdentity,
    vintageDate: input.series.vintageDate,
    retrievedAt: input.series.retrievedAt,
    url: input.url,
    archiveSnapshotUrl: input.series.archiveSnapshotUrl,
    contentHash: createHash("sha256").update(JSON.stringify(input.series.points)).digest("hex"),
    points: input.series.points,
  };
}
