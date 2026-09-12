// Authority vetting — two stages (VER-R14, ADR-0018):
//   Stage 1 deterministic guardrails: advocacy rejection, foreign-official,
//   non-https. Declared lists — guardrails, not judgement.
//   Stage 2 LLM tier classification: surviving candidates are classified into
//   the declared T1–T6 taxonomy with rationale + confidence. The classifier is
//   an LLM — honestly stated (same posture as the NLI gate, VERIFICATION §2.7),
//   calibrated by must-pass/must-fail fixtures, rationale recorded on the
//   authority row as provenance.
//
// Authored BEFORE implementation (TDD red). Do not mutate without approval.

import { describe, expect, it } from "vitest";
import type { SearchResult } from "./serper-adapter.ts";
import { type AuthorityVettingLlm, type VettedCandidate, vetCandidate } from "./vetting.ts";

const result = (link: string, title = "Title", snippet = ""): SearchResult => ({
  link,
  title,
  snippet,
});

// Scripted LLM stub: returns canned classifications keyed on link substring.
function stubLlm(
  classify: (candidate: SearchResult) => {
    tier: number;
    rationale: string;
    confidence: number;
  } | null,
): AuthorityVettingLlm {
  return {
    async classifyAuthority(candidate) {
      const out = classify(candidate);
      if (out == null) return null;
      return out;
    },
  };
}

describe("authority vetting — stage 1 guardrails (deterministic, VER-R14)", () => {
  it("rejects non-https links before any LLM call", async () => {
    const llmCalls: unknown[] = [];
    const llm = stubLlm((c) => {
      llmCalls.push(c);
      return { tier: 1, rationale: "x", confidence: 0.9 };
    });
    const out = await vetCandidate(result("http://www.police.govt.nz/stats"), llm);
    expect(out.rejected).toBe(true);
    expect(llmCalls).toHaveLength(0); // guardrail fires first, classifier never runs
  });

  it("rejects advocacy sources outright (ADR-0018)", async () => {
    const llm = stubLlm(() => ({ tier: 1, rationale: "x", confidence: 0.9 }));
    const out = await vetCandidate(result("https://www.taxpayers.org.nz/poll"), llm);
    expect(out.rejected).toBe(true);
    expect(out.reason).toContain("advocacy");
  });

  it("rejects foreign official domains (suffix match — .gov must not hit govt.nz)", async () => {
    const llm = stubLlm(() => ({ tier: 1, rationale: "x", confidence: 0.9 }));
    expect((await vetCandidate(result("https://www.ons.gov.uk/economy"), llm)).rejected).toBe(true);
    expect((await vetCandidate(result("https://data.census.gov/table"), llm)).rejected).toBe(true);
    expect((await vetCandidate(result("https://www.police.govt.nz/stats"), llm)).rejected).toBe(
      false,
    );
  });
});

describe("authority vetting — stage 2 LLM tier classification", () => {
  it("classifies an official statistics page T1 with recorded rationale", async () => {
    const llm = stubLlm((c) =>
      c.link.includes("police.govt.nz")
        ? {
            tier: 1,
            rationale: "official NZ Police statistics portal on a govt.nz domain",
            confidence: 0.95,
          }
        : null,
    );
    const out = await vetCandidate(result("https://www.police.govt.nz/about-us/statistics"), llm);
    expect(out.rejected).toBe(false);
    expect(out.tier).toBe(1);
    expect(out.rationale).toContain("official NZ Police");
    expect(out.confidence).toBe(0.95);
  });

  it("classifies media T3 and NGO T5 — not everything is official", async () => {
    const llm = stubLlm((c) => {
      if (c.link.includes("rnz.co.nz"))
        return { tier: 3, rationale: "major NZ broadcaster", confidence: 0.9 };
      if (c.link.includes("salvationarmy"))
        return { tier: 5, rationale: "NGO social-policy unit", confidence: 0.85 };
      return null;
    });
    expect((await vetCandidate(result("https://www.rnz.co.nz/news"), llm)).tier).toBe(3);
    expect((await vetCandidate(result("https://www.salvationarmy.org.nz/social"), llm)).tier).toBe(
      5,
    );
  });

  it("LLM refusal to classify (null) rejects with the recorded reason — no silent accept", async () => {
    const llm = stubLlm(() => null);
    const out = await vetCandidate(result("https://mystery-source.example.com/data"), llm);
    expect(out.rejected).toBe(true);
    expect(out.reason).toContain("classifier");
  });

  it("candidate ranking: lowest tier wins among vetted survivors", async () => {
    const llm = stubLlm((c) => {
      if (c.link.includes("police.govt.nz"))
        return { tier: 1, rationale: "official", confidence: 0.95 };
      if (c.link.includes("otago.ac.nz"))
        return { tier: 2, rationale: "university", confidence: 0.9 };
      if (c.link.includes("nzherald")) return { tier: 3, rationale: "media", confidence: 0.9 };
      return null;
    });
    const candidates = [
      result("https://www.nzherald.co.nz/crime"),
      result("https://www.police.govt.nz/statistics"),
      result("https://www.otago.ac.nz/study"),
    ];
    const vetted = (await Promise.all(candidates.map((c) => vetCandidate(c, llm)))).filter(
      (c): c is VettedCandidate => !c.rejected,
    );
    const best = vetted.sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9))[0];
    expect(best?.tier).toBe(1);
    expect(best?.link).toBe("https://www.police.govt.nz/statistics");
  });
});
