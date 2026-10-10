// The decision port (ADR-0024): the request shape, the response parse, and the
// fail-closed behaviour when the alpha endpoint misbehaves.
//
// No network here. The client takes an injectable fetch, the same convention as
// the search adapter — CRO-R6 requires CI to be green with no API keys present,
// and a paid call in an L1 suite would break that.

import { describe, expect, it, vi } from "vitest";
import {
  createJevDecisions,
  DECISIONS_ENDPOINT,
  DEFAULT_DECISION_ROLES,
  type DecisionPort,
  decisionRolesFromEnv,
  JEV_MODEL,
  JEV_PRICE_KEY,
} from "./decision-port.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const request = {
  role: "triage-checkability" as const,
  state: { genre: "news-report" },
  questions: {
    s_1: {
      type: "choice" as const,
      instructions: "Whose words is sentence 1?",
      criteria: { "quoted-actor": "reported speech", "outlet-prose": "narration" },
    },
  },
};

describe("the decisions client (ADR-0024)", () => {
  it("posts to the decisions endpoint, not chat/completions", async () => {
    // The chat endpoint rejects a decisions model with a 400. Pinning the URL
    // here means a future refactor toward the OpenAI-compatible path fails in a
    // test rather than at 2am during the campaign.
    const calls: Array<{ url: string; body: unknown; auth?: string | undefined }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init.body)),
        auth: (init.headers as Record<string, string>).Authorization,
      });
      return jsonResponse({
        model: "typesafe/jev-1.13-20260917",
        answers: {
          s_1: {
            type: "choice",
            choice: "quoted-actor",
            probabilities: { "quoted-actor": 0.98 },
            confidence: 0.98,
          },
        },
        usage: { input_tokens: 367, output_tokens: 63, cost: 1.5414e-5 },
        provider: "TypeSafe",
      });
    }) as unknown as typeof fetch;

    const port = createJevDecisions("k-test", fetchImpl);
    const result = await port.decide(request);

    // Asserted once and then dereferenced: an optional chain immediately followed
    // by a property access throws on a missing call, so the failure reads as a
    // TypeError instead of "the request was never made" — the same fix the search
    // adapter's test needed.
    const call = calls[0];
    if (call == null) throw new Error("no request reached the decisions endpoint");
    expect(call.url).toBe(DECISIONS_ENDPOINT);
    expect(call.url).toContain("/alpha/decisions");
    expect(call.auth).toBe("Bearer k-test");
    expect((call.body as { model: string }).model).toBe(JEV_MODEL);
    expect(result.ok).toBe(true);
  });

  it("reports the RESOLVED model, which is not the one requested", async () => {
    // Asking for the undated alias resolved to a dated pin. Provenance must name
    // what actually ran, so the client surfaces the provider's string rather than
    // echoing the request.
    const fetchImpl = (async () =>
      jsonResponse({
        model: "typesafe/jev-1.13-20260917",
        answers: { s_1: { type: "noul", noul: 0.5 } },
        usage: { input_tokens: 10, output_tokens: 1 },
        provider: "TypeSafe",
      })) as unknown as typeof fetch;

    const result = await createJevDecisions("k", fetchImpl).decide(request);
    expect(result.ok && result.model).toBe("typesafe/jev-1.13-20260917");
    expect(result.ok && result.model).not.toBe(JEV_MODEL);
  });

  it("records the serving provider, because passthrough-to-origin must be visible", async () => {
    // ADR-0011 rule 3: passthrough to the origin operator is treated as using the
    // origin operator, and the routing config has to record which serving mode was
    // used. `provider: "TypeSafe"` is the signal.
    const fetchImpl = (async () =>
      jsonResponse({
        model: "typesafe/jev-1.13",
        answers: {},
        usage: { input_tokens: 1, output_tokens: 0 },
        provider: "TypeSafe",
      })) as unknown as typeof fetch;
    const result = await createJevDecisions("k", fetchImpl).decide(request);
    expect(result.ok && result.provider).toBe("TypeSafe");
  });

  it("surfaces a non-2xx as a transport failure with the provider's message", async () => {
    // The 400 that says "use /api/alpha/decisions instead" is the single most
    // useful diagnostic this endpoint produces; flattening it to "bad request"
    // would throw that away.
    const fetchImpl = (async () =>
      jsonResponse(
        {
          error: {
            message:
              "typesafe/jev-1.13 is a decisions model and cannot be used with the chat/completions endpoint.",
          },
        },
        400,
      )) as unknown as typeof fetch;
    const result = await createJevDecisions("k", fetchImpl).decide(request);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failureClass).toBe("transport");
    expect(!result.ok && result.rawOutput).toContain("decisions model");
  });

  it("maps a gateway timeout to `timeout`, not to a generic failure", async () => {
    const fetchImpl = (async () => jsonResponse({}, 504)) as unknown as typeof fetch;
    const result = await createJevDecisions("k", fetchImpl).decide(request);
    expect(!result.ok && result.failureClass).toBe("timeout");
  });

  it("parses rather than trusts, because the endpoint is alpha", async () => {
    // A shape change at an alpha endpoint has to arrive as a recorded failure
    // class, not as `undefined` reaching a verdict.
    const fetchImpl = (async () =>
      jsonResponse({
        model: "typesafe/jev-1.13",
        answers: "not-an-object",
      })) as unknown as typeof fetch;
    const result = await createJevDecisions("k", fetchImpl).decide(request);
    expect(!result.ok && result.failureClass).toBe("schema-validation");
  });

  it("rejects a noul outside 0..1 rather than clamping it", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        model: "m",
        answers: { s_1: { type: "noul", noul: 1.4 } },
        usage: { input_tokens: 1, output_tokens: 0 },
      })) as unknown as typeof fetch;
    const result = await createJevDecisions("k", fetchImpl).decide(request);
    expect(result.ok).toBe(false);
  });

  it("treats a thrown fetch as transport failure, not as a crash", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const result = await createJevDecisions("k", fetchImpl).decide(request);
    expect(!result.ok && result.failureClass).toBe("transport");
  });

  it("does not use the provider's own cost figure", async () => {
    // Cost is computed at aggregation from the versioned price map (ADR-0012).
    // The client parses `cost` for nothing, so a rate change re-prices history
    // instead of freezing whatever the provider reported.
    const fetchImpl = (async () =>
      jsonResponse({
        model: "typesafe/jev-1.13",
        answers: {},
        usage: { input_tokens: 1000, output_tokens: 10, cost: 999 },
      })) as unknown as typeof fetch;
    const result = await createJevDecisions("k", fetchImpl).decide(request);
    expect(result.ok && JSON.stringify(result)).not.toContain("999");
  });

  it("keeps its price key in step with the model it asks for", async () => {
    // A routing entry with no price row throws at aggregation (the price map
    // fails loudly rather than costing zero), so the two strings must agree.
    expect(JEV_PRICE_KEY).toBe(`openrouter:${JEV_MODEL}`);
    const { costUsd } = await import("@cw/llm");
    expect(costUsd(JEV_PRICE_KEY, { tokensIn: 1_000_000, tokensOut: 1_000_000 })).toBeCloseTo(
      0.042,
      6,
    );
  });

  it("keeps the port injectable so a test never reaches the network", async () => {
    const spy = vi.fn();
    const fake: DecisionPort = {
      decide: async () => {
        spy();
        return { ok: false, failureClass: "transport" };
      },
    };
    await fake.decide(request);
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("the routed roles (ADR-0024)", () => {
  it("routes triage-checkability by default, on the measurement", () => {
    expect(DEFAULT_DECISION_ROLES).toEqual(["triage-checkability"]);
    expect(decisionRolesFromEnv({})).toEqual(["triage-checkability"]);
  });

  it("treats an empty DECISION_ROLES as an explicit off", () => {
    expect(decisionRolesFromEnv({ DECISION_ROLES: "" })).toEqual([]);
  });

  it("routes exactly the roles named, trimming whitespace", () => {
    expect(
      decisionRolesFromEnv({ DECISION_ROLES: " triage-speakership , triage-checkability " }),
    ).toEqual(["triage-speakership", "triage-checkability"]);
  });

  it("drops an unknown name rather than routing it", () => {
    expect(decisionRolesFromEnv({ DECISION_ROLES: "triage-checkability,typo-role" })).toEqual([
      "triage-checkability",
    ]);
  });
});
