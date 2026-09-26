// ADR-0020 rule 3: refutation and corroboration. Added alongside the original
// research-loop contract test (which is authored-before-implementation and left
// untouched); this file covers the behaviour the ADR introduces.

import { describe, expect, it } from "vitest";
import {
  independentSourceCount,
  meetsCorroboration,
  type ResearcherLlm,
  runDeepResearch,
} from "./research-loop.ts";
import type { SearchResult } from "./serper-adapter.ts";

const roundResult: SearchResult = {
  title: "Article",
  link: "https://rnz.co.nz/one",
  snippet: "s",
};
const refutationResult: SearchResult = {
  title: "Counter-report",
  link: "https://newsroom.co.nz/two",
  snippet: "s",
};

describe("independent-source counting (ADR-0020 rule 3)", () => {
  it("counts domains, not pages — two pages on one site are one source", () => {
    expect(
      independentSourceCount([
        { link: "https://www.rnz.co.nz/a" },
        { link: "https://rnz.co.nz/b" },
      ]),
    ).toBe(1);
    expect(
      independentSourceCount([
        { link: "https://rnz.co.nz/a" },
        { link: "https://newsroom.co.nz/b" },
      ]),
    ).toBe(2);
  });

  it("requires two independent sources to corroborate", () => {
    expect(meetsCorroboration([{ link: "https://rnz.co.nz/a" }])).toBe(false);
    expect(
      meetsCorroboration([{ link: "https://rnz.co.nz/a" }, { link: "https://newsroom.co.nz/b" }]),
    ).toBe(true);
  });
});

describe("refutation search (ADR-0020 rule 3)", () => {
  it("runs the refutation query the researcher names, and re-assesses with it in view", async () => {
    const calls: string[] = [];
    const evidenceSeen: number[] = [];
    let n = 0;
    const search = async (query: string): Promise<SearchResult[]> => {
      calls.push(query);
      return query === "did the police presence fall" ? [refutationResult] : [roundResult];
    };
    const researcher: ResearcherLlm = {
      assessRound: async (input) => {
        n += 1;
        evidenceSeen.push(input.evidence.length);
        if (n === 1) {
          return {
            sufficient: false,
            confidence: 0.2,
            gaps: ["no corroboration"],
            refinedQueries: [],
            refutationQuery: "did the police presence fall",
            verdictSignal: "not_enough_evidence",
          };
        }
        return { sufficient: true, confidence: 0.7, gaps: [], verdictSignal: "refuted" };
      },
    };

    const outcome = await runDeepResearch(
      { claim: "police presence increased", questions: [{ question: "by how much?", queries: ["police presence increase"] }] },
      { search, researcher, depthCap: 1, resultsPerQuery: 5 },
    );

    expect(calls).toContain("did the police presence fall");
    expect(outcome.refutationSearched).toBe(true);
    expect(outcome.evidence.map((e) => e.link)).toContain(refutationResult.link);
    // Two assessments, and the second saw MORE evidence — the refutation search
    // is not done after the judgement and forgotten.
    expect(evidenceSeen).toHaveLength(2);
    expect(evidenceSeen[1]).toBeGreaterThan(evidenceSeen[0] ?? 0);
    // The re-assessment's reading is the one reported.
    expect(outcome.verdictSignal).toBe("refuted");
    expect(outcome.independentSources).toBe(2);
  });

  it("does not fabricate a refutation search when the researcher names none", async () => {
    const calls: string[] = [];
    const search = async (query: string): Promise<SearchResult[]> => {
      calls.push(query);
      return [roundResult];
    };
    const researcher: ResearcherLlm = {
      assessRound: async () => ({ sufficient: true, confidence: 0.8, gaps: [], verdictSignal: "supported" }),
    };
    const outcome = await runDeepResearch(
      { claim: "c", questions: [{ question: "q", queries: ["only query"] }] },
      { search, researcher, depthCap: 1, resultsPerQuery: 5 },
    );
    expect(calls).toEqual(["only query"]);
    expect(outcome.refutationSearched).toBe(false);
  });
});
