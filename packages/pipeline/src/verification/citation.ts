// Citation-check mode (VER-R4): compare a claim against the document it cites.

import { z } from "zod";
import type { CitationOutcome, CitedDocument } from "../verification-api.ts";
import type { VerificationLlm } from "../verification-llm.ts";

// ---------- citation-check mode (VER-R4) ----------

export const CitationOutput = z.object({
  verdict: z.enum(["supported", "refuted", "not_enough_evidence", "conflicting_cherry_picking"]),
  // Absent for paywalled citations: no comparison ran, so no strictness exists.
  bindingStrictness: z.enum(["direct", "decorative"]).optional(),
  quotedClaimOnly: z.boolean().optional(),
  mismatch: z.string().optional(),
  // Deep-research additions (user direction, Sept 2026): the adjudicator also
  // explains its verdict in plain language and reports what each source said.
  narrative: z
    .object({
      lead: z.string(),
      // LLMs sometimes emit a single paragraph as a string — accept and wrap.
      paragraphs: z.union([z.array(z.string()), z.string().transform((s) => [s])]).default([]),
      pull: z.string(),
    })
    .optional(),
  sourceFindings: z
    .array(
      z.object({
        link: z.string(),
        // LLMs emit tier as a numeric string ('1') as often as a number.
        tier: z.union([z.number(), z.string().transform((s) => Number(s))]),
        finding: z.string(),
      }),
    )
    .optional(),
});

export async function citationCheck(
  llm: VerificationLlm,
  input: { claim: string; citedDocument: CitedDocument },
): Promise<CitationOutcome> {
  const call = await llm.generateObject(
    "citation-compare",
    { claim: input.claim, document: input.citedDocument },
    { parse: (raw: unknown) => CitationOutput.parse(raw) },
  );
  if (!call.ok) {
    throw new Error(`citation comparison failed: ${call.failureClass}`);
  }
  // Paywalled cited sources degrade to quoted-claim-only; never circumvented
  // (ADR-0006 paywall policy). The cited document is the object of the check,
  // never evidence — numbers still route to the stat-grid.
  const value = call.value;
  const quotedClaimOnly = input.citedDocument.paywalled === true || value.quotedClaimOnly === true;
  // A paywalled citation was never compared: no binding strictness exists.
  if (quotedClaimOnly) {
    return { verdict: value.verdict, quotedClaimOnly: true };
  }
  const strictness =
    value.bindingStrictness !== undefined ? { bindingStrictness: value.bindingStrictness } : {};
  return {
    verdict: value.verdict,
    ...strictness,
    ...(value.mismatch !== undefined ? { mismatch: value.mismatch } : {}),
  };
}
