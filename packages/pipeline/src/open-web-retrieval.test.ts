// Open-web retrieval loop (VERIFICATION §2.5a, FIRE pattern): the capped
// catch-all, now with REAL retrieval — fingerprint-conditioned query generation
// → Serper search → evidence extraction → confidence-capped rounds. The cap
// binding is recorded on every result (a capped run is visible, not silent).
//
// Authored BEFORE implementation (TDD red). Do not mutate without approval.

import { describe, expect, it } from "vitest";
import {
  type RetrievalLlm,
  type RetrievalResult,
  runOpenWebRetrieval,
} from "./open-web-retrieval.ts";
import type { SearchResult } from "./search/serper-adapter.ts";

function stubSearch(resultsByQuery: Record<string, SearchResult[]>) {
  const calls: string[] = [];
  return {
    calls,
    search: async (query: string): Promise<SearchResult[]> => {
      calls.push(query);
      return resultsByQuery[query] ?? [];
    },
  };
}

function stubLlm(script: (input: unknown) => unknown): RetrievalLlm {
  return {
    async generateObject(role: string, input: unknown, schema: { parse(value: unknown): unknown }) {
      // Mirror the LIVE adapter contract (LlmCallResult): { ok, value } on
      // success — the loop treats a failed call as "capped, no confidence".
      return { ok: true as const, value: schema.parse(script(input)) };
    },
  };
}

describe("open-web retrieval loop — fingerprint-conditioned, capped (VER-R3)", () => {
  it("generates queries from the claim fingerprint, not the raw claim string", async () => {
    const { calls, search } = stubSearch({});
    const llm = stubLlm(() => ({ done: true, confidence: 0.8 }));
    await runOpenWebRetrieval(
      {
        claim: "More than 225,000 people dead",
        fingerprint: {
          core: "225,000 covid deaths",
          claimant: null,
          domain: "covid-mortality",
          temporal: "2020",
          quantity: "225000",
          source: null,
        },
      },
      { search, llm: llm as never, depthCap: 3 },
    );
    expect(calls.length).toBeGreaterThan(0);
    // The query carries the core quantity + domain, not the rhetorical framing.
    expect(calls[0]).toContain("225,000 covid deaths");
    expect(calls[0]).not.toContain("More than 225,000 people dead");
  });

  it("returns evidence with the cap binding recorded", async () => {
    const { search } = stubSearch({
      "225,000 covid deaths statistics official New Zealand": [
        {
          title: "MoH covid data",
          link: "https://www.health.govt.nz/covid",
          snippet: "Official cumulative deaths reached 225,000 by late 2020.",
        },
      ],
    });
    const llm = stubLlm(() => ({ done: true, confidence: 0.85 }));
    const result: RetrievalResult = await runOpenWebRetrieval(
      {
        claim: "x",
        fingerprint: {
          core: "225,000 covid deaths",
          claimant: null,
          domain: "covid-mortality",
          temporal: null,
          quantity: null,
          source: null,
        },
      },
      { search, llm: llm as never, depthCap: 3 },
    );
    expect(result.capBinding).toBe(3);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.link).toBe("https://www.health.govt.nz/covid");
    expect(result.confidence).toBe(0.85);
  });

  it("iterates multi-hop rounds when the LLM says more retrieval is needed", async () => {
    const { calls, search } = stubSearch({
      "225,000 covid deaths statistics official New Zealand": [
        { title: "MoH portal", link: "https://www.health.govt.nz/covid", snippet: "data portal" },
      ],
      "covid mortality excess deaths 2020 New Zealand": [
        {
          title: "Stats NZ excess deaths",
          link: "https://www.stats.govt.nz/excess",
          snippet: "excess mortality series",
        },
      ],
    });
    let round = 0;
    const llm = stubLlm((input) => {
      const req = input as { round?: number };
      if ((req.round ?? 0) === 0) {
        round = 1;
        return {
          done: false,
          nextRound: 1,
          refinedQuery: "covid mortality excess deaths 2020 New Zealand",
        };
      }
      return { done: true, confidence: 0.9 };
    });
    const result = await runOpenWebRetrieval(
      {
        claim: "x",
        fingerprint: {
          core: "225,000 covid deaths",
          claimant: null,
          domain: "covid-mortality",
          temporal: null,
          quantity: null,
          source: null,
        },
      },
      { search, llm: llm as never, depthCap: 3 },
    );
    expect(calls).toHaveLength(2); // initial + refined query
    expect(result.evidence).toHaveLength(2);
    expect(result.roundsUsed).toBe(2);
  });

  it("stops at the depth cap — a capped run is visible in the result", async () => {
    let round = 0;
    const llm = stubLlm(() => {
      round += 1;
      return { done: false, nextRound: round };
    });
    const { search } = stubSearch({});
    const result = await runOpenWebRetrieval(
      {
        claim: "x",
        fingerprint: {
          core: "core",
          claimant: null,
          domain: null,
          temporal: null,
          quantity: null,
          source: null,
        },
      },
      { search, llm: llm as never, depthCap: 2 },
    );
    expect(result.roundsUsed).toBe(2);
    expect(result.cappedRun).toBe(true);
    expect(result.capBinding).toBe(2);
  });

  it("empty search results yield an honest no-evidence outcome, never a fake confidence", async () => {
    const { search } = stubSearch({});
    const llm = stubLlm(() => ({ done: true, confidence: 0.9 }));
    const result = await runOpenWebRetrieval(
      {
        claim: "x",
        fingerprint: {
          core: "obscure claim",
          claimant: null,
          domain: null,
          temporal: null,
          quantity: null,
          source: null,
        },
      },
      { search, llm: llm as never, depthCap: 1 },
    );
    expect(result.evidence).toHaveLength(0);
    expect(result.confidence).toBe(0);
  });
});
