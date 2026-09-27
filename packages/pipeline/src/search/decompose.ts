// Question decomposition (FIRE pattern, VERIFICATION §2.5a): a claim is not a
// query string — deep research decomposes it into atomic verifiable questions,
// each with its own search queries. The LLM does the decomposition
// (schema-constrained, versioned prompt); a fallback to the raw claim keeps
// the loop honest when the LLM fails. Cost guard: MAX_QUESTIONS.

import { biasQueries, type ClaimContextBundle } from "../claim-context.ts";

export interface DecomposedQuestion {
  question: string;
  queries: string[];
}

export interface DecompositionLlm {
  decompose(input: {
    claim: string;
    /** The country the claim's own document is from (ADR-0021). */
    jurisdiction?: string | null;
    /** The claim's place in an argument, so questions can be framed by it. */
    context?: ClaimContextBundle | null;
  }): Promise<{ questions: DecomposedQuestion[] }>;
}

export const MAX_QUESTIONS = 6;

// The jurisdiction instruction used to read "Queries must NOT be biased toward any
// country unless the claim itself concerns it" — which, for a sentence with no
// country in it, meant no bias at all. A claim about "the charity" and "$140,000"
// then returned American infrastructure pages. The bias comes from the DOCUMENT,
// which the input carries as `jurisdiction` (ADR-0021).
const DECOMPOSITION_PROMPT = `Decompose a factual claim into its atomic verifiable questions.
Each question must be independently checkable against public data or reporting.
For each question, provide 1-2 web-search queries that would find authoritative evidence.
The input carries \`jurisdiction\`: the country the claim's own document is from. Bias EVERY query
to that jurisdiction by naming the country in it, even when the claim sentence does not. Never search
without a jurisdiction bias when one is given. If the claim is reported speech — "X said Y" — one
question must be whether the statement was made, and the rest about the substance of Y.
The input may also carry \`context\`: the claim's place in an argument — \`topic\`, the \`attachedProposal\`
it was deployed in support of, and the \`argumentDirection\` (problem|success). Where an argument exists,
at least one question must be about THE ARGUMENT — whether this evidence supports the proposal it was
used for — not only about the number or statement on its own.
Reply with ONLY JSON: {"questions": [{"question": string, "queries": string[]}]}
Maximum 6 questions.`;

export { DECOMPOSITION_PROMPT };

// Fallback question: the claim itself, with plain queries derived from it.
function fallbackQuestion(claim: string): DecomposedQuestion[] {
  return [{ question: claim, queries: [claim.slice(0, 120)] }];
}

export async function decomposeClaim(
  input: { claim: string; jurisdiction?: string | null; context?: ClaimContextBundle | null },
  llm: DecompositionLlm,
): Promise<DecomposedQuestion[]> {
  const jurisdiction = input.jurisdiction ?? null;
  // Every query gets the jurisdiction bias, whatever the model returned — the
  // prompt asks for it, this guarantees it (ADR-0021 rule 2).
  const applied = (questions: DecomposedQuestion[]): DecomposedQuestion[] =>
    questions.map((q) => ({ question: q.question, queries: biasQueries(q.queries, jurisdiction) }));
  try {
    const result = await llm.decompose({
      claim: input.claim,
      jurisdiction,
      context: input.context ?? null,
    });
    const questions = (result.questions ?? [])
      .filter((q) => q && typeof q.question === "string" && Array.isArray(q.queries))
      .slice(0, MAX_QUESTIONS)
      // Every question must carry at least one query — drop hollow entries.
      .filter((q) => q.queries.length > 0);
    if (questions.length === 0) return applied(fallbackQuestion(input.claim));
    return applied(questions);
  } catch {
    // Decomposition failure degrades to claim-as-question: the loop still
    // researches, just less precisely. Never throws into the verdict path.
    return applied(fallbackQuestion(input.claim));
  }
}
