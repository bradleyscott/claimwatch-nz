// The planner (ADR-0023): a claim becomes a PLAN, not one of five modes.
//
// WHAT IS PRE-BUILT AND WHAT IS NOT. Procedures are pre-built, because an
// instrument has to be auditable, versioned and comparable — you cannot generate
// reproducibility per claim. The PLAN is not, because real claims are compound:
// ADR-0021 rule 5 requires that "was it said" and "is it true" be answered
// separately, and a single-mode column could hold only one of them.
//
// THE LIBRARY SUGGESTS; IT NEVER CONSTRAINS. `suggestProcedures` ranks
// procedures by how often past plans in the SAME CANONICAL CATEGORY used them.
// The planner may ignore the ranking entirely and add procedures the library has
// never seen. What it may not do is drop a procedure a claim's own features
// require — that is `planDefects`, and the floor exists because an omission is
// invisible in the output: a verdict from a plan that never looked at the number
// looks exactly like one whose number checked out.
//
// THE SUGGESTION KEY CARRIES NO SPEAKER. `PlanFeatures` has no speaker and no
// party field, and neither does this module's input. That is the same structural
// guarantee ADR-0022 rule 1 makes for materiality, for the same reason: a
// selection function that can see who said something can give one claim a
// different method from another. `discoveryQuery` makes the equivalent choice for
// the authority registry ("the same category always produces the same query,
// whoever claimed what about it"), and this follows it.
//
// IT LEARNS WHAT WAS DONE, NEVER WHAT WORKED. Usage frequency only. Feeding
// verdict outcomes back would optimise selection toward agreeing with the
// pipeline's own past assessments, turning whatever it is bad at into a
// convention.

import { PROCEDURE_LIBRARY_VERSION } from "@cw/llm";
import {
  type PlanFeatures,
  type PlanStep,
  requiredProcedureRefs,
  type VerificationPlan,
} from "@cw/store";

/** A library row, as much of it as planning needs. */
export interface ProcedureSummary {
  procedureRef: string;
  version: string;
  status: "active" | "retired";
  cannotEstablish: string;
}

/** One past plan, reduced to what the suggestion step may look at. */
export interface PastPlanUsage {
  category: string;
  procedureRefs: string[];
}

/**
 * Rank candidate procedures for a category, most-used first.
 *
 * Deliberately a plain frequency count over previously stored plans and nothing
 * cleverer. A learned scorer would have to be trained on something, and the only
 * outcome-like signal available is our own past verdicts — which would make the
 * library a machine for reproducing its own habits.
 *
 * Frequency is counted per PLAN, not per step, so a plan that ran a procedure
 * twice does not weight it twice. Proposals are sorted by (count desc, ref asc)
 * so the ranking is deterministic given the same history: two runs of the same
 * claim must not see different suggestions, or the plan diff between them becomes
 * noise.
 */
export function suggestProcedures(
  features: PlanFeatures,
  pastPlans: PastPlanUsage[],
  library: ProcedureSummary[],
): string[] {
  const counts = new Map<string, number>();
  for (const plan of pastPlans) {
    // Category match only. Matching on the claim text would let a claim's own
    // wording steer its method, which is the motivated-selection hazard.
    if (plan.category !== features.category) continue;
    for (const ref of new Set(plan.procedureRefs)) {
      counts.set(ref, (counts.get(ref) ?? 0) + 1);
    }
  }
  const active = new Set(library.filter((p) => p.status === "active").map((p) => p.procedureRef));
  return [...counts.entries()]
    .filter(([ref]) => active.has(ref))
    .sort(([aRef, aCount], [bRef, bCount]) => bCount - aCount || aRef.localeCompare(bRef))
    .map(([ref]) => ref);
}

/**
 * Work out what a claim structurally is, from its text and its category.
 *
 * The claim text is read for its own SHAPE — does it state a number, does it
 * quote someone — and never for who is speaking. `speakerHints` exists to make
 * that explicit at the call site rather than implied: a caller passing a name
 * into the claim text still does not get a speaker into the features.
 */
export function derivePlanFeatures(input: {
  category: string;
  claimText: string;
  /**
   * The kind triage assigned, where the caller knows it. Triage has already read
   * the sentence, so its type is a better signal than a pattern match here — and
   * for the document feature it is the only reliable one: a claim typed
   * `institution-citation` IS a claim resting on a document, whether or not the
   * sentence happens to contain the word "report".
   *
   * This was a text-only function on the first live run, and the omission was
   * visible: a claim typed `institution-citation` about a government action plan
   * produced `citesDocument: false`, so the document procedure was never required
   * and the plan had no step that could run.
   */
  claimType?: string | null;
  attachesToProposal?: boolean;
}): PlanFeatures {
  const text = input.claimText;
  const type = input.claimType ?? null;
  return {
    category: input.category,
    // A number claim is one typed `statistical`, or one that plainly contains a
    // figure. The text fallback stays because a caller with no triage behind it
    // still needs a sensible floor.
    assertsNumber: type === "statistical" || /\d/.test(text),
    // Quotation, or reported speech with an attribution verb. Deliberately
    // generous: a false positive costs one declined step with a reason, while a
    // false negative silently skips the attribution question.
    quotesPerson:
      type === "broadcast-quote" ||
      /["“”]/.test(text) ||
      /\b(said|says|stated|claimed|told|according to)\b/i.test(text),
    citesDocument:
      type === "citation-backed" ||
      type === "institution-citation" ||
      /\b(report|paper|review|study|briefing|submission|release|statement|data)\b/i.test(text),
    attachesToProposal: input.attachesToProposal ?? false,
  };
}

/** Plain words for what a feature requires, used in a step's recorded reason. */
const REQUIREMENT_REASONS: Record<string, string> = {
  "stat-grid": "the claim states a number, so the official figures were checked against it",
  "quote-fidelity":
    "the claim reports what someone said, so the wording was checked against the record",
  "citation-check": "the claim rests on a document, so the document was read",
};

export interface PlanInput {
  features: PlanFeatures;
  claimText: string;
  /** Procedures that could serve this claim, if the caller knows of any. */
  available?: ProcedureSummary[];
  /** How this category's past plans were built. Usage only, never outcomes. */
  pastPlans?: PastPlanUsage[];
  /**
   * Procedures the planner wants that the library has never suggested. This is
   * the seam that keeps the library from becoming a straitjacket: a caller (or a
   * planning model) may name a procedure that does not exist yet, and it appears
   * in the plan as a planner-sourced step.
   */
  proposed?: Array<{ procedureRef: string; procedureVersion: string; reason: string }>;
  /** What this plan will not attempt, in plain words (ADR-0023 §5). */
  notAttempted?: string[];
  /**
   * Procedures to consider but decline, with the reason. Required procedures may
   * be declined — that is an auditable decision — but only with a reason.
   */
  declines?: Array<{ procedureRef: string; reason: string }>;
}

/**
 * Build a claim's plan.
 *
 * Steps come from three places, and the order records why:
 *
 *  1. `required` — a procedure the claim's own features force to be decided on.
 *  2. `library` — a suggestion, ranked by past usage in this category.
 *  3. `planner` — anything else; the open-web research pass lives here, and so
 *     does any procedure the library has not seen.
 *
 * Every required procedure yields a step even when declined, because the plan is
 * the published record of what was considered. A decline without a reason is
 * rejected downstream rather than here, so the defect and its message live in one
 * place (`planDefects`).
 */
export function planForClaim(input: PlanInput): VerificationPlan {
  const { features } = input;
  const library = input.available ?? [];
  const versionOf = new Map(library.map((p) => [p.procedureRef, p.version]));
  const declines = new Map((input.declines ?? []).map((d) => [d.procedureRef, d.reason]));
  const steps: PlanStep[] = [];
  const seen = new Set<string>();

  const push = (step: PlanStep) => {
    if (seen.has(step.procedureRef)) return;
    seen.add(step.procedureRef);
    steps.push(step);
  };

  // 1. Required by the claim's own features. Always a step, even if declined.
  for (const ref of requiredProcedureRefs(features)) {
    const declineReason = declines.get(ref) ?? null;
    push({
      procedureRef: ref,
      procedureVersion: versionOf.get(ref) ?? "unversioned",
      reason: REQUIREMENT_REASONS[ref] ?? "the claim's features require this procedure",
      source: "required",
      status: declineReason == null ? "planned" : "declined",
      declineReason,
      outcome: null,
    });
  }

  // 2. Suggested by past plans in this category. Suggestions are additive: a
  //    suggestion that duplicates a required step is dropped, not replaced.
  const suggested = suggestProcedures(features, input.pastPlans ?? [], library);
  for (const ref of suggested) {
    const declineReason = declines.get(ref) ?? null;
    push({
      procedureRef: ref,
      procedureVersion: versionOf.get(ref) ?? "unversioned",
      reason: "this category's past plans used it",
      source: "library",
      status: declineReason == null ? "planned" : "declined",
      declineReason,
      outcome: null,
    });
  }

  // 3. Named by the planner. This is where a plan reaches past the library.
  for (const proposal of input.proposed ?? []) {
    const declineReason = declines.get(proposal.procedureRef) ?? null;
    push({
      procedureRef: proposal.procedureRef,
      procedureVersion: proposal.procedureVersion,
      reason: proposal.reason,
      source: "planner",
      status: declineReason == null ? "planned" : "declined",
      declineReason,
      outcome: null,
    });
  }

  // Declining something nobody else proposed still has to appear: "we considered
  // this and did not run it" is a statement the page makes, and it cannot make it
  // about a step that is absent.
  for (const [ref, reason] of declines) {
    push({
      procedureRef: ref,
      procedureVersion: versionOf.get(ref) ?? "unversioned",
      reason: "considered for this claim",
      source: library.some((p) => p.procedureRef === ref) ? "library" : "planner",
      status: "declined",
      declineReason: reason,
      outcome: null,
    });
  }

  // A plan with nothing to RUN is not a plan. The research pass is always
  // available, and it is the honest floor: it is the only procedure that can act
  // on a claim whose shape nothing else matches.
  //
  // The test is "nothing runnable", not "no steps". A plan can carry steps and
  // still be unrunnable — every one of them declined, which is the live lane's
  // actual case: a claim with no registered authority gets `stat-grid` declined
  // and would otherwise be stored as a plan that ran nothing, with the research
  // pass that produced the verdict missing from the record entirely.
  const runnable = steps.filter((step) => step.status !== "declined");
  if (runnable.length === 0) {
    push({
      procedureRef: "open-web-research",
      procedureVersion: versionOf.get("open-web-research") ?? "unversioned",
      reason:
        steps.length === 0
          ? "no other procedure applies to this claim, so it was researched"
          : "every other procedure was declined for this claim, so it was researched instead",
      source: "planner",
      status: "planned",
      declineReason: null,
      outcome: null,
    });
  }

  return {
    libraryVersion: PROCEDURE_LIBRARY_VERSION,
    features,
    steps,
    notAttempted: input.notAttempted ?? [],
  };
}
