// ADR-0021: a claim carries its document, its referents and its jurisdiction.
// The fixture is the BirdCare claim, which lost all three — its sentence names
// no country and no referent, so research returned American pages and the
// verdict said no charity had made a statement its own source recorded.

import { describe, expect, it } from "vitest";
import {
  biasQueries,
  deriveJurisdiction,
  entityQueries,
  queryBias,
  resolveReferent,
} from "./claim-context.ts";

const BIRDCARE =
  "The charity said it would need about $140,000 more for infrastructure upgrades and clinical staff to operate at full capacity.";

describe("jurisdiction comes from the document, not the sentence", () => {
  it("reads a NZ jurisdiction off the publication's ccTLD", () => {
    expect(deriveJurisdiction({ publicationUrl: "https://www.rnz.co.nz/news/x" })).toBe("NZ");
    expect(deriveJurisdiction({ publicationUrl: "https://www.stats.govt.nz/x" })).toBe("NZ");
    expect(deriveJurisdiction({ publicationUrl: "https://www.theguardian.com/uk/x" })).toBeNull();
  });

  it("falls back to the source id when the URL is not a URL", () => {
    expect(deriveJurisdiction({ sourceId: "rnz-politics" })).toBe("NZ");
    expect(deriveJurisdiction({ publicationUrl: "not a url", sourceId: "beehive" })).toBe("NZ");
  });

  it("returns null when nothing names a jurisdiction", () => {
    expect(deriveJurisdiction({ publicationUrl: "https://example.com/x" })).toBeNull();
    expect(deriveJurisdiction({})).toBeNull();
    expect(queryBias(null)).toBeNull();
    expect(queryBias("NZ")).toBe("New Zealand");
  });
});

describe("biasQueries — the fix for the US drift", () => {
  it("appends the jurisdiction to every query", () => {
    expect(biasQueries(["BirdCare Aotearoa funding", "$140,000 bird hospital"], "NZ")).toEqual([
      "BirdCare Aotearoa funding New Zealand",
      "$140,000 bird hospital New Zealand",
    ]);
  });

  it("does not append twice, and is a no-op with no jurisdiction", () => {
    expect(biasQueries(["bird hospital New Zealand"], "NZ")).toEqual(["bird hospital New Zealand"]);
    expect(biasQueries(["bird hospital"], null)).toEqual(["bird hospital"]);
  });
});

describe("entity-anchored queries (ADR-0021 rule 4)", () => {
  it("anchors on the named entity, with and without the jurisdiction", () => {
    expect(entityQueries({ entities: ["BirdCare Aotearoa"], jurisdiction: "NZ" })).toEqual([
      "BirdCare Aotearoa",
      "BirdCare Aotearoa New Zealand",
    ]);
  });

  it("yields nothing when no entity is named", () => {
    expect(entityQueries({ entities: [], jurisdiction: "NZ" })).toEqual([]);
    expect(entityQueries({ entities: ["  "], jurisdiction: "NZ" })).toEqual([]);
  });
});

describe("resolveReferent — 'the charity' becomes the charity", () => {
  it("resolves a leading definite reference to the known speaker", () => {
    const out = resolveReferent(BIRDCARE, { speaker: "BirdCare Aotearoa" });
    expect(out.resolved).toBe(true);
    expect(out.text.startsWith("BirdCare Aotearoa said it would need")).toBe(true);
    expect(out.referent).toBe("The charity");
  });

  it("leaves the sentence alone when there is no speaker", () => {
    expect(resolveReferent(BIRDCARE, { speaker: null }).text).toBe(BIRDCARE);
  });

  it("leaves the sentence alone when the speaker is already named", () => {
    const text = "BirdCare Aotearoa said it would need $140,000 more.";
    expect(resolveReferent(text, { speaker: "BirdCare Aotearoa" }).resolved).toBe(false);
  });

  it("does not touch a sentence that does not lead with a referring noun", () => {
    const text = "Crime is up 30% since 2017.";
    expect(resolveReferent(text, { speaker: "Mark Mitchell" }).text).toBe(text);
  });
});
