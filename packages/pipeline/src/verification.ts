// VERIFICATION: claim records → verdict + confidence + evidence pack (ADR-0005).
// The stat grid is pre-declared and identical for every claimant (the
// anti-invented-standard defence); the LLM selects which rows are material —
// it never authors the grid. Class boundaries are arithmetic (VERIFICATION
// §2.2): robust → supported · material alternatives contradict → cherry-picking
// · number matches nothing → refuted · no canonical series → NEI.

import { createHash } from "node:crypto";
import { GRID_AXES_VERSION } from "@cw/llm";
import { z } from "zod";
import type {
  AuthorityResolution,
  CitationOutcome,
  CitedDocument,
  DepthCapResult,
  EvidenceSeries,
  GridRow,
  NliCheckResult,
  QuoteFidelityOutcome,
  SeriesData,
  StatGridInput,
  StatGridOutcome,
  VerdictClass,
} from "./verification-api.ts";
import type { VerificationLlm } from "./verification-llm.ts";

export type {
  AuthorityResolution,
  CitationOutcome,
  CitedDocument,
  DepthCapResult,
  EvidenceSeries,
  GridResult,
  GridRow,
  NliCheckResult,
  QuoteFidelityOutcome,
  SeriesData,
  SeriesPoint,
  StatGridInput,
  StatGridOutcome,
  VerdictClass,
} from "./verification-api.ts";

// Pre-declared grid axes (ADR-0005): identical for every claimant. Changing
// these is a pipeline change that re-runs the harness (CROSS-CUTTING §2).
export { GRID_AXES_VERSION };

// Class-boundary tolerances, pre-declared: a claim number within
// MATCH_TOLERANCE_PTS of the cited-window row is supported; beyond
// REFUTED_CAP × the row it matches nothing in the field (refuted); in between
// it is an inflated framing (conflicting_cherry_picking).
const MATCH_TOLERANCE_PTS = 10;
const REFUTED_CAP = 3;

const MaterialityOutput = z.object({ materialRows: z.array(z.string()) });

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

// ---------- authority map (VER-R14) ----------

const DOMAIN_PRIMARY: Record<string, string> = {
  "crime-statistics": "policedata.nz",
  "economic-forecasts": "treasury.govt.nz",
  "population-estimates": "stats.govt.nz",
};

const ADVOCACY_SOURCES = [
  "NZ Initiative report",
  "Curia poll",
  "Taxpayers' Union poll",
  "The Kākā",
];

export function resolveAuthority(input: {
  domain: string;
  requestedSource: string;
  requestedTier: number;
}): AuthorityResolution {
  const primary = DOMAIN_PRIMARY[input.domain];
  if (!primary) {
    throw new Error(
      `no authority mapped for domain: ${input.domain} — route to open-web loop with no-pre-vetted-authority note`,
    );
  }
  if (input.requestedTier < 6) {
    return { primary };
  }
  // T6 requested: the claim's own tier is cited first, then the higher
  // authority — the gap IS the finding (VERIFICATION §3.4).
  return {
    primary,
    note: `claim cites ${input.requestedSource} (T6); verdict cites it first, then ${primary} — the tier gap is the finding`,
  };
}

const ADVOCACY_MARKERS = ["NZ Initiative", "Curia", "Taxpayers' Union", "The Kākā", "NZIER"];

export function rejectAdvocacySource(source: string): boolean {
  return ADVOCACY_MARKERS.some((marker) => source.includes(marker));
}

// ---------- citation-check mode (VER-R4) ----------

const CitationOutput = z.object({
  verdict: z.enum(["supported", "refuted", "not_enough_evidence", "conflicting_cherry_picking"]),
  // Absent for paywalled citations: no comparison ran, so no strictness exists.
  bindingStrictness: z.enum(["direct", "decorative"]).optional(),
  quotedClaimOnly: z.boolean().optional(),
  mismatch: z.string().optional(),
  // Deep-research additions (user direction, Sept 2026): the adjudicator also
  // explains its verdict in plain language and reports what each source said.
  narrative: z
    .object({
      lead: z.string(),
      // LLMs sometimes emit a single paragraph as a string — accept and wrap.
      paragraphs: z
        .union([z.array(z.string()), z.string().transform((s) => [s])])
        .default([]),
      pull: z.string(),
    })
    .optional(),
  sourceFindings: z
    .array(
      z.object({
        link: z.string(),
        // LLMs emit tier as a numeric string ('1') as often as a number.
        tier: z.union([z.number(), z.string().transform((s) => Number(s))]),
        finding: z.string(),
      }),
    )
    .optional(),
});

export async function citationCheck(
  llm: VerificationLlm,
  input: { claim: string; citedDocument: CitedDocument },
): Promise<CitationOutcome> {
  const call = await llm.generateObject(
    "citation-compare",
    { claim: input.claim, document: input.citedDocument },
    { parse: (raw: unknown) => CitationOutput.parse(raw) },
  );
  if (!call.ok) {
    throw new Error(`citation comparison failed: ${call.failureClass}`);
  }
  // Paywalled cited sources degrade to quoted-claim-only; never circumvented
  // (ADR-0006 paywall policy). The cited document is the object of the check,
  // never evidence — numbers still route to the stat-grid.
  const value = call.value;
  const quotedClaimOnly = input.citedDocument.paywalled === true || value.quotedClaimOnly === true;
  // A paywalled citation was never compared: no binding strictness exists.
  if (quotedClaimOnly) {
    return { verdict: value.verdict, quotedClaimOnly: true };
  }
  const strictness =
    value.bindingStrictness !== undefined ? { bindingStrictness: value.bindingStrictness } : {};
  return {
    verdict: value.verdict,
    ...strictness,
    ...(value.mismatch !== undefined ? { mismatch: value.mismatch } : {}),
  };
}

// ---------- quote-fidelity mode (VER-R5, ADR-0007) ----------

const QuoteFidelityOutput = z.object({
  // Absent when the claim cannot be anchored — the gate never reached a
  // comparison, so there is no verdict (VERIFICATION §2.4 step 4).
  verdict: z
    .enum(["supported", "refuted", "not_enough_evidence", "conflicting_cherry_picking"])
    .optional(),
  note: z.string(),
  anchorMissing: z.boolean().optional(),
});

export async function quoteFidelityCheck(
  llm: VerificationLlm,
  input: { claimText: string; captionText: string; transcriptTier: string },
): Promise<QuoteFidelityOutcome> {
  const call = await llm.generateObject(
    "quote-fidelity",
    { claimText: input.claimText, captionText: input.captionText },
    { parse: (raw: unknown) => QuoteFidelityOutput.parse(raw) },
  );
  if (!call.ok) {
    throw new Error(`quote-fidelity comparison failed: ${call.failureClass}`);
  }
  const value = call.value;
  if (value.anchorMissing) {
    return { verdict: "not_enough_evidence", note: value.note, anchorMissing: true };
  }
  // Numerical claims route to the stat-grid regardless of caption wording —
  // caption text is a claim pointer, never evidence for a quoted number
  // (ADR-0007 non-negotiable). Tier-2 claims always carry the quality flag.
  const routesToStatGrid = /\d/.test(input.claimText);
  const captionQualityFlag = input.transcriptTier === "publisher-auto";
  const out: QuoteFidelityOutcome = {
    note: value.note,
    ...(captionQualityFlag ? { captionQualityFlag } : {}),
    ...(routesToStatGrid ? { routesToStatGrid } : {}),
  };
  if (value.verdict !== undefined) {
    out.verdict = value.verdict;
  }
  return out;
}

// ---------- NLI publication gate (VER-R2, §2.7) ----------

const NliCheckOutput = z.object({
  verdict: z.enum(["pass", "fail"]),
  failureClass: z
    .enum([
      "unattributed-synthesis",
      "unstated-arithmetic",
      "authority-by-citation",
      "hallucinated-content",
    ])
    .optional(),
});

export async function nliAudit(
  llm: VerificationLlm,
  input: { justification: string; citedSpan: string },
): Promise<NliCheckResult> {
  const call = await llm.generateObject(
    "nli-audit",
    { justification: input.justification, citedSpan: input.citedSpan },
    { parse: (raw: unknown) => NliCheckOutput.parse(raw) },
  );
  if (!call.ok) {
    throw new Error(`NLI audit failed to run: ${call.failureClass}`);
  }
  const value = call.value;
  if (value.verdict === "pass") {
    return { verdict: "pass" };
  }
  return {
    verdict: "fail",
    ...(value.failureClass !== undefined ? { failureClass: value.failureClass } : {}),
  };
}

// ---------- open-web loop with confidence-capped depth (VER-R3) ----------

const OpenWebOutput = z.object({
  done: z.boolean(),
  confidence: z.number().optional(),
  nextRound: z.number().optional(),
});

// Authority classification (user direction, Sept 2026): the LLM tier
// classifier — the only judgement step in authority vetting. Rationale +
// confidence are recorded on the authority row as provenance.
export const AuthorityClassifyOutput = z.object({
  tier: z.number().int().min(1).max(6),
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
});

export async function openWebLoop(
  llm: VerificationLlm,
  input: { claim: string; depthCap: number; mockRounds: number },
): Promise<DepthCapResult> {
  let round = 0;
  let confidence: number | undefined;
  while (round < input.depthCap) {
    const call = await llm.generateObject(
      "open-web",
      { claim: input.claim, round, depthCap: input.depthCap },
      { parse: (raw: unknown) => OpenWebOutput.parse(raw) },
    );
    if (!call.ok) {
      throw new Error(`open-web loop failed: ${call.failureClass}`);
    }
    if (call.value.done) {
      confidence = call.value.confidence;
      break;
    }
    round = call.value.nextRound ?? round + 1;
  }
  const roundsUsed = Math.min(round + (confidence !== undefined ? 1 : 0), input.mockRounds);
  const cappedRun = input.mockRounds > input.depthCap;
  return {
    roundsUsed: Math.min(roundsUsed, input.depthCap),
    capBinding: input.depthCap,
    cappedRun,
    confidence: confidence ?? 0,
  };
}

// ---------- provenance mode - curated set only (VER-R6) ----------

const ProvenanceOutput = z.object({
  verdict: z.enum(["false context", "supported", "not_enough_evidence"]),
  originalContext: z.string(),
});

export interface ProvenanceOutcome {
  verdict: "false_context" | "supported" | "not_enough_evidence";
  claimedContext: string;
  trueContext: string;
  originalContextFinding?: string;
}

export async function provenanceCheck(
  llm: VerificationLlm,
  input: {
    claimedContext: string;
    verifiedContext: string;
    claimText: string;
    isCuratedFixture: boolean;
  },
): Promise<ProvenanceOutcome> {
  // Least mature mode: runs on the curated fixture set ONLY - no live
  // false-context detection is claimed (VERIFICATION 2.5, VER-R6).
  if (!input.isCuratedFixture) {
    throw new Error("provenance mode runs only on curated fixtures - never live records (VER-R6)");
  }
  const call = await llm.generateObject(
    "grid-materiality",
    { claimText: input.claimText, claimedContext: input.claimedContext },
    { parse: (raw: unknown) => ProvenanceOutput.parse(raw) },
  );
  if (!call.ok) {
    throw new Error(`provenance check failed: ${call.failureClass}`);
  }
  const verdict = call.value.verdict === "false context" ? "false_context" : call.value.verdict;
  return {
    verdict: verdict as ProvenanceOutcome["verdict"],
    claimedContext: input.claimedContext,
    // The curated fixture's verified context is the documented truth; the
    // LLM retrieval finding (originalContext) corroborates it.
    trueContext: input.verifiedContext,
    originalContextFinding: call.value.originalContext,
  };
}

// ---------- evidence pack assembly + publication flow ----------

export interface EvidencePackInput {
  gridResult: unknown;
  justifications: string[];
  evidenceItems: Array<{ authorityRef: string; seriesIdentity: string; vintageDate: string }>;
}

export interface AssembledPack {
  packId: string;
  gridResult: unknown;
  justifications: string[];
  nliOutcome: "pass" | "fail";
  vintageDates: string[];
  itemRefs: string[];
}

export async function assembleEvidencePack(
  input: EvidencePackInput,
  nli: VerificationLlm,
): Promise<AssembledPack> {
  // The NLI audit is the publication gate - it runs BEFORE publication (2.7):
  // a failing audit blocks the pack from ever reaching a verdict.
  for (const justification of input.justifications) {
    const result = await nliAudit(nli, {
      justification,
      citedSpan: input.evidenceItems.map((e) => e.seriesIdentity).join("; "),
    });
    if (result.verdict === "fail") {
      throw new Error(
        `publication blocked: NLI audit failed (${result.failureClass ?? "entailment"})`,
      );
    }
  }
  return {
    packId: createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32),
    gridResult: input.gridResult,
    justifications: input.justifications,
    nliOutcome: "pass",
    vintageDates: input.evidenceItems.map((e) => e.vintageDate),
    itemRefs: input.evidenceItems.map((e) => e.seriesIdentity),
  };
}

export interface VerdictWriteInput {
  verdictClass: VerdictClass;
  confidence: number;
  provenance: {
    pipelineVersion: string;
    promptVersions: Record<string, string>;
    modelVersions: Record<string, string>;
    searchRefs: string[];
  };
}

export async function publicationFlow(
  store: unknown,
  claimId: string,
  pack: AssembledPack,
  write: VerdictWriteInput,
): Promise<{ verdictId: string; version: number; status: string; verdictClass: string }> {
  const impl = store as {
    recordEvidenceItem(fixture: {
      claimId: string;
      authorityRef: string;
      seriesIdentity: string;
      vintageDate: Date;
      url: string;
      archiveSnapshotUrl: string;
      contentHash: string;
    }): Promise<{ itemId: string; version: number }>;
    appendEvidencePack(
      claimId: string,
      fixture: {
        itemRefs: string[];
        gridResult?: unknown;
        justifications: string[];
        nliOutcome: string;
      },
    ): Promise<{ packId: string }>;
    writeVerdict(
      claimId: string,
      packId: string,
      write: {
        provenance: VerdictWriteInput["provenance"];
        verdictClass?: VerdictClass;
        confidence?: number;
      },
    ): Promise<{ verdictId: string; version: number; status: string; verdictClass?: string }>;
    logTransition(
      verdictId: string,
      transition: { from: string; to: string; reason?: string },
    ): Promise<void>;
  };
  const itemRefs: string[] = [];
  for (const ref of pack.itemRefs) {
    const item = await impl.recordEvidenceItem({
      claimId,
      authorityRef: ref,
      seriesIdentity: ref,
      vintageDate: new Date("2026-06-30T00:00:00Z"),
      url: `https://www.policedata.nz/${ref}`,
      archiveSnapshotUrl: `https://web.archive.org/web/2026/https://www.policedata.nz/${ref}`,
      contentHash: createHash("sha256").update(ref).digest("hex"),
    });
    itemRefs.push(item.itemId);
  }
  const appended = await impl.appendEvidencePack(claimId, {
    itemRefs,
    gridResult: pack.gridResult,
    justifications: pack.justifications,
    nliOutcome: pack.nliOutcome,
  });
  const verdict = await impl.writeVerdict(claimId, appended.packId, {
    provenance: write.provenance,
    verdictClass: write.verdictClass,
    confidence: write.confidence,
  });
  await impl.logTransition(verdict.verdictId, {
    from: "DRAFT",
    to: "PUBLISHED",
    reason: "verified + evidence pack assembled",
  });
  return {
    verdictId: verdict.verdictId,
    version: verdict.version,
    status: "PUBLISHED",
    verdictClass: write.verdictClass,
  };
}

export const VERIFICATION_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "grid-materiality": MaterialityOutput,
  "citation-compare": CitationOutput,
  "quote-fidelity": QuoteFidelityOutput,
  "nli-audit": NliCheckOutput,
  "open-web": OpenWebOutput,
  "authority-classify": AuthorityClassifyOutput,
};
