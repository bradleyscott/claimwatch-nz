// The procedures, in plain words (SITE-MVP §2.3; ADR-0023). The verdict page's
// trail explains WHICH checks a claim got and WHAT each of them can and cannot
// establish.
//
// This was a table over "the five modes" and a single claimed mode. ADR-0023
// replaced the mode with a PLAN: an ordered list of steps, each naming a
// procedure. The five modes survive as the library's seeded procedures, so the
// descriptions below are keyed by procedure ref and the page now renders one
// block per step — a claim checked two ways says so.
//
// Why this lives on the site rather than in the pipeline: `apps/site` may not
// import pipeline source (AGENTS.md package boundaries), so this is a mapping over
// the *published* procedure names. The values come from `verification_plan.plan`,
// which the pipeline writes; nothing here re-decides the plan.
//
// The `cannot` line is the load-bearing part of the design, and the reason the
// section exists at all. Each check has a hard limit, and a page that reports a
// finding without stating the limit invites the reader to treat the finding as
// covering more than it does. The sharpest case: no procedure tests causation, so
// a causal claim's limit is stated on the page instead of being quietly graded by
// timing evidence (SITE-MVP §2.3 named gap, Sept 2026).

/** A procedure's plain-language identity, and the bound it must declare. */
export interface ProcedureDescription {
  /** What the check is called on the page. */
  label: string;
  /** One sentence: what this kind of check does. */
  whatItDoes: string;
  /** When this procedure is chosen — the rule, not this claim's instance. */
  chosenWhen: string;
  /** What this check cannot establish. Always present; never a hedge. */
  cannot: string;
  /** What a reader can verify themselves, without our tooling. */
  checkItYourself: string;
}

export const PROCEDURE_DESCRIPTIONS: Record<string, ProcedureDescription> = {
  "stat-grid": {
    label: "Official figures",
    whatItDoes:
      "Checks the number against the official figures for it, and shows every reading of those figures — including the ones that disagree with the claim.",
    chosenWhen: "The claim states a number over a period, and official figures cover it.",
    cannot:
      "Show that one thing caused another. It can show that two things changed at the same time; it cannot show that one caused the other.",
    checkItYourself: "the linked figures, and the date recorded on each source below.",
  },
  "citation-check": {
    label: "The source it cites",
    whatItDoes:
      "Reads the document the claim rests on, and checks whether the claim uses it the way the document does.",
    chosenWhen: "The claim names a document, or clearly rests on one.",
    cannot:
      "Judge a document it cannot get. If the cited source is paywalled or unreachable, this page says the claim was checked against its own wording and nothing else.",
    checkItYourself: "the quoted passage from the cited document, linked above.",
  },
  "quote-fidelity": {
    label: "The recording",
    whatItDoes:
      "Checks the claim's wording against the recording or transcript it reports, and says first whether the words were found at all.",
    chosenWhen: "The claim is about what someone said.",
    cannot:
      "Check a quotation that appears in no published record. If the words cannot be found, this page says so — it does not say the person was misreported.",
    checkItYourself: "the clip link on this page, which jumps to that moment.",
  },
  provenance: {
    label: "The context it carries",
    whatItDoes:
      "Checks what the claim is presented as — which event, image, document or date — and whether that is really what it is.",
    chosenWhen: "The claim is attached to an event, image, document or date it may not belong to.",
    cannot:
      "Say why someone attached it wrongly. The record can show which event something comes from; it cannot show anyone's intent.",
    checkItYourself: "the linked original and its earliest publication date.",
  },
  "open-web-research": {
    label: "Open-web research",
    whatItDoes:
      "Turns the claim into questions that published evidence could answer, searches for it, and reports what it found — including what it set aside.",
    chosenWhen:
      "No official figures cover the claim, and it names no document or recording. This is the fallback, and the most common check.",
    cannot:
      "Find a fact nobody has published, or show that one thing caused another. It reports what is published and where the searching stopped: no evidence is reported as no evidence, never as proof the claim is false.",
    checkItYourself: "the sources below, each linked with the date we fetched it.",
  },
};

/**
 * What the claim was read as, in the claim's own terms. Deliberately phrased as
 * what the claim is *not*: the reader's question at this point is "why this check
 * and not another one". It is no longer the routing decision — the plan is — but
 * it is still why the plan's required procedures were required.
 */
export const CLAIM_TYPE_READING: Record<string, string> = {
  // Each line says ONLY what the claim was read as. It used to end in a
  // consequence — "so no search and no document were needed" — which was true
  // while the type picked the check. ADR-0023 removed that: the plan picks the
  // checks, and the type only makes some of them required. The consequence was
  // left behind and printed a false statement on a real page — a claim read as
  // "a number stated over a period" told the reader no search was needed, on a
  // page whose check was open-web research. What ran is said by the "Checked
  // with" lines beside this one, from the plan.
  statistical: "a number stated over a period, with official figures covering it.",
  "citation-backed": "a claim resting on a source it names.",
  "institution-citation": "a claim about an institution's own record.",
  "broadcast-quote": "a claim about what someone said.",
  "false-context": "a claim attached to an event, image or document.",
  other: "a factual statement with no named source, no quotation and no official figures.",
};
/** One step of the plan, resolved to reader-facing copy. */
export interface ResolvedStep {
  procedureRef: string;
  status: "planned" | "ran" | "declined" | "failed";
  /** The planner's reason this step is in the plan. */
  reason: string;
  /** Present when the step was declined: why we did not run it. */
  declineReason: string | null;
  /** Null when the plan names a procedure the site has no copy for. */
  description: ProcedureDescription | null;
}

/**
 * Resolve a stored plan to reader-facing steps. Null when the store holds no
 * plan, which is the state of every verdict written before plans existed — and
 * the page then omits the check section entirely rather than guessing, which is
 * the same rule the single mode had.
 *
 * An interruption is not tolerated silently: a step naming a procedure this table
 * does not know keeps its ref and renders with no description, so a new procedure
 * added to the library is visibly missing its copy rather than invisible.
 */
export function resolvePlan(
  plan: {
    steps: Array<{
      procedureRef: string;
      reason: string;
      status: string;
      declineReason?: string | null;
    }>;
  } | null,
): { steps: ResolvedStep[]; ran: ResolvedStep[]; declined: ResolvedStep[] } | null {
  if (plan == null || plan.steps.length === 0) return null;
  const steps: ResolvedStep[] = plan.steps.map((step) => ({
    procedureRef: step.procedureRef,
    status: step.status as ResolvedStep["status"],
    reason: step.reason,
    declineReason: step.declineReason ?? null,
    description: PROCEDURE_DESCRIPTIONS[step.procedureRef] ?? null,
  }));
  return {
    steps,
    ran: steps.filter((step) => step.status === "ran"),
    declined: steps.filter((step) => step.status === "declined"),
  };
}
