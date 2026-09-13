// Deep-research retrieval loop (user direction, Sept 2026): "deep research,
// not one shot". The loop decomposes the claim (decompose.ts), researches each
// question with geography-aware queries, GRADES the evidence it collects
// (tier + specificity, from snippets), identifies gaps, and re-queries on the
// gaps — capped rounds, cap recorded. Sufficiency is an explicit LLM judgement
// against a stated bar, not a round count.
//
// Authored BEFORE implementation (TDD red). Do not mutate without approval.

import { describe, expect, it } from "vitest";
import type { DecomposedQuestion } from "./decompose.ts";
import { type ResearcherLlm, type ResearchOutcome, runDeepResearch } from "./research-loop.ts";
import type { SearchResult } from "./serper-adapter.ts";

function stubSearch(byQuery: Record<string, SearchResult[]>) {
  const calls: string[] = [];
  return {
    calls,
    search: async (query: string): Promise<SearchResult[]> => {
      calls.push(query);
      return byQuery[query] ?? [];
    },
  };
}

function stubDecomposer(questions: DecomposedQuestion[]) {
  return { decompose: async () => ({ questions }) };
}

function stubResearcher(script: (input: unknown) => unknown): ResearcherLlm {
  return { assessRound: async (input: unknown) => script(input) as never };
}

const indiaResults: Record<string, SearchResult[]> = {
  "India China imports April August 2020 customs": [
    {
      title: "India customs trade data",
      link: "https://commerce-app.govt.in/trade-stats",
      snippet:
        "Official India import statistics April-August 2020: imports from China fell 6% year-on-year.",
    },
  ],
  "India China bilateral trade 2020 percentage change": [
    {
      title: "OEC trade profile",
      link: "https://oec.world/ind/chn",
      snippet: "Bilateral trade data India-China: April-August 2020 imports down from 2019.",
    },
  ],
};

describe("deep research loop — decompose, grade, chase gaps (user direction Sept 2026)", () => {
  it("searches EVERY decomposed question, not just the first", async () => {
    const { calls, search } = stubSearch(indiaResults);
    const researcher = stubResearcher(() => ({
      sufficient: true,
      confidence: 0.8,
      verdictSignal: "supported",
    }));
    await runDeepResearch(
      {
        claim: "India's imports from China increased by 27% during April-August 2020.",
        questions: [
          {
            question: "What was the change in India's imports from China April-Aug 2020?",
            queries: ["India China imports April August 2020 customs"],
          },
          {
            question: "Was it a 27% increase?",
            queries: ["India China bilateral trade 2020 percentage change"],
          },
        ],
      },
      { search, researcher, depthCap: 3, resultsPerQuery: 5 },
    );
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0]).toContain("April August 2020 customs");
    expect(calls[1]).toContain("percentage change");
  });

  it("runs gap-driven refinement: unsufficient assessment triggers another round on the gaps", async () => {
    const { calls, search } = stubSearch({
      ...indiaResults,
      "India China imports 27 percent claim origin": [
        {
          title: "India MEA statement",
          link: "https://mea.gov.in/press-release-2020",
          snippet:
            "Government of India statement: no 27% increase in imports from China April-August 2020; imports declined.",
        },
      ],
    });
    let roundCount = 0;
    const researcher = stubResearcher((input) => {
      const req = input as { round: number; gaps: string[] };
      if (req.round === 0) {
        roundCount = 1;
        return {
          sufficient: false,
          confidence: 0.4,
          gaps: ["No official source states the specific 27% figure"],
          refinedQueries: ["India China imports 27 percent claim origin"],
          verdictSignal: "not_enough_evidence",
        };
      }
      return { sufficient: true, confidence: 0.85, verdictSignal: "refuted", gaps: [] };
    });
    const outcome: ResearchOutcome = await runDeepResearch(
      {
        claim: "India's imports from China increased by 27%.",
        questions: [
          {
            question: "Did India's imports from China increase 27% April-Aug 2020?",
            queries: ["India China imports April August 2020 customs"],
          },
        ],
      },
      { search, researcher, depthCap: 3, resultsPerQuery: 5 },
    );
    expect(calls.length).toBe(2); // initial + gap-driven refinement
    expect(outcome.evidence.some((e) => e.link.includes("mea.gov.in"))).toBe(true);
    expect(outcome.confidence).toBe(0.85);
    expect(outcome.verdictSignal).toBe("refuted");
    void roundCount;
  });

  it("stops at the depth cap with cappedRun recorded — never silent", async () => {
    const { search } = stubSearch(indiaResults);
    const researcher = stubResearcher(() => ({
      sufficient: false,
      confidence: 0.3,
      gaps: ["still no direct number"],
      refinedQueries: ["another refinement query"],
      verdictSignal: "not_enough_evidence",
    }));
    const outcome = await runDeepResearch(
      {
        claim: "compound claim",
        questions: [{ question: "Q?", queries: ["India China imports April August 2020 customs"] }],
      },
      { search, researcher, depthCap: 2, resultsPerQuery: 5 },
    );
    expect(outcome.cappedRun).toBe(true);
    expect(outcome.capBinding).toBe(2);
  });

  it("researcher sees snippets + domains, not titles alone (it must be able to judge quality)", async () => {
    const { search } = stubSearch(indiaResults);
    let seenInput: unknown;
    const researcher = stubResearcher((input) => {
      seenInput = input;
      return { sufficient: true, confidence: 0.9, verdictSignal: "refuted" };
    });
    await runDeepResearch(
      {
        claim: "India's imports increased by 27%.",
        questions: [
          {
            question: "What was the change?",
            queries: ["India China imports April August 2020 customs"],
          },
        ],
      },
      { search, researcher, depthCap: 1, resultsPerQuery: 5 },
    );
    const req = seenInput as { evidence: Array<{ snippet: string; domain: string }> };
    expect(req.evidence[0]?.snippet).toContain("Official India import statistics");
    expect(req.evidence[0]?.domain).toContain("govt.in");
  });

  it("empty retrieval on every question still returns an honest outcome", async () => {
    const { search } = stubSearch({});
    const researcher = stubResearcher(() => ({
      sufficient: false,
      confidence: 0,
      gaps: ["no evidence"],
      refinedQueries: [],
      verdictSignal: "not_enough_evidence",
    }));
    const outcome = await runDeepResearch(
      {
        claim: "obscure claim",
        questions: [{ question: "obscure?", queries: ["nothing matches this query"] }],
      },
      { search, researcher, depthCap: 2, resultsPerQuery: 5 },
    );
    expect(outcome.evidence).toHaveLength(0);
    expect(outcome.verdictSignal).toBe("not_enough_evidence");
  });

  it("shows the researcher the CUMULATIVE evidence, not just the newest round", async () => {
    // Regression (Sept 2026): `collected` was declared inside the round loop, so
    // round 2 graded its own snippets while round 1's evidence sat in a different
    // array. The sufficiency judgement — and therefore the round count, the
    // searches and the reported confidence — was made on a fragment, which is
    // what made the loop re-chase gaps it had already filled.
    const { search } = stubSearch(indiaResults);
    const seenPerRound: number[] = [];
    const researcher = stubResearcher((input) => {
      const req = input as { round: number; evidence: unknown[] };
      seenPerRound.push(req.evidence.length);
      if (req.round >= 1) {
        return { sufficient: true, confidence: 0.9, verdictSignal: "supported" };
      }
      return {
        sufficient: false,
        confidence: 0.4,
        gaps: ["which official series?"],
        refinedQueries: ["India China bilateral trade 2020 percentage change"],
        verdictSignal: "not_enough_evidence",
      };
    });
    const outcome = await runDeepResearch(
      {
        claim: "India's imports increased by 27%.",
        questions: [
          {
            question: "What was the change?",
            queries: ["India China imports April August 2020 customs"],
          },
        ],
      },
      { search, researcher, depthCap: 3, resultsPerQuery: 5 },
    );
    // Round 1 sees 1 item; round 2 sees that item PLUS the new one.
    expect(seenPerRound).toEqual([1, 2]);
    expect(outcome.evidence).toHaveLength(2);
  });

  it("cap on total searches: decomposition x refinement cannot blow the budget", async () => {
    const { calls, search } = stubSearch(indiaResults);
    const researcher = stubResearcher(() => ({
      sufficient: false,
      confidence: 0.3,
      gaps: ["gap"],
      refinedQueries: ["refined one", "refined two", "refined three", "refined four"],
      verdictSignal: "not_enough_evidence",
    }));
    await runDeepResearch(
      {
        claim: "compound",
        questions: Array.from({ length: 6 }, (_, i) => ({
          question: `Q${i}`,
          queries: [`q-${i}`],
        })),
      },
      { search, researcher, depthCap: 3, resultsPerQuery: 5 },
    );
    // 6 questions × 3 rounds would be 18 searches unbounded; the budget caps it.
    expect(calls.length).toBeLessThanOrEqual(12); // MAX_SEARCHES
  });
});
