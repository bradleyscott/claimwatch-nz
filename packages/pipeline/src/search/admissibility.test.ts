import { describe, expect, it } from "vitest";
import {
  admissibilityRefusal,
  DECISIVE_AUTHORITY_FLOOR,
  hostOf,
  isAdmissibleEvidence,
  isNeverTheRecord,
  meetsAuthorityFloor,
} from "./admissibility.ts";

describe("source admissibility (ADR-0020 rule 2)", () => {
  it("excludes reference and user-generated pages, whatever their tier", () => {
    for (const link of [
      "https://en.wikipedia.org/wiki/Mark_Mitchell_(New_Zealand_politician)",
      "https://www.britannica.com/place/New-Zealand",
      "https://www.reddit.com/r/nz/comments/x",
      "https://news.google.com/articles/abc",
      "https://someone.substack.com/p/claim",
    ]) {
      expect(isNeverTheRecord(link), link).toBe(true);
      // Even a would-be tier-1 score cannot rescue a page that is not a record.
      expect(isAdmissibleEvidence({ link, tier: 1 })).toBe(false);
    }
  });

  it("admits the sources that ARE records", () => {
    for (const link of [
      "https://www.policedata.nz/",
      "https://www.stats.govt.nz/information-releases",
      "https://www.rnz.co.nz/news/politics",
      "https://hansard.parliament.nz/",
    ]) {
      expect(isNeverTheRecord(link), link).toBe(false);
    }
  });

  it("treats a free-text citation with no host as neither excluded nor a host match", () => {
    // `hostOf` cannot parse it; exclusion is host-based, so it is not excluded.
    expect(hostOf("a Curia poll")).toBeNull();
    expect(isNeverTheRecord("a Curia poll")).toBe(false);
  });

  it("requires tier 5 or better for a decisive verdict", () => {
    expect(DECISIVE_AUTHORITY_FLOOR).toBe(5);
    for (const tier of [1, 2, 3, 5]) expect(meetsAuthorityFloor(tier), String(tier)).toBe(true);
    for (const tier of [6, null, undefined]) expect(meetsAuthorityFloor(tier)).toBe(false);
  });

  it("refuses an unestablished source as the record — the Wikipedia case", () => {
    // The live failure: a biography scored tier 6 and was compared against.
    const refusal = admissibilityRefusal({
      link: "https://en.wikipedia.org/wiki/Mark_Mitchell_(New_Zealand_politician)",
      tier: 6,
    });
    expect(refusal).toContain("reference or user-generated");
    const unknown = admissibilityRefusal({ link: "https://example.com/post", tier: 6 });
    expect(unknown).toContain("not a source we can establish");
    expect(admissibilityRefusal({ link: "https://www.policedata.nz/", tier: 1 })).toBeNull();
  });
});
