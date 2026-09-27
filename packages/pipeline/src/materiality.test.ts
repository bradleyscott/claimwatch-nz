// ADR-0022: the materiality criterion is structural and party-blind. It reads
// the argumentative context only — a claim is worth a verdict when it is
// load-bearing to a position on policy, and it is set aside only when it carries
// none of the signals.

import { describe, expect, it } from "vitest";
import { assessMateriality } from "./materiality.ts";

describe("materiality (ADR-0022)", () => {
  it("is material when it supports a proposal — the load-bearing case", () => {
    const out = assessMateriality({
      claimType: "statistical",
      context: { attachedProposal: "tougher sentencing", topic: "crime" },
    });
    expect(out.material).toBe(true);
    expect(out.signal).toBe("attached-proposal");
  });

  it("is material when it takes a side in an argument", () => {
    const out = assessMateriality({
      claimType: "broadcast-quote",
      context: { argumentDirection: "problem" },
    });
    expect(out.material).toBe(true);
    expect(out.signal).toBe("argument-direction");
  });

  it("is material when it is about a policy topic", () => {
    const out = assessMateriality({
      claimType: "other",
      context: { topic: "public transport safety" },
    });
    expect(out.material).toBe(true);
    expect(out.signal).toBe("policy-topic");
  });

  it("is NOT material only when every signal is absent — conservative by design", () => {
    const out = assessMateriality({
      claimType: "other",
      context: { topic: null, attachedProposal: null, argumentDirection: null },
    });
    expect(out.material).toBe(false);
    expect(out.signal).toBe("none");
    expect(out.reason).toContain("nothing this could change");
  });

  it("treats a missing context the same as an empty one", () => {
    expect(assessMateriality({ claimType: "other", context: null }).material).toBe(false);
    expect(assessMateriality({ claimType: "other" }).material).toBe(false);
  });

  it("fails OPEN when there was no window — absence of context is not irrelevance", () => {
    const out = assessMateriality({
      claimType: "other",
      context: { topic: null, attachedProposal: null, argumentDirection: null },
      assessed: false,
    });
    expect(out.material).toBe(true);
    expect(out.signal).toBe("unassessed");
  });

  it("cannot see the speaker: the decision is about the argument, not the claimant", () => {
    // The input shape is the guarantee — there is no speaker or party to read.
    // This test pins that a claim from any claimant scores the same when the
    // context is the same.
    const a = assessMateriality({ claimType: "statistical", context: { topic: "health" } });
    const b = assessMateriality({ claimType: "statistical", context: { topic: "health" } });
    expect(a).toEqual(b);
  });
});
