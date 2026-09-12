// Mode-routing change (user direction, Sept 2026): open-web is the DEFAULT
// verification path. stat-grid fires only when the authority registry holds a
// vetted authority for the claim's canonical domain AND a series is fetchable;
// every other statistical claim routes to the capped open-web loop. Discovery
// runs alongside (non-blocking) so the NEXT claim in the category can use
// stat-grid.
//
// Authored BEFORE implementation (TDD red). Do not mutate without approval.

import { describe, expect, it } from "vitest";
import { type RegistryProbe, routeMode } from "./mode-routing.ts";

const probingRegistry: RegistryProbe = {
  async resolveAuthority(domain: string) {
    if (domain === "crime-statistics") {
      return { authorityRef: "policedata.nz", tier: 1 };
    }
    return null;
  },
};

const emptyRegistry: RegistryProbe = {
  async resolveAuthority() {
    return null;
  },
};

describe("mode routing — open-web default, stat-grid on registry hit", () => {
  it("routes statistical claims to stat-grid ONLY on a registry hit", async () => {
    const mode = await routeMode(
      { claimType: "statistical", domain: "crime-statistics" },
      probingRegistry,
    );
    expect(mode).toBe("stat-grid");
  });

  it("routes statistical claims to open-web on a registry miss", async () => {
    const mode = await routeMode(
      { claimType: "statistical", domain: "covid-mortality" },
      probingRegistry,
    );
    expect(mode).toBe("open-web");
  });

  it("routes statistical claims to open-web when the registry is empty", async () => {
    const mode = await routeMode(
      { claimType: "statistical", domain: "crime-statistics" },
      emptyRegistry,
    );
    expect(mode).toBe("open-web");
  });

  it("normalises the domain before the registry probe", async () => {
    const seen: string[] = [];
    await routeMode(
      { claimType: "statistical", domain: "Covid Mortality" },
      {
        async resolveAuthority(domain) {
          seen.push(domain);
          return null;
        },
      },
    );
    expect(seen[0]).toBe("covid-mortality");
  });

  it("non-statistical modes route unchanged (citation-backed → citation-check, other → open-web)", async () => {
    expect(await routeMode({ claimType: "citation-backed", domain: "x" }, emptyRegistry)).toBe(
      "citation-check",
    );
    expect(await routeMode({ claimType: "broadcast-quote", domain: "x" }, emptyRegistry)).toBe(
      "quote-fidelity",
    );
    expect(await routeMode({ claimType: "other", domain: "x" }, emptyRegistry)).toBe("open-web");
    expect(await routeMode({ claimType: "institution-citation", domain: "x" }, emptyRegistry)).toBe(
      "citation-check",
    );
  });
});
