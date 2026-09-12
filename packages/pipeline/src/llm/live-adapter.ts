// Live LLM provider adapter (ADR-0011 + ADR-0014): implements the TriageLlm and
// VerificationLlm ports via the Vercel AI SDK — the adopted provider abstraction
// (generateObject per step; no raw HTTP). Routing is configuration (CROSS-CUTTING
// §2); prompts stay vendor-neutral. Batch-routed per ADR-0011: latency_class:
// batch for everything except publish-day verdicts.
//
// Transport note: Node's Happy Eyeballs connects via an unreachable IPv6 path
// to api.anthropic.com (Bun is unaffected). Under Node, the Anthropic provider
// factory receives an undici fetch pinned to IPv4 (`connect: { family: 4 }`).
// OpenAI's provider settings in this SDK version expose no custom fetch; under
// Node the OpenAI smoke is gated off until the SDK ships it (tracked gap).

import { setDefaultResultOrder } from "node:dns";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import type { z } from "zod";

setDefaultResultOrder("ipv4first");

export type PortRole =
  | "triage-checkability"
  | "triage-typing"
  | "triage-fingerprint"
  | "triage-context"
  | "grid-materiality"
  | "citation-compare"
  | "quote-fidelity"
  | "nli-audit"
  | "open-web";

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
  model?: string;
  failureClass?: "schema-validation" | "llm-refusal" | "timeout";
  raw?: string;
}

export interface LiveAdapter {
  call<T>(providerCall: ProviderCall): Promise<ProviderResult<T>>;
}

// Role → provider/model routing, per ADR-0011's table. Overridable via config
// (the harness arbitrates per role on measured performance).
export const DEFAULT_ROUTING: Record<
  PortRole,
  { provider: "anthropic" | "openai"; model: string }
> = {
  "triage-checkability": { provider: "anthropic", model: "claude-sonnet-5" },
  "triage-typing": { provider: "anthropic", model: "claude-sonnet-5" },
  "triage-fingerprint": { provider: "anthropic", model: "claude-sonnet-5" },
  "triage-context": { provider: "anthropic", model: "claude-sonnet-5" },
  "grid-materiality": { provider: "anthropic", model: "claude-sonnet-5" },
  "citation-compare": { provider: "anthropic", model: "claude-sonnet-5" },
  "quote-fidelity": { provider: "anthropic", model: "claude-sonnet-5" },
  "nli-audit": { provider: "anthropic", model: "claude-sonnet-5" },
  "open-web": { provider: "anthropic", model: "claude-sonnet-5" },
};

const PROVIDER_ENV: Record<"anthropic" | "openai", string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

export function apiKeyFor(provider: "anthropic" | "openai"): string {
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

const runningUnderBun = typeof process.versions.bun === "string";

type FetchFunction = typeof globalThis.fetch;

export function createLiveAdapter(routing?: Partial<typeof DEFAULT_ROUTING>): LiveAdapter {
  const table = { ...DEFAULT_ROUTING, ...(routing ?? {}) };
  // Both provider factories take a custom fetch (typeof globalThis.fetch).
  // Under Bun the native fetch works; under Node the undici fetch pinned to
  // IPv4 is required (Happy Eyeballs picks the unreachable IPv6 path).
  const transport = runningUnderBun ? {} : { fetch: ipv4FetchForNode as unknown as FetchFunction };
  const anthropic = createAnthropic({ apiKey: apiKeyFor("anthropic"), ...transport });
  const openai = createOpenAI({ apiKey: apiKeyFor("openai"), ...transport });
  const modelFor = (role: PortRole) => {
    const entry = table[role];
    return entry.provider === "anthropic" ? anthropic(entry.model) : openai(entry.model);
  };
  return {
    async call<T>(providerCall: ProviderCall): Promise<ProviderResult<T>> {
      try {
        const result = await generateObject({
          model: modelFor(providerCall.role),
          schema: providerCall.schema,
          system: providerCall.system,
          prompt: providerCall.user,
          maxOutputTokens: providerCall.maxOutputTokens ?? 1024,
        });
        return {
          ok: true,
          value: result.object as T,
          usage: {
            tokensIn: result.usage.inputTokens ?? 0,
            tokensOut: result.usage.outputTokens ?? 0,
          },
          model: providerCall.role,
        };
      } catch (e) {
        const err = e as { name?: string; message?: string };
        const isSchema =
          err.name === "AI_NoObjectGeneratedError" || /schema|parse|json/i.test(err.message ?? "");
        return {
          ok: false,
          failureClass: isSchema ? "schema-validation" : "llm-refusal",
          raw: (err.message ?? "").slice(0, 500),
        };
      }
    },
  };
}
