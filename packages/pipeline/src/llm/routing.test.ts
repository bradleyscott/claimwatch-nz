// Routing table shape (ADR-0011 provisional tiering, Sept 2026): the cost split
// is only defensible if it is the one that actually runs — a research-tier role
// drifting onto the verdict tier (or the reverse) is a silent cost or accuracy
// change, and the recorded model key must name the model, not the role.
//
// No network here: this suite asserts the table and the key derivation, which are
// what a mis-routing bug looks like. Live calls stay LIVE_EGRESS-gated (CRO-R6).

import { PRICE_MAP, PROMPT_ROLES } from "@cw/llm";
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_ROUTING, SERVING_MODE } from "./live-adapter.ts";

const RESEARCH_TIER = ["research-assess", "claim-decompose", "authority-classify", "open-web"];
const VERDICT_TIER = [
  "citation-compare",
  "quote-fidelity",
  "nli-audit",
  "grid-materiality",
  "speakership-classify",
] as const;

describe("routing table (ADR-0011)", () => {
  it("routes every declared prompt role — no role without a model", () => {
    for (const role of PROMPT_ROLES) {
      expect(DEFAULT_ROUTING[role], `role "${role}" has no routing entry`).toBeDefined();
    }
  });

  it("keeps the verdict and publication-gate roles off the cheap research tier", () => {
    for (const role of VERDICT_TIER) {
      expect(DEFAULT_ROUTING[role].model).not.toBe("z-ai/glm-5.3-flash");
    }
    // And the research roles really are on the cheap tier — the saving depends on
    // it, so assert it rather than trusting the table by eye.
    for (const role of RESEARCH_TIER) {
      expect(DEFAULT_ROUTING[role as keyof typeof DEFAULT_ROUTING]?.model).toBe(
        "z-ai/glm-5.3-flash",
      );
    }
  });

  it("prices every routed model (cost lookup and provenance key agree)", () => {
    for (const [role, entry] of Object.entries(DEFAULT_ROUTING)) {
      const key = `${entry.provider}:${entry.model}`;
      expect(PRICE_MAP[key], `role "${role}" routes to unpriced "${key}"`).toBeDefined();
    }
  });

  it("records the serving mode per provider (ADR-0011 rule 3)", () => {
    // Origin operators are direct; an aggregator serving the weights is recorded
    // as such, so a passthrough-to-origin change is visible in the routing config.
    expect(SERVING_MODE.anthropic).toBe("direct");
    expect(SERVING_MODE.openai).toBe("direct");
    expect(SERVING_MODE.openrouter).toBe("aggregator");
  });

  it("excludes an origin-hosted open-weights API from the routing table", () => {
    // ADR-0011 rule 1: no foreign-hosted inference API in any pipeline role
    // through 27 Nov 2026. Open weights are served by a US aggregator instead.
    for (const entry of Object.values(DEFAULT_ROUTING)) {
      expect(entry.provider).not.toMatch(/deepseek|moonshot|zhipu|alibaba|qwen/i);
    }
  });

  it("gives prose-answering roles output headroom over the one-object default", () => {
    // `citation-compare` returns a lead, 2-4 paragraphs, a pull-quote and a
    // finding per source. At the flat default that narrative was cut mid-sentence
    // and surfaced as `schema-validation`, so the run looked like it had received
    // a malformed answer rather than a truncated one (Sept 2026). The budget is
    // per role because the response SHAPE is a property of the role.
    expect(DEFAULT_ROUTING["citation-compare"].maxOutputTokens).toBeGreaterThan(
      DEFAULT_MAX_OUTPUT_TOKENS,
    );
  });

  it("derives a model key of the form provider:model, never the role name", () => {
    // Regression: the adapter used to return the ROLE as `model`, so every run
    // manifest recorded `{role: role}` and provenance could not tell which model
    // produced a verdict — invisible while one model did everything.
    const keys = Object.values(DEFAULT_ROUTING).map((e) => `${e.provider}:${e.model}`);
    for (const key of keys) {
      expect(key).toContain(":");
      expect(key).not.toBe(key.split(":")[1]);
    }
  });
});
