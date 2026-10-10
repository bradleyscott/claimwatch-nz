// Shapes for the adversarial research loop (ADR-0026). Declared separately from
// the loop so the site's reader and the store can depend on the shape without
// depending on the loop's implementation.

/**
 * The assessor's plan: what evidence would settle the claim, and the questions a
 * researcher should answer — including what would falsify it. The assessor does
 * not write search queries; the researcher chooses the strategy and the queries.
 */
export interface ResearchPlan {
  /** In plain words, what evidence would prove or disprove the claim. */
  evidencePlan: string;
  /** Sub-questions, including what would disprove the claim. */
  questions: string[];
  /** Where the evidence would live: institutions, datasets or domains to target. */
  sources: string[];
}

/** One orchestration step: the researcher's strategy, its queries, and whether it is done. */
export interface ResearchStep {
  /** Why these queries, and what the researcher expects to learn. */
  strategy: string;
  /** Searches to dispatch to subagents, in parallel. */
  queries: string[];
  /** True when the researcher judges it has gathered enough for this turn. */
  done: boolean;
}

export interface EvidenceRecord {
  url: string;
  title: string;
  domain: string;
  /** The shortest verbatim passage that speaks to the claim. */
  passage: string;
  /** Source tier (1–6) when the researcher classified it; null when not. */
  tier: number | null;
}

export type ResearchVerdictClass =
  | "supported"
  | "refuted"
  | "not_enough_evidence"
  | "conflicting_cherry_picking";

export interface ResearchCritique {
  sufficient: boolean;
  verdictClass: ResearchVerdictClass;
  confidence: number;
  reason: string;
  gaps: string[];
  /** One sentence per finding; each must be entailed by cited evidence. */
  justifications: string[];
}

/** One tool the researcher called, with a short summary of what came back. */
export interface ResearchToolCallRecord {
  toolName: string;
  input: unknown;
  resultSummary: string;
}

export interface ResearchTurn {
  round: number;
  plan: ResearchPlan;
  /** The researcher's strategy for this turn, in its own words. */
  strategy: string;
  /** Every search the researcher dispatched this turn. */
  queries: string[];
  /** Every tool the researcher called this turn, for audit. */
  toolCalls: ResearchToolCallRecord[];
  evidenceFound: EvidenceRecord[];
  critique: ResearchCritique;
}

/**
 * The loop's HARD backstop, not its policy: how long to keep looking is decided
 * by the research budget (`DEFAULT_RESEARCH_BUDGET_USD`), and this only stops a
 * run that cannot read its own spend. It is set well above what a budget would
 * buy, so reaching it means something is wrong rather than that the budget ran out.
 */
export const MAX_RESEARCH_TURNS = 20;
/**
 * The default research budget, in USD, for one claim (ADR-0026). The loop keeps
 * researching until its model spend reaches this, so a claim that needs more
 * looking gets it and a claim that settles early stops early. Cost is computed
 * from the versioned price map, never from a provider's own figure.
 */
export const DEFAULT_RESEARCH_BUDGET_USD = 0.25;
/** Searches across one turn. */
export const MAX_SEARCHES_PER_TURN = 6;
/** Orchestrator decisions per turn (plan → dispatch → read → decide …). */
export const MAX_RESEARCH_STEPS_PER_TURN = 3;
/** Pages one subagent fetches and extracts for its query. */
export const MAX_FETCHES_PER_SUBAGENT = 4;
/** Link-following hops one subagent takes after its first extraction. */
export const MAX_SUBAGENT_HOPS = 1;
