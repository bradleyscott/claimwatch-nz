// Discovery flow (user direction, Sept 2026): open-web is the DEFAULT
// verification path; the authority registry makes later claims better. On a
// registry miss, discovery runs NON-BLOCKING: the triggering claim gets its
// open-web verdict immediately, while search → guardrails → LLM classification
// → persistence runs alongside to serve the next claim in the category.
//
// Authored BEFORE implementation (TDD red). Do not mutate without approval.

import { describe, expect, it } from "vitest";
import { type DiscoveryDeps, discoverAuthority } from "./discovery.ts";
import type { SearchResult } from "./serper-adapter.ts";

function stubSearch(results: SearchResult[]): { calls: string[]; search: DiscoveryDeps["search"] } {
  const calls: string[] = [];
  return {
    calls,
    search: async (query: string) => {
      calls.push(query);
      return results;
    },
  };
}

function stubClassifier(
  classify: (
    candidate: SearchResult,
  ) => { tier: number; rationale: string; confidence: number } | null,
): DiscoveryDeps["classifyAuthorities"] {
  // Batched seam, per-candidate logic: one call classifies the whole surviving
  // set, so the stub maps over it exactly as the live bridge does.
  return async (candidates) => candidates.map((candidate) => classify(candidate));
}

describe("discovery flow — non-blocking authority persistence", () => {
  it("searches from the canonical domain key, never the claim text", async () => {
    const { calls, search } = stubSearch([]);
    const classify = stubClassifier(() => null);
    await discoverAuthority(
      { domain: "covid-mortality", claimText: "More than 225,000 people dead" },
      {
        search,
        classifyAuthorities: classify,
        recordAuthority: async () => {
          throw new Error("should not persist");
        },
      },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("covid mortality");
    expect(calls[0]).toContain("official");
    expect(calls[0]).not.toContain("225,000"); // claim text never enters the query
  });

  it("persists the best vetted candidate with provenance", async () => {
    const { search } = stubSearch([
      { title: "Herald story", link: "https://www.nzherald.co.nz/covid", snippet: "news" },
      { title: "MoH data", link: "https://www.health.govt.nz/covid-data", snippet: "official" },
    ]);
    const persisted: Array<{
      domain: string;
      authorityRef: string;
      tier: number;
      discoveredBy: string;
      searchRefs: string[];
    }> = [];
    await discoverAuthority(
      { domain: "covid-mortality", claimText: "whatever" },
      {
        search,
        classifyAuthorities: stubClassifier((c) =>
          c.link.includes("health.govt.nz")
            ? { tier: 1, rationale: "Ministry of Health official data portal", confidence: 0.95 }
            : { tier: 3, rationale: "media", confidence: 0.9 },
        ),
        recordAuthority: async (fixture) => {
          persisted.push(fixture);
          return { authorityId: "a1", discoveredAt: new Date(), ...fixture };
        },
      },
    );
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.tier).toBe(1);
    expect(persisted[0]?.authorityRef).toBe("www.health.govt.nz");
    expect(persisted[0]?.discoveredBy).toBe("serper-search");
    expect(persisted[0]?.searchRefs.length).toBeGreaterThan(0);
  });

  it("records nothing when no candidate survives vetting", async () => {
    const { search } = stubSearch([
      { title: "Taxpayers' Union poll", link: "https://www.taxpayers.org.nz/poll", snippet: "" },
      { title: "UK ONS", link: "https://www.ons.gov.uk/economy", snippet: "" },
    ]);
    const persisted: unknown[] = [];
    const outcome = await discoverAuthority(
      { domain: "covid-mortality", claimText: "x" },
      {
        search,
        classifyAuthorities: stubClassifier(() => ({ tier: 1, rationale: "x", confidence: 0.9 })),
        recordAuthority: async (fixture) => {
          persisted.push(fixture);
          return { authorityId: "a1", discoveredAt: new Date(), ...fixture };
        },
      },
    );
    expect(persisted).toHaveLength(0);
    expect(outcome.persisted).toBe(false);
    expect(outcome.reason).toContain("no candidate");
  });

  it("classifies the surviving candidates in ONE call, not one per result", async () => {
    const { search } = stubSearch([
      { title: "Herald", link: "https://www.nzherald.co.nz/a", snippet: "" },
      { title: "MoH", link: "https://www.health.govt.nz/b", snippet: "" },
      { title: "Stats", link: "https://www.stats.govt.nz/c", snippet: "" },
      { title: "Advocacy", link: "https://www.taxpayers.org.nz/d", snippet: "" },
    ]);
    const batches: number[] = [];
    await discoverAuthority(
      { domain: "covid-mortality", claimText: "x" },
      {
        search,
        classifyAuthorities: async (candidates) => {
          batches.push(candidates.length);
          // The advocacy candidate is guardrail-rejected, so 3 reach the call.
          return candidates.map(() => ({ tier: 3, rationale: "x", confidence: 0.8 }));
        },
        recordAuthority: async (fixture) => ({
          authorityId: "a1",
          discoveredAt: new Date(),
          ...fixture,
        }),
      },
    );
    expect(batches).toEqual([3]); // single call for the whole surviving set
  });

  it("skips discovery for a claim type that can never route to stat-grid", async () => {
    const { calls, search } = stubSearch([
      { title: "MoH", link: "https://www.health.govt.nz/x", snippet: "" },
    ]);
    let classifyCalls = 0;
    const outcome = await discoverAuthority(
      { domain: "covid-mortality", claimType: "other", claimText: "x" },
      {
        search,
        classifyAuthorities: async (candidates) => {
          classifyCalls++;
          return candidates.map(() => ({ tier: 1, rationale: "x", confidence: 0.9 }));
        },
        recordAuthority: async () => {
          throw new Error("should not persist");
        },
      },
    );
    expect(outcome.persisted).toBe(false);
    expect(outcome.reason).toContain("never routes to stat-grid");
    expect(calls).toHaveLength(0); // no search bought for a dead registry row
    expect(classifyCalls).toBe(0);
  });

  it("guardrails fire before the classifier — advocacy never reaches the LLM", async () => {
    const { search } = stubSearch([
      { title: "Curia report", link: "https://curia.com/report", snippet: "" },
    ]);
    let classifyCalls = 0;
    await discoverAuthority(
      { domain: "covid-mortality", claimText: "x" },
      {
        search,
        classifyAuthorities: async (candidates) => {
          classifyCalls++;
          return candidates.map(() => null);
        },
        recordAuthority: async () => {
          throw new Error("should not persist");
        },
      },
    );
    expect(classifyCalls).toBe(0);
  });
});
