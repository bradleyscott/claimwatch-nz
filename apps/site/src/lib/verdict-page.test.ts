// SITE-MVP §2.3/§5 L1: section-order invariant, register rules, anchor href,
// claim-card shape. Authored red; requirements frozen, structural edits free.

import { describe, expect, it } from "vitest";
import {
  anchorHref,
  assertRegisterSafe,
  buildVerdictPageModel,
  VERDICT_LABELS,
  type VerdictClass,
  type VerdictPageInput,
} from "./verdict-page.ts";

const input = (
  over: Partial<VerdictPageInput> & { verdictClass: VerdictClass },
): VerdictPageInput => ({
  claimId: "c1",
  claimText: "Crime is up 30% since 2017.",
  speaker: "Hon Sample Minister",
  speakerAffiliation: "National",
  publishedAt: new Date("2026-09-08"),
  confidence: 0.72,
  attachedProposal: null,
  mediaAnchor: null,
  transcriptTier: null,
  evidence: [],
  pipelineVersion: "0.1.0",
  promptVersions: { "citation-compare": "citation-compare@1" },
  ...over,
});

describe("section order is a design invariant (SITE-MVP §2.3)", () => {
  it("emits the fixed order: claim → verdict → (deployed) → (media) → evidence → provenance", () => {
    const model = buildVerdictPageModel(
      input({
        verdictClass: "conflicting_cherry_picking",
        attachedProposal: "tougher sentencing package",
        mediaAnchor: {
          mediaUrl: "https://youtube.com?v=x",
          startS: 2.5,
          endS: 11.8,
          deepLink: "https://youtube.com?v=x&t=2.5s&end=11.8s",
        },
      }),
    );
    expect(model.sections.map((s) => s.kind)).toEqual([
      "claim",
      "verdict",
      "deployed",
      "media",
      "evidence",
      "provenance",
    ]);
  });

  it("omits absent sections rather than rendering placeholders (no dead controls, SIT-R3)", () => {
    const model = buildVerdictPageModel(input({ verdictClass: "supported" }));
    expect(model.sections.map((s) => s.kind)).toEqual([
      "claim",
      "verdict",
      "evidence",
      "provenance",
    ]);
  });

  it("positions the verdict pin on the rule per class — left = refuted, right = supported", () => {
    for (const [cls, pos] of [
      ["refuted", 0],
      ["not_enough_evidence", 1],
      ["conflicting_cherry_picking", 2],
      ["supported", 3],
    ] as Array<[VerdictClass, number]>) {
      expect(buildVerdictPageModel(input({ verdictClass: cls })).verdictPosition).toBe(pos);
    }
  });
});

describe("register rules (SIT-R4/R5/R6)", () => {
  it("bans technical lexicon on public pages", () => {
    expect(() => assertRegisterSafe("Our sensitivity grid shows the alternatives.")).toThrow(
      /register violation/,
    );
    expect(() => assertRegisterSafe("We ran the NLI audit before publishing.")).toThrow(
      /register violation/,
    );
    expect(() => assertRegisterSafe("This claim came from a Tier-2 caption.")).toThrow(
      /register violation/,
    );
  });

  it("bans character statements and degree-slider vocabulary (ADR-0002/0004)", () => {
    expect(() => assertRegisterSafe("The Minister is dishonest about crime.")).toThrow(
      /register violation/,
    );
    expect(() => assertRegisterSafe("This claim is half-true.")).toThrow(/register violation/);
    expect(() => assertRegisterSafe("This claim is mostly false.")).toThrow(/register violation/);
  });

  it("accepts the ADR-0004 label set and plain summaries", () => {
    expect(() =>
      assertRegisterSafe(
        "Conflicting Evidence/Cherrypicking — The number is real, but the way it is framed changes the picture.",
      ),
    ).not.toThrow();
    for (const label of Object.values(VERDICT_LABELS)) {
      expect(() => assertRegisterSafe(`${label.label} — ${label.plainSummary}`)).not.toThrow();
      expect(() => assertRegisterSafe(`${label.plainLabel} — ${label.plainSummary}`)).not.toThrow();
    }
  });

  // Sept 2026: the published number was a hardcoded placeholder in the `ops/`
  // slice scripts with no adjudicator behind it, so SIT-R6 tightened from
  // "de-emphasise" to "do not publish": a confidence value is withheld until
  // ADR-0011's adjudication step exists and the harness calibrates it.
  it("publishes no confidence value, even when the store carries one (SIT-R6)", () => {
    const model = buildVerdictPageModel(input({ verdictClass: "supported", confidence: 0.81 }));
    const rendered = JSON.stringify(model.sections);
    expect(rendered).not.toContain("confidence");
    expect(rendered).not.toContain("0.81");
  });
});

describe("hear-it anchor contract (SIT-R3)", () => {
  it("href is the stored deep link, byte-exact — never re-derived", () => {
    const deepLink = "https://www.youtube.com/watch?v=qa1234567890&t=2.5s&end=11.8s";
    expect(anchorHref({ deepLink })).toBe(deepLink);
  });
});

describe("label set is the ADR-0004 mapping", () => {
  it("carries the four public labels with honest plain summaries", () => {
    expect(VERDICT_LABELS.supported.label).toBe("Supported");
    expect(VERDICT_LABELS.refuted.label).toBe("Refuted");
    expect(VERDICT_LABELS.not_enough_evidence.label).toBe("Not enough evidence");
    expect(VERDICT_LABELS.conflicting_cherry_picking.label).toBe(
      "Conflicting Evidence/Cherrypicking",
    );
  });

  it("carries the ADR-0004 public rendering the verdict band displays", () => {
    // The fourth class is the one AVeriTeC name that is not already plain
    // English, so ADR-0004 gives it a public rendering — the same string
    // `packages/store` publishes as ClaimReview `alternateName`.
    expect(VERDICT_LABELS.conflicting_cherry_picking.plainLabel).toBe("Accurate but incomplete");
    // The other three class names are their own public rendering.
    expect(VERDICT_LABELS.supported.plainLabel).toBe(VERDICT_LABELS.supported.label);
    expect(VERDICT_LABELS.refuted.plainLabel).toBe(VERDICT_LABELS.refuted.label);
    expect(VERDICT_LABELS.not_enough_evidence.plainLabel).toBe(
      VERDICT_LABELS.not_enough_evidence.label,
    );
  });
});
