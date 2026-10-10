// TriageLlm port — the injectable LLM boundary for triage (ADR-0011). L1 tests
// drive the mock; the live wiring is `portFromAdapter`.

import type { LlmPort, ScriptedResult } from "./llm-port.ts";
import { ScriptedLlm } from "./llm-port.ts";

export type { LlmCallResult, LlmUsage } from "./llm-port.ts";

/** The roles triage invokes — a closed set (CROSS-CUTTING §3, HAR-R7). */
export type TriageRole = "triage-speakership" | "triage-checkability" | "triage-context";

export type TriageLlm = LlmPort<TriageRole>;

/** Deterministic scripted LLM for tests — no network, no randomness. */
export class MockTriageLlm extends ScriptedLlm<TriageRole> {
  private constructor(script: (role: string, input: unknown) => ScriptedResult) {
    super(script, "mock-triage", { tokensIn: 42, tokensOut: 17 });
  }

  static scripted(script: (role: string, input: unknown) => ScriptedResult): TriageLlm {
    return new MockTriageLlm(script);
  }

  /**
   * A whole-document mock. Each sentence names its speakership class (axis 1) and,
   * for eligible sentences, its content class (axis 2). The context pass answers
   * with the supplied fields for every claim.
   */
  static forDocument(
    sentences: Array<{
      text: string;
      speakershipClass: string;
      contentClass?: string;
      speaker?: string | null;
    }>,
    context: { venue?: string | null; topic?: string | null; supports?: string | null } = {},
  ): TriageLlm {
    return new MockTriageLlm((role, input) => {
      if (role === "triage-context") {
        return {
          ok: true,
          value: {
            venue: context.venue ?? null,
            topic: context.topic ?? null,
            supports: context.supports ?? null,
            qualifiers: [],
          },
        };
      }
      const doc = input as { sentences?: Array<{ id: string; text: string }> };
      const out: Array<Record<string, unknown>> = [];
      for (const s of doc.sentences ?? []) {
        const fixture = sentences.find((f) => f.text === s.text);
        if (!fixture) {
          return {
            ok: false,
            raw: `unscripted sentence: ${s.text}`,
            failureClass: "schema-validation",
          };
        }
        if (role === "triage-speakership") {
          out.push({
            sentenceId: s.id,
            speakershipClass: fixture.speakershipClass,
            speaker: fixture.speaker ?? null,
          });
        } else {
          out.push({
            sentenceId: s.id,
            contentClass: fixture.contentClass ?? "checkable",
          });
        }
      }
      return { ok: true, value: { sentences: out } };
    });
  }
}
