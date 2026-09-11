// VerificationLlm port — same pattern as the TriageLlm port (ADR-0011):
// packages/llm owns providers; verification depends on this interface only.
// Deterministic scripted mock for L1; real provider wiring lands with the
// live-run phase.

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
    };

export interface VerificationLlm {
  generateObject<T>(
    role: "grid-materiality" | "citation-compare" | "quote-fidelity" | "nli-audit" | "open-web",
    input: unknown,
    schema: { parse(value: unknown): T },
  ): Promise<LlmCallResult<T>>;
}

export class MockVerificationLlm implements VerificationLlm {
  private constructor(
    private readonly script: (
      role: string,
      input: unknown,
    ) => { ok: boolean; value?: unknown; raw?: string; failureClass?: string },
  ) {}

  async generateObject<T>(
    role: "grid-materiality" | "citation-compare" | "quote-fidelity" | "nli-audit" | "open-web",
    input: unknown,
    schema: { parse(value: unknown): T },
  ): Promise<LlmCallResult<T>> {
    const out = this.script(role, input);
    if (!out.ok) {
      return {
        ok: false,
        failureClass: (out.failureClass ?? "schema-validation") as "schema-validation",
        ...(out.raw !== undefined ? { rawOutput: out.raw } : {}),
        model: "mock-verification",
      };
    }
    return {
      ok: true,
      value: schema.parse(out.value),
      usage: { tokensIn: 55, tokensOut: 23 },
      model: "mock-verification",
    };
  }

  // ---- domain-specific script builders (test support) ----

  static scripted(
    script: (
      role: string,
      input: unknown,
    ) => { ok: boolean; value?: unknown; raw?: string; failureClass?: string },
  ): VerificationLlm {
    return new MockVerificationLlm(script);
  }

  static forCitation(
    claim: string,
    citedDocument: object,
    expected: Record<string, unknown>,
  ): VerificationLlm {
    return new MockVerificationLlm((_role, input) => {
      const req = input as { claim?: string };
      if (req.claim !== claim)
        return { ok: false, raw: "unexpected input", failureClass: "schema-validation" };
      const doc = citedDocument as { paywalled?: boolean };
      if (doc.paywalled) {
        return { ok: true, value: { verdict: "not_enough_evidence", quotedClaimOnly: true } };
      }
      const value: Record<string, unknown> = {
        verdict: expected.verdict,
        bindingStrictness: expected.bindingStrictness,
      };
      if (expected.mismatch) value.mismatch = expected.mismatch;
      return { ok: true, value };
    });
  }

  static forQuoteFidelity(
    artefact: { claimText: string; captionText: string },
    expected: Record<string, unknown>,
  ): VerificationLlm {
    return new MockVerificationLlm((_role, input) => {
      const req = input as { claimText?: string };
      if (req.claimText !== artefact.claimText)
        return { ok: false, raw: "unexpected input", failureClass: "schema-validation" };
      const value: Record<string, unknown> = expected.anchorMissing
        ? { anchorMissing: true, note: expected.reason }
        : { verdict: expected.verdict, note: expected.note };
      if (expected.verdict === "not_enough_evidence") value.captionQualityFlag = true;
      if (expected.routesToStatGrid) value.routesToStatGrid = true;
      return { ok: true, value };
    });
  }

  static forNli(justification: string, verdict: string, failureClass?: string): VerificationLlm {
    return new MockVerificationLlm((_role, input) => {
      const req = input as { justification?: string };
      if (req.justification !== justification)
        return { ok: false, raw: "unexpected input", failureClass: "schema-validation" };
      if (verdict === "pass") return { ok: true, value: { verdict: "pass" } };
      return { ok: true, value: { verdict: "fail", failureClass } };
    });
  }

  static forOpenWeb(rounds: number, confidence: number): VerificationLlm {
    return new MockVerificationLlm((_role, input) => {
      const req = input as { round?: number; depthCap?: number };
      const round = req.round ?? 0;
      if (round >= Math.min(rounds, req.depthCap ?? 0)) {
        return { ok: true, value: { done: true, confidence } };
      }
      return { ok: true, value: { done: false, nextRound: round + 1 } };
    });
  }
}
