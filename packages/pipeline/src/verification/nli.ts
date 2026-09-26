// NLI publication gate (VER-R2): does the justification follow from the cited
// evidence?

import { z } from "zod";
import type { NliCheckResult } from "../verification-api.ts";
import type { VerificationLlm } from "../verification-llm.ts";

// ---------- NLI publication gate (VER-R2, §2.7) ----------

const NLI_FAILURE_CLASSES = [
  "unattributed-synthesis",
  "unstated-arithmetic",
  "authority-by-citation",
  "hallucinated-content",
] as const;

export const NliCheckOutput = z.object({
  verdict: z.enum(["pass", "fail"]),
  failureClass: z.enum(NLI_FAILURE_CLASSES).optional(),
});

// Batched shape: one call audits every (justification, cited-span) pair in the
// pack. The per-pair verdict is the same shape as the single-pair path, so a
// failureClass that is not one of the declared classes is a schema failure here
// rather than a string that has to be coerced into the port's union later.
const NliBatchOutput = z.object({
  results: z
    .array(
      z.object({
        verdict: z.enum(["pass", "fail"]),
        failureClass: z.enum(NLI_FAILURE_CLASSES).optional(),
      }),
    )
    .min(1),
});

export async function nliAudit(
  llm: VerificationLlm,
  input: { justification: string; citedSpan: string },
): Promise<NliCheckResult> {
  const call = await llm.generateObject(
    "nli-audit",
    { justification: input.justification, citedSpan: input.citedSpan },
    { parse: (raw: unknown) => NliCheckOutput.parse(raw) },
  );
  if (!call.ok) {
    throw new Error(`NLI audit failed to run: ${call.failureClass}`);
  }
  const value = call.value;
  if (value.verdict === "pass") {
    return { verdict: "pass" };
  }
  return {
    verdict: "fail",
    ...(value.failureClass !== undefined ? { failureClass: value.failureClass } : {}),
  };
}

/**
 * Batched NLI audit: ONE call for the whole pack (VER-R2, §2.7). The gate used
 * to cost one call per justification sentence, run sequentially; a pack of six
 * justifications cost six calls and six round-trips for one gate decision. The
 * audit is now fail-fast over one response, and the `nli-audit` prompt accepts
 * either a single pair or a `sentences` array. The single-pair contract above is
 * unchanged and still used when a pack carries one justification.
 */
export async function nliAuditBatch(
  llm: VerificationLlm,
  input: { sentences: Array<{ justification: string; citedSpan: string }> },
): Promise<NliCheckResult[]> {
  const call = await llm.generateObject(
    "nli-audit",
    { sentences: input.sentences },
    { parse: (raw: unknown) => NliBatchOutput.parse(raw) },
  );
  if (!call.ok) {
    throw new Error(`NLI audit failed to run: ${call.failureClass}`);
  }
  const results = call.value.results;
  // A short response is a failure of the gate, not an implicit pass: the
  // caller must be able to pair every justification with its own verdict.
  if (results.length !== input.sentences.length) {
    throw new Error(
      `NLI audit returned ${results.length} verdict(s) for ${input.sentences.length} justification(s) — refusing to infer the missing ones`,
    );
  }
  return results.map((r) =>
    r.verdict === "pass"
      ? { verdict: "pass" as const }
      : {
          verdict: "fail" as const,
          ...(r.failureClass !== undefined ? { failureClass: r.failureClass } : {}),
        },
  );
}
