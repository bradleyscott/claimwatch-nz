// Shared live-run plumbing for the ops slices (ADR-0025, ADR-0026).
//
// What every slice needs and nothing under packages/ should own: the tracked live
// adapter (provenance records the roles a run ACTUALLY invoked, HAR-R7), the
// stage ports (two-arm triage, the researcher's tool loop, the adversarial
// research loop), the researcher's search/fetch tools, and the mapping from the
// loop's outcome to the store's ResearchLoopRecord.
//
// This module imports pipeline and store SOURCE across package boundaries, like
// every other script in ops/ — it is typechecked as part of @cw/ops, never built
// or imported by a package.

import { costUsd, PRICE_MAP_VERSION } from "../packages/llm/src/prices.ts";
import type { AgentCall, AgentCallResult, AgentPort } from "../packages/pipeline/src/agent-port.ts";
import {
  createJevDecisions,
  type DecisionPort,
  type DecisionRequest,
  type DecisionRole,
  decisionRolesFromEnv,
  JEV_PRICE_KEY,
} from "../packages/pipeline/src/decision-port.ts";
import {
  createLiveAdapter,
  type LiveAdapter,
  type ProviderCall,
  type ProviderResult,
} from "../packages/pipeline/src/llm/live-adapter.ts";
import { agentPortFromAdapter, portFromAdapter } from "../packages/pipeline/src/llm/live-port.ts";
import {
  assessFromLlm,
  CLAIM_ASSESSOR_PROMPT,
  createResearcherAgent,
  createResearchSpend,
  critiqueFromLlm,
  EVIDENCE_CRITIQUER_PROMPT,
  RESEARCH_PROMPT_VERSIONS,
  RESEARCHER_EXTRACT_PROMPT,
  RESEARCHER_PROMPT,
  type ResearchClaimContext,
  type ResearcherTools,
  type ResearchLlm,
  type ResearchOutcome,
  type ResearchRole,
  type ResearchSpend,
  runAdversarialResearch,
} from "../packages/pipeline/src/research.ts";
import { fetchEvidenceText } from "../packages/pipeline/src/search/fetch-evidence.ts";
import { createSerperSearch } from "../packages/pipeline/src/search/serper-adapter.ts";
import {
  TRIAGE_CHECKABILITY_PROMPT,
  TRIAGE_CONTEXT_PROMPT,
  TRIAGE_PROMPT_VERSIONS,
  TRIAGE_SPEAKERSHIP_PROMPT,
} from "../packages/pipeline/src/triage.ts";
import type { TriageLlm, TriageRole } from "../packages/pipeline/src/triage-llm.ts";
import type { ResearchLoopRecord } from "../packages/store/src/research.ts";

/** The slice-provenance pipeline version. Bumped when a slice's flow changes. */
export const PIPELINE_VERSION = "0.1.0-ops-live";

/** Every prompt version the stages can record, by role. */
export const PROMPT_VERSIONS: Record<string, string> = {
  ...TRIAGE_PROMPT_VERSIONS,
  ...RESEARCH_PROMPT_VERSIONS,
};

/**
 * The prompt for a role. The text lives in the pipeline module whose call uses
 * it, so the words the provider reads and the version recorded in provenance
 * cannot drift apart (CROSS-CUTTING §3).
 */
export const PROMPTS: Record<string, string> = {
  "triage-speakership": TRIAGE_SPEAKERSHIP_PROMPT,
  "triage-checkability": TRIAGE_CHECKABILITY_PROMPT,
  "triage-context": TRIAGE_CONTEXT_PROMPT,
  "claim-assessor": CLAIM_ASSESSOR_PROMPT,
  // The tool-loop system prompt for the researcher's agent loop.
  researcher: RESEARCHER_PROMPT,
  "researcher-extract": RESEARCHER_EXTRACT_PROMPT,
  "evidence-critiquer": EVIDENCE_CRITIQUER_PROMPT,
};

export function promptFor(role: string): string {
  return PROMPTS[role] ?? "Reply with ONLY a JSON object matching the requested schema.";
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set — run \`set -a; source .env; set +a\` first (copy .env.example to .env)`,
    );
  }
  return value;
}

/**
 * Stop before the first paid call when a key is missing. The flow always
 * researches, so it needs the verdict tier (Anthropic: triage, assessor,
 * extractor, critiquer), the research tier (OpenRouter: the researcher's tool
 * loop) and search (Serper).
 */
export function preflight(): void {
  const required = ["DATABASE_URL", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "SERPER_API_KEY"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`\n── preflight failed ──\n  missing: ${missing.join(", ")}`);
    console.error("  no paid call was made. Fill .env and re-run.");
    process.exit(2);
  }
}

/** Tokens and calls accumulated for one role ON ONE MODEL. */
export interface RoleUsage {
  role: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  calls: number;
}

export interface TrackedAdapter {
  adapter: LiveAdapter;
  /**
   * role → the model(s) that ran for it. A decision-routed role can run TWO — the
   * decision model for the settled items and the generative model for the
   * escalated ones — so this joins them rather than letting the last call win.
   */
  invokedRoles: Map<string, string>;
  /** role → how the model(s) were served (direct | aggregator). */
  invokedServingModes: Map<string, string>;
  /** "role::model" → tokens and calls, so a two-model role is priced per model. */
  usageByModel: Map<string, RoleUsage>;
  /**
   * The decision port, tracked the same way (ADR-0024). The routed roles come
   * from `decisionRolesFromEnv` (default `triage-checkability`); a role not in
   * the list takes the all-generative path.
   */
  decisions: DecisionPort;
  decisionRoles: DecisionRole[];
}

/**
 * The live adapter, wrapped so every call records the role and model that ran —
 * both `generateObject` calls and the researcher's tool loop. Provenance must
 * name the roles a run ACTUALLY invoked; a hand-written list is how the phantom
 * `adjudication@1` step reached stored verdicts (HAR-R7).
 */
export function createTrackedAdapter(): TrackedAdapter {
  const invokedRoles = new Map<string, string>();
  const invokedServingModes = new Map<string, string>();
  const invokedModels = new Map<string, Set<string>>();
  const usageByModel = new Map<string, RoleUsage>();
  const noteModel = (role: string, model: string, servingMode?: string): void => {
    const models = invokedModels.get(role) ?? new Set<string>();
    models.add(model);
    invokedModels.set(role, models);
    invokedRoles.set(role, [...models].join(" + "));
    if (servingMode != null) {
      const modes = (invokedServingModes.get(role) ?? "").split(" + ").filter(Boolean);
      if (!modes.includes(servingMode)) modes.push(servingMode);
      invokedServingModes.set(role, modes.join(" + "));
    }
  };
  const record = (role: string, model: string, tokensIn: number, tokensOut: number): void => {
    const key = `${role}::${model}`;
    const usage = usageByModel.get(key) ?? { role, model, tokensIn: 0, tokensOut: 0, calls: 0 };
    usage.tokensIn += tokensIn;
    usage.tokensOut += tokensOut;
    usage.calls += 1;
    usageByModel.set(key, usage);
  };
  const raw = createLiveAdapter();
  const decisionRoles = decisionRolesFromEnv();
  const rawDecisions =
    decisionRoles.length > 0 && process.env.OPENROUTER_API_KEY != null
      ? createJevDecisions(process.env.OPENROUTER_API_KEY)
      : null;
  const decisions: DecisionPort = {
    decide: async (request: DecisionRequest) => {
      if (rawDecisions == null) {
        return {
          ok: false,
          failureClass: "transport",
          rawOutput: "decision role configured but OPENROUTER_API_KEY is not set",
        };
      }
      const result = await rawDecisions.decide(request);
      if (result.ok) {
        // The price key is the stable routing key, not the resolved pin the
        // provider reports, so a cost lookup and the price map agree.
        noteModel(request.role, JEV_PRICE_KEY, "aggregator");
        record(request.role, JEV_PRICE_KEY, result.usage.tokensIn, result.usage.tokensOut);
      }
      return result;
    },
  };
  const adapter: LiveAdapter = {
    call: async <T>(providerCall: ProviderCall): Promise<ProviderResult<T>> => {
      const result = await raw.call<T>(providerCall);
      const model = result.model ?? "unknown";
      noteModel(providerCall.role, model, result.servingMode);
      if (result.ok && result.usage != null) {
        record(providerCall.role, model, result.usage.tokensIn, result.usage.tokensOut);
      }
      return result;
    },
    runAgent: async (agentCall: AgentCall): Promise<AgentCallResult> => {
      const result = await raw.runAgent(agentCall);
      const model = result.model ?? "unknown";
      noteModel(agentCall.role, model, result.ok ? result.servingMode : undefined);
      if (result.ok) {
        record(agentCall.role, model, result.usage.tokensIn, result.usage.tokensOut);
      }
      return result;
    },
  };
  return { adapter, invokedRoles, invokedServingModes, usageByModel, decisions, decisionRoles };
}

/**
 * Report what the run cost, from the tokens it recorded and the versioned price
 * map (ADR-0012: cost is computed at aggregation, never pinned per span).
 * Models only — search is billed per query and is not in the price map.
 */
export function logCost(tracked: TrackedAdapter): void {
  let total = 0;
  console.log(`\n── cost (${PRICE_MAP_VERSION}; models only, search not included) ──`);
  for (const usage of tracked.usageByModel.values()) {
    const cost = costUsd(usage.model, { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut });
    total += cost;
    console.log(
      `  ${usage.role.padEnd(20)} ${usage.model.padEnd(34)} ${String(usage.calls).padStart(3)} calls  ` +
        `${String(usage.tokensIn).padStart(7)} in / ${String(usage.tokensOut).padStart(6)} out  $${cost.toFixed(5)}`,
    );
  }
  console.log(`  ${"TOTAL".padEnd(20)} $${total.toFixed(4)}`);
}

/** The triage port: speakership, checkability and context (ADR-0025). */
export function triagePort(adapter: LiveAdapter): TriageLlm {
  return portFromAdapter<TriageRole>(adapter, { promptFor });
}

/** The research port: `claim-assessor`, `researcher-extract`, `evidence-critiquer`. */
export function researchPort(adapter: LiveAdapter): ResearchLlm {
  return portFromAdapter<ResearchRole>(adapter, { promptFor });
}

/** The researcher's tool-loop port (its own `runAgent` contract). */
export function researchAgentPort(adapter: LiveAdapter): AgentPort {
  return agentPortFromAdapter(adapter);
}

/** The researcher's only network tools: Serper search and page fetch. */
export function researcherTools(): ResearcherTools {
  const search = createSerperSearch(requireEnv("SERPER_API_KEY"));
  return {
    search: (query: string) => search.search(query),
    // Fetch failures degrade to "" so a dead page is an empty page, never a
    // thrown error in the verdict path (VER-R9 discipline).
    fetchPage: async (url: string) => {
      const page = await fetchEvidenceText(url);
      return page.ok ? page.text : "";
    },
  };
}

/**
 * The research budget for one claim, in USD, from `RESEARCH_BUDGET_USD`. Unset
 * takes the pipeline default (ADR-0026). The loop keeps researching until its
 * model spend reaches this, so the budget — not a fixed turn count — decides how
 * long to keep looking.
 */
export function researchBudgetUsd(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.RESEARCH_BUDGET_USD;
  if (raw == null || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`RESEARCH_BUDGET_USD must be a positive number of USD, got "${raw}"`);
  }
  return value;
}

/**
 * Run the adversarial loop for one claim, against a budget rather than a fixed
 * number of turns, and report what it spent.
 */
export async function runResearch(
  context: ResearchClaimContext,
  llm: ResearchLlm,
  agentPort: AgentPort,
): Promise<{ outcome: ResearchOutcome; spend: ResearchSpend }> {
  const spend = createResearchSpend();
  const agent = createResearcherAgent(llm, agentPort, researcherTools(), { spend });
  const budgetUsd = researchBudgetUsd();
  const outcome = await runAdversarialResearch(
    context,
    {
      spend,
      assessor: (input) => assessFromLlm(llm, input, spend),
      researcher: (input) => agent.research(input),
      critiquer: (input) => critiqueFromLlm(llm, input, spend),
    },
    budgetUsd != null ? { budgetUsd } : {},
  );
  return { outcome, spend };
}

/** Map the loop's outcome onto the store's append-only record (ADR-0026 §6). */
export function toResearchLoopRecord(outcome: ResearchOutcome): ResearchLoopRecord {
  return {
    turns: outcome.turns.map((turn) => ({
      round: turn.round,
      plan: {
        evidencePlan: turn.plan.evidencePlan,
        questions: turn.plan.questions,
        sources: turn.plan.sources,
      },
      strategy: turn.strategy,
      queries: turn.queries,
      toolCalls: turn.toolCalls.map((call) => ({
        toolName: call.toolName,
        input: call.input,
        resultSummary: call.resultSummary,
      })),
      evidenceFound: turn.evidenceFound.map((e) => ({
        url: e.url,
        title: e.title,
        domain: e.domain,
        passage: e.passage,
        tier: e.tier,
      })),
      critique: {
        sufficient: turn.critique.sufficient,
        verdictClass: turn.critique.verdictClass,
        confidence: turn.critique.confidence,
        reason: turn.critique.reason,
        gaps: turn.critique.gaps,
        justifications: turn.critique.justifications,
      },
    })),
    turnsUsed: outcome.turnsUsed,
    capBinding: outcome.capBinding,
    capped: outcome.capped,
    stopReason: outcome.stopReason,
    budgetUsd: outcome.budgetUsd,
    spentUsd: outcome.spentUsd,
    reason: outcome.reason,
    agreement: outcome.agreement,
  };
}

/**
 * Full provenance for a verdict write: the roles actually invoked, with their
 * real prompt versions (not a synthesised `${role}@1`), and the searches that
 * produced the evidence.
 */
export function provenanceFor(
  invokedRoles: Map<string, string>,
  searchRefs: string[],
): {
  pipelineVersion: string;
  promptVersions: Record<string, string>;
  modelVersions: Record<string, string>;
  searchRefs: string[];
} {
  return {
    pipelineVersion: PIPELINE_VERSION,
    promptVersions: Object.fromEntries(
      [...invokedRoles.keys()].map((role) => [role, PROMPT_VERSIONS[role] ?? `${role}@1`]),
    ),
    modelVersions: Object.fromEntries(invokedRoles),
    searchRefs,
  };
}

/** The routing actually exercised, printed at the end of a live run. */
export function logRouting(tracked: TrackedAdapter): void {
  console.log("\n── routing actually exercised (role / model / serving mode) ──");
  for (const [role, model] of tracked.invokedRoles) {
    console.log(
      `  ${role.padEnd(20)} ${model.padEnd(34)} ${tracked.invokedServingModes.get(role) ?? "unknown"}`,
    );
  }
}
