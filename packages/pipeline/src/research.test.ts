// The adversarial research loop L1 (ADR-0026): the loop's control flow, and the
// researcher's tool loop over a mocked `AgentPort`. No provider, no network.

import { describe, expect, it } from "vitest";
import type {
  AgentCall,
  AgentCallResult,
  AgentPort,
  AgentStepRecord,
  AgentToolCall,
  AgentToolResult,
} from "./agent-port.ts";
import { ScriptedLlm } from "./llm-port.ts";
import {
  createResearcherAgent,
  createResearchSpend,
  DEFAULT_RESEARCH_BUDGET_USD,
  type EvidenceRecord,
  MAX_RESEARCH_TURNS,
  type ResearchCritique,
  type ResearchPlan,
  type ResearchRole,
  type ResearchSpend,
  runAdversarialResearch,
} from "./research.ts";
import type { SearchResult } from "./search/serper-adapter.ts";

const context = { claim: "Crime is up 30% since 2017.", supports: "that law and order is failing" };

const plan = (): ResearchPlan => ({
  evidencePlan: "Find the official victimisation series.",
  questions: ["What do the official figures say?", "Would they disprove a 30% rise?"],
  sources: ["NZ Police policedata.nz victimisations"],
});

const evidence = (url = "https://www.policedata.nz/x"): EvidenceRecord => ({
  url,
  title: "Police data",
  domain: "policedata.nz",
  passage: "Victimisations rose 12%.",
  tier: 1,
});

const critique = (over: Partial<ResearchCritique>): ResearchCritique => ({
  sufficient: false,
  verdictClass: "not_enough_evidence",
  confidence: 0.4,
  reason: "The official series has not been found yet.",
  gaps: ["no official series"],
  justifications: [],
  ...over,
});

const found = (evidenceFound: EvidenceRecord[]) => ({
  evidence: evidenceFound,
  strategy: "searched the official series",
  queries: ["crime statistics New Zealand"],
  toolCalls: [
    {
      toolName: "search",
      input: { query: "crime statistics New Zealand" },
      resultSummary: "4 results",
    },
  ],
});

describe("runAdversarialResearch", () => {
  it("publishes the critiquer's finding when the first turn is sufficient", async () => {
    const outcome = await runAdversarialResearch(context, {
      assessor: async () => plan(),
      researcher: async () => found([evidence()]),
      critiquer: async () =>
        critique({
          sufficient: true,
          verdictClass: "refuted",
          confidence: 0.9,
          reason: "The official series shows 12%, not 30%.",
          gaps: [],
          justifications: ["The series shows 12%."],
        }),
    });
    expect(outcome.verdictClass).toBe("refuted");
    expect(outcome.turnsUsed).toBe(1);
    expect(outcome.capped).toBe(false);
    expect(outcome.agreement.agreed).toBe(true);
    expect(outcome.turns[0]?.toolCalls).toHaveLength(1);
  });

  it("loops the critique back to the assessor when evidence is insufficient", async () => {
    const priorSeen: Array<ResearchCritique | null | undefined> = [];
    let round = 0;
    const outcome = await runAdversarialResearch(context, {
      assessor: async ({ prior }) => {
        priorSeen.push(prior);
        return plan();
      },
      researcher: async ({ round: r }) => found([evidence(`https://example.com/${r}`)]),
      critiquer: async () => {
        round += 1;
        return round >= 2
          ? critique({
              sufficient: true,
              verdictClass: "supported",
              confidence: 0.8,
              reason: "Two sources agree.",
            })
          : critique({});
      },
    });
    expect(outcome.verdictClass).toBe("supported");
    expect(outcome.turns).toHaveLength(2);
    expect(priorSeen[0]).toBeNull();
    expect(priorSeen[1]?.gaps).toEqual(["no official series"]);
  });

  it("caps the loop and publishes the critiquer's reason", async () => {
    let assessments = 0;
    const outcome = await runAdversarialResearch(context, {
      assessor: async () => {
        assessments += 1;
        return plan();
      },
      researcher: async () => found([evidence()]),
      critiquer: async () => critique({ reason: "Still no official series for the 30% figure." }),
    });
    expect(outcome.capped).toBe(true);
    expect(outcome.verdictClass).toBe("not_enough_evidence");
    expect(outcome.turnsUsed).toBe(MAX_RESEARCH_TURNS);
    expect(assessments).toBe(MAX_RESEARCH_TURNS);
    expect(outcome.reason).toContain("no official series");
  });

  it("publishes nothing when two deciding runs disagree (VER-R16)", async () => {
    let deciding = 0;
    const outcome = await runAdversarialResearch(context, {
      assessor: async () => plan(),
      researcher: async () => found([evidence()]),
      critiquer: async () => {
        deciding += 1;
        return critique({
          sufficient: true,
          verdictClass: deciding === 1 ? "supported" : "refuted",
          confidence: 0.7,
          reason: "the evidence settles it",
        });
      },
    });
    expect(outcome.verdictClass).toBe("not_enough_evidence");
    expect(outcome.agreement.agreed).toBe(false);
    expect(outcome.agreement.classes).toEqual(["supported", "refuted"]);
  });
});

// ---------- the researcher tool loop ----------

class MockAgentPort implements AgentPort {
  constructor(private readonly script: Array<Array<{ toolName: string; input: unknown }>>) {}

  async runAgent(call: AgentCall): Promise<AgentCallResult> {
    const steps: AgentStepRecord[] = [];
    for (let i = 0; i < this.script.length; i++) {
      const calls = this.script[i] ?? [];
      const toolCalls: AgentToolCall[] = [];
      const toolResults: AgentToolResult[] = [];
      for (const c of calls) {
        const spec = call.tools[c.toolName];
        const output = spec?.execute ? await spec.execute(c.input) : undefined;
        toolCalls.push({ toolName: c.toolName, input: c.input });
        toolResults.push({ toolName: c.toolName, output });
      }
      steps.push({
        stepNumber: i,
        toolCalls,
        toolResults,
        text: i === this.script.length - 1 ? "done" : "",
        tokensIn: 1,
        tokensOut: 1,
      });
    }
    return { ok: true, steps, usage: { tokensIn: 2, tokensOut: 2 }, model: "mock" };
  }
}

class MockResearchLlm extends ScriptedLlm<ResearchRole> {
  constructor(script: (role: string, input: unknown) => { ok: boolean; value?: unknown }) {
    super(script, "mock-research", { tokensIn: 10, tokensOut: 5 });
  }
}

describe("createResearcherAgent", () => {
  it("runs the model's tool calls, collects evidence, and records the calls", async () => {
    const searches: string[] = [];
    const llm = new MockResearchLlm((role, input) => {
      if (role !== "researcher-extract") return { ok: false };
      const pages = (input as { pages: Array<{ url: string }> }).pages;
      return {
        ok: true,
        value: {
          evidence: pages.map((p) => ({
            url: p.url,
            // Distinct titles, so the researcher's re-publication dedupe does not
            // collapse them (the dedupe is tested separately).
            title: p.url,
            passage: `Passage for ${p.url}`,
          })),
        },
      };
    });
    const agent = new MockAgentPort([
      [
        { toolName: "search", input: { query: "q1" } },
        { toolName: "search", input: { query: "q2" } },
      ],
      [
        {
          toolName: "extractEvidence",
          input: { urls: ["https://a", "https://b"], question: "q1" },
        },
      ],
      [{ toolName: "finish", input: { reason: "done" } }],
    ]);
    const researcher = createResearcherAgent(llm, agent, {
      search: async (query: string): Promise<SearchResult[]> => {
        searches.push(query);
        return [{ title: "A", link: `https://example.com/${query}`, snippet: query }];
      },
      fetchPage: async (url: string) => `page text for ${url}`,
    });

    const result = await researcher.research({ claim: context.claim, plan: plan(), round: 0 });
    expect(searches).toEqual(["q1", "q2"]);
    expect(result.queries).toEqual(["q1", "q2"]);
    expect(result.evidence.map((e) => e.passage).sort()).toEqual([
      "Passage for https://a",
      "Passage for https://b",
      "Passage for https://example.com/q1",
      "Passage for https://example.com/q2",
    ]);
    expect(result.toolCalls.map((c) => c.toolName)).toEqual([
      "search",
      "search",
      "extractEvidence",
      "finish",
    ]);
    expect(result.toolCalls.find((c) => c.toolName === "search")?.resultSummary).toBe(
      "1 results, 1 passages",
    );
  });

  it("enforces the search budget inside the tool, telling the model to finish", async () => {
    const llm = new MockResearchLlm(() => ({ ok: true, value: { evidence: [] } }));
    const agent = new MockAgentPort([
      [
        { toolName: "search", input: { query: "q1" } },
        { toolName: "search", input: { query: "q2" } },
      ],
      [{ toolName: "finish", input: { reason: "budget" } }],
    ]);
    const researcher = createResearcherAgent(
      llm,
      agent,
      {
        search: async (): Promise<SearchResult[]> => [],
        fetchPage: async () => "",
      },
      { maxSearches: 1 },
    );
    const result = await researcher.research({ claim: context.claim, plan: plan(), round: 0 });
    expect(result.queries).toEqual(["q1"]);
  });

  it("drops the claim's own document and collapses same-title republications", async () => {
    const llm = new MockResearchLlm((role, input) => {
      if (role !== "researcher-extract") return { ok: false };
      const pages = (input as { pages: Array<{ url: string; title: string }> }).pages;
      return {
        ok: true,
        value: {
          evidence: pages.map((p) => ({
            url: p.url,
            title: p.title,
            passage: `Passage for ${p.url}`,
          })),
        },
      };
    });
    const agent = new MockAgentPort([
      [{ toolName: "search", input: { query: "q" } }],
      [{ toolName: "finish", input: { reason: "done" } }],
    ]);
    const researcher = createResearcherAgent(llm, agent, {
      search: async (): Promise<SearchResult[]> => [
        // An independent story with its own title: kept.
        {
          title: "Independent analysis of the figures",
          link: "https://news.example/a",
          snippet: "",
        },
        // A syndicated copy of the claim's own story: same title, different domain.
        { title: "The Story", link: "https://copy.example/b", snippet: "" },
        // The claim's own document.
        { title: "The story", link: "https://claim.example/c", snippet: "" },
      ],
      fetchPage: async (url: string) => `page ${url}`,
    });
    const result = await researcher.research({
      claim: context.claim,
      plan: plan(),
      round: 0,
      sourceUrl: "https://claim.example/c",
      documentTitle: "The story",
    });
    expect(result.evidence.map((e) => e.url)).toEqual(["https://news.example/a"]);
  });

  it("refuses a source that can never be the record, whatever its tier (ADR-0020)", async () => {
    // The search tool extracts mechanically from whatever its query returned, so
    // this is enforced in code and not left to the prompt: a run that only ASKED
    // the model not to gather social posts still gathered them.
    const llm = new MockResearchLlm((role, input) => {
      if (role !== "researcher-extract") return { ok: false };
      const pages = (input as { pages: Array<{ url: string; title: string }> }).pages;
      return {
        ok: true,
        value: {
          evidence: pages.map((p) => ({
            url: p.url,
            title: p.title,
            passage: `Passage for ${p.url}`,
            tier: 6,
          })),
        },
      };
    });
    const agent = new MockAgentPort([
      [{ toolName: "search", input: { query: "q" } }],
      [{ toolName: "finish", input: { reason: "done" } }],
    ]);
    const researcher = createResearcherAgent(llm, agent, {
      search: async (): Promise<SearchResult[]> => [
        { title: "Police data", link: "https://www.policedata.nz/series", snippet: "" },
        { title: "A post", link: "https://www.facebook.com/someone/posts/1", snippet: "" },
        { title: "A wiki", link: "https://en.wikipedia.org/wiki/Crime", snippet: "" },
      ],
      fetchPage: async (url: string) => `page ${url}`,
    });
    const result = await researcher.research({ claim: context.claim, plan: plan(), round: 0 });
    expect(result.evidence.map((e) => e.url)).toEqual(["https://www.policedata.nz/series"]);
  });
});

describe("the research budget (ADR-0026)", () => {
  /** A meter whose total the test controls, so the budget arithmetic is exact. */
  function fakeSpend(): ResearchSpend & { charge(usd: number): void } {
    let total = 0;
    return {
      record: () => {},
      entries: () => [],
      totalUsd: () => total,
      charge: (usd: number) => {
        total += usd;
      },
    };
  }

  /** A critiquer that never finds sufficiency, charging the meter once per turn. */
  const neverSufficient = (spend: ReturnType<typeof fakeSpend>, perTurn: number) => async () => {
    spend.charge(perTurn);
    return critique({ reason: "Still no official series for the 30% figure." });
  };

  it("stops when the budget is spent, not after a fixed number of turns", async () => {
    const spend = fakeSpend();
    const outcome = await runAdversarialResearch(
      context,
      {
        spend,
        assessor: async () => plan(),
        researcher: async () => found([evidence()]),
        critiquer: neverSufficient(spend, 0.03),
      },
      { budgetUsd: 0.1 },
    );
    // 0.03 a turn: four turns reach 0.12, which is over the 0.10 budget.
    expect(outcome.stopReason).toBe("budget");
    expect(outcome.capped).toBe(true);
    expect(outcome.turnsUsed).toBe(4);
    expect(outcome.budgetUsd).toBe(0.1);
    expect(outcome.spentUsd).toBeCloseTo(0.12);
    // The published reason stays the critiquer's (VER-R17); WHY we stopped is `stopReason`.
    expect(outcome.reason).toContain("no official series");
  });

  it("lets the budget buy MORE turns than the old fixed cap", async () => {
    const spend = fakeSpend();
    const outcome = await runAdversarialResearch(
      context,
      {
        spend,
        assessor: async () => plan(),
        researcher: async () => found([evidence()]),
        critiquer: neverSufficient(spend, 0.001),
      },
      { budgetUsd: 1 },
    );
    // The budget never binds, so the hard backstop does — and it is well past 5.
    expect(outcome.stopReason).toBe("cap");
    expect(outcome.turnsUsed).toBe(MAX_RESEARCH_TURNS);
    expect(outcome.turnsUsed).toBeGreaterThan(5);
  });

  it("falls back to the backstop when no meter is supplied", async () => {
    const outcome = await runAdversarialResearch(context, {
      assessor: async () => plan(),
      researcher: async () => found([evidence()]),
      critiquer: async () => critique({}),
    });
    expect(outcome.spentUsd).toBeNull();
    expect(outcome.stopReason).toBe("cap");
    expect(outcome.turnsUsed).toBe(MAX_RESEARCH_TURNS);
    expect(outcome.budgetUsd).toBe(DEFAULT_RESEARCH_BUDGET_USD);
  });

  it("reports sufficiency as the stop reason, with what it spent", async () => {
    const spend = fakeSpend();
    const outcome = await runAdversarialResearch(
      context,
      {
        spend,
        assessor: async () => plan(),
        researcher: async () => found([evidence()]),
        critiquer: async () => {
          spend.charge(0.02);
          return critique({ sufficient: true, verdictClass: "refuted", confidence: 0.9 });
        },
      },
      { budgetUsd: 1 },
    );
    expect(outcome.stopReason).toBe("sufficient");
    expect(outcome.capped).toBe(false);
    expect(outcome.turnsUsed).toBe(1);
    expect(outcome.spentUsd).toBeCloseTo(0.04);
  });

  it("takes the budget from the caller, defaulting to the pipeline constant", async () => {
    const spend = fakeSpend();
    const outcome = await runAdversarialResearch(
      context,
      {
        spend,
        assessor: async () => plan(),
        researcher: async () => found([evidence()]),
        critiquer: neverSufficient(spend, 0.001),
      },
      { budgetUsd: 0.05 },
    );
    expect(outcome.budgetUsd).toBe(0.05);
  });
});

describe("createResearchSpend", () => {
  it("prices recorded calls from the versioned price map", () => {
    const spend = createResearchSpend();
    spend.record({
      role: "claim-assessor",
      model: "anthropic:claude-sonnet-5",
      tokensIn: 1_000_000,
      tokensOut: 0,
    });
    // Sonnet is $2.00/M in, $10.00/M out.
    expect(spend.totalUsd()).toBeCloseTo(2, 6);
    spend.record({
      role: "researcher",
      model: "anthropic:claude-sonnet-5",
      tokensIn: 0,
      tokensOut: 100_000,
    });
    expect(spend.totalUsd()).toBeCloseTo(3, 6);
    expect(spend.entries()).toHaveLength(2);
  });

  it("fails loudly on an unpriced model rather than under-counting", () => {
    const spend = createResearchSpend();
    spend.record({
      role: "researcher",
      model: "somewhere:unpriced-model",
      tokensIn: 1,
      tokensOut: 1,
    });
    expect(() => spend.totalUsd()).toThrow(/no price for/);
  });
});
