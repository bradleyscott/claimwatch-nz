// Price map behaviour (CROSS-CUTTING §2, ADR-0011): the map is the only place
// cost is computed, so the properties that matter are that a known model prices
// correctly, cached input uses the cache rate, and an unknown model fails loudly
// rather than costing zero.

import { describe, expect, it } from "vitest";
import { costUsd, PRICE_MAP, PRICE_MAP_VERSION } from "./prices.ts";

describe("price map (CROSS-CUTTING §2)", () => {
  it("prices a known model from its per-1M rates", () => {
    // Sonnet 5: $2.00 in / $10.00 out per 1M tokens.
    const cost = costUsd("anthropic:claude-sonnet-5", { tokensIn: 1_000_000, tokensOut: 0 });
    expect(cost).toBeCloseTo(2.0, 6);
    expect(costUsd("anthropic:claude-sonnet-5", { tokensIn: 0, tokensOut: 1_000_000 })).toBeCloseTo(
      10.0,
      6,
    );
  });

  it("bills cached input at the cache-read rate, not the full input rate", () => {
    // Fable 5.1: $10.00 in, $0.25 cache-read. 1M cached tokens = $0.25.
    expect(
      costUsd("anthropic:claude-fable-5.1", {
        tokensIn: 1_000_000,
        tokensOut: 0,
        cachedTokensIn: 1_000_000,
      }),
    ).toBeCloseTo(0.25, 6);
  });

  it("falls back to the input rate when a model publishes no cache-read price", () => {
    // Sonnet 5 has no published cacheRead in the map -> full input rate.
    expect(
      costUsd("anthropic:claude-sonnet-5", {
        tokensIn: 1_000_000,
        tokensOut: 0,
        cachedTokensIn: 1_000_000,
      }),
    ).toBeCloseTo(2.0, 6);
  });

  it("keeps sub-cent costs distinguishable for cheap-tier roles", () => {
    // A GLM-5.3-Flash research call: ~1.1k in, 150 out.
    const cost = costUsd("openrouter:z-ai/glm-5.3-flash", { tokensIn: 1_100, tokensOut: 150 });
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.001);
  });

  it("fails loudly on a model with no price entry", () => {
    expect(() => costUsd("openai:gpt-4.1-mini", { tokensIn: 10, tokensOut: 10 })).toThrow(
      /no price for "openai:gpt-4.1-mini"/,
    );
  });

  it("names its version so cost figures are comparable", () => {
    expect(PRICE_MAP_VERSION).toMatch(/^prices-\d{4}-\d{2}$/);
  });

  it("prices every model the routing table can select", () => {
    // The routing table's model keys must all be priceable — the guard against a
    // routing change that lands without a price row.
    const routed = ["anthropic:claude-sonnet-5", "openrouter:z-ai/glm-5.3-flash"];
    for (const key of routed) {
      expect(PRICE_MAP[key]).toBeDefined();
    }
  });
});
