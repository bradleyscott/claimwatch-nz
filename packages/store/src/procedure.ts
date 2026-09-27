// Verification plans and the procedure library (ADR-0023).
//
// A claim's check is a PLAN: an ordered list of STEPS, each invoking a procedure
// or an open-web research pass. This module is the single definition of both
// shapes, and it lives in `@cw/store` for the same reason `triage-record.ts`
// does: pipeline may import store, the site may only import store, and store
// imports neither. A shape declared in pipeline would have to be redeclared in
// the reader with nothing to catch the drift — which is exactly what happened to
// the fingerprint, where `@cw/store`'s `Fingerprint` was
// {@link indicator,population,geography,timeWindow,baseline,unit} and the
// pipeline's `FingerprintTuple` was something else entirely.
//
// WHY THE LIBRARY IS DATA AND NOT A SWITCH STATEMENT. ADR-0005 chose an emergent
// evidence store over pre-computed topic packs, because "precomputation bets on a
// prediction that cannot be checked in advance". The five modes were the same bet
// applied to methods: a fixed taxonomy written before any claim arrived. So the
// five survive here as the library's SEEDED rows, and the population grows.
//
// WHAT IS FIXED AND WHAT IS NOT. The fixed part is this shape — declared
// `consumes`/`produces` so two procedures can be compared, and a stated
// `cannotEstablish` bound so a reader is never invited to read a finding as
// covering more than it does. The emergent part is which rows exist. A procedure
// may compute anything; it may NOT define its own thresholds. Tolerances and
// admissibility tiers are published criteria that live in code (ADR-0004,
// ADR-0020) and are referenced, never owned.

import { z } from "zod";

/** Whether a step computes from evidence we hold, or goes and retrieves. */
export const PROCEDURE_KINDS = ["deterministic", "research"] as const;
export type ProcedureKind = (typeof PROCEDURE_KINDS)[number];

/** `retired` is a status, never a deletion: the library is append-only history. */
export const PROCEDURE_STATUSES = ["active", "retired"] as const;

/**
 * The five procedures the library is seeded with (ADR-0023 §1). These were the
 * five verification modes; each keeps its implementation and its published
 * description. What changed is their status: one entry in a set that can grow,
 * not one of five possible answers.
 *
 * Named `SEEDED_` and not `PROCEDURES` on purpose — a consumer that treats this
 * list as the set of available procedures has reintroduced the taxonomy.
 */
export const SEEDED_PROCEDURE_REFS = [
  "stat-grid",
  "citation-check",
  "quote-fidelity",
  "provenance",
  "open-web-research",
] as const;

/**
 * Why a step is in the plan. `required` is the floor ADR-0023 §4 imposes: a
 * claim's own features (it asserts a number, it quotes someone, it cites a
 * document) force the corresponding procedure to be *decided on*. The step may be
 * declined, but the decision and its reason are then recorded. A dropped
 * requirement with a reason is an auditable decision; one without a reason is a
 * defect.
 */
export const PLAN_STEP_SOURCES = ["required", "library", "planner"] as const;
export type PlanStepSource = (typeof PLAN_STEP_SOURCES)[number];

/**
 * `declined` is a first-class outcome and the reason the plan is worth
 * publishing: it is how the page can say "this was considered and not run"
 * instead of saying nothing, which would imply coverage.
 */
export const PLAN_STEP_STATUSES = ["planned", "ran", "declined", "failed"] as const;
export type PlanStepStatus = (typeof PLAN_STEP_STATUSES)[number];

export const PlanStep = z.object({
  procedureRef: z.string().min(1),
  /** The procedure version the plan pinned. Free-form so a retired version stays legible. */
  procedureVersion: z.string().min(1),
  /** Why this step is here, in the planner's words. Rendered on the page. */
  reason: z.string().min(1),
  source: z.enum(PLAN_STEP_SOURCES),
  status: z.enum(PLAN_STEP_STATUSES),
  /** Required when `status` is `declined`, enforced below. */
  declineReason: z.string().nullable().default(null),
  /** The class this step reached, when it ran. Null for a declined or failed step. */
  outcome: z.string().nullable().default(null),
});
export type PlanStep = z.infer<typeof PlanStep>;

/**
 * The features the planner is allowed to see (ADR-0023 §3). Note what is
 * ABSENT: no speaker, no party, no attribution. The same guarantee ADR-0022 rule
 * 1 makes for materiality — "that is a structural guarantee, not a promise" —
 * and for the same reason: a selection function that can see who said something
 * can give the same claim a different method depending on the speaker.
 *
 * This is the input to the library's suggestion step, so it must stay
 * speaker-free even if a caller has a speaker to hand.
 */
export const PlanFeatures = z.object({
  /** The canonical category key (`canonicalDomain`), not the claim text. */
  category: z.string().min(1),
  assertsNumber: z.boolean(),
  quotesPerson: z.boolean(),
  citesDocument: z.boolean(),
  attachesToProposal: z.boolean(),
});
export type PlanFeatures = z.infer<typeof PlanFeatures>;

export const VerificationPlan = z.object({
  /** `PROCEDURE_LIBRARY_VERSION` — which library state suggested this plan. */
  libraryVersion: z.string().min(1),
  features: PlanFeatures,
  steps: z.array(PlanStep).min(1),
  /**
   * What this plan did not attempt, in plain words, decided per claim — as
   * opposed to a per-mode disclaimer printed on every page (ADR-0023 §5). The
   * distinction matters: boilerplate is ignored, while an omission the plan
   * itself names is a statement a reader can argue with.
   */
  notAttempted: z.array(z.string()).default([]),
});
export type VerificationPlan = z.infer<typeof VerificationPlan>;

/** A procedure library row. Fixed shape, emergent population (ADR-0023 §2). */
export const ProcedureRecord = z.object({
  procedureRef: z.string().min(1),
  version: z.string().min(1),
  kind: z.enum(PROCEDURE_KINDS),
  title: z.string().min(1),
  consumes: z.array(z.string()),
  produces: z.array(z.string()),
  cannotEstablish: z.string().min(1),
  rationale: z.string().min(1),
  discoveredBy: z.string().min(1),
  searchRefs: z.array(z.string()).default([]),
  status: z.enum(PROCEDURE_STATUSES).default("active"),
});
export type ProcedureRecord = z.infer<typeof ProcedureRecord>;
/**
 * The write shape: `searchRefs` and `status` default, so a caller declaring a
 * procedure does not restate them. `z.infer` is the OUTPUT type, where defaults
 * are filled — a distinction that cost a compile error here the first time.
 */
export type ProcedureRecordInput = z.input<typeof ProcedureRecord>;

/**
 * The library's seeded rows. `discoveredBy: "seed"` matches the authority
 * seeds' convention (`0001_seeds.sql`), so a reader of the table can tell a
 * designed entry from one the pipeline found.
 *
 * `cannotEstablish` restates each procedure's published bound, and is the
 * internal counterpart of the site's reader-facing copy. The two registers are
 * deliberately different text for the same limit (SITE-MVP §2.2); they must not
 * be collapsed into one string.
 */
export const SEEDED_PROCEDURES: ProcedureRecordInput[] = [
  {
    procedureRef: "stat-grid",
    version: "stat-grid@1",
    kind: "deterministic",
    title: "Official figures",
    consumes: ["claim text", "official series", "series vintage date"],
    produces: ["grid readings", "verdict class", "matched row"],
    cannotEstablish:
      "Show that one thing caused another. It can show that two things changed at the same time; it cannot show that one caused the other.",
    rationale:
      "The flagship class this project exists for: a true number used selectively. The readings are pre-declared and identical for every speaker, and the arithmetic is pure logic, so the standard cannot be invented after seeing the claim.",
    discoveredBy: "seed",
  },
  {
    procedureRef: "citation-check",
    version: "citation-check@1",
    kind: "deterministic",
    title: "The source it cites",
    consumes: ["claim text", "cited document"],
    produces: ["claim-against-source finding", "binding strictness"],
    cannotEstablish:
      "Judge a document it cannot get. If the cited source is paywalled or unreachable, the claim is checked against its own wording and nothing else.",
    rationale:
      "The cited document is the object of the check, never the evidence for the claim: a source that does its own arithmetic is checked against the official figures instead.",
    discoveredBy: "seed",
  },
  {
    procedureRef: "quote-fidelity",
    version: "quote-fidelity@1",
    kind: "deterministic",
    title: "The recording",
    consumes: ["claim text", "stored caption text", "cue span"],
    produces: ["wording finding", "caption quality flag"],
    cannotEstablish:
      "Check a quotation that appears in no published record. If the words cannot be found, the page says so — it does not say the person was misreported.",
    rationale:
      "Comparison is against the record we hold, never against the audio: no self-generated transcription exists, so an automatic-caption error must not be reported as a misquotation.",
    discoveredBy: "seed",
  },
  {
    procedureRef: "provenance",
    version: "provenance@1",
    kind: "research",
    title: "The context it carries",
    consumes: ["claim text", "stored discourse window"],
    produces: ["true context", "claimed context"],
    cannotEstablish:
      "Say why someone attached it wrongly. The record can show which event something comes from; it cannot show anyone's intent.",
    rationale:
      "Decontextualisation is the dominant verified-disinformation class. Least mature procedure: runs on the curated fixture set only, with no live detection claimed.",
    discoveredBy: "seed",
  },
  {
    procedureRef: "open-web-research",
    version: "open-web-research@1",
    kind: "research",
    title: "Open-web research",
    consumes: ["claim text", "jurisdiction", "claim context"],
    produces: ["sources", "gaps", "verdict signal"],
    cannotEstablish:
      "Find a fact nobody has published, or show that one thing caused another. It reports what is published and where the searching stopped: no evidence is reported as no evidence, never as proof the claim is false.",
    rationale:
      "Question decomposition beats claim-string search. Every claim gets a real research pass before any verdict, and every pass runs at least one search aimed at refuting the claim.",
    discoveredBy: "seed",
  },
];

/**
 * The procedures a claim's own features force the planner to DECIDE ON
 * (ADR-0023 §4). This is a floor, not a fixed plan: the planner may add any step
 * it likes, including procedures absent from the library, but it may not silently
 * drop one of these.
 *
 * A dropped requirement with a reason is an auditable decision. One without a
 * reason is a defect, and {@link planDefects} is what distinguishes them.
 */
export function requiredProcedureRefs(features: PlanFeatures): string[] {
  const required: string[] = [];
  if (features.assertsNumber) required.push("stat-grid");
  if (features.quotesPerson) required.push("quote-fidelity");
  if (features.citesDocument) required.push("citation-check");
  return required;
}

/**
 * Every way a plan can be wrong, as plain sentences. Empty means valid.
 *
 * Two rules, both from ADR-0023 §4, and both checked here rather than trusted to
 * the planner's care:
 *
 *  1. Every required procedure has a step. Without this a plan that forgot to
 *     consider the figure a claim rests on looks exactly like a plan that
 *     considered and dismissed it, and nothing downstream can tell them apart.
 *  2. Every declined step carries a reason. "We considered this and did not run
 *     it, because…" is the sentence the page prints; a decline with no reason
 *     prints as a silent omission, which reads as coverage.
 *
 * `planned` is deliberately NOT a defect: a plan is inspected mid-run too, and
 * the stored artefact is written with outcomes filled in.
 */
export function planDefects(plan: VerificationPlan): string[] {
  const defects: string[] = [];
  const present = new Set(plan.steps.map((step) => step.procedureRef));
  for (const ref of requiredProcedureRefs(plan.features)) {
    if (!present.has(ref)) {
      defects.push(
        `claim asserts ${ref.replace(/-/g, " ")} but the plan has no "${ref}" step — a required procedure must be decided on, even to decline it`,
      );
    }
  }
  for (const step of plan.steps) {
    if (step.status === "declined" && (step.declineReason ?? "").trim().length === 0) {
      defects.push(
        `step "${step.procedureRef}" is declined with no reason — that renders as a silent omission`,
      );
    }
  }
  return defects;
}

/** Throwing wrapper, for the write boundary. */
export function assertPlanValid(plan: VerificationPlan): void {
  const defects = planDefects(plan);
  if (defects.length > 0) {
    throw new Error(`invalid verification plan: ${defects.join("; ")}`);
  }
}
