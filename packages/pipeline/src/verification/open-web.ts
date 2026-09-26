// Open-web loop (VER-R3): capped retrieval depth, the least reliable mode and
// the one most visibly open to contest.

import { z } from "zod";
import type { DepthCapResult } from "../verification-api.ts";
import type { VerificationLlm } from "../verification-llm.ts";

// ---------- open-web loop with confidence-capped depth (VER-R3) ----------

export const OpenWebOutput = z.object({
  done: z.boolean(),
  confidence: z.number().optional(),
  nextRound: z.number().optional(),
});

// Authority classification (user direction, Sept 2026): the LLM tier
// classifier — the only judgement step in authority vetting. Rationale +
// confidence are recorded on the authority row as provenance.
export const AuthorityClassifyOutput = z.object({
  tier: z.number().int().min(1).max(6),
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
});

export async function openWebLoop(
  llm: VerificationLlm,
  input: { claim: string; depthCap: number; mockRounds: number },
): Promise<DepthCapResult> {
  let round = 0;
  let confidence: number | undefined;
  while (round < input.depthCap) {
    const call = await llm.generateObject(
      "open-web",
      { claim: input.claim, round, depthCap: input.depthCap },
      { parse: (raw: unknown) => OpenWebOutput.parse(raw) },
    );
    if (!call.ok) {
      throw new Error(`open-web loop failed: ${call.failureClass}`);
    }
    if (call.value.done) {
      confidence = call.value.confidence;
      break;
    }
    round = call.value.nextRound ?? round + 1;
  }
  const roundsUsed = Math.min(round + (confidence !== undefined ? 1 : 0), input.mockRounds);
  const cappedRun = input.mockRounds > input.depthCap;
  return {
    roundsUsed: Math.min(roundsUsed, input.depthCap),
    capBinding: input.depthCap,
    cappedRun,
    confidence: confidence ?? 0,
  };
}
