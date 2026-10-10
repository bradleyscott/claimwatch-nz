// The adversarial research loop's stored record (ADR-0026), as
// `evidence_pack.research` holds it.
//
// It lives in `@cw/store` because pipeline writes it and the site reads it, and
// neither may import the other (AGENTS.md boundaries): one shape, one parse, so
// the plan the pipeline recorded and the plan the page renders cannot drift.

import { z } from "zod";

export const RESEARCH_VERDICT_CLASSES = [
  "supported",
  "refuted",
  "not_enough_evidence",
  "conflicting_cherry_picking",
] as const;
export type ResearchVerdictClass = (typeof RESEARCH_VERDICT_CLASSES)[number];

export const ResearchEvidence = z.object({
  url: z.string(),
  title: z.string(),
  domain: z.string(),
  /** The verbatim passage from the page. */
  passage: z.string(),
  /** Source tier (1–6) when classified; null when not. */
  tier: z.number().nullable().default(null),
});
export type ResearchEvidence = z.infer<typeof ResearchEvidence>;

/** The assessor's plan: what would settle the claim, the questions, and where the evidence lives. */
export const ResearchPlanRecord = z.object({
  evidencePlan: z.string(),
  questions: z.array(z.string()).default([]),
  sources: z.array(z.string()).default([]),
});
export type ResearchPlanRecord = z.infer<typeof ResearchPlanRecord>;

export const ResearchCritiqueRecord = z.object({
  sufficient: z.boolean(),
  verdictClass: z.enum(RESEARCH_VERDICT_CLASSES),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  gaps: z.array(z.string()).default([]),
  justifications: z.array(z.string()).default([]),
});
export type ResearchCritiqueRecord = z.infer<typeof ResearchCritiqueRecord>;

export const ResearchToolCallRecord = z.object({
  toolName: z.string(),
  input: z.unknown(),
  resultSummary: z.string(),
});
export type ResearchToolCallRecord = z.infer<typeof ResearchToolCallRecord>;

export const ResearchTurnRecord = z.object({
  round: z.number().int().nonnegative(),
  plan: ResearchPlanRecord,
  /** The researcher's strategy for this turn. */
  strategy: z.string().default(""),
  /** The searches the researcher chose and ran this turn. */
  queries: z.array(z.string()).default([]),
  /** Every tool the researcher called this turn, for audit. */
  toolCalls: z.array(ResearchToolCallRecord).default([]),
  evidenceFound: z.array(ResearchEvidence).default([]),
  critique: ResearchCritiqueRecord,
});
export type ResearchTurnRecord = z.infer<typeof ResearchTurnRecord>;

export const ResearchLoopRecord = z.object({
  turns: z.array(ResearchTurnRecord).default([]),
  turnsUsed: z.number().int().nonnegative(),
  /** The hard turn backstop that was in force; `capped` says whether it bound. */
  capBinding: z.number().int().nonnegative(),
  capped: z.boolean(),
  /**
   * Why the loop stopped: the evidence settled the claim, the research budget ran
   * out, or the hard backstop did (ADR-0026). Defaulted, so a record written
   * before the budget existed still parses.
   */
  stopReason: z.enum(["sufficient", "budget", "cap"]).default("sufficient"),
  /** The research budget that was in force, in USD; null when none applied. */
  budgetUsd: z.number().nonnegative().nullable().default(null),
  /** What the loop spent on model calls, in USD; null when it was not measured. */
  spentUsd: z.number().nonnegative().nullable().default(null),
  /** The published reason — the critiquer's, or the cap's. */
  reason: z.string(),
  /** Class-agreement state for the published class (VER-R16). */
  agreement: z
    .object({
      agreed: z.boolean(),
      classes: z.array(z.string()).default([]),
    })
    .default({ agreed: true, classes: [] }),
});
export type ResearchLoopRecord = z.infer<typeof ResearchLoopRecord>;
export type ResearchLoopRecordInput = z.input<typeof ResearchLoopRecord>;
