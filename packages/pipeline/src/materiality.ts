// Materiality (ADR-0022): is this claim worth verifying at all?
//
// Triage decides two things today — whether a sentence is *checkable* (§2.2) and,
// through the attribute stage, whether it is *ours to check* (ADR-0019). Neither
// asks whether the claim MATTERS. A figure quoted in passing, with no policy
// topic and no argument around it, can be checkable, in scope, and yet change
// nothing that anyone is arguing about.
//
// The criterion below is deliberately structural and party-blind: it reads the
// argumentative CONTEXT and never the speaker or the party, so it cannot become
// a way of quietly deciding which side is worth checking. It is conservative —
// immaterial only when every signal is absent — because a filter that removes
// real claims is worse than one that lets an uninteresting claim through, and
// because the measured recall on the drop log would show it either way.

import type { ClaimContextBundle } from "./claim-context.ts";

/** Why a claim is (or is not) load-bearing to an argument. */
export type MaterialitySignal =
  | "attached-proposal"
  | "argument-direction"
  | "policy-topic"
  | "none"
  /** There was no window to read, so relevance could not be judged. */
  | "unassessed";

export interface MaterialityOutcome {
  material: boolean;
  signal: MaterialitySignal;
  /** A plain reason, for the drop log and the audit trail. */
  reason: string;
}

/**
 * A claim is material when it carries a stance, a proposal or a topic — the
 * three observable ways a claim is load-bearing to a position on policy. With
 * none of them there is nothing it could change, and it is set aside as
 * `inconsequential`: logged, counted and sampled like any other drop, never
 * silently discarded.
 */
export function assessMateriality(input: {
  claimType: string;
  context?: ClaimContextBundle | null;
  /**
   * False when there was no window to read. Absence of context is NOT evidence
   * of irrelevance: a claim whose passage we could not read must not be set
   * aside for saying nothing, or a context-extraction gap silently becomes a
   * claim filter. Fail open.
   */
  assessed?: boolean;
}): MaterialityOutcome {
  if (input.assessed === false) {
    return {
      material: true,
      signal: "unassessed",
      reason: "no passage to judge relevance from — kept",
    };
  }
  const context = input.context ?? {};
  if (context.attachedProposal) {
    return {
      material: true,
      signal: "attached-proposal",
      reason: "it was used in support of a proposal",
    };
  }
  if (context.argumentDirection != null) {
    return {
      material: true,
      signal: "argument-direction",
      reason: "it takes a side in an argument",
    };
  }
  if (context.topic) {
    return {
      material: true,
      signal: "policy-topic",
      reason: "it is about a policy topic",
    };
  }
  return {
    material: false,
    signal: "none",
    reason:
      "no policy topic, no proposal and no argumentative stance — nothing this could change, so it is not worth a verdict",
  };
}
