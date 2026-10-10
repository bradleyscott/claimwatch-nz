// The decision stage (ADR-0024): run a closed-vocabulary classification through
// the decision port, take the confident answers, and escalate the rest to the
// generative model in ONE batched call.
//
// WHY ONE BATCHED ESCALATION AND NOT PER-ITEM. The escalation is the expensive
// path, and the per-sentence classification stages are exactly where a per-item
// call would reintroduce the fan-out the chunking exists to bound. So the
// marginal items are collected and handed to the generative stage together — the
// same call shape the all-generative path already uses.
//
// A DECISION OUTAGE DEGRADES, IT DOES NOT THROW. A failed call escalates every
// item rather than guessing, so an outage costs money and latency, never
// correctness (ADR-0024 §4). The `degraded` flag is explicit so a caller cannot
// confuse it with a document whose sentences were all confident.

import type {
  DecisionAnswer,
  DecisionPort,
  DecisionQuestion,
  DecisionRole,
} from "./decision-port.ts";

/**
 * The escalation threshold (ADR-0024): a published criterion, which moves only
 * with a measured calibration curve behind it. It is the value the routed role
 * was measured at — `triage-checkability` settles 57% of eligible sentences at
 * 96.0% accuracy at 0.70 — not a round number chosen for comfort. A higher bar
 * settles fewer items and escalates more, which costs money rather than
 * accuracy.
 */
export const DECISION_THRESHOLD = 0.7;

/** The scalar confidence of an answer: `noul` carries its probability, the others a `confidence`. */
export function confidenceOf(answer: DecisionAnswer): number {
  return answer.type === "noul" ? answer.noul : answer.confidence;
}

export interface DecisionStageResult<R> {
  byId: Map<string, R>;
  /** Items the decision model answered above the threshold. */
  settled: number;
  /** Items escalated to the generative model (marginal, name-needed, or all on outage). */
  escalated: number;
  /** The decision call failed; every item took the generative path. */
  degraded: boolean;
  /** The model the provider ACTUALLY served, for provenance (may be a dated pin). */
  model: string | null;
  provider: string | null;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Decide a set of items with a decision model, escalating the marginal ones.
 *
 * `questionFor` returns the questions for one item, keyed by a name that is
 * unique across the whole set (Jev's answers are keyed by question name, so two
 * items must not both use `"class"`). An item escalates when any of its answers
 * is missing, below `threshold`, or flagged by `needsEscalation` — which is how a
 * settled `quoted-actor` still reaches the generative model for the attribution
 * NAME, since no decision primitive produces free text.
 */
export async function runDecisionStage<T extends { id: string }, R>(input: {
  port: DecisionPort;
  role: DecisionRole;
  items: T[];
  /** The state the questions are asked about. Names must match the instructions. */
  stateFor: (items: T[]) => Record<string, unknown>;
  questionFor: (item: T) => Record<string, DecisionQuestion>;
  settle: (item: T, answers: Record<string, DecisionAnswer>) => R;
  needsEscalation?: (item: T, answers: Record<string, DecisionAnswer>) => boolean;
  escalate: (items: T[]) => Promise<Map<string, R>>;
  threshold?: number;
}): Promise<DecisionStageResult<R>> {
  const threshold = input.threshold ?? DECISION_THRESHOLD;
  const byId = new Map<string, R>();
  if (input.items.length === 0) {
    return {
      byId,
      settled: 0,
      escalated: 0,
      degraded: false,
      model: null,
      provider: null,
      tokensIn: 0,
      tokensOut: 0,
    };
  }

  const questions: Record<string, DecisionQuestion> = {};
  const namesById = new Map<string, string[]>();
  for (const item of input.items) {
    const forItem = input.questionFor(item);
    namesById.set(item.id, Object.keys(forItem));
    Object.assign(questions, forItem);
  }

  const call = await input.port.decide({
    role: input.role,
    state: input.stateFor(input.items),
    questions,
  });

  if (!call.ok) {
    const escalated = await input.escalate(input.items);
    for (const [id, value] of escalated) byId.set(id, value);
    return {
      byId,
      settled: 0,
      escalated: input.items.length,
      degraded: true,
      model: null,
      provider: null,
      tokensIn: 0,
      tokensOut: 0,
    };
  }

  const marginal: T[] = [];
  let settled = 0;
  for (const item of input.items) {
    const names = namesById.get(item.id) ?? [];
    const answers: Record<string, DecisionAnswer> = {};
    let complete = true;
    let minConfidence = 1;
    for (const name of names) {
      const answer = call.answers[name];
      if (answer == null) {
        complete = false;
        break;
      }
      answers[name] = answer;
      minConfidence = Math.min(minConfidence, confidenceOf(answer));
    }
    if (!complete || minConfidence < threshold || input.needsEscalation?.(item, answers) === true) {
      marginal.push(item);
      continue;
    }
    byId.set(item.id, input.settle(item, answers));
    settled += 1;
  }

  if (marginal.length > 0) {
    const escalated = await input.escalate(marginal);
    for (const [id, value] of escalated) byId.set(id, value);
  }

  return {
    byId,
    settled,
    escalated: marginal.length,
    degraded: false,
    model: call.model,
    provider: call.provider,
    tokensIn: call.usage.tokensIn,
    tokensOut: call.usage.tokensOut,
  };
}
