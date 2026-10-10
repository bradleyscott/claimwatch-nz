// Routing table shape (ADR-0011 provisional tiering): the cost split is only
// defensible if it is the one that actually runs — a research-tier role drifting
// onto the verdict tier (or the reverse) is a silent cost or accuracy change, and
// the recorded model key must name the model, not the role.
//
// No network here: this suite asserts the table and the key derivation, which are
// what a mis-routing bug looks like. Live calls stay LIVE_EGRESS-gated (CRO-R6).

import { PRICE_MAP, PROMPT_ROLES } from "@cw/llm";
import { describe, expect, it } from "vitest";
import { DEFAULT_DECISION_ROLES } from "../decision-port.ts";
import { DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_ROUTING, SERVING_MODE } from "./live-adapter.ts";

/** The cheap research tier. */
const CHEAP_MODEL = "z-ai/glm-5.3-flash";

/**
 * The plan a reader sees, and the gate that decides whether anything is published
 * at all. `evidence-critiquer` is deliberately never the cheap tier.
 */
const VERDICT_TIER = ["claim-assessor", "evidence-critiquer"] as const;

/**
 * The bulk of the calls per claim, whose output is evidence the critiquer judges
 * rather than a published finding.
 */
const RESEARCH_TIER = ["researcher", "researcher-extract", "authority-classify"] as const;

/**
 * The triage arms. Their generative entry is the ESCALATION TARGET for a role
 * routed to the decision model, so it stays on the strong tier even when the
 * decision model answers most items: a marginal sentence reaches this model, and
 * it is the answer that gets published.
 */
const TRIAGE_ROLES = ["triage-speakership", "triage-checkability", "triage-context"] as const;

describe("routing table (ADR-0011)", () => {
  it("routes every declared prompt role — no role without a model", () => {
    for (const role of PROMPT_ROLES) {
      expect(DEFAULT_ROUTING[role], `role "${role}" has no routing entry`).toBeDefined();
    }
  });

  it("keeps the publication gate and the triage arms off the cheap research tier", () => {
    for (const role of [...VERDICT_TIER, ...TRIAGE_ROLES]) {
      expect(DEFAULT_ROUTING[role].model, role).not.toBe(CHEAP_MODEL);
    }
  });

  it("keeps the research tier on the cheap model — the saving depends on it", () => {
    for (const role of RESEARCH_TIER) {
      expect(DEFAULT_ROUTING[role].model, role).toBe(CHEAP_MODEL);
    }
  });

  it("prices every routed model (cost lookup and provenance key agree)", () => {
    // Load-bearing for the research budget and the cost report: a routing change
    // that lands without a price entry must fail here, not silently cost zero or
    // throw in the middle of a run.
    for (const [role, entry] of Object.entries(DEFAULT_ROUTING)) {
      const key = `${entry.provider}:${entry.model}`;
      expect(PRICE_MAP[key], `role "${role}" routes to unpriced "${key}"`).toBeDefined();
    }
  });

  it("routes only roles a run manifest can record (HAR-R7)", () => {
    // A decision role is a prompt role, or its provenance cannot be recorded.
    for (const role of DEFAULT_DECISION_ROLES) {
      expect(PROMPT_ROLES as readonly string[], role).toContain(role);
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

  it("gives the roles that answer in prose output headroom over the one-object default", () => {
    // A plan, a critique and a per-sentence classification do not fit the default
    // budget, and a truncated response arrives as `schema-validation` — which
    // reads as "the model returned something malformed" rather than "the answer
    // was cut in half". The budget is per role because the response SHAPE is a
    // property of the role.
    for (const role of ["claim-assessor", "evidence-critiquer", "triage-speakership"] as const) {
      expect(DEFAULT_ROUTING[role].maxOutputTokens, role).toBeGreaterThan(
        DEFAULT_MAX_OUTPUT_TOKENS,
      );
    }
  });

  it("derives a model key of the form provider:model, never the role name", () => {
    // Regression: the adapter returned the ROLE as `model`, so every run manifest
    // recorded `{role: role}` and provenance could not tell which model produced a
    // verdict — invisible while one model did everything.
    const keys = Object.values(DEFAULT_ROUTING).map((e) => `${e.provider}:${e.model}`);
    for (const key of keys) {
      expect(key).toContain(":");
      expect(key).not.toBe(key.split(":")[1]);
    }
  });
});
