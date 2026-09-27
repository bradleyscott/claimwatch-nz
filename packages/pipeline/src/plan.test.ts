// The plan (ADR-0023). These tests pin the properties the old single-mode
// `claim.verification_mode` could not have: that a compound claim carries several
// checks, that the library suggests rather than constrains, that a required
// procedure cannot be dropped silently, and that nothing in the selection path
// can see who said the claim.

import { planDefects, requiredProcedureRefs, SEEDED_PROCEDURE_REFS } from "@cw/store";
import { describe, expect, it } from "vitest";
import {
  derivePlanFeatures,
  type PastPlanUsage,
  type ProcedureSummary,
  planForClaim,
  suggestProcedures,
} from "./plan.ts";

const library: ProcedureSummary[] = SEEDED_PROCEDURE_REFS.map((ref) => ({
  procedureRef: ref,
  version: `${ref}@1`,
  status: "active" as const,
  cannotEstablish: "…",
}));

describe("a claim gets a plan, not a mode (ADR-0023)", () => {
  it("gives a compound claim several steps instead of one", () => {
    // The claim that motivated the change: it quotes a person AND asserts a
    // number, so it needs the attribution question and the figures question
    // answered separately (ADR-0021 rule 5). One mode could hold only one.
    const features = derivePlanFeatures({
      category: "crime-statistics",
      claimText: 'The Minister said "crime is up 30%" since 2017.',
    });
    expect(features.assertsNumber).toBe(true);
    expect(features.quotesPerson).toBe(true);

    const plan = planForClaim({ features, claimText: "", available: library });
    const refs = plan.steps.map((s) => s.procedureRef);
    expect(refs).toContain("stat-grid");
    expect(refs).toContain("quote-fidelity");
    expect(refs.length).toBeGreaterThan(1);
  });

  it("names a research pass when every other step was DECLINED, not only when the plan is empty", () => {
    // The live lane's real case: a claim with no registered authority gets the
    // figures procedure declined, so the plan had steps but nothing runnable —
    // and the research pass that actually produced the verdict was missing from
    // the stored record. A plan with nothing to run is not a plan.
    const features = derivePlanFeatures({
      category: "health",
      claimText: "It has launched a five-year action plan.",
      claimType: "institution-citation",
    });
    const plan = planForClaim({
      features,
      claimText: "It has launched a five-year action plan.",
      available: library,
      declines: [{ procedureRef: "citation-check", reason: "no cited document could be resolved" }],
    });
    expect(plan.steps.some((step) => step.status !== "declined")).toBe(true);
    expect(plan.steps.map((s) => s.procedureRef)).toContain("open-web-research");
    expect(planDefects(plan)).toEqual([]);
  });

  it("takes the required procedures from the claim's TYPE, not only its wording", () => {
    // A claim typed `institution-citation` rests on a document whether or not the
    // sentence contains the word "report". On the first live run this function was
    // text-only, so a claim about a government action plan produced
    // `citesDocument: false` and the document procedure was never required.
    const features = derivePlanFeatures({
      category: "health",
      claimText: "It has launched a five-year action plan.",
      claimType: "institution-citation",
    });
    expect(features.citesDocument).toBe(true);
    expect(requiredProcedureRefs(features)).toContain("citation-check");
  });

  it("always names a research pass when nothing else applies", () => {
    const features = derivePlanFeatures({ category: "misc", claimText: "the scheme is popular" });
    const plan = planForClaim({ features, claimText: "", available: library });
    expect(plan.steps.map((s) => s.procedureRef)).toContain("open-web-research");
  });

  it("is deterministic for the same input, so two runs' plans are comparable", () => {
    const features = derivePlanFeatures({ category: "crime-statistics", claimText: "up 30%" });
    const past: PastPlanUsage[] = [
      { category: "crime-statistics", procedureRefs: ["open-web-research", "stat-grid"] },
    ];
    const input = { features, claimText: "up 30%", available: library, pastPlans: past };
    expect(planForClaim(input)).toEqual(planForClaim(input));
  });
});

describe("the library suggests and never constrains (ADR-0023 §3)", () => {
  it("ranks by how often this category's past plans used a procedure", () => {
    const features = derivePlanFeatures({ category: "housing", claimText: "rents doubled" });
    const past: PastPlanUsage[] = [
      { category: "housing", procedureRefs: ["citation-check"] },
      { category: "housing", procedureRefs: ["citation-check", "open-web-research"] },
      { category: "housing", procedureRefs: ["open-web-research"] },
    ];
    expect(suggestProcedures(features, past, library)).toEqual([
      "citation-check",
      "open-web-research",
    ]);
  });

  it("counts a category's usage only — a claim's own wording cannot steer it", () => {
    const features = derivePlanFeatures({ category: "housing", claimText: "rents doubled" });
    // Same category, but every past plan is filed under a different one.
    const past: PastPlanUsage[] = [
      { category: "crime-statistics", procedureRefs: ["stat-grid"] },
      { category: "health", procedureRefs: ["quote-fidelity"] },
    ];
    expect(suggestProcedures(features, past, library)).toEqual([]);
  });

  it("never suggests a retired procedure", () => {
    const features = derivePlanFeatures({ category: "housing", claimText: "rents doubled" });
    const past: PastPlanUsage[] = [{ category: "housing", procedureRefs: ["provenance"] }];
    const retired = library.map((p) =>
      p.procedureRef === "provenance" ? { ...p, status: "retired" as const } : p,
    );
    expect(suggestProcedures(features, past, retired)).not.toContain("provenance");
  });

  it("lets a planner reach past the library entirely", () => {
    // The seam that keeps the library from becoming the old taxonomy: a procedure
    // the library has never seen is still a legal step.
    const features = derivePlanFeatures({ category: "misc", claimText: "prices fell" });
    const plan = planForClaim({
      features,
      claimText: "prices fell",
      available: library,
      proposed: [
        {
          procedureRef: "difference-in-differences",
          procedureVersion: "did@1",
          reason: "the claim is causal and no listed procedure can reach causation",
        },
      ],
    });
    const step = plan.steps.find((s) => s.procedureRef === "difference-in-differences");
    expect(step?.source).toBe("planner");
    expect(planDefects(plan)).toEqual([]);
  });
});

describe("a minimum plan, not a fixed one (ADR-0023 §4)", () => {
  it("requires the figures procedure whenever the claim asserts a number", () => {
    const features = derivePlanFeatures({ category: "crime-statistics", claimText: "up 30%" });
    expect(requiredProcedureRefs(features)).toContain("stat-grid");
  });

  it("flags a plan that dropped a required procedure", () => {
    // The defect this exists for: a verdict from a plan that never looked at the
    // number is indistinguishable, in its output, from one whose number checked
    // out. So the plan may decline — but not omit.
    const plan = {
      libraryVersion: "test",
      features: derivePlanFeatures({ category: "crime-statistics", claimText: "up 30%" }),
      steps: [
        {
          procedureRef: "open-web-research",
          procedureVersion: "open-web-research@1",
          reason: "researched",
          source: "planner" as const,
          status: "ran" as const,
          declineReason: null,
          outcome: "supported",
        },
      ],
      notAttempted: [],
    };
    expect(planDefects(plan).join(" ")).toContain("stat-grid");
  });

  it("accepts a required procedure that was declined with a reason", () => {
    const features = derivePlanFeatures({ category: "crime-statistics", claimText: "up 30%" });
    const plan = planForClaim({
      features,
      claimText: "up 30%",
      available: library,
      declines: [{ procedureRef: "stat-grid", reason: "no official series covers this measure" }],
    });
    expect(planDefects(plan)).toEqual([]);
    const step = plan.steps.find((s) => s.procedureRef === "stat-grid");
    expect(step?.status).toBe("declined");
    expect(step?.declineReason).toBe("no official series covers this measure");
  });

  it("rejects a decline with no reason, because it renders as a silent omission", () => {
    const features = derivePlanFeatures({ category: "crime-statistics", claimText: "up 30%" });
    const plan = planForClaim({
      features,
      claimText: "up 30%",
      available: library,
      declines: [{ procedureRef: "stat-grid", reason: "   " }],
    });
    expect(planDefects(plan).join(" ")).toContain("silent omission");
  });
});

describe("the selection path cannot see the speaker (ADR-0023 §3)", () => {
  it("has no speaker or party field anywhere in the features", () => {
    // A STRUCTURAL guarantee, not a promise — the shape of ADR-0022 rule 1. If a
    // future contributor adds a speaker here, this test fails and the change has
    // to be argued for rather than slipped in.
    const features = derivePlanFeatures({
      category: "crime-statistics",
      claimText: "up 30%",
    });
    expect(Object.keys(features).sort()).toEqual([
      "assertsNumber",
      "attachesToProposal",
      "category",
      "citesDocument",
      "quotesPerson",
    ]);
  });

  it("returns the same suggestions whatever the claim says", () => {
    const past: PastPlanUsage[] = [{ category: "crime-statistics", procedureRefs: ["stat-grid"] }];
    const a = suggestProcedures(
      derivePlanFeatures({ category: "crime-statistics", claimText: "crime up 30%" }),
      past,
      library,
    );
    const b = suggestProcedures(
      derivePlanFeatures({ category: "crime-statistics", claimText: "crime is falling" }),
      past,
      library,
    );
    expect(a).toEqual(b);
  });
});
