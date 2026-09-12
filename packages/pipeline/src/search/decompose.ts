// Question decomposition (FIRE pattern, VERIFICATION §2.5a): a claim is not a
// query string — deep research decomposes it into atomic verifiable questions,
// each with its own search queries. The LLM does the decomposition
// (schema-constrained, versioned prompt); a fallback to the raw claim keeps
// the loop honest when the LLM fails. Cost guard: MAX_QUESTIONS.

export interface DecomposedQuestion {
  question: string;
  queries: string[];
}

export interface DecompositionLlm {
  decompose(input: { claim: string }): Promise<{ questions: DecomposedQuestion[] }>;
}

export const MAX_QUESTIONS = 6;

const DECOMPOSITION_PROMPT = `Decompose a factual claim into its atomic verifiable questions.
Each question must be independently checkable against public data or reporting.
For each question, provide 1-2 web-search queries that would find authoritative evidence.
Queries must NOT be biased toward any country unless the claim itself concerns it.
Reply with ONLY JSON: {"questions": [{"question": string, "queries": string[]}]}
Maximum 6 questions.`;

export { DECOMPOSITION_PROMPT };

// Fallback question: the claim itself, with plain queries derived from it.
function fallbackQuestion(claim: string): DecomposedQuestion[] {
  return [{ question: claim, queries: [claim.slice(0, 120)] }];
}

export async function decomposeClaim(
  input: { claim: string },
  llm: DecompositionLlm,
): Promise<DecomposedQuestion[]> {
  try {
    const result = await llm.decompose({ claim: input.claim });
    const questions = (result.questions ?? [])
      .filter((q) => q && typeof q.question === "string" && Array.isArray(q.queries))
      .slice(0, MAX_QUESTIONS)
      // Every question must carry at least one query — drop hollow entries.
      .filter((q) => q.queries.length > 0);
    if (questions.length === 0) return fallbackQuestion(input.claim);
    return questions;
  } catch {
    // Decomposition failure degrades to claim-as-question: the loop still
    // researches, just less precisely. Never throws into the verdict path.
    return fallbackQuestion(input.claim);
  }
}
