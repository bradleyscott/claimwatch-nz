import { describe, expect, it } from "vitest";
import {
  admissibilityRefusal,
  DECISIVE_AUTHORITY_FLOOR,
  enforceEvidenceFloor,
  hostOf,
  independentSourceCount,
  isAdmissibleEvidence,
  isNeverTheRecord,
  looksOfficial,
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

describe("evidence floor for a decisive verdict (ADR-0020 rule 3)", () => {
  const nonOfficial = { link: "https://example.com/a", tier: 6 };
  const news = { link: "https://www.rnz.co.nz/a", tier: 3 };
  const news2 = { link: "https://www.newsroom.co.nz/b", tier: 3 };
  const official = { link: "https://www.stats.govt.nz/x", tier: 1 };

  it("recognises an official record by host", () => {
    expect(looksOfficial("https://www.policedata.nz/")).toBe(true);
    expect(looksOfficial("https://census.gov/data")).toBe(true);
    expect(looksOfficial("https://www.rnz.co.nz/")).toBe(false);
  });

  it("leaves non-decisive classes alone", () => {
    const out = enforceEvidenceFloor({ verdictClass: "not_enough_evidence", evidence: [] });
    expect(out.downgraded).toBe(false);
  });

  it("downgrades a decisive verdict with no admissible source", () => {
    const out = enforceEvidenceFloor({ verdictClass: "supported", evidence: [nonOfficial] });
    expect(out.verdictClass).toBe("not_enough_evidence");
    expect(out.reason).toContain("no admissible source");
  });

  it("downgrades a single non-official source", () => {
    const out = enforceEvidenceFloor({ verdictClass: "refuted", evidence: [news] });
    expect(out.downgraded).toBe(true);
    expect(out.reason).toContain("single non-official source");
  });

  it("allows one official record, or two independent sources", () => {
    expect(enforceEvidenceFloor({ verdictClass: "supported", evidence: [official] }).downgraded).toBe(
      false,
    );
    expect(
      enforceEvidenceFloor({ verdictClass: "supported", evidence: [news, news2] }).downgraded,
    ).toBe(false);
    // Two pages on ONE site are still one source.
    expect(
      enforceEvidenceFloor({
        verdictClass: "supported",
        evidence: [news, { link: "https://rnz.co.nz/c", tier: 3 }],
      }).downgraded,
    ).toBe(true);
    expect(independentSourceCount([news, news2])).toBe(2);
  });
});
