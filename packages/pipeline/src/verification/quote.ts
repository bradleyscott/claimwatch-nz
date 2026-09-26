// Quote-fidelity mode (VER-R5, ADR-0007): compare a claim's wording against a
// stored caption.

import { z } from "zod";
import type { QuoteFidelityOutcome } from "../verification-api.ts";
import type { VerificationLlm } from "../verification-llm.ts";

// ---------- quote-fidelity mode (VER-R5, ADR-0007) ----------

export const QuoteFidelityOutput = z.object({
  // Absent when the claim cannot be anchored — the gate never reached a
  // comparison, so there is no verdict (VERIFICATION §2.4 step 4).
  verdict: z
    .enum(["supported", "refuted", "not_enough_evidence", "conflicting_cherry_picking"])
    .optional(),
  note: z.string(),
  anchorMissing: z.boolean().optional(),
});

export async function quoteFidelityCheck(
  llm: VerificationLlm,
  input: { claimText: string; captionText: string; transcriptTier: string },
): Promise<QuoteFidelityOutcome> {
  const call = await llm.generateObject(
    "quote-fidelity",
    { claimText: input.claimText, captionText: input.captionText },
    { parse: (raw: unknown) => QuoteFidelityOutput.parse(raw) },
  );
  if (!call.ok) {
    throw new Error(`quote-fidelity comparison failed: ${call.failureClass}`);
  }
  const value = call.value;
  if (value.anchorMissing) {
    return { verdict: "not_enough_evidence", note: value.note, anchorMissing: true };
  }
  // Numerical claims route to the stat-grid regardless of caption wording —
  // caption text is a claim pointer, never evidence for a quoted number
  // (ADR-0007 non-negotiable). Tier-2 claims always carry the quality flag.
  const routesToStatGrid = /\d/.test(input.claimText);
  const captionQualityFlag = input.transcriptTier === "publisher-auto";
  const out: QuoteFidelityOutcome = {
    note: value.note,
    ...(captionQualityFlag ? { captionQualityFlag } : {}),
    ...(routesToStatGrid ? { routesToStatGrid } : {}),
  };
  if (value.verdict !== undefined) {
    out.verdict = value.verdict;
  }
  return out;
}
