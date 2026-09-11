// VERIFICATION L1 API surface (VERIFICATION.md §2). Authored red: types are
// real; bodies throw NOT IMPLEMENTED until the green phase lands. LLM stages
// (materiality selection, citation comparison, NLI audit, quote fidelity) run
// through the injectable VerificationLlm port and are mocked at L1.

import type { VerificationLlm } from "./verification-llm.ts";
import type { DiscourseContext, FingerprintTuple, ClaimType, VerificationMode } from "./triage-api.ts";

export type { DiscourseContext, FingerprintTuple, ClaimType, VerificationMode };

export type VerdictClass = "supported" | "refuted" | "not_enough_evidence" | "conflicting_cherry_picking";

export interface SeriesPoint {
  period: string;
  value: number;
}

export interface SeriesData {
  authorityRef: string;
  authorityTier: 1 | 2 | 3 | 4 | 5 | 6;
  seriesIdentity: string;
  unit: string;
  vintageDate: string;
  retrievedAt: string;
  archiveSnapshotUrl: string;
  points: SeriesPoint[];
  populationSeries?: { seriesIdentity: string; authorityTier: 1 | 2 | 3 | 4 | 5 | 6; vintageDate: string; points: SeriesPoint[] } | undefined;
}

export interface GridRow {
  axis: "window" | "per-capita" | "denominator" | "cohort" | "seasonality";
  variant: string;
  periods: [string, string] | null;
  percentChange: number | null;
}

export interface GridResult {
  rows: GridRow[];
  materialRows: string[];
  robust: boolean;
  claimQuantityPercent: number | null;
}

export interface StatGridOutcome {
  verdictClass: VerdictClass;
  grid: GridResult;
  matchedRow: string | null;
  asDeployed?: string;
  reason: string;
}

export interface StatGridInput {
  fingerprint: Partial<FingerprintTuple>;
  series: SeriesData;
  discourseContext?: Partial<DiscourseContext> | undefined;
}

export function computeStatGrid(_llm: VerificationLlm, _input: StatGridInput): never {
  throw new Error("NOT IMPLEMENTED: computeStatGrid (verification red phase)");
}

// ---------- series retrieval ----------

export interface EvidenceSeries {
  authorityRef: string;
  seriesIdentity: string;
  vintageDate: string;
  retrievedAt: string;
  url: string;
  archiveSnapshotUrl: string;
  contentHash: string;
  points: SeriesPoint[];
}

export function recordSeriesRetrieval(_input: { series: SeriesData; url: string }): never {
  throw new Error("NOT IMPLEMENTED: recordSeriesRetrieval (verification red phase)");
}

// ---------- authority map ----------

export interface AuthorityResolution {
  primary: string;
  note?: string;
}

export function resolveAuthority(_input: { domain: string; requestedSource: string; requestedTier: number }): never {
  throw new Error("NOT IMPLEMENTED: resolveAuthority (verification red phase)");
}

export function rejectAdvocacySource(_source: string): boolean {
  throw new Error("NOT IMPLEMENTED: rejectAdvocacySource (verification red phase)");
}

// ---------- citation-check mode ----------

export interface CitedDocument {
  source: string;
  authorityTier: number;
  text: string | null;
  paywalled?: boolean;
}

export interface CitationOutcome {
  verdict: VerdictClass;
  bindingStrictness: "direct" | "decorative";
  quotedClaimOnly?: boolean;
  mismatch?: string;
  reason?: string;
}

export function citationCheck(_llm: VerificationLlm, _input: { claim: string; citedDocument: CitedDocument }): never {
  throw new Error("NOT IMPLEMENTED: citationCheck (verification red phase)");
}

// ---------- quote-fidelity mode ----------

export interface QuoteFidelityOutcome {
  verdict: VerdictClass;
  note: string;
  captionQualityFlag?: boolean;
  routesToStatGrid?: boolean;
  anchorMissing?: boolean;
}

export function quoteFidelityCheck(_llm: VerificationLlm, _input: { claimText: string; captionText: string; transcriptTier: string }): never {
  throw new Error("NOT IMPLEMENTED: quoteFidelityCheck (verification red phase)");
}

// ---------- NLI publication gate ----------

export interface NliCheckResult {
  verdict: "pass" | "fail";
  failureClass?: "unattributed-synthesis" | "unstated-arithmetic" | "authority-by-citation" | "hallucinated-content";
}

export function nliAudit(_llm: VerificationLlm, _input: { justification: string; citedSpan: string }): never {
  throw new Error("NOT IMPLEMENTED: nliAudit (verification red phase)");
}

// ---------- depth caps ----------

export interface DepthCapResult {
  roundsUsed: number;
  capBinding: number;
  cappedRun: boolean;
  confidence: number;
}

export function openWebLoop(_llm: VerificationLlm, _input: { claim: string; depthCap: number; mockRounds: number }): never {
  throw new Error("NOT IMPLEMENTED: openWebLoop (verification red phase)");
}