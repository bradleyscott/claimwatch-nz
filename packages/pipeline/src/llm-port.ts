// The shared LLM boundary for every pipeline stage (ADR-0011: `packages/llm`
// owns providers; a stage depends on a narrow port over one call shape). Roles
// are the only per-stage difference, so the role union is the type parameter.
//
// Before this module each stage restated `LlmUsage`, `LlmCallResult` and the
// `generateObject` signature, and the copies had already drifted: triage's
// failure variant carried `finishReason`, verification's did not, so a truncated
// response was diagnosable in one stage and invisible in the other. One
// definition, superset fields (Sept 2026).

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

/**
 * The one call shape every stage port uses. `Role` is the stage's closed role
 * union; the live adapter routes each role to a model (CROSS-CUTTING §2).
 */
export interface LlmPort<Role extends string = string> {
  generateObject<T>(
    role: Role,
    input: unknown,
    schema: { parse(value: unknown): T },
  ): Promise<LlmCallResult<T>>;
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
    schema: { parse(value: unknown): T },
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
