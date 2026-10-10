// The shared LLM boundary for every pipeline stage (ADR-0011: `packages/llm`
// owns providers; a stage depends on a narrow port over one call shape). Roles
// are the only per-stage difference, so the role union is the type parameter.
// One definition of the usage, result and call shapes, so a failure is
// diagnosable the same way in every stage.

export interface LlmUsage {
  tokensIn: number;
  tokensOut: number;
}

export type LlmFailureClass = "schema-validation" | "llm-refusal" | "timeout";

/**
 * The result of one structured call. The failure variant carries `finishReason`
 * so a response cut at the output budget is distinguishable from a refusal —
 * both otherwise arrive as `schema-validation`.
 */
export type LlmCallResult<T> =
  | { ok: true; value: T; usage: LlmUsage; model: string }
  | {
      ok: false;
      failureClass: LlmFailureClass;
      rawOutput?: string;
      model?: string;
      /** Why generation stopped — `length` marks a truncated response. */
      finishReason?: string;
    };

import type { z } from "zod";

/**
 * The one call shape every stage port uses. `Role` is the stage's closed role
 * union; the live adapter routes each role to a model (CROSS-CUTTING §2).
 *
 * The Zod schema is a first-class argument, not a `{ parse }` wrapper: the Vercel
 * AI SDK's `generateObject` takes the schema and constrains the model with it,
 * so the stage does not restate the output format inside the prompt. The mock
 * parses the schema to keep the same validation boundary the live call has
 * (ADR-0026 §9).
 */
export interface LlmPort<Role extends string = string> {
  generateObject<T>(role: Role, input: unknown, schema: z.ZodType<T>): Promise<LlmCallResult<T>>;
}

/** What a test script returns for one call, before the mock parses the schema. */
export interface ScriptedResult {
  ok: boolean;
  value?: unknown;
  raw?: string;
  failureClass?: string;
}

/**
 * Base for the deterministic test mocks. A stage's mock subclasses this and adds
 * its own scripted factories; the call body and the failure mapping live here, so
 * two mocks cannot map a failure differently or drift apart.
 */
export abstract class ScriptedLlm<Role extends string> implements LlmPort<Role> {
  protected constructor(
    private readonly script: (role: Role, input: unknown) => ScriptedResult,
    private readonly model: string,
    private readonly usage: LlmUsage,
  ) {}

  async generateObject<T>(
    role: Role,
    input: unknown,
    schema: z.ZodType<T>,
  ): Promise<LlmCallResult<T>> {
    const out = this.script(role, input);
    if (!out.ok) {
      return {
        ok: false,
        failureClass: (out.failureClass ?? "schema-validation") as LlmFailureClass,
        ...(out.raw !== undefined ? { rawOutput: out.raw } : {}),
        model: this.model,
      };
    }
    return { ok: true, value: schema.parse(out.value), usage: this.usage, model: this.model };
  }
}
