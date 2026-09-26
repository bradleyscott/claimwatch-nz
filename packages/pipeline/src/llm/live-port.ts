// Bridge from the live provider adapter to a stage port (ADR-0011): the one
// place the adapter's `raw` failure field becomes the port's `rawOutput`, and
// the adapter's loose `{ ok, value? }` becomes the discriminated `LlmCallResult`.
//
// Before this, each ops script hand-rolled the same bridge for triage and
// verification — an inline object literal with `role as never` and
// `return { ...call, rawOutput: call.raw } as never`, which spread the adapter
// result and left scripts reading `.raw` off a `.rawOutput` contract. One bridge
// removes the copies and the cast (Sept 2026).

import type { z } from "zod";
import type { LlmCallResult, LlmFailureClass, LlmPort } from "../llm-port.ts";
import type { LiveAdapter, PortRole } from "./live-adapter.ts";

export interface LivePortOptions<Role extends PortRole> {
  /** The system prompt for a role (ops-owned copy, versioned in provenance). */
  promptFor: (role: Role) => string;
  /** The real Zod schema per role; the caller's schema is the fallback. */
  schemas: Record<string, z.ZodTypeAny>;
}

/**
 * Wrap a live adapter as a stage port. Provenance stays the adapter's job: every
 * call goes through `adapter.call`, so a wrapper that records the invoked roles
 * still sees them.
 */
export function portFromAdapter<Role extends PortRole>(
  adapter: LiveAdapter,
  { promptFor, schemas }: LivePortOptions<Role>,
): LlmPort<Role> {
  return {
    async generateObject<T>(
      role: Role,
      input: unknown,
      schema: { parse(value: unknown): T },
    ): Promise<LlmCallResult<T>> {
      const call = await adapter.call<T>({
        role,
        system: promptFor(role),
        user: JSON.stringify(input, null, 2),
        schema: schemas[role] ?? (schema as unknown as z.ZodTypeAny),
      });
      if (call.ok) {
        return {
          ok: true,
          value: call.value as T,
          usage: call.usage ?? { tokensIn: 0, tokensOut: 0 },
          model: call.model ?? "unknown",
        };
      }
      return {
        ok: false,
        failureClass: (call.failureClass ?? "schema-validation") as LlmFailureClass,
        ...(call.raw !== undefined ? { rawOutput: call.raw } : {}),
        ...(call.model !== undefined ? { model: call.model } : {}),
        ...(call.finishReason !== undefined ? { finishReason: call.finishReason } : {}),
      };
    },
  };
}
