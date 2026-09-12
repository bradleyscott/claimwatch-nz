// Authority registry (ADR-0018 guardrail + user direction Sept 2026): no
// pre-declared authority map — authorities are DISCOVERED over time, assessed
// via the declared tier taxonomy, and persisted with their discovery
// provenance. The registry is append-only: an authority's vetting record is a
// fact about what was believed at discovery time, never silently rewritten
// (same discipline as evidence vintages, STO-R3).
//
// Authored BEFORE implementation (TDD red). Do not mutate without approval.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalDomain } from "./domain.ts";
import { createTestStore } from "./store.ts";
import type { Store } from "./store-api.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set — copy .env.example to .env (gitignored) and fill it in",
  );
}

let store: Store;

beforeAll(async () => {
  store = await createTestStore(DATABASE_URL, { scratchSuffix: "_authority" });
});

afterAll(async () => {
  await store.close();
});

describe("authority registry — discovery persistence (user direction, Sept 2026)", () => {
  it("records a discovered authority with tier, rationale, and provenance", async () => {
    // Scratch domain: the shared seed domains are asserted elsewhere; this
    // test owns its own domain so suite runs stay order-independent.
    const rec = await store.recordAuthority({
      domain: "test-record-domain",
      sourceUrl: "https://www.police.govt.nz/about-us/statistics",
      authorityRef: "police-govt-nz",
      tier: 1,
      rationale: "official NZ Police statistics portal on a govt.nz domain",
      confidence: 0.95,
      discoveredBy: "serper-search",
      searchRefs: ["q=crime statistics site:govt.nz"],
    });
    expect(rec.authorityId).toBeTruthy();
    expect(rec.tier).toBe(1);
    expect(rec.rationale).toContain("official NZ Police");
  });

  it("resolves the active authority for a domain (highest tier, latest discovery)", async () => {
    // Two entries for the same domain: the T1 outranks the T3.
    await store.recordAuthority({
      domain: "test-resolve-domain",
      sourceUrl: "https://www.nzherald.co.nz/crime",
      authorityRef: "nzherald-crime",
      tier: 3,
      rationale: "major NZ media",
      confidence: 0.9,
      discoveredBy: "serper-search",
      searchRefs: [],
    });
    await store.recordAuthority({
      domain: "test-resolve-domain",
      sourceUrl: "https://www.police.govt.nz/statistics",
      authorityRef: "policedata.nz",
      tier: 1,
      rationale: "official police portal",
      confidence: 0.95,
      discoveredBy: "serper-search",
      searchRefs: [],
    });
    const resolved = await store.resolveAuthority("test-resolve-domain");
    expect(resolved?.authorityRef).toBe("policedata.nz");
    expect(resolved?.tier).toBe(1);
  });

  it("returns null for an undiscovered domain — the discovery trigger", async () => {
    expect(await store.resolveAuthority("never-discovered-domain")).toBeNull();
  });

  it("is append-only: rewriting an authority row raises", async () => {
    await store.recordAuthority({
      domain: "test-append-only",
      sourceUrl: "https://www.otago.ac.nz/research",
      authorityRef: "otago-research",
      tier: 2,
      rationale: "university research",
      confidence: 0.9,
      discoveredBy: "serper-search",
      searchRefs: [],
    });
    const row = await store.resolveAuthority("test-append-only");
    if (!row) throw new Error("expected an authority row");
    await expect(store.tryUpdate("authority")).rejects.toThrow(/append-only/);
  });

  it("seeds: the three initial domains resolve without discovery", async () => {
    for (const [domain, expectedRef] of [
      ["crime-statistics", "policedata.nz"],
      ["economic-forecasts", "treasury.govt.nz"],
      ["population-estimates", "stats.govt.nz"],
    ] as const) {
      const resolved = await store.resolveAuthority(domain);
      expect(resolved?.authorityRef).toBe(expectedRef);
      expect(resolved?.discoveredBy).toBe("seed");
    }
  });

  it("domain normalisation: near-identical domains collapse to one registry entry", async () => {
    // "covid mortality", "covid-mortality", "pandemic deaths" → same canonical key.
    expect(canonicalDomain("Covid Mortality")).toBe(canonicalDomain("covid-mortality"));
    expect(canonicalDomain("pandemic deaths")).toBe(canonicalDomain("covid-mortality"));
    // Different real-world categories stay distinct.
    expect(canonicalDomain("covid-mortality")).not.toBe(canonicalDomain("vehicle theft"));
  });
});
