// L1: the verdict mark is a BAND + PIN (SITE-MVP §2.3) — four flat category
// segments with the pin resting on THIS verdict's segment, and every stop label
// present as text so the verdict never rides on colour alone (SIT-R9).
// Pins the design the mockups specify (`.vrule`/`.vpin`/`.vlabels`) so it cannot
// quietly regress to an unlabelled or chip-only treatment.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VERDICT_ORDER, VerdictRule } from "@/components/verdict-rule";
import { VERDICT_LABELS } from "@/lib/verdict-page";

const render = (verdictClass: (typeof VERDICT_ORDER)[number]) =>
  renderToStaticMarkup(<VerdictRule verdictClass={verdictClass} />);

describe("verdict rule — band + pin (SITE-MVP §2.3)", () => {
  it("draws all four category segments, each as its own flat band", () => {
    const html = render("supported");
    // The token name is not always the class name: not_enough_evidence is
    // drawn with the `--verdict-unverified` mark colour.
    for (const token of [
      "var(--verdict-refuted)",
      "var(--verdict-unverified)",
      "var(--verdict-incomplete)",
      "var(--verdict-supported)",
    ]) {
      expect(html).toContain(token);
    }
    // Hard edges: each segment names its colour at both stops (no blend region).
    expect(html).toContain("linear-gradient(90deg,");
    expect(html).toContain("var(--verdict-refuted) 22%");
    expect(html).toContain("var(--verdict-unverified) 22%");
    expect(html).toContain("var(--verdict-incomplete) 40%");
    expect(html).toContain("var(--verdict-incomplete) 72%");
  });

  it("rests the pin on the verdict's own segment, centred", () => {
    // The mockups' own geometry: refuted 0–22%, not enough evidence 22–40%,
    // accurate but incomplete 40–72%, supported 72–100% → segment midpoints.
    const expected = {
      refuted: "11%",
      not_enough_evidence: "31%",
      conflicting_cherry_picking: "56%",
      supported: "86%",
    } as const;
    for (const cls of VERDICT_ORDER) {
      expect(render(cls)).toContain(`left:${expected[cls]}`);
    }
  });

  it("rings the pin in the verdict's own mark colour", () => {
    expect(render("refuted")).toContain("border-color:var(--verdict-refuted)");
    expect(render("conflicting_cherry_picking")).toContain(
      "border-color:var(--verdict-incomplete)",
    );
  });

  it("names every stop in text and marks exactly the live one (SIT-R9)", () => {
    const html = render("conflicting_cherry_picking");
    for (const cls of VERDICT_ORDER) {
      expect(html).toContain(VERDICT_LABELS[cls].plainLabel);
    }
    // "Accurate but incomplete" is the ADR-0004 public rendering of the fourth
    // class — the band never shows the machine-only class name.
    expect(html).not.toContain("Cherrypicking");
    expect((html.match(/aria-current="true"/g) ?? []).length).toBe(1);
  });

  it("keeps the decorative band out of the accessibility tree", () => {
    expect(render("supported")).toContain('aria-hidden="true"');
  });
});
