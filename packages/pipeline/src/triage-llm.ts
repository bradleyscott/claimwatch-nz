// TriageLlm port — the injectable LLM boundary for triage (ADR-0011: packages/llm
// owns providers; pipeline depends on this interface only). L1 tests drive the
// mock; the real provider wiring lands with the live-run phase.

export interface LlmUsage {
  tokensIn: number;
  tokensOut: number;
}

export type LlmCallResult<T> =
  | { ok: true; value: T; usage: LlmUsage; model: string }
  | {
      ok: false;
      failureClass: "schema-validation" | "llm-refusal" | "timeout";
      rawOutput?: string;
      model?: string;
      /** Why generation stopped — `length` marks a truncated response. */
      finishReason?: string;
    };

export interface TriageLlm {
  generateObject<T>(
    role: "triage-checkability" | "triage-typing" | "triage-fingerprint" | "triage-context",
    input: unknown,
    schema: { parse(value: unknown): T },
  ): Promise<LlmCallResult<T>>;
}

/** Deterministic scripted LLM for tests — no network, no randomness. */
export class MockTriageLlm implements TriageLlm {
  private constructor(
    private readonly script: (
      role: string,
      input: unknown,
    ) => { ok: boolean; value?: unknown; raw?: string; failureClass?: string },
  ) {}

  async generateObject<T>(
    role: "triage-checkability" | "triage-typing" | "triage-fingerprint" | "triage-context",
    input: unknown,
    schema: { parse(value: unknown): T },
  ): Promise<LlmCallResult<T>> {
    const out = this.script(role, input);
    if (!out.ok) {
      const failure: LlmCallResult<never> = {
        ok: false,
        failureClass: (out.failureClass ?? "schema-validation") as "schema-validation",
        ...(out.raw !== undefined ? { rawOutput: out.raw } : {}),
        model: "mock-triage",
      };
      return failure;
    }
    return {
      ok: true,
      value: schema.parse(out.value),
      usage: { tokensIn: 42, tokensOut: 17 },
      model: "mock-triage",
    };
  }

  static forCheckability(_sentence: string, expected: string, rejectionClass?: string): TriageLlm {
    return new MockTriageLlm((_role, input) => {
      const sentence = (input as { sentence?: string }).sentence ?? "";
      if (expected === "checkable") return { ok: true, value: { checkable: true, sentence } };
      return {
        ok: true,
        value: { checkable: false, rejectionClass: rejectionClass ?? "opinion", sentence },
      };
    });
  }

  static malformed(): TriageLlm {
    return new MockTriageLlm(() => ({
      ok: false,
      raw: "<<<not json>>>",
      failureClass: "schema-validation",
    }));
  }

  static forTyping(sentence: string, claimType: string): TriageLlm {
    return new MockTriageLlm((_role, input) => {
      const s = (input as { sentence?: string }).sentence ?? "";
      if (s !== sentence)
        return { ok: false, raw: "unexpected input", failureClass: "schema-validation" };
      const mode: Record<string, string> = {
        statistical: "stat-grid",
        "citation-backed": "citation-check",
        "broadcast-quote": "quote-fidelity",
        "institution-citation": "citation-check",
        "false-context": "provenance",
        other: "open-web",
      };
      return { ok: true, value: { claimType, mode: mode[claimType] ?? "open-web", sentence } };
    });
  }

  static forTypingWithBrokenFingerprint(sentence: string): TriageLlm {
    return new MockTriageLlm((_role, input) => {
      const s = (input as { sentence?: string }).sentence ?? "";
      if (s !== sentence)
        return { ok: false, raw: "unexpected input", failureClass: "schema-validation" };
      return {
        ok: true,
        value: {
          claimType: "statistical",
          mode: "stat-grid",
          fingerprint: {
            core: s,
            claimant: null,
            domain: null,
            temporal: null,
            quantity: "significant",
            source: null,
            __unusable: true,
          },
          sentence,
        },
      };
    });
  }

  static forContext(window: string, expected: Record<string, unknown>): TriageLlm {
    return new MockTriageLlm((_role, input) => {
      const w = (input as { window?: string }).window ?? "";
      if (w !== window)
        return { ok: false, raw: "unexpected input", failureClass: "schema-validation" };
      return {
        ok: true,
        value: {
          speaker:
            expected.speaker === "absent"
              ? null
              : expected.speaker === "present"
                ? "Minister"
                : (expected.speaker ?? null),
          topic:
            expected.topic === "absent"
              ? null
              : typeof expected.topic === "string"
                ? expected.topic
                : "economy",
          proposal:
            expected.proposal === "absent"
              ? null
              : expected.proposal === "present"
                ? "housing package"
                : null,
          attachedProposal:
            expected.attachedProposal === "present"
              ? "the announced housing package"
              : expected.attachedProposal === null
                ? null
                : null,
          qualifiers: [],
        },
      };
    });
  }

  static forDocument(
    sentences: Array<{
      id: string;
      text: string;
      expected: string;
      rejectionClass?: string;
      window: string;
    }>,
    /**
     * What the discourse-context pass should return for every window. Triage
     * runs that pass per checkable claim (TRIAGE §2.3), so a document mock has
     * to answer it — and a caller that wants the deployment framing to flow
     * through to the claim supplies it here rather than asserting on nulls.
     */
    context: {
      speaker?: string | null;
      topic?: string | null;
      attachedProposal?: string | null;
      argumentDirection?: "problem" | "success" | null;
    } = {},
  ): TriageLlm {
    return new MockTriageLlm((role, input) => {
      // The context pass reads a window, not a sentence list, and answers with
      // the ADR-0008 field set — never with the document's results shape.
      if (role === "triage-context") {
        return {
          ok: true,
          value: {
            speaker: context.speaker ?? null,
            topic: context.topic ?? null,
            proposal: null,
            attachedProposal: context.attachedProposal ?? null,
            qualifiers: [],
            argumentDirection: context.argumentDirection ?? null,
          },
        };
      }
      const doc = input as { sentences?: Array<{ id: string; text: string; window?: string }> };
      const out: Array<Record<string, unknown>> = [];
      for (const s of doc.sentences ?? []) {
        const fixture = sentences.find((f) => f.text === s.text);
        if (!fixture)
          return {
            ok: false,
            raw: `unscripted sentence: ${s.text}`,
            failureClass: "schema-validation",
          };
        if (fixture.expected === "checkable") {
          out.push({ sentenceId: s.id, checkable: true, claimType: "other", mode: "open-web" });
        } else {
          out.push({
            sentenceId: s.id,
            checkable: false,
            rejectionClass: fixture.rejectionClass ?? "opinion",
          });
        }
      }
      return { ok: true, value: { results: out } };
    });
  }
}
