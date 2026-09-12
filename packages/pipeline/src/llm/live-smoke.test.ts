// Live smoke: one real Anthropic call per key path (SIT: verify keys + the
// adapter's schema-parse path end-to-end before the five-lane run). Gated
// behind LIVE_EGRESS=1 — the default L1 suite never touches paid APIs (CRO-R6).
// Cost per smoke: a few hundred tokens, fractions of a cent.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLiveAdapter } from "./live-adapter.ts";

describe.runIf(process.env.LIVE_EGRESS === "1")("live provider smoke (LIVE_EGRESS=1)", () => {
  const adapter = createLiveAdapter();

  it("anthropic: returns schema-valid structured output", async () => {
    const schema = z.object({ checkable: z.boolean(), rejectionClass: z.string().optional() });
    const result = await adapter.call({
      role: "triage-checkability",
      system:
        'You classify political sentences for checkability. Reply with ONLY a JSON object: {"checkable": boolean, "rejectionClass": string}. rejectionClass is one of: opinion, rhetoric, procedure, satire, pledge-conditional, question — omit it when checkable is true.',
      user: "Sentence: Crime is up 30 percent since 2017. Classify it.",
      schema,
    });
    expect(result.ok).toBe(true);
    expect((result.value as { checkable?: boolean } | undefined)?.checkable).toBe(true);
    expect(result.usage?.tokensIn).toBeGreaterThan(0);
    expect(result.usage?.tokensOut).toBeGreaterThan(0);
  });

  it("openai: reachable and schema-parses", async () => {
    const schema = z.object({ checkable: z.boolean() });
    const openai = createLiveAdapter({
      "triage-checkability": { provider: "openai", model: "gpt-4.1-mini" },
    });
    const result = await openai.call({
      role: "triage-checkability",
      system: 'Reply with ONLY a JSON object: {"checkable": boolean}.',
      user: "Sentence: What is the Government doing about hospital waiting lists? Classify whether it is a checkable claim.",
      schema,
    });
    expect(result.ok).toBe(true);
    expect((result.value as { checkable?: boolean } | undefined)?.checkable).toBe(false);
  });

  it("serper: search API reachable", async () => {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: "New Zealand police recorded crime statistics 2024" }),
    });
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { organic?: Array<{ title: string }> };
    expect(body.organic?.length).toBeGreaterThan(0);
  });
});
