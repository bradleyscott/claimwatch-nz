// The adversarial research loop (ADR-0026). One verification instrument:
//
//   claim-assessor   → what evidence would prove or falsify this claim
//   researcher       → a bounded tool-loop agent: plan the queries, dispatch
//                      them in parallel, read what comes back, and decide the
//                      next step
//   evidence-critiquer → is that evidence enough to settle it?
//
// If the critiquer says no and the turn cap has not been hit, its critique goes
// back to the assessor for another turn. If the cap is hit, the conclusion is
// `not_enough_evidence` and the critiquer's reason is published.
//
// The researcher's tool loop runs on the AI SDK's `generateText` (bounded by
// `stopWhen`, with per-step tool-call audit), behind the `AgentPort` so it stays
// mockable and the blind rule holds. The critiquer IS the publication gate: its
// finding must cite evidence for every justification.

import { costUsd } from "@cw/llm";
import { z } from "zod";
import type { AgentPort, AgentToolSpec } from "./agent-port.ts";
import type { LlmPort } from "./llm-port.ts";
import {
  DEFAULT_RESEARCH_BUDGET_USD,
  type EvidenceRecord,
  MAX_FETCHES_PER_SUBAGENT,
  MAX_RESEARCH_STEPS_PER_TURN,
  MAX_RESEARCH_TURNS,
  MAX_SEARCHES_PER_TURN,
  type ResearchCritique,
  type ResearchPlan,
  type ResearchToolCallRecord,
  type ResearchTurn,
  type ResearchVerdictClass,
} from "./research-api.ts";
import { isNeverTheRecord } from "./search/admissibility.ts";
import type { SearchResult } from "./search/serper-adapter.ts";

export type {
  EvidenceRecord,
  ResearchCritique,
  ResearchPlan,
  ResearchToolCallRecord,
  ResearchTurn,
  ResearchVerdictClass,
} from "./research-api.ts";
export {
  DEFAULT_RESEARCH_BUDGET_USD,
  MAX_FETCHES_PER_SUBAGENT,
  MAX_RESEARCH_STEPS_PER_TURN,
  MAX_RESEARCH_TURNS,
  MAX_SEARCHES_PER_TURN,
} from "./research-api.ts";

/** The roles this loop invokes — a closed set (CROSS-CUTTING §3, HAR-R7). */
export type ResearchRole =
  | "claim-assessor"
  | "researcher"
  | "researcher-extract"
  | "evidence-critiquer";
export type ResearchLlm = LlmPort<ResearchRole>;

// ---------- prompts (code, versioned @1 until a baseline is declared) ----------

export const RESEARCH_PROMPT_VERSIONS = {
  "claim-assessor": "claim-assessor@1",
  researcher: "researcher@1",
  "researcher-extract": "researcher-extract@1",
  "evidence-critiquer": "evidence-critiquer@1",
} as const;

/**
 * Retrieval guidance that names the agency which OWNS a number, per policy domain
 * (SOURCE-TAXONOMY §2.1–2.2, A1–A6 precedence and the authority map).
 *
 * It is one constant so the assessor's plan and the researcher's searches share
 * one list, and it names DOMAINS rather than a whitelist of URLs. A prompt that
 * privileges one curator makes the pipeline better at whichever portfolios that
 * curator happens to cover, which is the coverage bias the taxonomy exists to
 * avoid — and the taxonomy's own A5 level (established curators) is explicitly
 * "never sole basis for a verdict". These are examples of the rule, not the rule.
 */
export const NZ_AUTHORITY_GUIDANCE = `Naming the record (SOURCE-TAXONOMY A1–A6):
- The record is the body that PRODUCED the number — the agency and its series — not the page that describes it and not a curator that redraws it.
- Examples by domain: crime & justice — NZ Police recorded crime (policedata.nz), Ministry of Justice NZCVS and conviction data. Economy & fiscal — Stats NZ (CPI, GDP), Treasury (FOREs, HYEFU), RBNZ. Employment — Stats NZ HLFS, MSD benefit data. Immigration — Stats NZ international migration, MBIE visa data. Housing — Stats NZ building consents, LINZ/HUD price series, MSD housing register. Health — Te Whatu Ora/MoH waitlist and treatment data, NZ Health Survey. Education — Ministry of Education (rolls, attendance, NCEA), ERO. Welfare — MSD benefit data, Stats NZ child-poverty measures. Climate & energy — Stats NZ GHG inventory, MfE, MBIE energy statistics. Transport — Ministry of Transport / Waka Kotahi (road deaths, NLTP). Māori outcomes — Te Puni Kōkiri, Stats NZ Māori-purposed series.
- figure.nz is a curator (A5): it redraws official series and links each to its source. Use it to FIND the series, then read and cite the agency that produced it. It is never the verdict basis on its own.
- These are examples, not a whitelist. The rule is: find the agency that owns the number. If no official producer exists for the domain, say so and fall back to the open web.`;

export const CLAIM_ASSESSOR_PROMPT = `You are an adversarial claim assessor. Given a factual claim and the argument it was used to support, work out what evidence would PROVE it and what evidence would FALSIFY it.

Produce a research plan:
- evidencePlan: in plain words, what evidence would settle this claim — what a decisive source would have to say, and who would hold it.
- questions: the sub-questions a researcher should answer. Include the questions that would DISPROVE the claim, not only the ones that would confirm it.
- sources: where the evidence would live — the specific institutions, datasets or SERIES to target, not the page that describes them. Prefer the primary record over reporting about it. If the claim cites a survey or a report, the underlying data is the source.

${NZ_AUTHORITY_GUIDANCE}

Do not write search queries: the researcher chooses the strategy and the queries. On a later turn you are given the previous critique — its gaps are what the next plan must chase, and its missing sources are what the next plan must target. Keep every field short and plain.`;

export const RESEARCHER_PROMPT = `You are a research orchestrator with tools. You are given a claim, an evidence plan, the questions to answer, and the sources where the evidence is likely to live. Find the evidence that bears on the claim.

Work in steps. In each step, call one or more tools:
- "search": run a web search. You may call it several times in one step; the calls run in parallel. Include at least one search aimed at REFUTING the claim, not only at confirming it. Pass "site" to restrict a search to one domain when you are targeting an official source (for example site "police.govt.nz").
- "readPage": read the full text of a specific page.
- "extractEvidence": for a set of urls and a question, return the shortest VERBATIM passages that speak to the claim, each with its source tier. Use this for the pages that matter; it returns checked quotations, not raw text.
- "finish": call when you judge the turn's searching done, with a one-sentence reason.

Rules for finding evidence that can settle a claim:
- Prefer the PRIMARY record. Official statistics, a government dataset or the original survey beat a news story, a study about the survey, or a social post. If a source cites a survey, series or report, go and find that underlying data and read it.
- Do not treat a republication of the claim's own article as evidence. If a result is the same story the claim came from (the same title, or the same outlet), it is the claim, not corroboration — ignore it and look for the underlying record.
- NEVER STOP AT A LANDING PAGE. A "publications and statistics", "data and statistics", "research" or survey home page is an index, not the record. If a page only lists or links to data, follow it to the specific series, table or release and read that. A hub page is never the evidence.
- Prefer the data over the prose about it. When a series is published as a file or a table, read the file or the table; a page that describes the data is a lead to it.
- Do not gather evidence from social media, forums or personal posts (Facebook, LinkedIn, X, Instagram, TikTok, Reddit), or from reposts and aggregators. They are not evidence, whatever they say.
- Target the plan's sources: search the official domain directly rather than the claim's wording, and pass "site" to restrict a search when you are targeting one domain.

${NZ_AUTHORITY_GUIDANCE}
- Use what you have already found to decide the next step: chase the plan's questions, follow a promising source, or stop. Do not repeat a search that already found nothing. Keep going until you can answer the plan's questions or further searching will not help, then call "finish".`;

export const RESEARCHER_EXTRACT_PROMPT = `You are a research subagent. You are given a claim, the question you are answering, and the text of pages fetched for one search query. Extract the evidence that bears on the claim.

For each relevant page, give the url, the SHORTEST passage that speaks to the claim (verbatim from the page), and a source tier:
- tier 1: official statistics or the relevant national government source for the claim's jurisdiction
- tier 2: academic or peer-reviewed research in the claim's jurisdiction
- tier 3: major mainstream media in the claim's jurisdiction
- tier 5: NGO, advocacy-adjacent sector body, or an international body
- tier 6: unknown or personal sources (a social post, a blog, an aggregator)
If a page is tabular data (CSV, JSON, XML, a plain-text table), give the specific rows or values that answer the question, with the column or field names, exactly as they appear. Do not recompute, round or reformat the numbers, and do not summarise the file — quote the part that bears on the claim.

If a page is not relevant, omit it. Do not summarise and do not paraphrase: a passage that is not verbatim cannot be checked.

Omit social media, forums and personal posts entirely, and omit hub or landing pages that only link to data: extract from the record, not from a menu.

Never assert what a page says beyond its passage.`;

export const EVIDENCE_CRITIQUER_PROMPT = `You are an evidence critiquer. You are given a claim, the plan that was used to search for evidence, and ALL the evidence gathered across every turn (each item carries a source tier: 1 official · 2 academic · 3 media · 5 sector · 6 unknown). Decide whether that evidence is ENOUGH to prove or disprove the claim.

The bar for a decisive class ("supported" or "refuted"):
- The evidence must include the PRIMARY record. For a statistic, that is the official dataset, series or survey release for the claim's own jurisdiction, read directly (tier 1) — not a news story about it, not a study that mentions it, not a social post.
- Two sources are independent only if they are independent RECORDS. Two outlets reporting the same story are ONE source. A source that cites another is not independent of it.
- A news article that reports a figure is evidence of what was reported, not of the figure. A newsroom's own analysis of the data is a LEAD to the record, not the record. If the claim turns on a statistic or a trend and the official dataset, series or survey release is not in the evidence, the class is not_enough_evidence, whatever the analysis says.
- A hub, index or landing page is not the record, however official its domain: a "data and statistics" page that only links to the series is a lead, not the series.
- Media commentary about related facts is NOT enough. An international or secondary study is NOT the primary record.

Answer:
- sufficient: whether the evidence settles the claim. If you answer false, say exactly what is missing in gaps, and name the specific primary source that would settle it.
- verdictClass: "supported" if the primary evidence establishes the claim; "refuted" if it establishes its negation; "conflicting_cherry_picking" if the primary evidence shows the claim is accurate but selective or incomplete; "not_enough_evidence" if the primary record is not present.
- confidence: 0-1.
- reason: one or two plain sentences a reader can follow, saying why the class follows from the evidence.
- gaps: what specifically remains unverified, and the primary source that would fill it.
- justifications: one sentence per finding, each stating something the cited evidence entails. Never synthesize beyond the evidence; never attribute to a person a character judgement.

You must not conclude "supported" or "refuted" unless the evidence you cite entails it. A conclusion the evidence does not support is worse than not_enough_evidence.`;

// ---------- schemas ----------

const ResearchPlanSchema = z.object({
  evidencePlan: z.string().min(1),
  questions: z.array(z.string().min(1)).default([]),
  sources: z.array(z.string().min(1)).default([]),
});

const ResearcherExtractionSchema = z.object({
  evidence: z
    .array(
      z.object({
        url: z.string().min(1),
        title: z.string().nullable().default(null),
        passage: z.string().min(1),
        tier: z.number().int().min(1).max(6).nullable().default(null),
      }),
    )
    .default([]),
});

const CritiqueSchema = z.object({
  sufficient: z.boolean(),
  verdictClass: z.enum([
    "supported",
    "refuted",
    "not_enough_evidence",
    "conflicting_cherry_picking",
  ]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  gaps: z.array(z.string()).default([]),
  justifications: z.array(z.string()).default([]),
});

// ---------- role adapters over the port ----------

export interface ResearchClaimContext {
  claim: string;
  /** The argumentative point the claim supports (ADR-0026 / TRIAGE §3.2). */
  supports?: string | null;
  topic?: string | null;
  venue?: string | null;
  /** The claim's own document, a retrieval seed (ADR-0020 rule 4). */
  document?: string | null;
  /** The document the claim was read from — its republications are not evidence. */
  sourceUrl?: string | null;
  /** The document's title — a result with the same title is the same story. */
  documentTitle?: string | null;
  jurisdiction?: string | null;
}

// ---------- the research budget (ADR-0026) ----------

/**
 * What the loop has spent on model calls, in USD. Cost comes from the versioned
 * price map (ADR-0012: derived at aggregation, never pinned at call time), so a
 * rate change re-prices a budget check instead of freezing a figure.
 *
 * The loop is given one of these by its caller. Without it the loop cannot see
 * its own spend and falls back to the hard turn backstop.
 */
export interface ResearchSpend {
  record(entry: { role: string; model: string; tokensIn: number; tokensOut: number }): void;
  /**
   * USD spent so far. Throws on an unpriced model: a routing change that lands
   * without a price entry must surface, not silently make the budget unreachable.
   */
  totalUsd(): number;
  entries(): Array<{ role: string; model: string; tokensIn: number; tokensOut: number }>;
}

/** A spend meter for one research run. */
export function createResearchSpend(): ResearchSpend {
  const entries: Array<{ role: string; model: string; tokensIn: number; tokensOut: number }> = [];
  return {
    record(entry) {
      entries.push(entry);
    },
    entries() {
      return entries;
    },
    totalUsd() {
      return entries.reduce(
        (sum, entry) =>
          sum + costUsd(entry.model, { tokensIn: entry.tokensIn, tokensOut: entry.tokensOut }),
        0,
      );
    },
  };
}

export async function assessFromLlm(
  llm: ResearchLlm,
  input: {
    context: ResearchClaimContext;
    prior?: ResearchCritique | null;
    priorEvidence?: EvidenceRecord[];
  },
  spend?: ResearchSpend,
): Promise<ResearchPlan> {
  const call = await llm.generateObject(
    "claim-assessor",
    {
      claim: input.context.claim,
      supports: input.context.supports ?? null,
      topic: input.context.topic ?? null,
      venue: input.context.venue ?? null,
      jurisdiction: input.context.jurisdiction ?? null,
      document: input.context.document ?? null,
      previousCritique: input.prior ?? null,
      evidenceAlreadyFound: input.priorEvidence ?? [],
    },
    ResearchPlanSchema,
  );
  if (!call.ok) {
    throw new Error(
      `claim assessor failed: ${call.failureClass}` +
        `${call.finishReason ? ` (finish_reason: ${call.finishReason})` : ""} — raw: ${
          call.rawOutput?.slice(0, 800) ?? "none"
        }`,
    );
  }
  spend?.record({
    role: "claim-assessor",
    model: call.model,
    tokensIn: call.usage.tokensIn,
    tokensOut: call.usage.tokensOut,
  });
  return call.value;
}

export async function critiqueFromLlm(
  llm: ResearchLlm,
  input: {
    context: ResearchClaimContext;
    plan: ResearchPlan;
    evidence: EvidenceRecord[];
    round: number;
  },
  spend?: ResearchSpend,
): Promise<ResearchCritique> {
  const call = await llm.generateObject(
    "evidence-critiquer",
    {
      claim: input.context.claim,
      supports: input.context.supports ?? null,
      plan: input.plan,
      evidence: input.evidence.map((e) => ({
        url: e.url,
        title: e.title,
        passage: e.passage,
        tier: e.tier ?? null,
      })),
      round: input.round,
    },
    CritiqueSchema,
  );
  if (!call.ok) {
    throw new Error(
      `evidence critiquer failed: ${call.failureClass}` +
        `${call.finishReason ? ` (finish_reason: ${call.finishReason})` : ""} — raw: ${
          call.rawOutput?.slice(0, 800) ?? "none"
        }`,
    );
  }
  spend?.record({
    role: "evidence-critiquer",
    model: call.model,
    tokensIn: call.usage.tokensIn,
    tokensOut: call.usage.tokensOut,
  });
  return call.value;
}

/** Extract relevant passages from the pages a subagent fetched. */
export async function extractEvidenceFromLlm(
  llm: ResearchLlm,
  input: {
    claim: string;
    plan: ResearchPlan;
    /** The question this extraction was answering. */
    question: string;
    pages: Array<{ url: string; title: string; text: string }>;
  },
  spend?: ResearchSpend,
): Promise<EvidenceRecord[]> {
  if (input.pages.length === 0) return [];
  const call = await llm.generateObject(
    "researcher-extract",
    {
      claim: input.claim,
      question: input.question,
      evidencePlan: input.plan.evidencePlan,
      pages: input.pages,
    },
    ResearcherExtractionSchema,
  );
  if (!call.ok) {
    throw new Error(
      `researcher extraction failed: ${call.failureClass}` +
        `${call.finishReason ? ` (finish_reason: ${call.finishReason})` : ""} — raw: ${
          call.rawOutput?.slice(0, 800) ?? "none"
        }`,
    );
  }
  spend?.record({
    role: "researcher-extract",
    model: call.model,
    tokensIn: call.usage.tokensIn,
    tokensOut: call.usage.tokensOut,
  });
  const byUrl = new Map(input.pages.map((p) => [p.url, p]));
  return call.value.evidence.map((item) => ({
    url: item.url,
    title: item.title ?? byUrl.get(item.url)?.title ?? item.url,
    domain: domainOf(item.url),
    passage: item.passage,
    tier: item.tier ?? null,
  }));
}

// ---------- the researcher agent (tool loop) ----------

export interface ResearcherTools {
  search(query: string): Promise<SearchResult[]>;
  /** Fetch page text; returns "" when unreachable (degraded, never throws). */
  fetchPage(url: string): Promise<string>;
}

export interface ResearcherOptions {
  maxSearches?: number;
  maxSteps?: number;
  maxReads?: number;
  resultsPerQuery?: number;
  /** Top results of a search to read and extract from. */
  extractTop?: number;
  maxPageChars?: number;
  /** Records each model call, so the loop can enforce a research budget. */
  spend?: ResearchSpend;
}

/** What one turn of the researcher returns. */
export interface ResearcherTurnResult {
  evidence: EvidenceRecord[];
  strategy: string;
  queries: string[];
  toolCalls: ResearchToolCallRecord[];
}

export interface ResearcherAgent {
  research(input: {
    claim: string;
    plan: ResearchPlan;
    round: number;
    /** Evidence already gathered in earlier turns, so the agent can avoid repeats. */
    priorEvidence?: EvidenceRecord[];
    /** The claim's own document: a republication of it is the claim, not evidence. */
    sourceUrl?: string | null;
    documentTitle?: string | null;
  }): Promise<ResearcherTurnResult>;
}

/** Pages per extraction call; a truncated batch is retried at half size. */
export const EXTRACTION_PAGES = 3;

function summariseToolResult(toolName: string, output: unknown): string {
  if (toolName === "search") {
    const o = output as { results?: unknown[]; evidence?: unknown[] } | undefined;
    return `${o?.results?.length ?? 0} results, ${o?.evidence?.length ?? 0} passages`;
  }
  if (toolName === "readPage") {
    const evidence = (output as { evidence?: unknown[] } | undefined)?.evidence ?? [];
    return `${evidence.length} passages`;
  }
  if (toolName === "extractEvidence") {
    const evidence = (output as { evidence?: unknown[] } | undefined)?.evidence ?? [];
    return `${evidence.length} passages`;
  }
  if (toolName === "finish") {
    return String((output as { reason?: string } | undefined)?.reason ?? "finished");
  }
  return "ok";
}

/**
 * Build the researcher as a bounded tool-loop agent over `AgentPort`. The tools
 * are the action space; the SDK owns the loop and records every call. Budgets
 * are enforced inside the tools (so an exhausted budget is told to the model,
 * which then finishes), and the step limit is the hard backstop.
 */
export function createResearcherAgent(
  llm: ResearchLlm,
  agent: AgentPort,
  tools: ResearcherTools,
  options: ResearcherOptions = {},
): ResearcherAgent {
  const maxSearches = options.maxSearches ?? MAX_SEARCHES_PER_TURN;
  const maxSteps = options.maxSteps ?? MAX_RESEARCH_STEPS_PER_TURN;
  const maxReads = options.maxReads ?? MAX_FETCHES_PER_SUBAGENT;
  const resultsPerQuery = options.resultsPerQuery ?? 6;
  const extractTop = options.extractTop ?? 5;
  const maxPageChars = options.maxPageChars ?? 4000;
  const spend = options.spend;

  return {
    async research({
      claim,
      plan,
      round,
      priorEvidence,
      sourceUrl,
      documentTitle,
    }): Promise<ResearcherTurnResult> {
      const evidence: EvidenceRecord[] = [];
      const queries: string[] = [];
      const toolCalls: ResearchToolCallRecord[] = [];
      const pageCache = new Map<string, { url: string; title: string; text: string }>();
      let searchesUsed = 0;
      let readsUsed = 0;

      // The claim's own document is not evidence: it is the claim. A result from
      // the same domain, or one carrying the same title (a syndicated copy of the
      // same story), is dropped rather than counted as corroboration.
      const sourceDomain = domainOf(sourceUrl ?? "");
      const documentTitleKey = titleKey(documentTitle ?? "");
      const seenTitles = new Set<string>();
      const keepEvidence = (record: EvidenceRecord): boolean => {
        // Some hosts can never be the record, whatever they would score — a
        // reference work, a social post, a self-published blog, an aggregator
        // (ADR-0020 rule 2). The search tool extracts mechanically from whatever
        // its query returned, so this is enforced here and not left to the
        // prompt: a run that only ASKS the model not to gather social posts still
        // gathered them.
        if (isNeverTheRecord(record.url)) return false;
        if (sourceDomain.length > 0 && record.domain === sourceDomain) return false;
        const key = titleKey(record.title);
        if (documentTitleKey.length > 0 && key === documentTitleKey) return false;
        if (key.length > 0) {
          if (seenTitles.has(key)) return false;
          seenTitles.add(key);
        }
        return true;
      };

      const fetchPage = async (url: string, title: string): Promise<string> => {
        const cached = pageCache.get(url);
        if (cached) return cached.text;
        const text = await tools.fetchPage(url);
        pageCache.set(url, { url, title, text: text.slice(0, maxPageChars) });
        return pageCache.get(url)?.text ?? "";
      };

      const extractBatch = async (
        batch: Array<{ url: string; title: string; text: string }>,
        question: string,
      ): Promise<EvidenceRecord[]> => {
        if (batch.length === 0) return [];
        try {
          return await extractEvidenceFromLlm(llm, { claim, plan, question, pages: batch }, spend);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes("schema-validation") && batch.length > 1) {
            const mid = Math.ceil(batch.length / 2);
            const first = await extractBatch(batch.slice(0, mid), question);
            const second = await extractBatch(batch.slice(mid), question);
            return [...first, ...second];
          }
          throw error;
        }
      };

      /** Extract from pages in batches, and keep every passage found. */
      const extractPages = async (
        pages: Array<{ url: string; title: string; text: string }>,
        question: string,
      ): Promise<EvidenceRecord[]> => {
        const found: EvidenceRecord[] = [];
        for (let i = 0; i < pages.length; i += EXTRACTION_PAGES) {
          found.push(...(await extractBatch(pages.slice(i, i + EXTRACTION_PAGES), question)));
        }
        const accepted: EvidenceRecord[] = [];
        for (const e of found) {
          if (!keepEvidence(e)) continue;
          if (!evidence.some((x) => x.url === e.url && x.passage === e.passage)) evidence.push(e);
          accepted.push(e);
        }
        return accepted;
      };

      /** Fetch pages for extraction, within the read budget. */
      const fetchForExtraction = async (
        urls: string[],
        titles: Map<string, string>,
      ): Promise<Array<{ url: string; title: string; text: string }>> => {
        const pages: Array<{ url: string; title: string; text: string }> = [];
        for (const url of urls) {
          if (readsUsed >= maxReads) break;
          readsUsed += 1;
          const text = await fetchPage(url, titles.get(url) ?? domainOf(url));
          const cached = pageCache.get(url);
          if (text.trim().length > 0) {
            pages.push({ url, title: cached?.title ?? domainOf(url), text });
          }
        }
        return pages;
      };

      const toolSpecs: Record<string, AgentToolSpec> = {
        search: {
          description:
            "Run a web search, read the top results, and return the verbatim passages that speak to the claim. Several searches may run in parallel. Pass `site` to restrict the search to one domain when targeting an official source.",
          inputSchema: z.object({ query: z.string().min(1), site: z.string().optional() }),
          execute: async (input) => {
            const { query, site } = input as { query: string; site?: string };
            if (searchesUsed >= maxSearches) {
              return { error: "search budget exhausted — call finish" };
            }
            searchesUsed += 1;
            const effectiveQuery =
              site != null && site.length > 0 ? `site:${site} ${query}` : query;
            queries.push(effectiveQuery);
            const results = (await tools.search(effectiveQuery)).slice(0, resultsPerQuery);
            const titles = new Map(results.map((r) => [r.link, r.title]));
            const pages = await fetchForExtraction(
              results.map((r) => r.link).slice(0, extractTop),
              titles,
            );
            const found = await extractPages(pages, effectiveQuery);
            return {
              results: results.map((r) => ({ title: r.title, url: r.link, snippet: r.snippet })),
              evidence: found.map((e) => ({ url: e.url, passage: e.passage, tier: e.tier })),
            };
          },
        },
        readPage: {
          description:
            "Read a specific page and return the verbatim passages that speak to the claim.",
          inputSchema: z.object({ url: z.string().url() }),
          execute: async (input) => {
            const { url } = input as { url: string };
            if (readsUsed >= maxReads) {
              return { error: "read budget exhausted — call finish" };
            }
            const pages = await fetchForExtraction([url], new Map());
            const found = await extractPages(pages, claim);
            return { url, evidence: found.map((e) => ({ url: e.url, passage: e.passage })) };
          },
        },
        extractEvidence: {
          description:
            "For a set of urls and a question, return the shortest verbatim passages that answer it.",
          inputSchema: z.object({
            urls: z.array(z.string()).min(1),
            question: z.string().min(1),
          }),
          execute: async (input) => {
            const { urls, question } = input as { urls: string[]; question: string };
            const pages = await fetchForExtraction(urls, new Map());
            const found = await extractPages(pages, question);
            return { evidence: found.map((e) => ({ url: e.url, passage: e.passage })) };
          },
        },
        finish: {
          description: "Call when the turn's searching is done, with a one-sentence reason.",
          inputSchema: z.object({ reason: z.string().min(1) }),
        },
      };

      const result = await agent.runAgent({
        role: "researcher",
        system: RESEARCHER_PROMPT,
        prompt: JSON.stringify({
          claim,
          evidencePlan: plan.evidencePlan,
          questions: plan.questions,
          sources: plan.sources,
          round,
          evidenceSoFar: (priorEvidence ?? []).map((e) => ({
            url: e.url,
            passage: e.passage,
          })),
        }),
        tools: toolSpecs,
        maxSteps,
        stopTool: "finish",
      });

      if (!result.ok) {
        throw new Error(
          `researcher loop failed: ${result.failureClass}` +
            `${result.finishReason ? ` (finish_reason: ${result.finishReason})` : ""} — raw: ${
              result.rawOutput?.slice(0, 800) ?? "none"
            }`,
        );
      }

      spend?.record({
        role: "researcher",
        model: result.model,
        tokensIn: result.usage.tokensIn,
        tokensOut: result.usage.tokensOut,
      });

      let strategy = "";
      for (const step of result.steps) {
        step.toolCalls.forEach((call, i) => {
          const output = step.toolResults[i]?.output;
          toolCalls.push({
            toolName: call.toolName,
            input: call.input,
            resultSummary: summariseToolResult(call.toolName, output),
          });
        });
        if (step.text.trim().length > 0) strategy = step.text.trim();
      }

      return { evidence, strategy, queries, toolCalls };
    },
  };
}

// ---------- the loop ----------

export interface ResearchDeps {
  assessor(input: {
    context: ResearchClaimContext;
    prior?: ResearchCritique | null;
    priorEvidence?: EvidenceRecord[];
  }): Promise<ResearchPlan>;
  researcher(input: {
    claim: string;
    plan: ResearchPlan;
    round: number;
    priorEvidence?: EvidenceRecord[];
    sourceUrl?: string | null;
    documentTitle?: string | null;
  }): Promise<ResearcherTurnResult>;
  critiquer(input: {
    context: ResearchClaimContext;
    plan: ResearchPlan;
    evidence: EvidenceRecord[];
    round: number;
  }): Promise<ResearchCritique>;
  /** Records each model call, so the loop can enforce a research budget. */
  spend?: ResearchSpend;
}

export interface ResearchOutcome {
  verdictClass: ResearchVerdictClass;
  confidence: number;
  reason: string;
  gaps: string[];
  justifications: string[];
  evidence: EvidenceRecord[];
  turns: ResearchTurn[];
  turnsUsed: number;
  capBinding: number;
  /** True when the loop stopped without the critiquer finding sufficiency. */
  capped: boolean;
  /** Why the loop stopped: the evidence settled it, the budget ran out, or the backstop. */
  stopReason: "sufficient" | "budget" | "cap";
  /** The research budget that was in force, in USD. */
  budgetUsd: number;
  /** USD spent on the loop's model calls; null when no meter was supplied. */
  spentUsd: number | null;
  /** Class-agreement state for the published class (VER-R16). */
  agreement: { agreed: boolean; classes: ResearchVerdictClass[] };
}

/** Dedupe evidence across turns by URL + passage prefix. */
function mergeEvidence(prior: EvidenceRecord[], next: EvidenceRecord[]): EvidenceRecord[] {
  const seen = new Set(prior.map((e) => `${e.url}#${e.passage.slice(0, 80)}`));
  const merged = [...prior];
  for (const e of next) {
    const key = `${e.url}#${e.passage.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(e);
  }
  return merged;
}

/**
 * Run the capped adversarial loop.
 *
 * The class-deciding step runs twice (VER-R16): the configured models ignore
 * sampling settings, so a class is published only when two runs agree. A
 * disagreement publishes `not_enough_evidence` and is counted. A thrown call
 * propagates rather than counting as a disagreement.
 */
export async function runAdversarialResearch(
  context: ResearchClaimContext,
  deps: ResearchDeps,
  opts?: { maxTurns?: number; budgetUsd?: number },
): Promise<ResearchOutcome> {
  const maxTurns = opts?.maxTurns ?? MAX_RESEARCH_TURNS;
  const budgetUsd = opts?.budgetUsd ?? DEFAULT_RESEARCH_BUDGET_USD;
  const spend = deps.spend;
  const turns: ResearchTurn[] = [];
  let evidence: EvidenceRecord[] = [];
  let prior: ResearchCritique | null = null;
  let stopReason: ResearchOutcome["stopReason"] = "cap";
  const spentUsd = (): number | null => (spend == null ? null : spend.totalUsd());

  for (let round = 0; round < maxTurns; round++) {
    // The budget is the policy, and it is checked BETWEEN turns: a claim always
    // gets a first attempt, and the spend can exceed the budget by at most one
    // turn's cost. Without a meter the loop cannot see its spend, so the hard
    // backstop is what stops it.
    if (round > 0 && spend != null && spend.totalUsd() >= budgetUsd) {
      stopReason = "budget";
      break;
    }
    const plan = await deps.assessor({ context, prior, priorEvidence: evidence });
    const found = await deps.researcher({
      claim: context.claim,
      plan,
      round,
      priorEvidence: evidence,
      sourceUrl: context.sourceUrl ?? null,
      documentTitle: context.documentTitle ?? null,
    });
    evidence = mergeEvidence(evidence, found.evidence);
    const critique = await deps.critiquer({ context, plan, evidence, round });
    turns.push({
      round,
      plan,
      strategy: found.strategy,
      queries: found.queries,
      toolCalls: found.toolCalls,
      evidenceFound: found.evidence,
      critique,
    });
    if (critique.sufficient) {
      const confirm = await deps.critiquer({ context, plan, evidence, round });
      const agreed = confirm.verdictClass === critique.verdictClass;
      if (agreed) {
        return {
          verdictClass: critique.verdictClass,
          confidence: critique.confidence,
          reason: critique.reason,
          gaps: critique.gaps,
          justifications: critique.justifications,
          evidence,
          turns,
          turnsUsed: round + 1,
          capBinding: maxTurns,
          capped: false,
          stopReason: "sufficient",
          budgetUsd,
          spentUsd: spentUsd(),
          agreement: { agreed: true, classes: [critique.verdictClass, confirm.verdictClass] },
        };
      }
      return {
        verdictClass: "not_enough_evidence",
        confidence: 0,
        reason: `The evidence did not support a stable class: one reading was "${critique.verdictClass}" and another "${confirm.verdictClass}". Nothing is published on a decision that moves between runs.`,
        gaps: critique.gaps,
        justifications: [],
        evidence,
        turns,
        turnsUsed: round + 1,
        capBinding: maxTurns,
        capped: false,
        stopReason: "sufficient",
        budgetUsd,
        spentUsd: spentUsd(),
        agreement: { agreed: false, classes: [critique.verdictClass, confirm.verdictClass] },
      };
    }
    prior = critique;
  }

  return {
    verdictClass: "not_enough_evidence",
    confidence: 0,
    reason:
      prior?.reason ??
      (stopReason === "budget"
        ? "The research budget was spent before the evidence settled the claim."
        : "The research backstop was reached before the evidence settled the claim."),
    gaps: prior?.gaps ?? [],
    justifications: prior?.justifications ?? [],
    evidence,
    turns,
    turnsUsed: turns.length,
    capBinding: maxTurns,
    capped: true,
    stopReason,
    budgetUsd,
    spentUsd: spentUsd(),
    agreement: { agreed: true, classes: ["not_enough_evidence"] },
  };
}

function domainOf(link: string): string {
  try {
    return new URL(link).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** A title reduced to its letters and digits, so case and punctuation do not hide a repeat. */
function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
