// Deep-research retrieval loop (user direction, Sept 2026): "deep research,
// not one shot". Decompose → research each question (geography-aware queries,
// no NZ suffix) → LLM researcher grades evidence (snippets + domains), states
// gaps, refines on the gaps — capped rounds, cap recorded, budget-capped
// searches. Sufficiency is an explicit judgement against a stated bar.

import type { SearchResult } from "./serper-adapter.ts";

export interface ResearchOutcome {
  evidence: SearchResult[];
  roundsUsed: number;
  capBinding: number;
  cappedRun: boolean;
  confidence: number;
  verdictSignal: "supported" | "refuted" | "not_enough_evidence";
  gaps: string[];
}

export const RESEARCHER_PROMPT = `You are a research assessor verifying a factual claim.
You are given: the claim, the decomposed questions searched, and the evidence collected so far
(title, link, domain, snippet for each source).
Assess:
1. sufficient: is the evidence ENOUGH to settle the claim's key quantity/statement?
   The bar: at least one source whose domain matches the claim's own jurisdiction,
   directly stating the specific figure/period the claim asserts. Media commentary
   about related numbers does NOT meet the bar.
2. gaps: what specifically remains unverified (e.g. "no official source for the 27% figure").
3. refinedQueries: 1-3 searches targeting the gaps. These must chase the MISSING evidence
   (official statistics, primary statements), not repeat what was already searched.
4. verdictSignal: your current best reading — supported | refuted | not_enough_evidence.
5. confidence: 0-1, reflecting how settled the evidence is.
Reply with ONLY JSON: {"sufficient": boolean, "confidence": number, "gaps": string[], "refinedQueries": string[], "verdictSignal": "supported"|"refuted"|"not_enough_evidence"}`;

export interface ResearchAssessment {
  sufficient: boolean;
  confidence: number;
  gaps: string[];
  refinedQueries?: string[];
  verdictSignal: "supported" | "refuted" | "not_enough_evidence";
}

export interface ResearcherLlm {
  assessRound(input: {
    claim: string;
    round: number;
    questions: Array<{ question: string; queries: string[] }>;
    evidence: Array<{ title: string; link: string; snippet: string; domain: string }>;
    gaps: string[];
  }): Promise<ResearchAssessment>;
}

export interface ResearchInput {
  claim: string;
  questions: Array<{ question: string; queries: string[] }>;
}

// Cost guard: decomposition × refinement cannot blow the search budget.
export const MAX_SEARCHES = 12;

export async function runDeepResearch(
  input: {
    claim: string;
    questions: Array<{ question: string; queries: string[] }>;
  },
  deps: {
    search: (query: string) => Promise<SearchResult[]>;
    researcher: ResearcherLlm;
    depthCap: number;
    resultsPerQuery: number;
  },
): Promise<ResearchOutcome> {
  const evidence: SearchResult[] = [];
  const seenLinks = new Set<string>();
  let searchesUsed = 0;
  let round = 0;
  let assessment: ResearchAssessment = {
    sufficient: false,
    confidence: 0,
    gaps: [],
    verdictSignal: "not_enough_evidence",
  };

  // Pending queries start as the decomposition's own queries; refinement
  // replaces them with gap-targeted queries.
  let pendingQueries = input.questions.flatMap((q) => q.queries);

  while (round < deps.depthCap && pendingQueries.length > 0 && searchesUsed < MAX_SEARCHES) {
    // Search this round's queries; dedupe by link across rounds.
    const roundQueries = pendingQueries.slice(0, Math.max(0, MAX_SEARCHES - searchesUsed));
    const collected: Array<{ title: string; link: string; snippet: string; domain: string }> = [];
    for (const query of roundQueries) {
      const results = await deps.search(query);
      searchesUsed += 1;
      for (const r of results.slice(0, deps.resultsPerQuery)) {
        if (seenLinks.has(r.link)) continue;
        seenLinks.add(r.link);
        evidence.push(r);
        let domain = "";
        try {
          domain = new URL(r.link).hostname;
        } catch {
          domain = "";
        }
        collected.push({ title: r.title, link: r.link, snippet: r.snippet, domain });
      }
    }

    // The researcher SEES snippets + domains — it can actually judge quality.
    assessment = await deps.researcher.assessRound({
      claim: input.claim,
      round,
      questions: input.questions,
      evidence: collected,
      gaps: assessment.gaps,
    });

    round += 1;
    if (assessment.sufficient) break;
    pendingQueries = assessment.refinedQueries ?? [];
  }

  return {
    evidence,
    roundsUsed: round,
    capBinding: deps.depthCap,
    cappedRun: round >= deps.depthCap && !assessment.sufficient,
    confidence: assessment.confidence,
    verdictSignal: assessment.verdictSignal,
    gaps: assessment.gaps,
  };
}
