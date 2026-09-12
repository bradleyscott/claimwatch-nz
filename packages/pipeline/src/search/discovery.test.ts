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
): DiscoveryDeps["classifyAuthority"] {
  return async (candidate) => classify(candidate);
}

describe("discovery flow — non-blocking authority persistence", () => {
  it("searches from the canonical domain key, never the claim text", async () => {
    const { calls, search } = stubSearch([]);
    const classify = stubClassifier(() => null);
    await discoverAuthority(
      { domain: "covid-mortality", claimText: "More than 225,000 people dead" },
      {
        search,
        classifyAuthority: classify,
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
        classifyAuthority: stubClassifier((c) =>
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
        classifyAuthority: stubClassifier(() => ({ tier: 1, rationale: "x", confidence: 0.9 })),
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

  it("guardrails fire before the classifier — advocacy never reaches the LLM", async () => {
    const { search } = stubSearch([
      { title: "Curia report", link: "https://curia.com/report", snippet: "" },
    ]);
    let classifyCalls = 0;
    await discoverAuthority(
      { domain: "covid-mortality", claimText: "x" },
      {
        search,
        classifyAuthority: async () => {
          classifyCalls++;
          return null;
        },
        recordAuthority: async () => {
          throw new Error("should not persist");
        },
      },
    );
    expect(classifyCalls).toBe(0);
  });
});
