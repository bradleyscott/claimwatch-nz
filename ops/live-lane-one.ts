// Lane 2 (RNZ politics RSS) — the first LIVE run in this repo that starts from a
// scraped source instead of a hardcoded claim string (Sept 2026).
//
// INGESTION §2.3: feed → article → publication row. Then the slice path that
// already existed: triage → route → verify → NLI gate → claim + verdict →
// ClaimReview. Everything is recorded with provenance; nothing is hand-edited.
//
// Usage:
//   set -a; source .env; set +a
//   npx tsx ops/live-lane-one.ts [itemIndex] [claimIndex]
//
//   itemIndex  which feed item to read (default 0 = newest)
//   claimIndex which checkable claim in that article to verify (default: the
//              first statistical one, else the first claim)
//
// Cost: 1 triage call, then the routed mode's calls. ADR-0011 puts the research
// tier on OpenRouter (GLM-5.3-Flash) and the verdict tier + publication gate on
// Anthropic (Claude Sonnet 5), so BOTH keys are required — the preflight names
// any that are missing before a single paid call is made.

import { setDefaultResultOrder } from "node:dns";

setDefaultResultOrder("ipv4first");

import { createHash } from "node:crypto";
import type { ZodTypeAny } from "zod";
import {
  deriveJurisdiction,
  describeContext,
  entityQueries,
  resolveReferent,
} from "../packages/pipeline/src/claim-context.ts";
import {
  assertLaneHealthy,
  computeContentHash,
  dedupeKey,
  extractArticle,
  parseFeed,
} from "../packages/pipeline/src/ingestion.ts";
import {
  createLiveAdapter,
  type ProviderCall,
  type ProviderResult,
} from "../packages/pipeline/src/llm/live-adapter.ts";
import { portFromAdapter } from "../packages/pipeline/src/llm/live-port.ts";
import { assessMateriality } from "../packages/pipeline/src/materiality.ts";
import { derivePlanFeatures, planForClaim } from "../packages/pipeline/src/plan.ts";

/**
 * The document a claim cites, read from the claim's own words.
 *
 * A deliberately thin first cut: an explicit "according to X" / "X's report"
 * phrasing, else nothing. Returning null is a real outcome — a claim that names
 * no document gets no citation check and escalates to research, which is the
 * ADR-0020 rule — and it is strictly better than the fingerprint's `source`
 * field, which was a model's free-text guess made before any evidence existed.
 */
function citationNameFromClaim(claimText: string): string | null {
  const m =
    claimText.match(/\baccording to (?:the )?([^,.;]{3,60})/i) ??
    claimText.match(
      /\b([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4})'s (?:report|review|paper|data)\b/,
    );
  return m?.[1]?.trim() ?? null;
}

import { enforceEvidenceFloor } from "../packages/pipeline/src/search/admissibility.ts";
import { resolveCitationTarget } from "../packages/pipeline/src/search/citation-target.ts";
import { DECOMPOSITION_PROMPT, decomposeClaim } from "../packages/pipeline/src/search/decompose.ts";
import { discoverAuthority } from "../packages/pipeline/src/search/discovery.ts";
import { fetchEvidenceText } from "../packages/pipeline/src/search/fetch-evidence.ts";
import {
  RESEARCHER_PROMPT,
  type ResearchAssessment,
  type ResearcherLlm,
  runDeepResearch,
} from "../packages/pipeline/src/search/research-loop.ts";
import { createSerperSearch } from "../packages/pipeline/src/search/serper-adapter.ts";
import {
  ATTRIBUTION_PROMPT,
  attributeSentences,
  eligibleSentences,
  SPEAKERSHIP_SCHEMAS,
  speakershipFor,
} from "../packages/pipeline/src/speakership.ts";
import {
  splitSentences,
  TRIAGE_CONTEXT_PROMPT,
  triageDocument,
} from "../packages/pipeline/src/triage.ts";
import type { TriageLlm, TriageRole } from "../packages/pipeline/src/triage-llm.ts";
import { citationCheck, nliAudit } from "../packages/pipeline/src/verification.ts";
import type {
  VerificationLlm,
  VerificationRole,
} from "../packages/pipeline/src/verification-llm.ts";
import { claimReviewFromVerdict, validateClaimReview } from "../packages/store/src/claimreview.ts";
import { canonicalDomain } from "../packages/store/src/domain.ts";
import { createStore } from "../packages/store/src/store.ts";

// ---------- lane config (INGESTION §2.3) ----------

const LANE = {
  sourceId: "rnz-politics",
  feedUrl: "https://www.rnz.co.nz/rss/political.xml",
  retrievalMethod: "tier-1-rss+readability",
  pipelineVersion: "0.1.0-lane-one",
  // ING-R1: a feed that answers 200 with nothing in it is a distinct alarm from
  // a dead feed, and a feed whose newest item is days old is stale, not healthy.
  stalenessBandHours: 48,
} as const;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set — run \`set -a; source .env; set +a\` first (copy .env.example to .env)`,
    );
  }
  return value;
}

/**
 * Preflight for the keys needed before the FIRST paid call, so a missing key
 * costs nothing. The verification-tier keys (ADR-0011: research on OpenRouter,
 * search on Serper) are checked at the verification stage instead — ingestion
 * and triage are upstream of them, so a run without those keys still does real
 * work on a real document and records it, rather than stopping before the free
 * half.
 */
function preflight(): void {
  const required = [
    "DATABASE_URL",
    "ANTHROPIC_API_KEY", // triage, then the verdict tier + publication gate
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`\n── preflight failed ──\n  missing: ${missing.join(", ")}`);
    console.error("  no paid call was made. Fill .env and re-run.");
    process.exit(2);
  }
}

// ---------- live LLM plumbing (mirrors ops/live-averitec-one.ts) ----------

// Provenance (HAR-R7): the roles this run actually invoked, with the model the
// adapter reported and how it was served. Never a hand-written role list, so the
// stored manifest cannot claim a step that did not run.
const invokedRoles = new Map<string, string>();
const invokedServingModes = new Map<string, string>();
const rawAdapter = createLiveAdapter();
const adapter = {
  call: async <T>(providerCall: ProviderCall): Promise<ProviderResult<T>> => {
    const result = await rawAdapter.call<T>(providerCall);
    invokedRoles.set(providerCall.role, result.model ?? "unknown");
    if (result.servingMode != null) invokedServingModes.set(providerCall.role, result.servingMode);
    return result;
  },
};

const TRIAGE_SCHEMAS: Record<string, ZodTypeAny> = {};
const VERIFICATION_SCHEMAS: Record<string, ZodTypeAny> = {};
{
  const triage = await import("../packages/pipeline/src/triage.ts");
  Object.assign(TRIAGE_SCHEMAS, triage.TRIAGE_SCHEMAS);
  const verification = await import("../packages/pipeline/src/verification.ts");
  Object.assign(VERIFICATION_SCHEMAS, verification.VERIFICATION_SCHEMAS);
}

const PROMPTS: Record<string, string> = {
  "triage-checkability":
    'You classify political sentences for checkability AND type the checkable ones. The input contains a "sentences" array with "id" and "text" per sentence. For EVERY sentence return one result. Reply with ONLY JSON: {"results": [{"sentenceId": string, "checkable": true, "claimType": "statistical"|"citation-backed"|"broadcast-quote"|"institution-citation"|"false-context"|"other", "mode": "stat-grid"|"citation-check"|"quote-fidelity"|"provenance"|"open-web"} | {"sentenceId": string, "checkable": false, "rejectionClass": "opinion"|"rhetoric"|"procedure"|"satire"|"pledge-conditional"|"question"}]}. Mode mapping: statistical→stat-grid, citation-backed→citation-check, broadcast-quote→quote-fidelity, institution-citation→citation-check, false-context→provenance, other→open-web. A statement about what someone would, will or intends to do is a POLICY COMMITMENT: type it "other" (open-web), NOT "institution-citation" and NOT "citation-backed", unless it explicitly cites a specific document. A news report quoting a politician about a plan is not an institution citing its own record.',
  "triage-typing":
    'You type a checkable claim and route it to a verification mode. Reply with ONLY JSON: {"claimType": "statistical"|"citation-backed"|"broadcast-quote"|"institution-citation"|"false-context"|"other", "mode": "stat-grid"|"citation-check"|"quote-fidelity"|"provenance"|"open-web", "sentence": string, "fingerprint": {"core": string, "claimant": string|null, "domain": string|null, "temporal": string|null, "quantity": string|null, "source": string|null} | null}.',
  "triage-context": TRIAGE_CONTEXT_PROMPT,
  "claim-decompose": DECOMPOSITION_PROMPT,
  "research-assess": RESEARCHER_PROMPT,
  "citation-compare": `You are explaining a fact-check to a member of the public. You receive:
- claim: the sentence as published; resolvedClaim: the same sentence with a definite reference resolved ("the charity" → the named charity).
- claimSource: the document the claim came from. THIS is the record that the statement was made — it is never a source to search for, and its presence is never a reason to say the statement is unattested.
- sources: independent sources retrieved for the SUBSTANCE of the claim (title/link/snippet, plus fetched pageText where available).
- researchGaps: what the research could not settle.
Answer two questions SEPARATELY: (1) Attribution — does claimSource record this statement? Quote it if it does. (2) Substance — what do the independent sources establish about what the statement asserts.
Decide the verdict on the SUBSTANCE, then EXPLAIN it in plain language. Write for someone with no statistics training — short sentences, no jargon.
Reply with ONLY JSON (types matter: paragraphs is an ARRAY of strings; tier is a NUMBER):
{"verdict": "supported"|"refuted"|"not_enough_evidence"|"conflicting_cherry_picking",
 "bindingStrictness": "direct"|"decorative",
 "mismatch": string,
 "narrative": {"lead": string, "paragraphs": [string], "pull": string},
 "sourceFindings": [{"link": string, "tier": number, "finding": string}]}
Rules for "narrative":
- lead: one sentence a reader could quote. Say what the evidence ACTUALLY shows vs the claim.
- paragraph: 2-4 sentences of plain explanation. Reference the specific numbers/periods the sources state. No jargon (no "tier", "stratum", "grid", "NLI").
- pull: one short sentence summarising the takeaway, like a pull-quote.
"sourceFindings": for EACH source, what it actually says that is relevant to the claim (one sentence, quote the figure where possible), and its reliability tier (1 = official statistics/government for the claim's jurisdiction, 2 = academic, 3 = major media, 5 = NGO, 6 = unknown).
If no source states the specific figure, the honest verdict is not_enough_evidence.`,
  "authority-classify":
    'Classify EACH candidate as an evidence authority for statistical claims. You receive {"candidates": [{"title", "link", "snippet"}, ...]}. The authority question is JURISDICTION-RELATIVE: tier 1 = the official statistics office or relevant national government department FOR THE CLAIM\'S JURISDICTION (NZ claims → govt.nz; US claims → census.gov/bls.gov/cdc.gov; India claims → mospi.gov.in). A national statistics office of any country is T1 for that jurisdiction\'s claims and only for them. tier 2 = academia/peer-review in-jurisdiction; tier 3 = major mainstream media in-jurisdiction; tier 5 = NGO/sector body (tier-gap framing); tier 6 = unknown/personal. For each candidate, use null when it is not plausibly an evidence authority for the jurisdiction. Reply with ONLY JSON: {"results": [{"tier": number, "rationale": string, "confidence": number} | null, ...]} — one entry per candidate, in the order given.',
  "nli-audit":
    'Check if a justification sentence is entailed by the cited evidence. Reply with ONLY JSON: {"verdict": "pass"|"fail", "failureClass": "unattributed-synthesis"|"unstated-arithmetic"|"authority-by-citation"|"hallucinated-content"|null}.',
};

function promptFor(role: string): string {
  return PROMPTS[role] ?? "Reply with ONLY a JSON object matching the requested schema.";
}

const triageLlm: TriageLlm = portFromAdapter<TriageRole>(adapter, {
  promptFor,
  schemas: TRIAGE_SCHEMAS,
});

// The `attribute` stage's bridge: its prompt is the one the stage exports, so the
// text the provider reads and the prompt version recorded in provenance cannot
// drift apart.
const speakershipLlm = {
  generateObject: async (role: string, input: unknown, schema: { parse(v: unknown): unknown }) => {
    const call = await adapter.call({
      role: role as never,
      system: ATTRIBUTION_PROMPT,
      user: JSON.stringify(input, null, 2),
      schema: SPEAKERSHIP_SCHEMAS[role] ?? (schema as never),
    });
    return { ...call, rawOutput: call.raw };
  },
};

const verificationLlm: VerificationLlm = portFromAdapter<VerificationRole>(adapter, {
  promptFor,
  schemas: VERIFICATION_SCHEMAS,
});

const decomposeLlm = {
  decompose: async (input: { claim: string }) => {
    const call = await adapter.call({
      role: "claim-decompose" as never,
      system: DECOMPOSITION_PROMPT,
      user: JSON.stringify(input, null, 2),
      schema: {
        parse: (v: unknown) => v as { questions: Array<{ question: string; queries: string[] }> },
      } as never,
    });
    if (!call.ok) throw new Error(`decompose failed: ${call.failureClass}`);
    return call.value as unknown as { questions: Array<{ question: string; queries: string[] }> };
  },
};

const researcherLlm: ResearcherLlm = {
  assessRound: async (input): Promise<ResearchAssessment> => {
    const call = await adapter.call({
      role: "research-assess" as never,
      system: RESEARCHER_PROMPT,
      user: JSON.stringify(input, null, 2),
      schema: {
        parse: (v: unknown) =>
          v as {
            sufficient: boolean;
            confidence: number;
            gaps: string[];
            refinedQueries?: string[];
            verdictSignal: "supported" | "refuted" | "not_enough_evidence";
          },
      } as never,
    });
    // Researcher failure: honest default — not sufficient, no invented gaps. The
    // loop's cap bounds it.
    if (!call.ok) {
      return {
        sufficient: false,
        confidence: 0,
        gaps: [],
        refinedQueries: [],
        verdictSignal: "not_enough_evidence",
      };
    }
    return call.value as unknown as ResearchAssessment;
  },
};

// ---------- ingest (INGESTION §2.1) ----------

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`fetch failed: HTTP ${response.status} for ${url}`);
  }
  return await response.text();
}

async function main(): Promise<void> {
  preflight();

  const itemIndex = Number(process.argv[2] ?? "0");
  const claimArg = process.argv[3];

  console.log("── lane 2 live run: RNZ politics RSS ──");
  console.log(`feed: ${LANE.feedUrl}`);

  // 1. Feed (Tier 1, deterministic).
  console.log("\n[1/6] ingest: feed (Tier 1 RSS)…");
  const feedXml = await fetchText(LANE.feedUrl);
  const items = parseFeed(feedXml);
  const newest = items[0];
  assertLaneHealthy({
    itemsSeen: items.length,
    httpStatus: 200,
    ...(newest
      ? {
          lastNewItemAgeHours: (Date.now() - newest.publishedAt.getTime()) / 36e5,
          stalenessBandHours: LANE.stalenessBandHours,
        }
      : {}),
  });
  const item = items[itemIndex];
  if (item == null) {
    throw new Error(`no feed item at index ${itemIndex} (feed holds ${items.length})`);
  }
  console.log(`  ${items.length} items; selected [${itemIndex}]: ${item.title}`);
  console.log(`  published ${item.publishedAt.toISOString()}`);

  // 2. Article (Tier 1 readability).
  console.log("\n[2/6] ingest: article (Tier 1 readability)…");
  const html = await fetchText(item.link);
  const doc = extractArticle(html, item.link);
  // Identity hashes the RAW fetched body, never the extracted text. If it hashed
  // extraction output, improving the extractor would change the identity of an
  // UNCHANGED document: same URL, same bytes, new hash → the publication
  // uniqueness constraint misses → a second publication row → duplicate claims
  // and verdicts, which is the STO-R13 failure. It also has to agree with
  // `dedupeKey`, which hashes guid + url + raw content (INGESTION §2.8).
  // Nothing in the types enforces this — extraction changes must stay invisible
  // to identity (Sept 2026, raised by the Drizzle audit session).
  const contentHash = computeContentHash(html);
  console.log(`  extracted ${doc.text.length} chars from ${item.link}`);
  console.log(`  content hash ${contentHash.slice(0, 16)}… (of the raw body)`);
  console.log(
    `  dedupe key  ${dedupeKey({ guid: item.guid, canonicalUrl: item.link, content: html }).slice(0, 16)}…`,
  );

  const store = await createStore(requireEnv("DATABASE_URL"));
  try {
    // The document record (INGESTION §3.1) — idempotent by content hash, so a
    // re-ingest of an unchanged article appends nothing (STO-R13).
    const publication = await store.recordPublication({
      sourceId: LANE.sourceId,
      canonicalUrl: item.link,
      contentHash,
      retrievedAt: new Date(),
      retrievalMethod: LANE.retrievalMethod,
      pipelineVersion: LANE.pipelineVersion,
      rawRef: `raw/${contentHash.slice(0, 16)}.html`,
      text: doc.text,
    });
    console.log(`  publication row: ${publication.publicationId}`);

    // 3. Attribute, then triage (ADR-0019 §4: eligibility is decided BEFORE
    // triage reads anything). Triage is handed only the sentences that survived
    // the scope rule, so it can never be the stage that decides whose words are
    // ours to check — and a caller cannot forget the rule, because the eligible
    // set is the only input triage is given.
    console.log("\n[3/6] attribute + triage (live LLM)…");
    const sentences = splitSentences(doc.text);
    // ADR-0008: the window is the claim's IMMEDIATE context — the containing
    // paragraph, capped around ±300 words — not the document headline. Triage
    // reads it to decide whether a proposal is attached (the page's "as
    // deployed" line), so a headline-only window has no deployment in it to
    // find: `attached_proposal` came back null on every claim and the section
    // could never render, even once the context pass itself was wired
    // (Sept 2026). Windows are per sentence because the pass runs per claim.
    const paragraphs = doc.text
      .split("\n")
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0);
    const WINDOW_WORDS = 300;
    const lead = paragraphs[0] ?? "";
    const windowFor = (sentenceText: string): string => {
      const paragraph = paragraphs.find((p) => p.includes(sentenceText));
      const body =
        paragraph ?? `${item.title} — RNZ Politics, ${item.publishedAt.toISOString().slice(0, 10)}`;
      let capped = body;
      const words = body.split(/\s+/);
      const at = body.indexOf(sentenceText);
      if (words.length > WINDOW_WORDS && at >= 0) {
        // Cap centred on the sentence, so the claim is always inside its own window.
        const before = body.slice(0, at).split(/\s+/).length;
        const start = Math.max(0, before - Math.floor(WINDOW_WORDS / 2));
        capped = words.slice(start, start + WINDOW_WORDS).join(" ");
      }
      // ADR-0020 rule 4: the window carries the headline and the lead with the
      // containing paragraph. A paragraph can be a single sentence ("Police
      // spokesperson Mark Mitchell said the team would…"), and the referent it
      // leaves dangling — which team — lives in the headline and lead, which the
      // window excluded before, so the context pass had nothing to resolve it
      // with and no venue to read.
      return [item.title, lead !== capped ? lead : null, capped]
        .filter((part): part is string => part != null && part.length > 0)
        .join("\n");
    };
    // The `attribute` stage: whose words is each sentence?
    const attributionInput = {
      documentId: publication.publicationId,
      // Declared, not classified: this lane reads a news feed. The dangerous
      // direction of a wrong genre is a news report labelled `opinion-analysis`,
      // which makes the reporter's own assertions eligible — the original defect
      // through the back door (ADR-0019 §2; genre detection is INGESTION Q13).
      genre: "news-report" as const,
      sentences: sentences.map((sentence) => ({ id: sentence.id, text: sentence.text })),
    };
    const attribution = await attributeSentences(attributionInput, speakershipLlm as never);
    const scope = attribution.scope;
    console.log(
      `  ${scope.read} sentence(s): ${scope.eligible} in scope, ${scope.excluded} out of scope ` +
        `(${Object.entries(scope.byClass)
          .filter(([, count]) => count > 0)
          .map(([cls, count]) => `${cls} ${count}`)
          .join(", ")})`,
    );
    const inScope = eligibleSentences(attributionInput, attribution);
    if (inScope.length === 0) {
      console.log("  no sentence in this document is ours to check — nothing written.");
      return;
    }
    const triage = await triageDocument(
      {
        documentId: publication.publicationId,
        sentences: inScope.map((sentence) => ({
          id: sentence.id,
          text: sentence.text,
          window: windowFor(sentence.text),
        })),
      },
      triageLlm as never,
    );
    const record = triage.triageRecord;
    console.log(
      `  read ${record.sentencesRead} sentence(s): ${triage.claims.length} claim(s), ` +
        `${record.setAside.length} set aside, ${record.held.length} held`,
    );
    for (const drop of record.setAside.slice(0, 5)) {
      console.log(`    set aside (${drop.rejectionClass}): ${drop.sentenceText.slice(0, 70)}`);
    }
    for (const held of record.held.slice(0, 3)) {
      console.log(`    held (${held.reason.slice(0, 40)}): ${held.sentenceText.slice(0, 70)}`);
    }
    if (triage.claims.length === 0) {
      console.log("\n  no claim survived triage — nothing to verify. The ingest half is recorded.");
      return;
    }

    // Which claim to verify: an explicit index, else the first statistical one
    // (the lane's R2 target), else the first claim.
    const claim =
      claimArg != null
        ? triage.claims[Number(claimArg)]
        : (triage.claims.find((c) => c.claimType === "statistical") ?? triage.claims[0]);
    if (claim == null) {
      throw new Error(`no claim at index ${claimArg ?? "statistical/first"}`);
    }
    console.log(`\n  verifying: "${claim.text.slice(0, 110)}"`);
    console.log(`  typed as ${claim.claimType}`);

    // 4. Plan. The claim gets a PLAN, not a mode (ADR-0023). Whether the figures
    // procedure can run still depends on the authority registry — no vetted
    // authority means no series — and that is recorded as a declined step with a
    // reason rather than routing the claim to a different, weaker check.
    console.log("\n[4/6] planning…");
    const domainKey = canonicalDomain(claim.text);
    const library = (await store.listProcedures()).map((p) => ({
      procedureRef: p.procedureRef,
      version: p.version,
      status: p.status ?? ("active" as const),
      cannotEstablish: p.cannotEstablish,
    }));
    const authority = await store.resolveAuthority(domainKey);

    // The lane declares what it CANNOT run, at planning time (ADR-0023 §4). This
    // is not bookkeeping: a plan that omits the escalation stores a claim about a
    // check that never ran. Two earlier versions of this block did exactly that —
    // the first dropped the plan entirely, the second planned `quote-fidelity` and
    // then escalated it at verification, so the stored plan said "ran" for a check
    // this lane has no instrument for.
    //
    // Declaring the limits up front also means the research floor fires for the
    // right reason: with nothing runnable, `planForClaim` adds the research pass,
    // and the stored plan is the plan the lane actually followed.
    const laneDeclines = [
      {
        procedureRef: "stat-grid",
        reason:
          authority == null
            ? `no vetted authority for "${domainKey}" in the registry, so no official series to check against`
            : `authority "${authority.authorityRef}" is registered, but this lane has no series-fetch path (INGESTION §2.3)`,
      },
      {
        procedureRef: "quote-fidelity",
        reason:
          "this lane ingests article text, so there is no caption track to anchor the quote to (ADR-0007)",
      },
      {
        procedureRef: "provenance",
        reason:
          "the context procedure runs only on the curated false-context fixtures (VER-R6); no live detection is claimed",
      },
    ];

    const plan = planForClaim({
      features: derivePlanFeatures({
        category: domainKey,
        claimText: claim.text,
        claimType: claim.claimType,
      }),
      claimText: claim.text,
      available: library,
      pastPlans: [],
      declines: laneDeclines,
      notAttempted: [
        "whether any policy caused the change — no procedure here can reach causation",
      ],
    });
    console.log(
      `  plan: ${plan.steps
        .map((step) => `${step.procedureRef}(${step.status}${step.declineReason ? "" : ""})`)
        .join(", ")}`,
    );
    for (const step of plan.steps) {
      if (step.status === "declined")
        console.log(`    declined ${step.procedureRef}: ${step.declineReason}`);
    }

    // 5. Verify. Every procedure this lane cannot run was declined at step 4 with
    // its reason, so what remains here is genuinely runnable: the document check
    // where a cited document resolved, else the research pass the plan added.
    console.log("\n[5/6] verification…");
    let verdictClass: string | null = null;
    let justification: string | null = null;
    let citedSpan = "";
    const evidence: Array<{
      title: string;
      link: string;
      snippet: string;
      finding: string;
      tier: number | null;
    }> = [];

    // ADR-0021: the attributed speaker is the referent for a sentence that says
    // "the charity", and the strongest query term we hold. Derived here because
    // verification runs before the claim record is written.
    const speakerName = speakershipFor(attribution, claim.sourceSentenceId)?.speaker ?? null;

    // ADR-0022: is this claim worth verifying at all? Triage decides *checkable*
    // and (via the attribute stage) *ours to check*; this decides
    // *consequential*. It is a PRIORITY filter, not a truth filter — an
    // immaterial claim is recorded with its reason and not verified. Structural
    // and party-blind (materiality.ts); it fails open when no passage was read.
    const materiality = assessMateriality({
      claimType: claim.claimType,
      context: {
        topic: claim.discourseContext?.policyTopic ?? null,
        attachedProposal: claim.discourseContext?.attachedProposal ?? null,
        argumentDirection: claim.discourseContext?.argumentDirection ?? null,
      },
      assessed: (claim.discourseContext?.window ?? "").trim().length > 0,
    });
    console.log(
      `  materiality: ${materiality.material ? "kept" : "SET ASIDE"} — ${materiality.reason}`,
    );
    if (!materiality.material) {
      console.log("  not worth a verdict — recorded, not verified (ADR-0022).");
      return;
    }

    // `mode` is gone (ADR-0023); the branch is driven by what the PLAN actually
    // contains. A procedure the plan declined is not run, and a procedure the
    // plan includes that this lane cannot honestly run is escalated by name
    // rather than approximated — an unrun check must never become a verdict.
    const runs = (ref: string) =>
      plan.steps.some((step) => step.procedureRef === ref && step.status !== "declined");

    // What the plan left runnable. The lane's limits were declared at step 4, so
    // this is a read of the plan rather than a second opinion about it.
    const effectiveMode: "open-web" | "citation-check" = runs("citation-check")
      ? "citation-check"
      : "open-web";
    // Which procedure this lane actually ran, as a library ref. `mode` says what
    // the plan WANTED; `effectiveMode` is what this lane could honestly run. This
    // lane has no series-fetch path and no caption track, so only the research
    // procedure and the document procedure are reachable — short by construction,
    // not by omission.
    const primaryProcedureRef =
      effectiveMode === "citation-check" ? "citation-check" : "open-web-research";

    // Verification-tier keys, checked at the point of use: an open-web claim
    // needs the research tier (OpenRouter) as well as search, while
    // citation-check needs search only. Named rather than thrown, so the run
    // reports what is missing after the free half has already been recorded.
    const needed = [
      "SERPER_API_KEY",
      ...(effectiveMode === "open-web" ? ["OPENROUTER_API_KEY"] : []),
    ];
    const missingVerify = needed.filter((name) => !process.env[name]);
    if (missingVerify.length > 0) {
      console.log(`\n── verification blocked ──`);
      console.log(`  path "${effectiveMode}" needs: ${missingVerify.join(", ")}`);
      console.log(
        "  ADR-0011 puts the research tier on OpenRouter and search on Serper; the verdict tier" +
          " and the publication gate are on Anthropic, which is present.",
      );
      console.log("  Ingest, triage and routing above are recorded. No verdict was written.");
      return;
    }
    const search = createSerperSearch(requireEnv("SERPER_API_KEY"));

    // ADR-0020: resolve the cited document BEFORE choosing the path. A claim
    // that names no document — or whose cited document is not admissible — does
    // not get a citation check; it escalates to open-web research, which is the
    // mode that actually searches for corroboration. The old path invented a
    // citation from the claimant's name and took search result #1, which is how
    // a Wikipedia biography became the evidence for a policing claim.
    let citationTarget: {
      link: string;
      title: string;
      snippet: string;
      tier: number | null;
    } | null = null;
    let citationRefusal: string | null = null;
    if (effectiveMode === "citation-check") {
      // The cited document is read from the CLAIM TEXT, not from a triage-time
      // paraphrase of it. `fingerprint.source` used to supply this, and the
      // citation-target module exists because that path once "checked" a policing
      // claim against the subject's Wikipedia biography.
      const citedName = citationNameFromClaim(claim.text);
      console.log(`  cited source: ${citedName ?? "(none named)"}`);
      const found = citedName != null ? await search.search(`${citedName} New Zealand`) : [];
      const tiers = new Map<string, number | null>();
      for (const result of found) {
        const known = await store.resolveAuthority(canonicalDomain(result.link));
        tiers.set(result.link, known?.tier ?? null);
      }
      const resolved = resolveCitationTarget({
        citedSource: citedName,
        results: found,
        tierOf: (link) => tiers.get(link) ?? null,
      });
      if (resolved.ok) {
        citationTarget = { ...resolved.target, tier: tiers.get(resolved.target.link) ?? null };
      } else {
        citationRefusal = resolved.reason;
      }
    }

    if (effectiveMode === "citation-check" && citationTarget != null) {
      console.log(`  citation-check against ${citationTarget.link}`);
      const page = await fetchEvidenceText(citationTarget.link, undefined, {
        snippet: citationTarget.snippet,
      });
      const outcome = await citationCheck(verificationLlm as never, {
        claim: claim.text,
        citedDocument: {
          source: citationTarget.link,
          authorityTier: citationTarget.tier ?? 6,
          // Null text means the page did not yield readable content — the
          // comparison then rests on the snippet, and the design's rule holds:
          // a paywalled/uncitable source is quoted-claim-only, never
          // circumvented (ADR-0006 paywall policy).
          text: page.ok ? page.text.slice(0, 4000) : null,
        },
      });
      verdictClass = outcome.verdict;
      justification =
        outcome.mismatch ??
        `Compared against ${citationTarget.link}${outcome.bindingStrictness ? ` (${outcome.bindingStrictness} binding)` : ""}.`;
      // The gate gets what the comparison actually read, not just the citation.
      citedSpan = page.ok
        ? `${citationTarget.title} (${citationTarget.link}): ${page.text.slice(0, 1400)}`
        : `${citationTarget.title} — ${citationTarget.link} (page text unavailable)`;
      evidence.push({
        title: citationTarget.title,
        link: citationTarget.link,
        snippet: citationTarget.snippet,
        finding: outcome.mismatch ?? "",
        tier: citationTarget.tier,
      });
      console.log(`  citation-check → ${verdictClass}`);
    } else {
      // open-web: the default path (mode-routing.ts) — decompose, research the
      // questions, read the pages, then adjudicate against full text. A
      // citation-check that could not resolve its document escalates here
      // (ADR-0020 rule 1) rather than abstaining after one query.
      if (effectiveMode === "citation-check") {
        console.log(
          `  citation-check cannot run: ${citationRefusal ?? "no cited document"} → escalated to open-web`,
        );
      }
      // ADR-0021: research the RESOLVED claim, bias every query to the document's
      // jurisdiction, and anchor on the speaker's own name — the terms that find
      // the article rather than New Mexico. The old path searched the raw
      // sentence, which names neither a country nor the charity.
      const jurisdiction = deriveJurisdiction({
        publicationUrl: item.link,
        sourceId: LANE.sourceId,
      });
      const resolved = resolveReferent(claim.text, { speaker: speakerName });
      // ADR-0021 rule 5: the claim's place in an argument, so research is framed
      // by what was being argued — not only by the number.
      // The STORED context shape (StoredDiscourseContext) — its names differ from
      // the extraction shape: policyTopic/speechContext here, topic/venue there.
      const claimContext = {
        topic: claim.discourseContext?.policyTopic ?? null,
        attachedProposal: claim.discourseContext?.attachedProposal ?? null,
        argumentDirection: claim.discourseContext?.argumentDirection ?? null,
        venue: claim.discourseContext?.speechContext ?? null,
      };
      console.log(
        `  jurisdiction: ${jurisdiction ?? "unknown"}` +
          (resolved.resolved ? `; "${resolved.referent}" → ${speakerName}` : ""),
      );
      const contextLine = describeContext(claimContext);
      if (contextLine) console.log(`  context: ${contextLine}`);
      const decomposed = await decomposeClaim(
        { claim: resolved.text, jurisdiction, context: claimContext },
        decomposeLlm,
      );
      const entity = entityQueries({
        entities: speakerName ? [speakerName] : [],
        jurisdiction,
      });
      const questions = [
        ...decomposed,
        ...(item.title
          ? [
              {
                question: `Corroborating coverage of the event the claim came from: ${item.title}`,
                queries: [item.title],
              },
            ]
          : []),
        ...(entity.length > 0
          ? [{ question: `What has ${speakerName} said about this?`, queries: entity }]
          : []),
      ];
      console.log(`  decomposed into ${questions.length} question(s)`);
      const outcome = await runDeepResearch(
        { claim: claim.text, questions },
        { search: search.search, researcher: researcherLlm, depthCap: 3, resultsPerQuery: 5 },
      );
      console.log(
        `  research: ${outcome.evidence.length} source(s), ${outcome.roundsUsed} round(s)` +
          `${outcome.cappedRun ? " (CAP BOUND)" : ""}`,
      );

      if (outcome.evidence.length === 0) {
        verdictClass = "not_enough_evidence";
        justification = "Open-web research found no evidence bearing on the claim.";
        citedSpan = "no sources retrieved";
      } else {
        const withText = await Promise.all(
          outcome.evidence.slice(0, 5).map(async (source) => {
            const page = await fetchEvidenceText(source.link, undefined, {
              snippet: source.snippet,
            });
            return {
              title: source.title,
              link: source.link,
              snippet: source.snippet,
              pageText: page.text.slice(0, 1500),
              pageFetched: page.ok,
            };
          }),
        );
        // What the publication gate is handed as "the evidence": the SAME payload
        // the adjudicator read — title, link, snippet and page text per source.
        // Handing it less is what blocked the first full runs: with titles only,
        // or with a short slice of page text, a justification that reasons across
        // sources (or asserts what a source does NOT say) cannot be confirmed and
        // comes back `fail (hallucinated-content)` while the evidence underneath
        // is sound (Sept 2026). The gate must judge the finding against exactly
        // the material the finding was made from.
        // The document the claim came from, handed to the gate FIRST: it is the
        // record for whether the statement was made at all — the question this
        // claim's first verdict got wrong.
        const claimSource = {
          title: item.title,
          link: item.link,
          text: doc.text.slice(0, 2000),
        };
        citedSpan = [
          `${claimSource.title}\n${claimSource.link}\nThe document the claim came from:\n${claimSource.text}`,
          ...withText.map(
            (source) =>
              `${source.title}\n${source.link}\nSnippet: ${source.snippet}\nPage text: ${source.pageText}`,
          ),
        ].join("\n\n---\n\n");
        const adjudication = (await verificationLlm.generateObject(
          "citation-compare",
          // No researchConfidence is passed: the researcher's self-reported number
          // is not a measurement and nothing has calibrated it (Sept 2026).
          {
            claim: claim.text,
            resolvedClaim: resolved.text,
            claimSource,
            context: contextLine ?? "no argumentative context recorded",
            sources: withText,
            researchGaps: outcome.gaps,
          },
          {
            parse: (v: unknown) =>
              v as {
                verdict: string;
                mismatch: string;
                narrative?: { lead: string; paragraphs: string[]; pull: string };
                sourceFindings?: Array<{ link: string; tier: number; finding: string }>;
              },
          },
        )) as {
          ok: boolean;
          value?: {
            verdict: string;
            mismatch: string;
            narrative?: { lead: string; paragraphs: string[]; pull: string };
            sourceFindings?: Array<{ link: string; tier: number; finding: string }>;
          };
          failureClass?: string;
        };

        if (!adjudication.ok || !adjudication.value) {
          // No adjudication means no considered finding, so there is nothing to
          // gate and nothing to publish. Writing a verdict class here would
          // manufacture "not enough evidence" out of a failed call, and the
          // justification available to us is pipeline meta-commentary that the
          // gate correctly refuses to treat as evidence (it blocked exactly that
          // on the first full run, Sept 2026). Stop and report instead, naming
          // the cause: a schema failure on a response this large is usually the
          // fixed output budget cutting the answer.
          console.log(
            `  adjudication failed: ${adjudication.failureClass ?? "unknown"}` +
              `${(adjudication as { finishReason?: string }).finishReason ? ` (finish_reason: ${(adjudication as { finishReason?: string }).finishReason})` : ""}`,
          );
          const raw = (adjudication as { rawOutput?: string }).rawOutput;
          if (raw) console.log(`  raw: ${raw.slice(0, 300)}`);
          console.log("  no finding to gate — nothing written.");
          return;
        }
        {
          const value = adjudication.value;
          verdictClass = value.verdict;
          const narrative = value.narrative;
          justification = narrative
            ? [narrative.lead, ...narrative.paragraphs, narrative.pull].join("\n")
            : (value.mismatch ?? "Adjudicated against the retrieved sources.");
          for (const source of outcome.evidence.slice(0, 5)) {
            const finding = (value.sourceFindings ?? []).find((f) => f.link === source.link);
            evidence.push({
              title: source.title,
              link: source.link,
              snippet: source.snippet,
              finding: finding?.finding ?? "",
              tier: finding?.tier ?? null,
            });
          }
          // ADR-0020 rule 3: a decisive verdict rests on an official record or
          // two independent admissible sources. Anything less downgrades to
          // not_enough_evidence rather than publishing a finding on one weak
          // source — the discipline that would have stopped the Wikipedia case.
          const floored = enforceEvidenceFloor({
            verdictClass,
            evidence: evidence.map((e) => ({ link: e.link, tier: e.tier ?? null })),
          });
          if (floored.downgraded) {
            console.log(`  evidence floor: ${floored.reason} → not_enough_evidence`);
            justification = `${justification} ${floored.reason}.`;
            verdictClass = floored.verdictClass;
          }
          console.log(`  open-web → ${verdictClass}`);
        }
      }
    }

    if (verdictClass == null || justification == null) {
      console.log("  no verdict produced — nothing written.");
      return;
    }

    // Non-blocking discovery: an authority-registry miss is exactly why the
    // figures procedure was declined for this claim, so search and vet the domain
    // now and later claims in the same category can run it. Failures are logged
    // and never block the verdict — and a claim type that could never use the
    // figures procedure is skipped inside discovery rather than buying a search
    // that cannot be used.
    if (effectiveMode === "open-web" && domainKey) {
      try {
        const outcome = await discoverAuthority(
          { domain: domainKey, claimType: claim.claimType, claimText: claim.text },
          {
            search: search.search,
            classifyAuthorities: async (candidates) => {
              const call = await verificationLlm.generateObject(
                "authority-classify",
                { candidates },
                {
                  parse: (v: unknown) =>
                    v as {
                      results: Array<{
                        tier: number;
                        rationale: string;
                        confidence: number;
                      } | null>;
                    },
                },
              );
              return (
                (
                  call as {
                    value?: {
                      results?: Array<{
                        tier: number;
                        rationale: string;
                        confidence: number;
                      } | null>;
                    };
                  }
                ).value?.results ?? candidates.map(() => null)
              );
            },
            recordAuthority: (fixture) => store.recordAuthority(fixture),
          },
        );
        console.log(`  discovery: ${outcome.reason}`);
      } catch (err) {
        console.log(`  discovery failed (non-blocking): ${(err as Error).message}`);
      }
    }

    // 6. Publication gate (VER-R2 §2.7), then the writes.
    console.log("\n[6/6] publication gate + writes…");
    const nli = await nliAudit(verificationLlm as never, {
      justification,
      citedSpan: citedSpan || "no cited span",
    });
    console.log(`  NLI: ${nli.verdict}${nli.failureClass ? ` (${nli.failureClass})` : ""}`);

    const sentenceAttribution = speakershipFor(attribution, claim.sourceSentenceId);
    const claimRecord = await store.recordClaim({
      publicationId: publication.publicationId,
      // Content identity (TRI-R13): triage's claim id is derived from the
      // sentence, so a re-run of the same article finds the claim it already
      // made instead of inserting a second row for the same sentence. Without
      // this the write is unconditional and re-runs accumulate duplicates —
      // each with its own verdict and trail, and nothing pointing at the first.
      claimKey: claim.claimId,
      // The scope decision, written WHOLE (ADR-0019 §5): the class this sentence
      // got, how it was decided, and the genre that selected the rule. The
      // reader's gate requires all three, because a class with no method or genre
      // cannot be disclosed with its provenance and so is not publishable.
      speakershipClass: sentenceAttribution?.speakershipClass ?? null,
      speakershipMethod: attribution.method,
      genre: attribution.genre,
      utteranceText: claim.text,
      text: claim.text,
      claimType: claim.claimType,
      // No `verification_mode` (ADR-0023) — see the plan at step 4, stored with
      // the evidence pack.
      // Triage's own output: what was read, what was set aside, what was held.
      // Comes from triageDocument so the counts cannot drift from the run.
      triageRecord: triage.triageRecord,
      // When it was said: the article's publication time.
      spokenAt: item.publishedAt,
      // The named speaker, so the page can say whose claim it assesses instead of
      // leaving the "who" line empty. `confidence` is required by the shape and
      // nothing measures it: 1 records that this is the name the text attributes
      // the words to, NOT that entity resolution is certain. A nullable
      // confidence would be the honest shape, and it is flagged rather than
      // quietly chosen (Sept 2026).
      attributionCandidates: sentenceAttribution?.speaker
        ? [
            {
              name: sentenceAttribution.speaker,
              kind: "person",
              confidence: 1,
              basis: attribution.provenance.promptVersion,
            },
          ]
        : [],
      // Triage's own discourse-context pass (ADR-0008): the extractor reads the
      // window, so the lane passes its result through rather than inventing one.
      // Until this was wired, `attached_proposal` was always null and the verdict
      // page's "as deployed" section could not render — the stage ran per claim
      // and its output was discarded here (Sept 2026).
      discourseContext: claim.discourseContext,
    });

    const itemRefs: string[] = [];
    for (const source of evidence) {
      try {
        const written = await store.recordEvidenceItem({
          claimId: claimRecord.claimId,
          authorityRef: new URL(source.link).hostname,
          seriesIdentity: source.title || source.link,
          vintageDate: new Date(),
          url: source.link,
          archiveSnapshotUrl: "",
          contentHash: createHash("sha256").update(source.link).digest("hex"),
          plainFinding: source.finding || null,
          tier: source.tier,
        });
        itemRefs.push(written.itemId);
      } catch {
        // A duplicate or malformed source never blocks the pack.
      }
    }

    // The plan travels with the pack (ADR-0023 §5). Built at step 4 and stored
    // HERE rather than at planning time, because the stored artefact is the record
    // of what the plan DID: a step is `ran` with its outcome, or `declined` with
    // its reason. Storing the plan as-planned would publish a claim about checks
    // that had not run yet.
    //
    // This was missing on the first run of this lane: the plan was computed, used
    // for branching and printed, and then dropped — so the page rendered "no plan
    // recorded" for a claim whose plan the run had in hand. A stage the
    // orchestrator forgets to STORE is as absent as one it never runs.
    const storedPlan = {
      libraryVersion: plan.libraryVersion,
      features: plan.features,
      steps: plan.steps.map((step) =>
        step.status === "declined"
          ? step
          : {
              ...step,
              status: "ran" as const,
              outcome: step.procedureRef === primaryProcedureRef ? verdictClass : null,
            },
      ),
      notAttempted: plan.notAttempted,
    };
    const pack = await store.appendEvidencePack(claimRecord.claimId, {
      plan: storedPlan,
      itemRefs,
      gridResult: null,
      justifications: [justification],
      nliOutcome: nli.verdict === "pass" ? "pass" : "fail",
    });
    if (nli.verdict !== "pass") {
      // The gate is a gate: the pack is the record of the blocked attempt and no
      // verdict is written, so nothing unvetted reaches the public page.
      console.log(
        `\n── publication blocked ── NLI audit: ${nli.verdict}${nli.failureClass ? ` (${nli.failureClass})` : ""}`,
      );
      console.log(`  pack recorded without a verdict: ${pack.packId}`);
      return;
    }

    const verdict = await store.writeVerdict(claimRecord.claimId, pack.packId, {
      provenance: {
        pipelineVersion: LANE.pipelineVersion,
        promptVersions: Object.fromEntries(
          [...invokedRoles.keys()].map((role) => [role, `${role}@1`]),
        ),
        modelVersions: Object.fromEntries(invokedRoles),
        // The searches that produced the evidence — a real list, not a placeholder.
        searchRefs: evidence.map((source) => source.link),
      },
      verdictClass: verdictClass as never,
      // No confidence: nothing in the pipeline measures one, and a placeholder is
      // what made every verdict page read "Confidence: 70%" (Sept 2026).
    });
    await store.logTransition(verdict.verdictId, {
      from: "DRAFT",
      to: "PUBLISHED",
      reason: "lane 2 live run (RNZ politics RSS)",
    });
    console.log(`  verdict v${verdict.version} (${verdict.status}): ${verdict.verdictClass}`);

    const review = claimReviewFromVerdict({
      verdictUrl: `https://claimwatch.nz/claim/${claimRecord.claimId}`,
      claimText: claim.text,
      verdictClass: verdictClass as never,
      publishedAt: new Date().toISOString(),
      claimPublishedAt: item.publishedAt.toISOString(),
      // No claimant: this lane does not attribute (ADR-0002). The outlet is the
      // publisher of the claim, not its speaker.
      claimantName: "RNZ (publication)",
      claimantKind: "institution",
    });
    validateClaimReview(review);
    console.log(`  ClaimReview valid: ${review.reviewRating.ratingName}`);

    console.log("\n── routing actually exercised (role / model / serving mode) ──");
    for (const [role, model] of invokedRoles) {
      console.log(
        `  ${role.padEnd(20)} ${model.padEnd(34)} ${invokedServingModes.get(role) ?? "unknown"}`,
      );
    }
    console.log(`\n  site: http://localhost:3456/claim/${claimRecord.claimId}`);
    console.log("\n── done — lane 2 end-to-end ──");
  } finally {
    await store.close();
  }
}

await main();
