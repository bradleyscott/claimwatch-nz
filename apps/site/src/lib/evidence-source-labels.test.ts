// L1: source descriptions (SITE-MVP §2.2/§2.3). The stored source code is
// written by the open-web classifier prompt in
// `packages/pipeline/src/search/vetting.ts`; these tests pin the public
// rendering to that classifier's scale and to the register rules (SIT-R4).

import { describe, expect, it } from "vitest";
import {
  describeEvidenceSource,
  EVIDENCE_SOURCE_KEY_LEVELS,
  EVIDENCE_SOURCE_SCALE,
  evidenceSourceCodes,
  orderEvidenceBySourceQuality,
} from "./evidence-source-labels.ts";
import { assertRegisterSafe } from "./verdict-page.ts";

describe("evidence-source descriptions (SITE-MVP §2.3)", () => {
  it("describes every level the classifier assigns, strongest first", () => {
    expect(EVIDENCE_SOURCE_SCALE.map((level) => level.code)).toEqual([1, 2, 3, 5, 6]);
    for (const level of EVIDENCE_SOURCE_SCALE) {
      expect(level.label.length).toBeGreaterThan(0);
      expect(level.description.length).toBeGreaterThan(0);
    }
  });

  it("describes the classifier's codes, not SOURCE-TAXONOMY §2.1's (tripwire)", () => {
    // T2 means academic research in the classifier that writes the stored value
    // — NOT "official administrative data" from SOURCE-TAXONOMY.md §2.1. The
    // two schemes share a code space and disagree from T2 on, so this test is
    // the tripwire if someone re-reads the public copy off the taxonomy.
    for (const level of EVIDENCE_SOURCE_SCALE) {
      expect(describeEvidenceSource(level.code).label).toBe(level.label);
    }
    expect(describeEvidenceSource(2).label).toBe("Academic research");
    expect(describeEvidenceSource(1).label).toBe("Official statistics");
  });

  it("orders evidence strongest source first, with unclassified rows last", () => {
    const ordered = orderEvidenceBySourceQuality([
      { id: "unclassified", tier: null },
      { id: "sector", tier: 5 },
      { id: "official", tier: 1 },
      { id: "media", tier: 3 },
      { id: "academic", tier: 2 },
      { id: "unknown", tier: 6 },
      { id: "off-scale", tier: 4 },
    ]);
    expect(ordered.map((row) => row.id)).toEqual([
      "official",
      "academic",
      "media",
      "sector",
      "unknown",
      "unclassified",
      "off-scale",
    ]);
  });

  it("keeps the pack's own order within a grade and leaves the input untouched", () => {
    const input = [
      { id: "media-b", tier: 3 },
      { id: "official", tier: 1 },
      { id: "media-a", tier: 3 },
    ];
    const ordered = orderEvidenceBySourceQuality(input);
    expect(ordered.map((row) => row.id)).toEqual(["official", "media-b", "media-a"]);
    // A rendered page must never reorder the pack it reads from (append-only
    // store: the pack is the record).
    expect(input.map((row) => row.id)).toEqual(["media-b", "official", "media-a"]);
  });

  it("renders 'Not classified' for a row the pipeline did not code, and for a code off the scale", () => {
    // A null code is today's common case for open-web rows (the adjudicator
    // returns a finding without always returning a code) — since no current
    // path writes stat-grid series rows, null is not a stand-in for "the series
    // itself" and must not be shown as if it were strong evidence.
    expect(describeEvidenceSource(null).label).toBe("Not classified");
    for (const code of [0, 4, 7, 99]) {
      expect(describeEvidenceSource(code).label).toBe("Not classified");
    }
    expect(describeEvidenceSource(null).description).toContain("unverified");
  });

  it("explains every label the page can render, so no chip is left undefined", () => {
    const labels = EVIDENCE_SOURCE_KEY_LEVELS.map((level) => level.label);
    expect(labels).toEqual([
      "Official statistics",
      "Academic research",
      "Major news outlet",
      "Sector or advocacy body",
      "Unknown source",
      "Not classified",
    ]);
    for (const level of EVIDENCE_SOURCE_KEY_LEVELS) {
      expect(level.description.length).toBeGreaterThan(0);
    }
  });

  it("keeps the public labels in the layperson register (SIT-R4)", () => {
    for (const level of EVIDENCE_SOURCE_KEY_LEVELS) {
      expect(() => assertRegisterSafe(`${level.label} — ${level.description}`)).not.toThrow();
      expect(`${level.label} ${level.description}`.toLowerCase()).not.toContain("tier");
    }
  });

  it("lists the raw codes for the provenance block, deduped and ordered by the stronger source", () => {
    expect(evidenceSourceCodes([{ tier: 3 }, { tier: 1 }, { tier: 1 }, { tier: null }])).toBe(
      "T1, T3",
    );
    expect(evidenceSourceCodes([])).toBeNull();
    expect(evidenceSourceCodes([{ tier: null }])).toBeNull();
  });
});
