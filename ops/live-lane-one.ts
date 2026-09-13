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
import { routeMode } from "../packages/pipeline/src/mode-routing.ts";
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
import { splitSentences, triageDocument } from "../packages/pipeline/src/triage.ts";
import { citationCheck, nliAudit } from "../packages/pipeline/src/verification.ts";
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
    'You classify political sentences for checkability AND type the checkable ones. The input contains a "sentences" array with "id" and "text" per sentence. For EVERY sentence return one result. Reply with ONLY JSON: {"results": [{"sentenceId": string, "checkable": true, "claimType": "statistical"|"citation-backed"|"broadcast-quote"|"institution-citation"|"false-context"|"other", "mode": "stat-grid"|"citation-check"|"quote-fidelity"|"provenance"|"open-web"} | {"sentenceId": string, "checkable": false, "rejectionClass": "opinion"|"rhetoric"|"procedure"|"satire"|"pledge-conditional"|"question"}]}. Mode mapping: statistical→stat-grid, citation-backed→citation-check, broadcast-quote→quote-fidelity, institution-citation→citation-check, false-context→provenance, other→open-web.',
  "triage-typing":
    'You type a checkable claim and route it to a verification mode. Reply with ONLY JSON: {"claimType": "statistical"|"citation-backed"|"broadcast-quote"|"institution-citation"|"false-context"|"other", "mode": "stat-grid"|"citation-check"|"quote-fidelity"|"provenance"|"open-web", "sentence": string, "fingerprint": {"core": string, "claimant": string|null, "domain": string|null, "temporal": string|null, "quantity": string|null, "source": string|null} | null}.',
  "claim-decompose": DECOMPOSITION_PROMPT,
  "research-assess": RESEARCHER_PROMPT,
  "citation-compare": `You are explaining a fact-check to a member of the public. You receive the claim and sources (title/link/snippet, plus fetched pageText where available).
Decide the verdict, then EXPLAIN it in plain language. Write for someone with no statistics training — short sentences, no jargon.
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

const triageLlm = {
  generateObject: async (role: string, input: unknown, schema: { parse(v: unknown): unknown }) => {
    const call = await adapter.call({
      role: role as never,
      system: promptFor(role),
      user: JSON.stringify(input, null, 2),
      schema: TRIAGE_SCHEMAS[role] ?? (schema as never),
    });
    return { ...call, rawOutput: call.raw };
  },
};

const verificationLlm = {
  generateObject: async (role: string, input: unknown, schema: { parse(v: unknown): unknown }) => {
    const call = await adapter.call({
      role: role as never,
      system: promptFor(role),
      user: JSON.stringify(input, null, 2),
      schema: VERIFICATION_SCHEMAS[role] ?? (schema as never),
    });
    return { ...call, rawOutput: call.raw };
  },
};

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

    // 3. Triage.
    console.log("\n[3/6] triage (live LLM)…");
    const sentences = splitSentences(doc.text);
    // One checkability call covers the whole document; the window is what the
    // claim was said in, which for a news article is its own headline/desk.
    const window = `${item.title} — RNZ Politics, published ${item.publishedAt.toISOString().slice(0, 10)}`;
    const triage = await triageDocument(
      {
        documentId: publication.publicationId,
        sentences: sentences.map((sentence) => ({
          id: sentence.id,
          text: sentence.text,
          window,
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

    // 4. Route. The mode is ROUTED, never taken from the type→mode map: for a
    // statistical claim that map says stat-grid unconditionally, while routing
    // needs an authority-registry hit (mode-routing.ts). Storing the type-map
    // default would put a check on the page that did not run (Sept 2026).
    console.log("\n[4/6] routing…");
    const fingerprint = claim.fingerprintAttempt ?? {
      core: claim.text,
      claimant: null,
      domain: null,
      temporal: null,
      quantity: null,
      source: null,
    };
    const domainKey = canonicalDomain(fingerprint.domain ?? fingerprint.core ?? claim.text);
    const registry = { resolveAuthority: (domain: string) => store.resolveAuthority(domain) };
    const mode = await routeMode({ claimType: claim.claimType, domain: domainKey }, registry);
    console.log(`  ${claim.claimType} + domain "${domainKey}" → ${mode}`);
    if (mode !== claim.mode) {
      console.log(
        `  NOTE: type→mode map said "${claim.mode}"; storing the routed mode "${mode}" (the map's ` +
          `statistical→stat-grid default is not authority-aware).`,
      );
    }

    // 5. Verify by mode. Modes this lane cannot honestly run are refused BY NAME
    // rather than approximated — an unrun check must never become a verdict.
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

    if (mode === "provenance") {
      console.log(
        "  REFUSED: provenance mode runs only on the curated false-context fixtures " +
          "(VER-R6, ING-R10) — no live detection is claimed. No verdict written.",
      );
      return;
    }
    if (mode === "quote-fidelity") {
      console.log(
        "  REFUSED: quote-fidelity compares a quote against a stored caption track " +
          "(ADR-0007). This lane ingests article text only, so there is no caption to " +
          "anchor the claim to (INGESTION §2.4). No verdict written.",
      );
      return;
    }
    if (mode === "stat-grid") {
      const authority = await store.resolveAuthority(domainKey);
      console.log(
        `  REFUSED: grid authority "${authority?.authorityRef ?? "unknown"}" is registered, but ` +
          `this lane has no series-fetch path (INGESTION §2.3: series plumbing is per-source and ` +
          `not built), so the grid would run over nothing. No verdict written.`,
      );
      return;
    }

    // Verification-tier keys, checked at the point of use: an open-web claim
    // needs the research tier (OpenRouter) as well as search, while
    // citation-check needs search only. Named rather than thrown, so the run
    // reports what is missing after the free half has already been recorded.
    const needed = ["SERPER_API_KEY", ...(mode === "open-web" ? ["OPENROUTER_API_KEY"] : [])];
    const missingVerify = needed.filter((name) => !process.env[name]);
    if (missingVerify.length > 0) {
      console.log(`\n── verification blocked ──`);
      console.log(`  mode "${mode}" needs: ${missingVerify.join(", ")}`);
      console.log(
        "  ADR-0011 puts the research tier on OpenRouter and search on Serper; the verdict tier" +
          " and the publication gate are on Anthropic, which is present.",
      );
      console.log("  Ingest, triage and routing above are recorded. No verdict was written.");
      return;
    }
    const search = createSerperSearch(requireEnv("SERPER_API_KEY"));

    if (mode === "citation-check") {
      // The cited source is named in the fingerprint; find it, fetch it, and
      // compare the claim against what it actually says.
      const citedName = fingerprint.source ?? domainKey;
      console.log(`  cited source: ${citedName}`);
      const found = await search.search(`${citedName} New Zealand`);
      const candidate = found[0];
      if (candidate == null) {
        verdictClass = "not_enough_evidence";
        justification = `The claim cites "${citedName}", but no citable document could be located to compare it against.`;
        console.log("  no cited document located → not_enough_evidence");
      } else {
        const page = await fetchEvidenceText(candidate.link, undefined, {
          snippet: candidate.snippet,
        });
        const known = await store.resolveAuthority(canonicalDomain(candidate.link));
        const outcome = await citationCheck(verificationLlm as never, {
          claim: claim.text,
          citedDocument: {
            source: candidate.link,
            authorityTier: known?.tier ?? 6,
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
          `Compared against ${candidate.link}${outcome.bindingStrictness ? ` (${outcome.bindingStrictness} binding)` : ""}.`;
        // The gate gets what the comparison actually read, not just the citation.
        citedSpan = page.ok
          ? `${candidate.title} (${candidate.link}): ${page.text.slice(0, 1400)}`
          : `${candidate.title} — ${candidate.link} (page text unavailable)`;
        evidence.push({
          title: candidate.title,
          link: candidate.link,
          snippet: candidate.snippet,
          finding: outcome.mismatch ?? "",
          tier: known?.tier ?? null,
        });
        console.log(`  citation-check → ${verdictClass}`);
      }
    } else {
      // open-web: the default path (mode-routing.ts) — decompose, research the
      // questions, read the pages, then adjudicate against full text.
      const questions = await decomposeClaim({ claim: claim.text }, decomposeLlm);
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
        citedSpan = withText
          .map(
            (source) =>
              `${source.title}\n${source.link}\nSnippet: ${source.snippet}\nPage text: ${source.pageText}`,
          )
          .join("\n\n---\n\n");
        const adjudication = (await verificationLlm.generateObject(
          "citation-compare",
          // No researchConfidence is passed: the researcher's self-reported number
          // is not a measurement and nothing has calibrated it (Sept 2026).
          { claim: claim.text, sources: withText, researchGaps: outcome.gaps },
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
          const raw = (adjudication as { raw?: string }).raw;
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
          console.log(`  open-web → ${verdictClass}`);
        }
      }
    }

    if (verdictClass == null || justification == null) {
      console.log("  no verdict produced — nothing written.");
      return;
    }

    // Non-blocking discovery (mode-routing.ts): an authority-registry miss is
    // exactly why a statistical claim took the open-web path, so search and vet
    // the domain now and later claims in the same category route to the
    // stat-grid. Failures are logged and never block the verdict — and a claim
    // type that can never route to the grid is skipped inside discovery rather
    // than buying a search that cannot be used.
    if (mode === "open-web" && domainKey) {
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

    const claimRecord = await store.recordClaim({
      publicationId: publication.publicationId,
      utteranceText: claim.text,
      text: claim.text,
      claimType: claim.claimType,
      // The routed mode, not the type→mode default — see step 4.
      verificationMode: mode,
      // Triage's own output: what was read, what was set aside, what was held.
      // Comes from triageDocument so the counts cannot drift from the run.
      triageRecord: triage.triageRecord,
      // When it was said: the article's publication time. Attribution is left
      // empty rather than guessed — the lane does not diarize (ADR-0002/ADR-0007
      // attribution is conservative), so the page omits the "who" line.
      spokenAt: item.publishedAt,
      attributionCandidates: [],
      discourseContext: {
        window,
        ...(fingerprint.domain != null ? { policyTopic: fingerprint.domain } : {}),
      },
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

    const pack = await store.appendEvidencePack(claimRecord.claimId, {
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
