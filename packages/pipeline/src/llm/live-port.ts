// Bridge from the live provider adapter to a stage port (ADR-0011): the one
// place the adapter's `raw` failure field becomes the port's `rawOutput`, and
// the adapter's loose `{ ok, value? }` becomes the discriminated `LlmCallResult`.
//
// The Zod schema is a first-class argument, passed straight to the AI SDK's
// `generateObject`, which constrains the model with it (ADR-0026 §9).

import type { z } from "zod";
import type { AgentCall, AgentPort } from "../agent-port.ts";
import type { LlmCallResult, LlmFailureClass, LlmPort } from "../llm-port.ts";
import type { LiveAdapter, PortRole } from "./live-adapter.ts";

export interface LivePortOptions<Role extends PortRole> {
  /** The system prompt for a role (ops-owned copy, versioned in provenance). */
  promptFor: (role: Role) => string;
}

/**
 * Wrap a live adapter as a stage port. Provenance stays the adapter's job: every
 * call goes through `adapter.call`, so a wrapper that records the invoked roles
 * still sees them.
 */
export function portFromAdapter<Role extends PortRole>(
  adapter: LiveAdapter,
  { promptFor }: LivePortOptions<Role>,
): LlmPort<Role> {
  return {
    async generateObject<T>(
      role: Role,
      input: unknown,
      schema: z.ZodType<T>,
    ): Promise<LlmCallResult<T>> {
      const call = await adapter.call<T>({
        role,
        system: promptFor(role),
        user: JSON.stringify(input, null, 2),
        schema,
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

/**
 * The tool-loop port over the same adapter. The role still routes the model, so
 * the researcher's loop is recorded like any other call (ADR-0011, HAR-R7).
 */
export function agentPortFromAdapter(adapter: LiveAdapter): AgentPort {
  return {
    runAgent: (call: AgentCall) => adapter.runAgent(call),
  };
}
