// Live LLM provider adapter (ADR-0011 + ADR-0014): implements the TriageLlm and
// VerificationLlm ports via the Vercel AI SDK — the adopted provider abstraction
// (generateObject per step; no raw HTTP). Routing is configuration (CROSS-CUTTING
// §2); prompts stay vendor-neutral. Batch-routed per ADR-0011: latency_class:
// batch for everything except publish-day verdicts.
//
// Tiered routing (Sept 2026 cost work): the RESEARCH tier (claim decomposition,
// per-round evidence grading, authority tiering) runs on an extreme-value model —
// it is ~80% of the calls per claim and its output is a control signal, not the
// published verdict. The VERDICT tier (`citation-compare`) and the publication
// gate (`nli-audit`) stay on the mid tier; `grid-materiality` touches published
// class boundaries and also stays. Rationale and the harness gate live in
// ADR-0011's provisional routing note.
//
// Transport note: Node's Happy Eyeballs connects via an unreachable IPv6 path
// to api.anthropic.com. The Anthropic provider factory therefore receives an
// undici fetch pinned to IPv4 (`connect: { family: 4 }`). OpenAI's provider
// settings in this SDK version expose no custom fetch; the OpenAI smoke is
// gated off until the SDK ships it (tracked gap).

import { setDefaultResultOrder } from "node:dns";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { type PromptRole, SAMPLING, SEEDABLE_PROVIDERS } from "@cw/llm";
import { generateObject } from "ai";
import type { z } from "zod";

setDefaultResultOrder("ipv4first");

/**
 * Runtime port roles, derived from the shared prompt-role vocabulary
 * (CROSS-CUTTING §2): the pipeline cannot route a role the harness manifest
 * would reject as having no prompt behind it (HAR-R7).
 */
export type PortRole = PromptRole;

export interface ProviderCall {
  role: PortRole;
  system: string;
  user: string;
  schema: z.ZodTypeAny;
  maxOutputTokens?: number;
}

export interface ProviderResult<T> {
  ok: boolean;
  value?: T;
  usage?: { tokensIn: number; tokensOut: number };
  /**
   * The model that actually ran, as `provider:model` — the same key the price
   * map and the harness `modelVersions` use. It used to carry the ROLE name, so
   * every recorded run claimed the role had produced itself: with one model
   * everywhere that was merely wrong, with a tiered table it would attribute the
   * cheap tier's work to the expensive one (Sept 2026).
   */
  model?: string;
  /** How the model was served (ADR-0011 rule 3) — recorded on every call. */
  servingMode?: ServingMode;
  /**
   * Why generation stopped. `length` means the response was cut at the output
   * budget, which is the difference between a truncated answer and a model that
   * refused: the checkability fan-out truncated at the 2048-token default and
   * the only signal was `schema-validation — the model did not return a
   * response`, which names neither the cause nor the fix (Sept 2026).
   */
  finishReason?: string;
  failureClass?: "schema-validation" | "llm-refusal" | "timeout";
  raw?: string;
}

export interface LiveAdapter {
  call<T>(providerCall: ProviderCall): Promise<ProviderResult<T>>;
}

export type Provider = "anthropic" | "openai" | "openrouter";

/**
 * Serving mode per ADR-0011 rule 3: what actually processes the request. `direct`
 * is the provider's own inference; `aggregator` is a non-origin host serving the
 * weights (US-hosted, permitted). Passthrough-to-origin through an aggregator is
 * treated as the origin operator and is NOT a mode this adapter configures — the
 * OpenRouter base URL below is its own inference endpoint, never a passthrough
 * to a Chinese-hosted origin API, which rule 1 excludes for the whole cycle.
 */
export type ServingMode = "direct" | "aggregator";

export const SERVING_MODE: Record<Provider, ServingMode> = {
  anthropic: "direct",
  openai: "direct",
  openrouter: "aggregator",
};

/** Default output-token budget when a role declares none and the call site does
 * not override: sized for a one-object answer. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

/**
 * A role's routing entry. `maxOutputTokens` is part of the entry because the
 * response SHAPE is a property of the role, not of the provider: a role that
 * returns a single verdict object fits the default, and a role that returns
 * authored prose does not. A truncated response arrives as a schema failure, so
 * an under-sized budget reads as "the model returned something malformed"
 * rather than "the answer was cut in half" (Sept 2026).
 */
export interface RoutingEntry {
  provider: Provider;
  model: string;
  /** Output budget for this role; falls back to DEFAULT_MAX_OUTPUT_TOKENS. */
  maxOutputTokens?: number;
}

// Role → provider/model routing, per ADR-0011's table. Overridable via config
// (the harness arbitrates per role on measured performance).
export const DEFAULT_ROUTING: Record<PortRole, RoutingEntry> = {
  // Triage: high-volume structured extraction over mundane text.
  "triage-checkability": { provider: "anthropic", model: "claude-sonnet-5" },
  "triage-typing": { provider: "anthropic", model: "claude-sonnet-5" },
  "triage-context": { provider: "anthropic", model: "claude-sonnet-5" },
  // The figures procedure's first step (ADR-0023): parse the claim's window and
  // magnitude at the point of use. It replaces `triage-fingerprint`, and sits on
  // the verdict tier rather than the triage tier because its output decides what
  // the claim is compared against — a mis-parse is an abstention, and an
  // abstention is a published outcome.
  "claim-parameters": { provider: "anthropic", model: "claude-sonnet-5" },
  // Choosing which procedures a claim needs. Verdict tier for the same reason:
  // an omitted procedure is invisible in the output.
  "plan-for-claim": { provider: "anthropic", model: "claude-sonnet-5" },

  // Verdict tier: the published verdict and the publication gate. Deliberately
  // NOT the cheap tier — a cheap adjudicator is cheap in the way that matters
  // least (ADR-0011: calibration over benchmark score). `quote-fidelity` is here
  // because it produces a published verdict (VERIFICATION §2.4), not a control
  // signal: wording-critical claims turn on its reading of the caption.
  "grid-materiality": { provider: "anthropic", model: "claude-sonnet-5" },
  // The only role that returns authored prose: a lead, 2-4 paragraphs, a
  // pull-quote and a finding per source. At the default the narrative was cut
  // mid-sentence and the run blocked on `finish_reason: length` — twice on the
  // first lane that reached publication (Sept 2026).
  "citation-compare": {
    provider: "anthropic",
    model: "claude-sonnet-5",
    maxOutputTokens: 4096,
  },
  "quote-fidelity": { provider: "anthropic", model: "claude-sonnet-5" },
  "nli-audit": { provider: "anthropic", model: "claude-sonnet-5" },
  // Speakership attribution (ADR-0019) sits on the verdict tier even though it
  // is not a verdict, because its errors do not degrade gracefully the way the
  // research tier's do: a false `quoted-actor` publishes an outlet's own
  // sentence, and a false `outlet-prose` silently drops a politician's claim.
  // Both are public-quality failures, so "cheap here" is not cheap.
  "speakership-classify": {
    provider: "anthropic",
    model: "claude-sonnet-5",
    // One result per sentence, so the response grows with the document — the
    // budget is explicit here rather than inherited, per the same lesson as
    // `citation-compare` (Sept 2026).
    maxOutputTokens: 4096,
  },

  // Research tier: ~80% of calls per claim, output is a control signal (rounds
  // and gaps), and its confidence is neither published nor written to a verdict.
  // `open-web` is the depth-loop control (done/confidence/nextRound), not the
  // published open-web verdict — that comes from `citation-compare`.
  "open-web": { provider: "openrouter", model: "z-ai/glm-5.3-flash" },
  "authority-classify": { provider: "openrouter", model: "z-ai/glm-5.3-flash" },
  "claim-decompose": { provider: "openrouter", model: "z-ai/glm-5.3-flash" },
  "research-assess": { provider: "openrouter", model: "z-ai/glm-5.3-flash" },
};

const PROVIDER_ENV: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

/** OpenRouter's own inference endpoint (US-hosted). Never a passthrough URL. */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function apiKeyFor(provider: Provider): string {
  const key = process.env[PROVIDER_ENV[provider]];
  if (!key) {
    throw new Error(
      `${PROVIDER_ENV[provider]} is not set — copy .env.example to .env and fill it in`,
    );
  }
  return key;
}

async function ipv4FetchForNode(
  input: string | URL | globalThis.Request,
  init?: RequestInit,
): Promise<Response> {
  const { fetch: undiciFetch, Agent } = await import("undici");
  const agent = new Agent({ connect: { family: 4 } });
  return (await undiciFetch(
    input as never,
    { ...(init ?? {}), dispatcher: agent } as never,
  )) as unknown as Response;
}

type FetchFunction = typeof globalThis.fetch;

type GenerateModel = Parameters<typeof generateObject>[0]["model"];

export function createLiveAdapter(routing?: Partial<typeof DEFAULT_ROUTING>): LiveAdapter {
  const table = { ...DEFAULT_ROUTING, ...(routing ?? {}) };
  // Provider clients are built LAZILY, on first use by the routing table. Keys
  // are therefore required only for the providers actually selected: a routing
  // config that sends everything to one provider must not demand the other two
  // keys, and a test that constructs an adapter must not need any key at all
  // until it makes a call.
  const modelFactories = new Map<Provider, (model: string) => GenerateModel>();
  const modelFactoryFor = (provider: Provider): ((model: string) => GenerateModel) => {
    const cached = modelFactories.get(provider);
    if (cached != null) return cached;
    // Both provider factories take a custom fetch (typeof globalThis.fetch).
    // Node's undici fetch pinned to IPv4 is required (Happy Eyeballs picks the
    // unreachable IPv6 path to api.anthropic.com).
    const transport = { fetch: ipv4FetchForNode as unknown as FetchFunction };
    let factory: (model: string) => GenerateModel;
    switch (provider) {
      case "anthropic": {
        const client = createAnthropic({ apiKey: apiKeyFor("anthropic"), ...transport });
        factory = (model) => client(model) as GenerateModel;
        break;
      }
      case "openai": {
        const client = createOpenAI({ apiKey: apiKeyFor("openai"), ...transport });
        factory = (model) => client(model) as GenerateModel;
        break;
      }
      case "openrouter": {
        // OpenRouter is OpenAI-compatible, so it rides the OpenAI provider
        // factory pointed at OpenRouter's OWN inference endpoint (US-hosted).
        // This is deliberately not a passthrough URL: ADR-0011 rule 3 treats
        // passthrough-to-origin as the origin operator, which rule 1 excludes.
        const client = createOpenAI({
          apiKey: apiKeyFor("openrouter"),
          baseURL: OPENROUTER_BASE_URL,
          ...transport,
        });
        factory = (model) => client(model) as GenerateModel;
        break;
      }
    }
    modelFactories.set(provider, factory);
    return factory;
  };
  const routingFor = (role: PortRole) => {
    const entry = table[role];
    if (entry == null) {
      throw new Error(`no routing entry for role "${role}" — the role has no model behind it`);
    }
    return entry;
  };
  return {
    async call<T>(providerCall: ProviderCall): Promise<ProviderResult<T>> {
      const entry = routingFor(providerCall.role);
      const modelKey = `${entry.provider}:${entry.model}`;
      try {
        const result = await generateObject({
          model: modelFactoryFor(entry.provider)(entry.model),
          schema: providerCall.schema,
          system: providerCall.system,
          prompt: providerCall.user,
          maxOutputTokens:
            providerCall.maxOutputTokens ?? entry.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          // Sampling is pinned (CROSS-CUTTING §2, SAMPLING): the same document
          // triaged twice at the provider's default returned 31 claims and then
          // 42, which moves a published disclosure — the set-aside list — between
          // runs of identical input. Seeding is provider-conditional; Anthropic
          // accepts no seed, so its determinism rests on temperature alone.
          temperature: SAMPLING.temperature,
          ...(SEEDABLE_PROVIDERS.includes(entry.provider as never) ? { seed: SAMPLING.seed } : {}),
        });
        return {
          ok: true,
          value: result.object as T,
          usage: {
            tokensIn: result.usage.inputTokens ?? 0,
            tokensOut: result.usage.outputTokens ?? 0,
          },
          model: modelKey,
          servingMode: SERVING_MODE[entry.provider],
          finishReason: result.finishReason,
        };
      } catch (e) {
        const err = e as { name?: string; message?: string };
        const isSchema =
          err.name === "AI_NoObjectGeneratedError" || /schema|parse|json/i.test(err.message ?? "");
        const rawText =
          (err as { text?: string }).text ??
          (err as { cause?: { text?: string } }).cause?.text ??
          "";
        return {
          ok: false,
          failureClass: isSchema ? "schema-validation" : "llm-refusal",
          model: modelKey,
          servingMode: SERVING_MODE[entry.provider],
          // Available on the SDK's no-object error; absent for a transport error.
          ...((e as { finishReason?: string }).finishReason != null
            ? { finishReason: String((e as { finishReason?: string }).finishReason) }
            : {}),
          raw: [err.message ?? "", rawText].filter(Boolean).join(" | ").slice(0, 1500),
        };
      }
    },
  };
}
