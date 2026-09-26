import { describe, expect, it } from "vitest";
import { resolveCitationTarget } from "./citation-target.ts";

const wiki = {
  link: "https://en.wikipedia.org/wiki/Mark_Mitchell_(New_Zealand_politician)",
  title: "Mark Mitchell (New Zealand politician) - Wikipedia",
  snippet: "New Zealand politician",
};
const rnz = {
  link: "https://www.rnz.co.nz/news/politics/1354691/national-to-set-up-auckland-transport-police-team",
  title: "National to set up Auckland transport police team if re-elected",
  snippet: "The National Party will set up a dedicated team",
};
const tier1 = (link: string) => (link.includes("rnz.co.nz") ? 3 : link.includes("wikipedia") ? 6 : null);

describe("citation-target resolution (ADR-0020 rule 1)", () => {
  it("fails closed when the claim names no document — the live failure", () => {
    // The old path fell back to `domainKey`, searched the claimant's name and took
    // result #1. Now: no citation, no citation check.
    const outcome = resolveCitationTarget({ citedSource: null, results: [wiki], tierOf: tier1 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain("names no document");
  });

  it("fails closed when nothing looks like the cited document", () => {
    const outcome = resolveCitationTarget({
      citedSource: "the Treasury's Budget 2026 forecasts",
      results: [wiki, rnz],
      tierOf: tier1,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain("no result looks like");
  });

  it("never accepts a reference page as the cited document", () => {
    const outcome = resolveCitationTarget({
      citedSource: "wikipedia.org",
      results: [wiki],
      tierOf: tier1,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain("reference or user-generated");
  });

  it("resolves the cited document when it is present and admissible", () => {
    const outcome = resolveCitationTarget({
      citedSource: "rnz.co.nz",
      results: [wiki, rnz],
      tierOf: tier1,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.target.link).toBe(rnz.link);
  });

  it("matches a named citation against the result title", () => {
    const outcome = resolveCitationTarget({
      citedSource: "National to set up Auckland transport police team",
      results: [wiki, rnz],
      tierOf: tier1,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.target.link).toBe(rnz.link);
  });
});
