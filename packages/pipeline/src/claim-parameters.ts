// Claim parameters: the two facts about a claim that the figures procedure needs
// to build its readings — the window it is about, and the magnitude it asserts.
//
// WHY THIS REPLACES THE FINGERPRINT (ADR-0023). The fingerprint was a six-part
// identity object built at triage time, before any evidence was fetched, and then
// consumed downstream. Two of its six fields were load-bearing and both were
// free-text strings with no declared format:
//
//   - the grid read its window start with `/(?:since|from)\s+(\d{4})/i` over
//     `temporal`, so a claim parsed as "2017-2026" produced a null start, no
//     cited-window row, and an abstention — and nothing in the prompt, the schema
//     or the tests asked for the `since 2017` phrasing the regex required;
//   - the grid read its magnitude with "the first number in the string", so
//     "we could not read the magnitude" and "the claim states no magnitude" were
//     indistinguishable, and only the first of those may take the
//     direction-robustness path (which can return "supported" on direction alone).
//
// The other four fields had no consumer that could not have used the claim text,
// and the whole object's identity key had no reader at all. So it is gone. The
// parse happens HERE, at the point of use, inside the procedure that needs it,
// and its result is stored with the check that consumed it rather than as an
// identity for the claim.
//
// The parse is a model call with a declared schema, like every other prompt, and
// its result is versioned with the run (`claim-parameters@1`).

import { z } from "zod";

/**
 * The window a claim is about.
 *
 * `kind: "point"` is a claim about one year rather than a change ("in 2024 the
 * rate was 4%"), and it has no start — the grid treats it as it treats an
 * unreadable window, which is to abstain rather than invent a comparison.
 * `raw` carries the claim's own words verbatim, because that is the auditable
 * artefact the parse was made from: a derived year with no source text cannot be
 * checked against the sentence.
 */
export const ClaimWindow = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("since"),
    start: z.string().regex(/^\d{4}$/),
    end: z
      .string()
      .regex(/^\d{4}$/)
      .nullable(),
    raw: z.string(),
  }),
  z.object({
    kind: z.literal("between"),
    start: z.string().regex(/^\d{4}$/),
    end: z
      .string()
      .regex(/^\d{4}$/)
      .nullable(),
    raw: z.string(),
  }),
  z.object({
    kind: z.literal("point"),
    start: z.string().regex(/^\d{4}$/),
    end: z.null(),
    raw: z.string(),
  }),
  z.object({ kind: z.literal("unstated"), start: z.null(), end: z.null(), raw: z.string() }),
]);

/**
 * The magnitude a claim asserts.
 *
 * `kind` is the field that fixes the old bug. `direction-only` means the claim
 * really states no magnitude ("crime is rising"), and the grid may judge it on
 * direction. A magnitude kind with `value: null` means we failed to read a
 * magnitude that is there, and the grid must abstain — treating it as
 * `direction-only` would publish "supported" for a claim whose number was never
 * compared against anything.
 *
 * `raw` is kept for the same reason as the window's: `"up 30%"`, `"up a third"`
 * and `"more than 30%"` parse to the same number and are not the same claim.
 */
export const ClaimQuantity = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("percent-change"),
    value: z.number().nullable(),
    raw: z.string(),
  }),
  z.object({ kind: z.literal("percent-level"), value: z.number().nullable(), raw: z.string() }),
  z.object({ kind: z.literal("absolute"), value: z.number().nullable(), raw: z.string() }),
  z.object({ kind: z.literal("ratio"), value: z.number().nullable(), raw: z.string() }),
  z.object({ kind: z.literal("direction-only"), value: z.null(), raw: z.string() }),
  z.object({ kind: z.literal("none"), value: z.null(), raw: z.string() }),
]);

export const ClaimParameters = z.object({
  window: ClaimWindow,
  quantity: ClaimQuantity,
});
export type ClaimWindow = z.infer<typeof ClaimWindow>;
export type ClaimQuantity = z.infer<typeof ClaimQuantity>;
export type ClaimParameters = z.infer<typeof ClaimParameters>;

/** A claim with no window and no magnitude, used when there is nothing to parse. */
export function emptyClaimParameters(): ClaimParameters {
  return {
    window: { kind: "unstated", start: null, end: null, raw: "" },
    quantity: { kind: "none", value: null, raw: "" },
  };
}

/**
 * The prompt (`claim-parameters@1`). Lives in the module that uses it, per the
 * house convention.
 *
 * It is explicit about the failure mode the old code had, because the model's
 * answer is the difference between an abstention and a published verdict: a
 * magnitude that is present but unreadable must be reported as a magnitude with
 * a null value, NOT as `direction-only`.
 */
export const CLAIM_PARAMETERS_PROMPT =
  `Extract two facts from one sentence containing a numeric claim: the time window it is about, and the magnitude it asserts.

Reply with ONLY JSON: {"window": {...}, "quantity": {...}}

WINDOW — one of:
  {"kind":"since","start":"YYYY","end":"YYYY"|null,"raw":"<the words in the sentence>"}
  {"kind":"between","start":"YYYY","end":"YYYY"|null,"raw":"..."}
  {"kind":"point","start":"YYYY","end":null,"raw":"..."}       // about one year, not a change
  {"kind":"unstated","start":null,"end":null,"raw":""}
` +
  `Rule: the sentence must SAY the window. "since 2017" is a since-window. "2017-2026" is a between-window. "in 2024" is a point. If the sentence names no time at all, use "unstated" — never infer a window from topical knowledge. "start" and "end" are four-digit years only: "up 30% since the last election" has an unstated window, not a guessed one.

QUANTITY — one of:
  {"kind":"percent-change","value":<number>|null,"raw":"..."}  // a change: "up 30%", "fell 2.3%"
  {"kind":"percent-level","value":<number>|null,"raw":"..."}   // a level: "unemployment at 4.2%"
  {"kind":"absolute","value":<number>|null,"raw":"..."}        // a count: "12,000 more"
  {"kind":"ratio","value":<number>|null,"raw":"..."}           // "twice as many", "3 in 5"
  {"kind":"direction-only","value":null,"raw":"..."}           // rising/falling, NO magnitude stated
  {"kind":"none","value":null,"raw":""}                        // no quantity at all

Rules, in order:
  1. If the sentence states a magnitude, pick the matching kind and set "value" to the number (percent-change and percent-level are percent numbers: "up 30%" → 30).
  2. If a magnitude IS stated but you cannot express it as a plain number ("a third", "more than double", "significantly higher"), you MUST still pick the magnitude kind and set "value": null. Do NOT use "direction-only".
  3. Use "direction-only" ONLY when the sentence genuinely states no magnitude at all — "crime is rising", "fewer people are waiting".
  4. Use "none" when the sentence asserts no quantity in any form.

Always fill "raw" with the exact words from the sentence that the parse came from.`;

/**
 * The port this parse needs — structurally the same shape triage uses, declared
 * here so the module does not depend on triage's type to run.
 */
export interface ClaimParametersLlm {
  generateObject(
    role: "claim-parameters",
    input: unknown,
    schema: { parse(value: unknown): unknown } | undefined,
  ): Promise<{ ok: boolean; value?: unknown; failureClass?: string }>;
}

/**
 * Parse a claim's window and magnitude.
 *
 * Throws on failure rather than degrading, and the caller decides what that
 * means: for the figures procedure an unreadable claim means an abstention, which
 * is the honest reading of "we could not tell what number this is". The old
 * fingerprint stage degraded the claim's TYPE instead, which silently rerouted it
 * to a different check.
 */
export async function claimParametersFromLlm(
  llm: ClaimParametersLlm,
  input: { sentence: string },
): Promise<ClaimParameters> {
  const call = await llm.generateObject(
    "claim-parameters",
    { sentence: input.sentence },
    { parse: (raw: unknown) => ClaimParameters.parse(raw) },
  );
  if (!call.ok) {
    throw new Error(`claim parameter extraction failed: ${call.failureClass}`);
  }
  return ClaimParameters.parse(call.value);
}
