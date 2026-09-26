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
  /** Whether a query aimed at refuting the claim was run (ADR-0020 rule 3). */
  refutationSearched: boolean;
  /** Independent sources — distinct domains — in the evidence (ADR-0020 rule 3). */
  independentSources: number;
}

export const RESEARCHER_PROMPT = `You are a research assessor verifying a factual claim.
You are given: the claim, the decomposed questions searched, and the evidence collected so far
(title, link, domain, snippet for each source).
Assess:
1. sufficient: is the evidence ENOUGH to settle the claim's key quantity/statement?
   The bar (ADR-0020): EITHER one official record for the claim's own jurisdiction that
   directly states the specific figure/statement, OR at least two INDEPENDENT sources from
   different domains. A single non-official source does NOT meet the bar. Media commentary
   about related numbers does NOT meet the bar either.
2. gaps: what specifically remains unverified (e.g. "no official source for the 27% figure").
3. refinedQueries: 1-3 searches targeting the gaps. These must chase the MISSING evidence
   (official statistics, primary statements), not repeat what was already searched.
4. refutationQuery: ONE search aimed at REFUTING the claim — the query most likely to surface
   evidence that it is false or oversimplified. A search that only looks for confirmation is
   not verification, so this is always required.
5. verdictSignal: your current best reading — supported | refuted | not_enough_evidence.
6. confidence: 0-1, reflecting how settled the evidence is.
Reply with ONLY JSON: {"sufficient": boolean, "confidence": number, "gaps": string[], "refinedQueries": string[], "refutationQuery": string, "verdictSignal": "supported"|"refuted"|"not_enough_evidence"}`;

export interface ResearchAssessment {
  sufficient: boolean;
  confidence: number;
  gaps: string[];
  refinedQueries?: string[];
  /** A query aimed at refuting the claim (ADR-0020 rule 3). */
  refutationQuery?: string;
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

function domainOf(link: string): string {
  try {
    return new URL(link).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Corroboration (ADR-0020 rule 3): how many DIFFERENT domains speak to the
 * claim. Two pages on one site are one source; a claim resting on a single
 * non-official source does not clear the bar.
 */
export function independentSourceCount(evidence: ReadonlyArray<{ link: string }>): number {
  return new Set(evidence.map((e) => domainOf(e.link)).filter((d) => d.length > 0)).size;
}

export function meetsCorroboration(evidence: ReadonlyArray<{ link: string }>): boolean {
  return independentSourceCount(evidence) >= 2;
}

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
  // What the researcher is shown: CUMULATIVE, not this round's slice. The
  // sufficiency judgement, the gaps and the confidence are all relative to
  // everything collected so far — grading round 2 against round 2's three
  // snippets alone made it re-chase gaps round 1 had already filled, spending
  // searches, tokens and rounds on evidence it could not see (Sept 2026).
  const evidenceForResearcher: Array<{
    title: string;
    link: string;
    snippet: string;
    domain: string;
  }> = [];
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
    for (const query of roundQueries) {
      const results = await deps.search(query);
      searchesUsed += 1;
      for (const r of results.slice(0, deps.resultsPerQuery)) {
        if (seenLinks.has(r.link)) continue;
        seenLinks.add(r.link);
        evidence.push(r);
        evidenceForResearcher.push({
          title: r.title,
          link: r.link,
          snippet: r.snippet,
          domain: domainOf(r.link),
        });
      }
    }

    // The researcher SEES snippets + domains — it can actually judge quality,
    // and it sees everything collected so far, not just this round.
    assessment = await deps.researcher.assessRound({
      claim: input.claim,
      round,
      questions: input.questions,
      evidence: evidenceForResearcher,
      gaps: assessment.gaps,
    });

    round += 1;
    if (assessment.sufficient) break;
    pendingQueries = assessment.refinedQueries ?? [];
  }

  // ADR-0020 rule 3: a refutation search is not optional. The researcher names
  // one; run it once if budget remains, then re-assess, because sufficiency
  // judged without it is confirmation-only.
  let refutationSearched = false;
  const refutationQuery = assessment.refutationQuery?.trim();
  if (refutationQuery && refutationQuery.length > 0 && searchesUsed < MAX_SEARCHES) {
    const results = await deps.search(refutationQuery);
    searchesUsed += 1;
    refutationSearched = true;
    for (const r of results.slice(0, deps.resultsPerQuery)) {
      if (seenLinks.has(r.link)) continue;
      seenLinks.add(r.link);
      evidence.push(r);
      evidenceForResearcher.push({
        title: r.title,
        link: r.link,
        snippet: r.snippet,
        domain: domainOf(r.link),
      });
    }
    assessment = await deps.researcher.assessRound({
      claim: input.claim,
      round,
      questions: input.questions,
      evidence: evidenceForResearcher,
      gaps: assessment.gaps,
    });
  }

  return {
    evidence,
    roundsUsed: round,
    capBinding: deps.depthCap,
    cappedRun: round >= deps.depthCap && !assessment.sufficient,
    confidence: assessment.confidence,
    verdictSignal: assessment.verdictSignal,
    gaps: assessment.gaps,
    refutationSearched,
    independentSources: independentSourceCount(evidence),
  };
}
