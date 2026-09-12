// Question decomposition (FIRE pattern, VERIFICATION §2.5a): a claim is not a
// query string. Deep research decomposes the claim into its atomic verifiable
// questions — the number, the period, the comparison, the source identity —
// then researches each. Decomposition is LLM work (schema-constrained); the
// same claim + prompt version always yields the same decomposition
// (motivated-selection guard: reproducible, auditable).
//
// Authored BEFORE implementation (TDD red). Do not mutate without approval.

import { describe, expect, it } from "vitest";
import { type DecomposedQuestion, type DecompositionLlm, decomposeClaim } from "./decompose.ts";

function stubDecomposer(questions: DecomposedQuestion[]): DecompositionLlm {
  return { decompose: async () => ({ questions }) };
}

describe("claim decomposition — atomic verifiable questions (FIRE)", () => {
  it("accepts the LLM's decomposed questions verbatim", async () => {
    const llm = stubDecomposer([
      {
        question: "What was India's import value from China April-August 2020?",
        queries: ["India China imports April August 2020 customs"],
      },
      {
        question:
          "What was the percentage change in India's imports from China April-August 2020 vs 2019?",
        queries: ["India China imports percentage change 2020"],
      },
    ]);
    const out = await decomposeClaim(
      { claim: "India's imports from China increased by 27% during the period April-August 2020." },
      llm,
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.queries).toHaveLength(1);
    expect(out[1]?.question).toContain("percentage change");
  });

  it("falls back to the claim itself as one question when the LLM yields nothing", async () => {
    const llm = stubDecomposer([]);
    const out = await decomposeClaim({ claim: "Crime is up 30% since 2017." }, llm);
    expect(out).toHaveLength(1);
    expect(out[0]?.question).toContain("Crime is up 30%");
    expect(out[0]?.queries.length).toBeGreaterThan(0);
  });

  it("propagates LLM failures as a single-question fallback, never a throw", async () => {
    const llm: DecompositionLlm = {
      decompose: async () => {
        throw new Error("llm exploded");
      },
    };
    const out = await decomposeClaim({ claim: "Unemployment fell to 4%." }, llm);
    expect(out).toHaveLength(1);
    expect(out[0]?.question).toContain("Unemployment fell to 4%");
  });

  it("caps the decomposition at a sane maximum (cost guard)", async () => {
    const many: DecomposedQuestion[] = Array.from({ length: 12 }, (_, i) => ({
      question: `Question ${i}?`,
      queries: [`query ${i}`],
    }));
    const llm = stubDecomposer(many);
    const out = await decomposeClaim({ claim: "compound claim" }, llm);
    expect(out.length).toBeLessThanOrEqual(6); // MAX_QUESTIONS
  });
});
