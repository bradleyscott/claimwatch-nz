// Live LLM provider adapter (ADR-0011 + ADR-0014): implements the pipeline's
// LLM ports via the Vercel AI SDK — the adopted provider abstraction
// (generateObject per step; no raw HTTP). Routing is configuration (CROSS-CUTTING
// §2); prompts stay vendor-neutral. Batch-routed per ADR-0011: latency_class:
// batch for everything except publish-day verdicts.
//
// Tiered routing: the RESEARCH tier (the researcher and source classification)
// runs on an extreme-value model — it is the bulk of the calls per claim and its
// output is evidence to be judged, not the published finding. The VERDICT tier
// (`claim-assessor`, `evidence-critiquer`) stays on the mid tier, because the
// plan and the sufficiency decision are what a reader sees. Rationale and the
// harness gate live in ADR-0011's provisional routing note.
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
import { generateObject, generateText, hasToolCall, stepCountIs, type ToolSet, tool } from "ai";
import type { z } from "zod";
import type { AgentCall, AgentCallResult, AgentStepRecord } from "../agent-port.ts";

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
   * map and the harness `modelVersions` use. It carries the provider:model, not
   * the role name, so a tiered routing table attributes each call to the model
   * that produced it.
   */
  model?: string;
  /** How the model was served (ADR-0011 rule 3) — recorded on every call. */
  servingMode?: ServingMode;
  /**
   * Why generation stopped. `length` means the response was cut at the output
   * budget, which is the difference between a truncated answer and a model that
   * refused: a cut response otherwise arrives as `schema-validation — the model
   * did not return a response`, which names neither the cause nor the fix.
   */
  finishReason?: string;
  failureClass?: "schema-validation" | "llm-refusal" | "timeout";
  raw?: string;
}

export interface LiveAdapter {
  call<T>(providerCall: ProviderCall): Promise<ProviderResult<T>>;
  /** Run a bounded tool loop for a role that plans, calls tools and decides. */
  runAgent(agentCall: AgentCall): Promise<AgentCallResult>;
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
 * Wall-clock bounds on a model call, and the retry count.
 *
 * WHY THESE EXIST. Neither the SDK nor the provider factories bound a call by
 * default: the AI SDK retries twice and the provider SDKs allow ~10 minutes an
 * attempt, so ONE stalled request can hold a live run for half an hour before it
 * surfaces as an error. A research run that hangs silently is worse than one that
 * fails: it spends nothing and reports nothing. The bound makes a stall a
 * recorded `timeout` failure the loop can degrade from.
 *
 * A single-object call is bounded tightly; the tool loop is given more room
 * because it runs several steps, searches and page reads inside one call.
 */
export const LLM_CALL_TIMEOUT_MS = 180_000;
export const LLM_AGENT_TIMEOUT_MS = 600_000;
export const LLM_MAX_RETRIES = 1;

/**
 * A role's routing entry. `maxOutputTokens` is part of the entry because the
 * response SHAPE is a property of the role, not of the provider: a role that
 * returns a single verdict object fits the default, and a role that returns
 * authored prose does not. A truncated response arrives as a schema failure, so
 * an under-sized budget reads as "the model returned something malformed"
 * rather than "the answer was cut in half".
 */
export interface RoutingEntry {
  provider: Provider;
  model: string;
  /** Output budget for this role; falls back to DEFAULT_MAX_OUTPUT_TOKENS. */
  maxOutputTokens?: number;
}

// Role → provider/model routing, per ADR-0011's table. Overridable via config
// (the harness arbitrates per role on measured performance).
//
// The verdict tier carries triage, the assessor and the critiquer; the research
// tier carries the researcher's tool loop, its passage extractor and source
// classification.
export const DEFAULT_ROUTING: Record<PortRole, RoutingEntry> = {
  // Triage axis 1: whose words the sentence is. One result per sentence.
  "triage-speakership": {
    provider: "anthropic",
    model: "claude-sonnet-5",
    maxOutputTokens: 4096,
  },
  // Triage axis 2: what the sentence is. One result per eligible sentence.
  "triage-checkability": {
    provider: "anthropic",
    model: "claude-sonnet-5",
    maxOutputTokens: 4096,
  },
  // The context pass: what the claim is used to support, read over the WHOLE
  // document (ADR-0026), not a moving window.
  "triage-context": { provider: "anthropic", model: "claude-sonnet-5" },

  // The verdict tier: the plan, the sufficiency decision and the verbatim
  // extraction are what a reader sees, so they stay on the strong model. The
  // assessor is adversarial by instruction and the critiquer is the publication
  // gate (ADR-0026); `evidence-critiquer` is deliberately NOT the cheap tier.
  "claim-assessor": {
    provider: "anthropic",
    model: "claude-sonnet-5",
    // The plan (evidence plan + questions + sources) can run long; the default
    // single-object budget truncates it and surfaces as a schema failure.
    maxOutputTokens: 4096,
  },
  // Extraction is a structured read of pages the researcher already fetched, and
  // the critiquer judges what comes back, so it runs on the research tier: the
  // strong model buys nothing here that the critiquer does not already gate.
  "researcher-extract": {
    provider: "openrouter",
    model: "z-ai/glm-5.3-flash",
    maxOutputTokens: 4096,
  },
  "evidence-critiquer": {
    provider: "anthropic",
    model: "claude-sonnet-5",
    maxOutputTokens: 4096,
  },

  // Research tier: the researcher's tool loop — the bulk of the calls per claim,
  // and its output is evidence the critiquer judges rather than a published
  // finding. The loop is bounded by the SDK's step limit and the tool budgets.
  researcher: {
    provider: "openrouter",
    model: "z-ai/glm-5.3-flash",
    maxOutputTokens: 4096,
  },
  "authority-classify": { provider: "openrouter", model: "z-ai/glm-5.3-flash" },
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
          // Bounds the whole call, retries included (see LLM_CALL_TIMEOUT_MS).
          abortSignal: AbortSignal.timeout(LLM_CALL_TIMEOUT_MS),
          maxRetries: LLM_MAX_RETRIES,
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
        const isTimeout =
          err.name === "AbortError" ||
          err.name === "TimeoutError" ||
          /aborted|timed? ?out/i.test(err.message ?? "");
        const isSchema =
          err.name === "AI_NoObjectGeneratedError" || /schema|parse|json/i.test(err.message ?? "");
        const rawText =
          (err as { text?: string }).text ??
          (err as { cause?: { text?: string } }).cause?.text ??
          "";
        return {
          ok: false,
          failureClass: isTimeout ? "timeout" : isSchema ? "schema-validation" : "llm-refusal",
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

    async runAgent(agentCall: AgentCall): Promise<AgentCallResult> {
      const entry = routingFor(agentCall.role as PortRole);
      const modelKey = `${entry.provider}:${entry.model}`;
      try {
        const tools = Object.fromEntries(
          Object.entries(agentCall.tools).map(([name, spec]) => {
            const base = { description: spec.description, inputSchema: spec.inputSchema };
            return [
              name,
              spec.execute
                ? tool({ ...base, execute: (input: unknown) => spec.execute?.(input) })
                : tool(base),
            ];
          }),
        ) as ToolSet;
        const result = await generateText({
          model: modelFactoryFor(entry.provider)(entry.model),
          system: agentCall.system,
          prompt: agentCall.prompt,
          tools,
          // The loop is bounded by the SDK's step limit and by the stop tool the
          // model calls when it judges the turn finished.
          stopWhen: [stepCountIs(agentCall.maxSteps), hasToolCall(agentCall.stopTool)],
          maxOutputTokens: entry.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          temperature: SAMPLING.temperature,
          ...(SEEDABLE_PROVIDERS.includes(entry.provider as never) ? { seed: SAMPLING.seed } : {}),
          // Bounds the whole tool loop, retries included (see LLM_AGENT_TIMEOUT_MS).
          abortSignal: AbortSignal.timeout(LLM_AGENT_TIMEOUT_MS),
          maxRetries: LLM_MAX_RETRIES,
        });
        const steps: AgentStepRecord[] = result.steps.map((step) => ({
          stepNumber: step.stepNumber,
          toolCalls: step.toolCalls.map((call) => ({ toolName: call.toolName, input: call.input })),
          toolResults: step.toolResults.map((res) => ({
            toolName: res.toolName,
            output: res.output,
          })),
          text: step.text,
          tokensIn: step.usage.inputTokens ?? 0,
          tokensOut: step.usage.outputTokens ?? 0,
        }));
        return {
          ok: true,
          steps,
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
        const isTimeout =
          err.name === "AbortError" ||
          err.name === "TimeoutError" ||
          /aborted|timed? ?out/i.test(err.message ?? "");
        const isSchema =
          err.name === "AI_NoObjectGeneratedError" || /schema|parse|json/i.test(err.message ?? "");
        return {
          ok: false,
          failureClass: isTimeout ? "timeout" : isSchema ? "schema-validation" : "llm-refusal",
          model: modelKey,
          ...((e as { finishReason?: string }).finishReason != null
            ? { finishReason: String((e as { finishReason?: string }).finishReason) }
            : {}),
          rawOutput: (err.message ?? "").slice(0, 1500),
        };
      }
    },
  };
}
