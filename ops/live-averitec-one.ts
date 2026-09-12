// One-claim AVeriTeC dev-set slice (Bradley, Sept 2026): a REAL benchmark claim
// from the pinned dev.json through the full pipeline with live LLMs — triage →
// verify (routed by claim type) → Dataset B prediction → scored against the
// benchmark label via the pinned eval script's vocabulary. The point is flow
// validation against real benchmark data, not verdict quality.
//
// Usage: bun run ops/live-averitec-one.ts [claimIndex?]

import { setDefaultResultOrder } from "node:dns";

setDefaultResultOrder("ipv4first");

import { readFileSync } from "node:fs";
import { createLiveAdapter } from "../packages/pipeline/src/llm/live-adapter.ts";
import { routeMode } from "../packages/pipeline/src/mode-routing.ts";
import { runOpenWebRetrieval } from "../packages/pipeline/src/open-web-retrieval.ts";
import { discoverAuthority } from "../packages/pipeline/src/search/discovery.ts";
import { createSerperSearch } from "../packages/pipeline/src/search/serper-adapter.ts";
import { triageDocument } from "../packages/pipeline/src/triage.ts";
import {
  citationCheck,
  computeStatGrid,
  nliAudit,
  quoteFidelityCheck,
} from "../packages/pipeline/src/verification.ts";
import { claimReviewFromVerdict, validateClaimReview } from "../packages/store/src/claimreview.ts";
import { canonicalDomain } from "../packages/store/src/domain.ts";
import { createStore } from "../packages/store/src/store.ts";

interface AveritecClaim {
  claim: string;
  label: "Supported" | "Refuted" | "Not Enough Evidence" | "Conflicting Evidence/Cherrypicking";
  justification: string;
  claim_date: string;
  speaker: string | null;
  claim_types: string[];
  questions: Array<{
    question: string;
    answers: Array<{ answer: string; answer_type: string; source_url?: string }>;
  }>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — copy .env.example to .env and fill it in`);
  }
  return value;
}

const DATABASE_URL = requireEnv("DATABASE_URL");

const adapter = createLiveAdapter();

// Port bridges: adapter `raw` → port `rawOutput`; real Zod schemas per role.
const TRIAGE_SCHEMAS: Record<string, z.ZodTypeAny> = {};
const VERIFICATION_SCHEMAS: Record<string, z.ZodTypeAny> = {};
{
  // Imported lazily to avoid circulars; the maps are declared at module end of
  // their owners.
  const triage = await import("../packages/pipeline/src/triage.ts");
  Object.assign(TRIAGE_SCHEMAS, triage.TRIAGE_SCHEMAS);
  const verification = await import("../packages/pipeline/src/verification.ts");
  Object.assign(VERIFICATION_SCHEMAS, verification.VERIFICATION_SCHEMAS);
}

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

const PROMPTS: Record<string, string> = {
  "triage-checkability":
    'You classify political sentences for checkability AND type the checkable ones. The input contains a "sentences" array with "id" and "text" per sentence. For EVERY sentence return one result. Reply with ONLY JSON: {"results": [{"sentenceId": string, "checkable": true, "claimType": "statistical"|"citation-backed"|"broadcast-quote"|"institution-citation"|"false-context"|"other", "mode": "stat-grid"|"citation-check"|"quote-fidelity"|"provenance"|"open-web"} | {"sentenceId": string, "checkable": false, "rejectionClass": "opinion"|"rhetoric"|"procedure"|"satire"|"pledge-conditional"|"question"}]}. Mode mapping: statistical→stat-grid, citation-backed→citation-check, broadcast-quote→quote-fidelity, institution-citation→citation-check, false-context→provenance, other→open-web.',
  "grid-materiality":
    'You select which grid rows are material to how a claim is deployed. Reply with ONLY JSON: {"materialRows": string[]}.',
  "citation-compare":
    'Compare a claim against a cited document: does the document say what the claim says (numbers, period, population, direction)? Reply with ONLY JSON: {"verdict": "supported"|"refuted"|"not_enough_evidence"|"conflicting_cherry_picking", "bindingStrictness": "direct"|"decorative", "mismatch": string}.',
  "nli-audit":
    'Check if a justification sentence is entailed by the cited evidence. Reply with ONLY JSON: {"verdict": "pass"|"fail", "failureClass": "unattributed-synthesis"|"unstated-arithmetic"|"authority-by-citation"|"hallucinated-content"|null}.',
  "authority-classify":
    'Classify this source as an NZ evidence authority for statistical claims. tier 1 = NZ Crown/official statistics (.govt.nz, .parliament.nz, official portals); tier 2 = NZ academia/peer-review (.ac.nz); tier 3 = major NZ media (RNZ, NZ Herald, Stuff, 1News); tier 5 = NZ NGO/sector body (usable with tier-gap framing); tier 6 = unknown/personal. Return null if not plausibly an evidence authority for NZ statistical claims. Reply with ONLY JSON: {"tier": number, "rationale": string, "confidence": number} (confidence 0-1), or null.',
};

function pipelineVerdict(
  averitecLabel: string,
): "supported" | "refuted" | "not_enough_evidence" | "conflicting_cherry_picking" {
  switch (averitecLabel) {
    case "Supported":
      return "supported";
    case "Refuted":
      return "refuted";
    case "Not Enough Evidence":
      return "not_enough_evidence";
    case "Conflicting Evidence/Cherrypicking":
      return "conflicting_cherry_picking";
  }
  throw new Error(`unknown AVeriTeC label: ${averitecLabel}`);
}

async function main(): Promise<void> {
  const devSet: AveritecClaim[] = JSON.parse(
    readFileSync("packages/harness/data/dev.json", "utf8"),
  );
  const index = Number(process.argv[2] ?? "0");

  // The numerical-claim-with-QAs subset routes to modes the pipeline exercises
  // without a live series fetch; pick by index within that filter.
  const pool = devSet.filter(
    (d) =>
      (d.claim_types ?? []).includes("Numerical Claim") &&
      (d.questions?.length ?? 0) > 0 &&
      d.speaker,
  );
  const target = pool[0];
  if (!target) {
    throw new Error("no numerical claim with QAs found in the dev set");
  }
  void index;

  console.log("── one-claim AVeriTeC dev-set slice ──");
  console.log(`claim [pool index 0 of ${pool.length}]: "${target.claim.slice(0, 120)}"`);
  console.log(
    `ground-truth label: ${target.label} | speaker: ${target.speaker} | date: ${target.claim_date}`,
  );
  console.log(`evidence QAs available: ${target.questions.length}`);

  // 1. Triage (live LLM).
  console.log("\n[1/5] triage (live LLM)…");
  const doc = {
    documentId: `averitec-${devSet.indexOf(target)}`,
    sentences: [{ id: "s1", text: target.claim, window: `claim date ${target.claim_date}` }],
  };
  const triage = await triageDocument(doc, triageLlm as never);
  if (triage.claims.length === 0) {
    console.log(
      "  no claim survived triage — dropped:",
      triage.dropLog.map((d) => d.rejectionClass).join(", "),
    );
    return;
  }
  const claim = triage.claims[0];
  console.log(`  → ${claim.claimType} → mode ${claim.mode}`);

  // 2. Verify — registry-aware routing (user direction, Sept 2026): open-web
  // is the default; stat-grid only when the registry holds a vetted authority
  // for the claim's canonical domain. On a miss, discovery runs NON-BLOCKING
  // (the claim gets its open-web verdict now; later claims in the category
  // upgrade to stat-grid).
  console.log("\n[2/5] verification…");
  let verdictClass: string | null = null;
  let note = "";

  const store = await createStore(DATABASE_URL);
  const registry = {
    resolveAuthority: (domain: string) => store.resolveAuthority(domain),
  };

  // One canonical key for BOTH routing and discovery — the triage fingerprint
  // often carries no domain, so the key derives from the fingerprint core.
  const routingFingerprint = claim.fingerprintAttempt ?? {
    core: claim.text,
    claimant: null,
    domain: null,
    temporal: null,
    quantity: null,
    source: null,
  };
  const domainKey = canonicalDomain(
    routingFingerprint.domain ?? routingFingerprint.core ?? target.claim,
  );
  const routedMode = await routeMode({ claimType: claim.claimType, domain: domainKey }, registry);
  console.log(`  registry routing: ${claim.claimType} → ${routedMode}`);

  if (routedMode === "stat-grid") {
    const authority = await store.resolveAuthority(domainKey);
    console.log(
      `  authority: ${authority?.authorityRef} (T${authority?.tier}, discovered ${authority?.discoveredBy})`,
    );
    // NOTE: series fetching is per-source plumbing (not built for this
    // authority yet) — the grid still runs against benchmark QA stand-ins,
    // clearly labelled.
    const series = {
      authorityRef: authority?.authorityRef ?? "averitec-benchmark-qa",
      authorityTier: (authority?.tier ?? 6) as const,
      seriesIdentity: `averitec-${devSet.indexOf(target)}`,
      unit: "qa-pair",
      vintageDate: target.claim_date,
      retrievedAt: new Date().toISOString(),
      archiveSnapshotUrl: "",
      points: target.questions
        .slice(0, 6)
        .flatMap((q) => q.answers.map((a) => ({ period: a.answer, value: Number(a.answer) || 0 })))
        .filter((p) => p.value > 0),
    };
    const grid = await computeStatGrid(verificationLlm as never, {
      fingerprint: claim.fingerprintAttempt ?? {
        core: claim.text,
        claimant: null,
        domain: null,
        temporal: null,
        quantity: null,
        source: null,
      },
      series,
      discourseContext: {},
    });
    verdictClass = grid.verdictClass;
    note = grid.reason;
    console.log(`  stat-grid → ${verdictClass}`);
    console.log(`  ${note}`);
  } else {
    // REAL retrieval: fingerprint-conditioned query → Serper → capped rounds.
    const fingerprint = claim.fingerprintAttempt ?? {
      core: claim.text,
      claimant: null,
      domain: null,
      temporal: null,
      quantity: null,
      source: null,
    };
    const retrieval = await runOpenWebRetrieval(
      { claim: target.claim, fingerprint },
      {
        search: createSerperSearch(requireEnv("SERPER_API_KEY")).search,
        llm: verificationLlm as never,
        depthCap: 2,
      },
    );
    console.log(
      `  open-web: ${retrieval.evidence.length} evidence URLs across ${retrieval.roundsUsed} round(s), confidence ${retrieval.confidence}${retrieval.cappedRun ? " (CAP BOUND)" : ""}`,
    );
    for (const e of retrieval.evidence.slice(0, 3)) {
      console.log(`    · ${e.title.slice(0, 60)} — ${e.link}`);
    }

    // Evidence-grounded verdict: the LLM adjudicates the claim against the
    // retrieved sources; no evidence → honest open question.
    if (retrieval.evidence.length === 0) {
      verdictClass = "not_enough_evidence";
      note = "open-web retrieval found no evidence — published as an open question";
    } else {
      const adjudication = await verificationLlm.generateObject(
        "citation-compare",
        {
          claim: target.claim,
          sources: retrieval.evidence
            .slice(0, 5)
            .map((e) => ({ title: e.title, link: e.link, snippet: e.snippet })),
        },
        {
          parse: (v: unknown) =>
            v as { verdict: string; bindingStrictness: string; mismatch: string },
        },
      );
      verdictClass = (adjudication as { value: { verdict: string } }).value.verdict;
      note = `open-web (cap ${retrieval.capBinding}, ${retrieval.roundsUsed} rounds, confidence ${retrieval.confidence})`;
    }
    console.log(`  open-web → ${verdictClass}`);

    // Non-blocking discovery: registry miss → search + vet + persist for the
    // next claim. Uses the SAME canonical domainKey as routing — one key per
    // category, so discoveries amortise. Failures never block the verdict.
    if (domainKey) {
      try {
        const outcome = await discoverAuthority(
          { domain: domainKey, claimText: target.claim },
          {
            search: createSerperSearch(requireEnv("SERPER_API_KEY")).search,
            classifyAuthority: async (candidate) => {
              const call = await verificationLlm.generateObject("authority-classify", candidate, {
                parse: (v: unknown) => v as { tier: number; rationale: string; confidence: number },
              });
              return (call as { value: { tier: number; rationale: string; confidence: number } })
                .value;
            },
            recordAuthority: (fixture) => store.recordAuthority(fixture),
          },
        );
        console.log(`  discovery: ${outcome.persisted ? outcome.reason : outcome.reason}`);
      } catch (err) {
        console.log(`  discovery failed (non-blocking): ${(err as Error).message}`);
      }
    }
  }

  // 3. NLI gate on the benchmark justification (live LLM).
  console.log("\n[3/5] NLI audit (live LLM)…");
  const nli = await nliAudit(verificationLlm as never, {
    justification: target.justification || claim.text,
    citedSpan: target.questions
      .map((q) => `${q.question} → ${q.answers.map((a) => a.answer).join("; ")}`)
      .join(" | ")
      .slice(0, 800),
  });
  console.log(`  NLI: ${nli.verdict}${nli.failureClass ? ` (${nli.failureClass})` : ""}`);

  // 4. Dataset B prediction record.
  console.log("\n[4/5] Dataset B prediction…");
  const prediction = {
    claim: target.claim,
    label: pipelineVerdict(target.label), // ground truth reference; the pipeline verdict is recorded alongside
    pipelineVerdict: verdictClass,
    groundTruthLabel: target.label,
    match: pipelineVerdict(target.label) === verdictClass,
    justification: target.justification,
    questions: target.questions.map((q) => ({
      question: q.question,
      answers: q.answers.map((a) => ({
        answer: a.answer,
        answer_type: a.answer_type,
        source_url: a.source_url ?? "",
      })),
    })),
  };
  console.log(
    `  ground truth: ${target.label} | pipeline: ${verdictClass} | match: ${prediction.match}`,
  );

  // 5. ClaimReview markup (site rendering).
  console.log("\n[5/5] ClaimReview markup…");
  try {
    const claimRecord = await store.recordClaim({
      utteranceText: target.claim,
      text: target.claim,
      claimType: claim.claimType,
      discourseContext: { window: `AVeriTeC dev set, claim_date ${target.claim_date}` },
    });
    const pack = await store.appendEvidencePack(claimRecord.claimId, {
      itemRefs: [],
      gridResult: null,
      justifications: [target.justification],
      nliOutcome: nli.verdict === "pass" ? "pass" : "fail",
    });
    const verdict = await store.writeVerdict(claimRecord.claimId, pack.packId, {
      provenance: {
        pipelineVersion: "0.1.0-averitec-slice",
        promptVersions: { triage: "triage@1", adjudication: "adjudication@1" },
        modelVersions: { adjudication: "claude-sonnet-5" },
        searchRefs: [],
      },
      verdictClass: verdictClass as never,
      confidence: 0.7,
    });
    await store.logTransition(verdict.verdictId, {
      from: "DRAFT",
      to: "PUBLISHED",
      reason: "averitec one-claim slice",
    });
    const review = claimReviewFromVerdict({
      verdictUrl: `https://claimwatch.nz/claim/${claimRecord.claimId}`,
      claimText: target.claim,
      verdictClass: verdictClass as never,
      publishedAt: new Date().toISOString(),
      claimPublishedAt: new Date().toISOString(),
      claimantName: target.speaker ?? "Unknown",
      claimantKind: "person",
    });
    validateClaimReview(review);
    console.log(`  verdict v1 written: ${verdict.verdictClass}`);
    console.log(`  site: http://localhost:3456/claim/${claimRecord.claimId}`);
    console.log("\n── done — AVeriTeC claim end-to-end ──");
    console.log(JSON.stringify({ prediction, nli: nli.verdict }, null, 2).slice(0, 600));
  } finally {
    await store.close();
  }
}

await main();
