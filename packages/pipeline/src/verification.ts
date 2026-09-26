// VERIFICATION: claim records → verdict + confidence + evidence pack (ADR-0005).
// This module is the public surface; the implementation is split by mode under
// `verification/` (one file per mode) so no single file carries the whole engine.
//
// The stat grid is pre-declared and identical for every claimant (the
// anti-invented-standard defence); the LLM selects which rows are material —
// it never authors the grid. Class boundaries are arithmetic (VERIFICATION
// §2.2): robust → supported · material alternatives contradict → cherry-picking
// · number matches nothing → refuted · no canonical series → NEI.

export { GRID_AXES_VERSION } from "@cw/llm";
export * from "./verification/agreement.ts";
export * from "./verification/authority.ts";
export * from "./verification/citation.ts";
export * from "./verification/nli.ts";
export * from "./verification/open-web.ts";
export * from "./verification/pack.ts";
export * from "./verification/provenance.ts";
export * from "./verification/quote.ts";
export * from "./verification/schemas.ts";
export * from "./verification/stat-grid.ts";
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
