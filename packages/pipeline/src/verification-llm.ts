// VerificationLlm port — same pattern as the TriageLlm port (ADR-0011):
// packages/llm owns providers; verification depends on this interface only.
// Deterministic scripted mock for L1; real provider wiring lands with the
// live-run phase.
//
// The call shape is the shared one in `llm-port.ts`; only the role set differs.

import type { LlmPort, ScriptedResult } from "./llm-port.ts";
import { ScriptedLlm } from "./llm-port.ts";

export type { LlmCallResult, LlmUsage } from "./llm-port.ts";

/** The roles verification invokes — a closed set (CROSS-CUTTING §3, HAR-R7). */
export type VerificationRole =
  | "grid-materiality"
  | "citation-compare"
  | "quote-fidelity"
  | "nli-audit"
  | "open-web"
  | "authority-classify";

export type VerificationLlm = LlmPort<VerificationRole>;

export class MockVerificationLlm extends ScriptedLlm<VerificationRole> {
  private constructor(script: (role: string, input: unknown) => ScriptedResult) {
    super(script, "mock-verification", { tokensIn: 55, tokensOut: 23 });
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

  static forProvenance(claimText: string, verdict: string): VerificationLlm {
    return new MockVerificationLlm((_role, input) => {
      const req = input as { claimText?: string };
      if (req.claimText !== claimText)
        return { ok: false, raw: "unexpected input", failureClass: "schema-validation" };
      return { ok: true, value: { verdict, originalContext: "Cyclone Gabrielle, February 2023" } };
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
