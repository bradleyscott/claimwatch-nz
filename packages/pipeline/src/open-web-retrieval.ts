// Open-web retrieval loop (VERIFICATION §2.5a, FIRE pattern): fingerprint-
// conditioned query generation → Serper search → evidence accumulation →
// confidence-capped rounds. The LLM's only roles: generate/refine queries and
// decide done/confidence — it never authors evidence. The cap binding is
// recorded on every result (a capped run is visible, not silent).

import type { SearchProvider, SearchResult } from "./search/serper-adapter.ts";

export interface RetrievalResult {
  evidence: SearchResult[];
  roundsUsed: number;
  capBinding: number;
  cappedRun: boolean;
  confidence: number;
}

export interface RetrievalLlm {
  generateObject(
    role: string,
    input: unknown,
    schema: { parse(value: unknown): unknown } | undefined,
  ): Promise<{ ok: boolean; value?: unknown; failureClass?: string }>;
}

interface LoopDecision {
  done: boolean;
  confidence?: number;
  nextRound?: number;
  refinedQuery?: string;
}

// A `const Fingerprint = { core: "" } as const` sat here, declared and never
// read. It went with the fingerprint itself (ADR-0023): the loop's query is
// built from the claim text, and the object had no other consumer.
export async function runOpenWebRetrieval(
  input: {
    claim: string;
    fingerprint: {
      core: string;
      claimant: string | null;
      domain: string | null;
      temporal: string | null;
      quantity: string | null;
      source: string | null;
    };
  },
  deps: { search: SearchProvider["search"]; llm: RetrievalLlm; depthCap: number },
): Promise<RetrievalResult> {
  const evidence: SearchResult[] = [];
  const capBinding = deps.depthCap;

  // Round 0 query: fingerprint-conditioned — the core quantity/topic, never
  // the rhetorical framing (the motivated-selection guard). The domain key is
  // appended only when the core is absent (it usually duplicates the core).
  const parts: string[] = [];
  if (input.fingerprint.core) parts.push(input.fingerprint.core);
  else if (input.fingerprint.domain) parts.push(input.fingerprint.domain.replace(/-/g, " "));
  if (input.fingerprint.temporal) parts.push(input.fingerprint.temporal);
  // Locale-aware suffix: NZ keywords → NZ bias; otherwise a neutral
  // "official statistics" suffix. The pipeline verifies any claim — a
  // Nigeria-GDP claim must search Nigerian sources, not NZ ones.
  const text = `${input.fingerprint.core} ${input.fingerprint.domain ?? ""}`.toLowerCase();
  const suffix = /\b(nz|new zealand)\b/.test(text)
    ? "statistics official New Zealand"
    : "official statistics";
  let query = `${parts.join(" ")} ${suffix}`.trim();

  let round = 0;
  let confidence = 0;

  while (round < deps.depthCap) {
    const results = await deps.search(query);
    evidence.push(...results);

    const decision = (await deps.llm.generateObject(
      "open-web-retrieval",
      {
        claim: input.claim,
        fingerprint: input.fingerprint,
        round,
        depthCap: deps.depthCap,
        query,
        evidenceCount: evidence.length,
        evidenceTitles: evidence.slice(-5).map((e) => e.title),
      },
      { parse: (v: unknown) => v as LoopDecision },
    )) as { ok: boolean; value?: LoopDecision; failureClass?: string };

    // The live adapter returns LlmCallResult: { ok, value } on success,
    // { ok: false, failureClass } on failure. A failed round is treated as
    // "capped, no confidence" — never fabricated.
    if (!decision.ok || !decision.value) {
      round += 1;
      break;
    }
    const value = decision.value;
    if (value.done) {
      confidence = value.confidence ?? 0;
      round += 1;
      break;
    }
    query = value.refinedQuery ?? query;
    round = value.nextRound ?? round + 1;
  }

  // Empty retrieval is honest: zero evidence, zero confidence — never a
  // fabricated confidence from an LLM that saw nothing.
  if (evidence.length === 0) confidence = 0;

  return {
    evidence,
    roundsUsed: Math.min(round, deps.depthCap),
    capBinding,
    cappedRun: round >= deps.depthCap && confidence === 0,
    confidence,
  };
}
