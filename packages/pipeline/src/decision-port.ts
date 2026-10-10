// The decision port (ADR-0024): typed, calibrated decisions from a System One
// model, alongside the generative port in `llm-port.ts`.
//
// WHY A SEPARATE PORT AND NOT ANOTHER ROLE ON `LlmPort`. A generative port asks
// for a schema and gets text back that happens to parse. A decision port asks for
// a NAMED SET OF QUESTIONS and gets typed answers with probabilities. Those are
// different contracts, and collapsing them would let a decision role be asked for
// prose (which Jev cannot produce) or a prose role be asked for a bare choice
// (which loses the reasoning the NLI gate audits). Two ports make the routing
// honest: a role's transport is visible in its type.
//
// WHAT JEV GUARANTEES, AND WHAT IT DOES NOT. By construction it cannot return an
// option outside the `criteria` it was given, and it cannot return a malformed
// value — there is no format to hallucinate. That is a real improvement over a
// generative classifier, where an invented class name arrives as a schema error
// or, worse, as a plausible string. What it does NOT guarantee is that the
// probabilities are calibrated ON OUR CLAIMS. That is a vendor claim about their
// data, and `packages/harness/src/calibration.ts` exists to measure it here
// before any role gates on a threshold.
//
// PRIMITIVES. Three, and only three: `choice` (one of a labelled set), `score`
// (an ordered 2-10 scale), `noul` (a calibrated yes/no as a probability). A
// question that does not fit one of them is a question for the generative port.

import { z } from "zod";

/** The three primitives, and nothing else — this is Jev's whole vocabulary. */
export const DecisionQuestion = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("noul"),
    instructions: z.string().min(1),
  }),
  z.object({
    type: z.literal("choice"),
    instructions: z.string().min(1),
    /** Label → what it means. At most 255, per the model's own limit. */
    criteria: z.record(z.string(), z.string()),
  }),
  z.object({
    type: z.literal("score"),
    instructions: z.string().min(1),
    /** 2-10 ordered levels, lowest first. */
    criteria: z.array(z.string()).min(2).max(10),
  }),
]);
export type DecisionQuestion = z.infer<typeof DecisionQuestion>;

/** A `choice` answer, with the distribution it came from. */
export const ChoiceAnswer = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
});

export const NoulAnswer = z.object({
  type: z.literal("noul"),
  noul: z.number().min(0).max(1),
});

export const ScoreAnswer = z.object({
  type: z.literal("score"),
  score: z.number(),
  legend: z.record(z.string(), z.string()),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
});

export const DecisionAnswer = z.union([ChoiceAnswer, NoulAnswer, ScoreAnswer]);
export type DecisionAnswer = z.infer<typeof DecisionAnswer>;
export type ChoiceAnswer = z.infer<typeof ChoiceAnswer>;
export type NoulAnswer = z.infer<typeof NoulAnswer>;

export interface DecisionUsage {
  tokensIn: number;
  tokensOut: number;
}

export type DecisionCallResult =
  | {
      ok: true;
      answers: Record<string, DecisionAnswer>;
      usage: DecisionUsage;
      /**
       * The model the provider ACTUALLY served. A floating alias resolves to a
       * dated pin — asking for `typesafe/jev-1.13` returned
       * `typesafe/jev-1.13-20260917` — so this is what provenance must record.
       */
      model: string;
      /** Who served it. `TypeSafe` means OpenRouter proxied to the origin. */
      provider: string;
    }
  | { ok: false; failureClass: DecisionFailureClass; rawOutput?: string };

export type DecisionFailureClass = "schema-validation" | "refusal" | "timeout" | "transport";

/**
 * The decision roles. Kept to the same closed vocabulary as `PROMPT_ROLES`
 * (CROSS-CUTTING §3), because a run manifest validates `promptVersions` keys
 * against it (HAR-R7) — a decision role that is not a role cannot record
 * provenance, and a stage the manifest cannot describe is a stage that does not
 * exist.
 *
 * Only the CLOSED-VOCABULARY classifications are here. `evidence-critiquer` is
 * deliberately absent: its two decisions (`sufficient`, `verdictClass`) are
 * closed choices, but its `reason`, `gaps` and `justifications` are published
 * prose that the strong model writes from the evidence. A decision model cannot
 * write that prose, so routing it there would either lose the prose or move it to
 * a weak model — neither is a saving worth the quality risk. The critiquer stays
 * generative by design.
 */
export type DecisionRole = "triage-speakership" | "triage-checkability";

/**
 * The roles this build routes to the decision model by default (ADR-0024).
 *
 * `triage-checkability` is here on a measurement, not a preference: on the
 * 88-item labelled set it settles 57% of eligible sentences at 96.0% accuracy at
 * threshold 0.70, against a 95% floor. `triage-speakership` is deliberately NOT
 * here — the same run measured 55.7% accuracy with a non-monotonic confidence
 * curve, so it stays generative.
 *
 * `DECISION_ROLES` overrides this: unset takes the default, an empty value turns
 * the routing off, and a list routes exactly the roles it names.
 */
export const DEFAULT_DECISION_ROLES: DecisionRole[] = ["triage-checkability"];

/** Narrow a string to a {@link DecisionRole}, so an unknown name is dropped rather than routed. */
export function isDecisionRole(value: string): value is DecisionRole {
  return value === "triage-speakership" || value === "triage-checkability";
}

/**
 * Resolve the routed roles from the environment. Unset takes the default; an
 * empty value is an explicit "off"; unknown names are dropped, because a typo in
 * `DECISION_ROLES` must not silently route a role nobody measured.
 */
export function decisionRolesFromEnv(
  env: { DECISION_ROLES?: string | undefined } = process.env,
): DecisionRole[] {
  const raw = env.DECISION_ROLES;
  if (raw == null) return [...DEFAULT_DECISION_ROLES];
  return raw
    .split(",")
    .map((role) => role.trim())
    .filter(isDecisionRole);
}

export interface DecisionRequest {
  role: DecisionRole;
  /**
   * Override the model, to pin a dated variant (`typesafe/jev-1.13-20260917`)
   * rather than take the floating alias. Defaults to {@link JEV_MODEL}.
   */
  model?: string;
  /** The text the questions are asked about. Named fields, so a question can refer to one. */
  state: Record<string, unknown>;
  questions: Record<string, DecisionQuestion>;
}

export interface DecisionPort {
  decide(request: DecisionRequest): Promise<DecisionCallResult>;
}

// ---------- the OpenRouter decisions client ----------

export const DECISIONS_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";

/**
 * The response body, as the provider returns it. Parsed rather than trusted:
 * this is an ALPHA endpoint (ADR-0024), so a shape change is expected rather
 * than exceptional, and a parse failure has to surface as a recorded failure
 * class instead of as `undefined` reaching a verdict.
 */
const DecisionsResponse = z.object({
  model: z.string(),
  answers: z.record(z.string(), DecisionAnswer),
  usage: z
    .object({
      input_tokens: z.number().default(0),
      output_tokens: z.number().default(0),
      /** The provider's own cost figure. Deliberately NOT used — see below. */
      cost: z.number().optional(),
    })
    .default({ input_tokens: 0, output_tokens: 0 }),
  provider: z.string().default("unknown"),
});

/**
 * A decision client over OpenRouter's `/api/alpha/decisions`.
 *
 * `fetchImpl` is injectable so the L1 suite exercises the request and the parse
 * against a fake — the same convention as the search adapter (CRO-R6: no paid
 * call by default, CI green with no keys).
 *
 * The provider's returned `usage.cost` is ignored on purpose. Cost is computed at
 * aggregation from the versioned price map (ADR-0012), never pinned at call time,
 * so a rate change re-prices history instead of freezing a figure the provider
 * happened to report.
 */
export function createJevDecisions(apiKey: string, fetchImpl: typeof fetch = fetch): DecisionPort {
  return {
    async decide(request: DecisionRequest): Promise<DecisionCallResult> {
      let response: Response;
      try {
        response = await fetchImpl(DECISIONS_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: request.model ?? JEV_MODEL,
            state: request.state,
            questions: request.questions,
          }),
        });
      } catch (e) {
        return { ok: false, failureClass: "transport", rawOutput: String(e).slice(0, 400) };
      }
      if (!response.ok) {
        // 400 here is not a schema error on our side: the endpoint rejects a
        // chat-shaped request outright, which is worth reading rather than
        // flattening into "bad request".
        const text = await response.text().catch(() => "");
        return {
          ok: false,
          failureClass:
            response.status === 408 || response.status === 504 ? "timeout" : "transport",
          rawOutput: `HTTP ${response.status}: ${text.slice(0, 300)}`,
        };
      }
      const parsed = DecisionsResponse.safeParse(await response.json().catch(() => null));
      if (!parsed.success) {
        return {
          ok: false,
          failureClass: "schema-validation",
          rawOutput: parsed.error.issues
            .map((i) => i.message)
            .join("; ")
            .slice(0, 400),
        };
      }
      const body = parsed.data;
      return {
        ok: true,
        answers: body.answers,
        usage: { tokensIn: body.usage.input_tokens, tokensOut: body.usage.output_tokens },
        model: body.model,
        provider: body.provider,
      };
    },
  };
}

/**
 * The model this build asks for. The undated slug is a floating alias: it
 * resolved to `typesafe/jev-1.13-20260917` when checked. Requesting the undated
 * form is deliberate so a patch release is picked up, and the RESOLVED model is
 * what provenance records — the same discipline as a provider version bump, which
 * the manifest already captures.
 */
export const JEV_MODEL = "typesafe/jev-1.13";

/** The provider key for the price map, derived once so routing and pricing agree. */
export const JEV_PRICE_KEY = `openrouter:${JEV_MODEL}`;
