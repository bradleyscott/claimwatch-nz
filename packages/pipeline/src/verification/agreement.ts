// Class-agreement gate (Sept 2026): when no sampling knob can pin the sampler,
// pin the decision — publish a class only when two runs agree.

import type { VerdictClass } from "../verification-api.ts";

// ---------- class-agreement gate (Sept 2026) ----------

export interface ClassAgreement<T> {
  /** True when every attempt produced the same verdict class. */
  agreed: boolean;
  /** How many deciding runs were made. */
  attempts: number;
  /**
   * The FIRST attempt's full outcome, present only when `agreed`. The first is
   * taken rather than an average or a vote because the published reason has to
   * come from a run whose class agreed with every other run — and picking the
   * first is a rule a reader can predict, where "whichever agreed" is not.
   */
  outcome?: T;
  /** Every class produced, in attempt order — the instability signal. */
  classes: VerdictClass[];
}

/**
 * Run the class-deciding step more than once and publish only if it agrees with
 * itself (Sept 2026).
 *
 * Why this exists rather than a sampling pin: the configured models discard the
 * sampling settings (`claude-sonnet-5` ignores `temperature`; the OpenRouter
 * model ignores `seed`), so identical input produced `not_enough_evidence` once
 * and `supported` twice on one claim, with the NLI gate passing every time. When
 * no knob can pin the sampler, the thing to pin is the DECISION — a class that
 * two independent runs agree on is a class the pipeline can defend, and a
 * disagreement is a measurement of how unstable that decision is.
 *
 * Cost is bounded by choice of where it is applied: on the verdict class only
 * (the low-volume step that produces what is published), not on triage, which
 * runs once per sentence per document and would multiply the dominant cost.
 *
 * A call that THROWS is not a disagreement — it propagates, so a provider failure
 * is never quietly recorded as instability.
 */
export async function agreeOnVerdictClass<T extends { verdictClass: VerdictClass }>(
  decide: (attempt: number) => Promise<T>,
  opts?: { attempts?: number },
): Promise<ClassAgreement<T>> {
  const attempts = Math.max(2, opts?.attempts ?? 2);
  const outcomes: T[] = [];
  for (let attempt = 0; attempt < attempts; attempt++) {
    outcomes.push(await decide(attempt));
  }
  const classes = outcomes.map((outcome) => outcome.verdictClass);
  const agreed = classes.every((cls) => cls === classes[0]);
  return {
    agreed,
    attempts,
    classes,
    ...(agreed ? { outcome: outcomes[0] } : {}),
  };
}
