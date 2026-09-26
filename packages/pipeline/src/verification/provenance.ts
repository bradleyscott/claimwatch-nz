// Provenance mode (VER-R6): curated fixtures only, never live records.

import { z } from "zod";
import type { VerificationLlm } from "../verification-llm.ts";

// ---------- provenance mode - curated set only (VER-R6) ----------

const ProvenanceOutput = z.object({
  verdict: z.enum(["false context", "supported", "not_enough_evidence"]),
  originalContext: z.string(),
});

export interface ProvenanceOutcome {
  verdict: "false_context" | "supported" | "not_enough_evidence";
  claimedContext: string;
  trueContext: string;
  originalContextFinding?: string;
}

export async function provenanceCheck(
  llm: VerificationLlm,
  input: {
    claimedContext: string;
    verifiedContext: string;
    claimText: string;
    isCuratedFixture: boolean;
  },
): Promise<ProvenanceOutcome> {
  // Least mature mode: runs on the curated fixture set ONLY - no live
  // false-context detection is claimed (VERIFICATION 2.5, VER-R6).
  if (!input.isCuratedFixture) {
    throw new Error("provenance mode runs only on curated fixtures - never live records (VER-R6)");
  }
  const call = await llm.generateObject(
    "grid-materiality",
    { claimText: input.claimText, claimedContext: input.claimedContext },
    { parse: (raw: unknown) => ProvenanceOutput.parse(raw) },
  );
  if (!call.ok) {
    throw new Error(`provenance check failed: ${call.failureClass}`);
  }
  const verdict = call.value.verdict === "false context" ? "false_context" : call.value.verdict;
  return {
    verdict: verdict as ProvenanceOutcome["verdict"],
    claimedContext: input.claimedContext,
    // The curated fixture's verified context is the documented truth; the
    // LLM retrieval finding (originalContext) corroborates it.
    trueContext: input.verifiedContext,
    originalContextFinding: call.value.originalContext,
  };
}
