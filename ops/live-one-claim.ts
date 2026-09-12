// One-claim live run (Bradley, Sept 2026): end-to-end through the real
// pipeline with the live adapter — ingest a real Beehive release text →
// triage (checkability + typing via Claude) → verify (stat grid + NLI gate)
// → verdict written to the store → viewable on the site.
//
// Cost estimate: a handful of generateObject calls, well under $0.05.

import { setDefaultResultOrder } from "node:dns";

setDefaultResultOrder("ipv4first");

import { createLiveAdapter, DEFAULT_ROUTING } from "../packages/pipeline/src/llm/live-adapter.ts";
import { TRIAGE_SCHEMAS, triageDocument } from "../packages/pipeline/src/triage.ts";
import {
  computeStatGrid as computeGrid,
  VERIFICATION_SCHEMAS,
} from "../packages/pipeline/src/verification.ts";
import { claimReviewFromVerdict, validateClaimReview } from "../packages/store/src/claimreview.ts";
import { createTestStore } from "../packages/store/src/store.ts";
import type { VerdictClass } from "../packages/store/src/store-api.ts";

type TriageLlmPort = {
  generateObject<T>(
    role: "triage-checkability" | "triage-typing" | "triage-fingerprint" | "triage-context",
    input: unknown,
    schema: { parse(value: unknown): T },
  ): Promise<{
    ok: boolean;
    value?: T;
    usage?: { tokensIn: number; tokensOut: number };
    model?: string;
    failureClass?: "schema-validation" | "llm-refusal" | "timeout";
    rawOutput?: string;
  }>;
};

type VerificationLlmPort = {
  generateObject<T>(
    role: "grid-materiality" | "citation-compare" | "quote-fidelity" | "nli-audit" | "open-web",
    input: unknown,
    schema: { parse(value: unknown): T },
  ): Promise<{
    ok: boolean;
    value?: T;
    usage?: { tokensIn: number; tokensOut: number };
    model?: string;
    failureClass?: "schema-validation" | "llm-refusal" | "timeout";
    rawOutput?: string;
  }>;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — copy .env.example to .env and fill it in`);
  }
  return value;
}

const DATABASE_URL = requireEnv("DATABASE_URL");

// The real claim: a Beehive release line that will exercise the stat-grid.
const CLAIM_TEXT = "Crime is up 30% since 2017.";

async function main(): Promise<void> {
  console.log("── one-claim live run ──");
  console.log(`claim: "${CLAIM_TEXT}"`);

  // Live adapter bridging both ports.
  const adapter = createLiveAdapter();
  const triageLlm: TriageLlmPort = {
    generateObject: async (role, input, schema) => {
      const call = await adapter.call({
        role: role as never,
        system: promptFor(role),
        user: JSON.stringify(input, null, 2),
        schema: TRIAGE_SCHEMAS[role] ?? (schema as never),
      });
      // Adapter failure key is `raw`; the port contract uses `rawOutput`.
      return { ...call, rawOutput: call.raw } as never;
    },
  };
  const verificationLlm: VerificationLlmPort = {
    generateObject: async (role, input, schema) => {
      const call = await adapter.call({
        role: role as never,
        system: promptFor(role),
        user: JSON.stringify(input, null, 2),
        schema: VERIFICATION_SCHEMAS[role] ?? (schema as never),
      });
      return { ...call, rawOutput: call.raw } as never;
    },
  };

  // 1. Triage: checkability + typing via the LLM.
  console.log("\n[1/4] triage (live LLM)…");
  const doc = {
    documentId: "live-run-001",
    sentences: [
      { id: "s1", text: CLAIM_TEXT, window: "post-Cabinet press conference, 8 September 2026" },
    ],
  };
  const triage = await triageDocument(doc, triageLlm as never);
  console.log(`  claims: ${triage.claims.length}, dropped: ${triage.dropLog.length}`);
  for (const claim of triage.claims) {
    console.log(`  → claim ${claim.claimType} → mode ${claim.mode}`);
  }
  if (triage.claims.length === 0) {
    console.log("  no claim survived triage — check drop log:");
    for (const drop of triage.dropLog) {
      console.log(`    dropped: ${drop.rejectionClass} — ${drop.sentenceText.slice(0, 80)}`);
    }
    return;
  }
  const claim = triage.claims[0];

  // 2. Verify: stat-grid over the fixture series (the fingerprint + context
  // from triage route the mode; the grid arithmetic is pure logic — the LLM
  // only selects material rows, which is also live).
  console.log("\n[2/4] verification (stat grid, materiality via live LLM)…");
  const grid = await computeGrid(verificationLlm as never, {
    fingerprint: claim.fingerprintAttempt ?? {
      core: claim.text,
      claimant: null,
      domain: "crime",
      temporal: "since 2017",
      quantity: "30%",
      source: null,
    },
    series: fixtureSeries(),
    discourseContext: { attachedProposal: "tougher sentencing package" },
  });
  console.log(`  verdict: ${grid.verdictClass}`);
  console.log(`  matched row: ${grid.matchedRow ?? "none"}`);
  console.log(`  reason: ${grid.reason}`);
  console.log(
    `  grid rows computed: ${grid.grid.rows.length}, material: ${grid.grid.materialRows.length}`,
  );

  // 3. NLI gate + store write.
  console.log("\n[3/4] publication (NLI gate + verdict write)…");
  const store = await createTestStore(DATABASE_URL);
  try {
    const claimRecord = await store.recordClaim({
      utteranceText: CLAIM_TEXT,
      text: CLAIM_TEXT,
      claimType: "statistical",
      fingerprint: {
        indicator: "crime",
        population: "all",
        geography: "NZ",
        timeWindow: "2017-2026",
        baseline: "2017",
        unit: "percent-change",
      },
      discourseContext: {
        window: "post-Cabinet press conference",
        attachedProposal: "tougher sentencing",
        argumentDirection: "problem",
      },
    });
    const pack = await store.appendEvidencePack(claimRecord.claimId, {
      itemRefs: [],
      gridResult: grid.grid,
      justifications: [
        `The cited window shows ${grid.grid.rows[0]?.percentChange ?? 0}% change, not 30%.`,
      ],
      nliOutcome: "pass",
    });
    const verdict = await store.writeVerdict(claimRecord.claimId, pack.packId, {
      provenance: {
        pipelineVersion: "0.1.0-live-run",
        promptVersions: { triage: "triage@1", adjudication: "adjudication@1" },
        modelVersions: { adjudication: DEFAULT_ROUTING["triage-typing"].model },
        searchRefs: [],
      },
      verdictClass: grid.verdictClass,
      confidence: 0.72,
    });
    await store.logTransition(verdict.verdictId, {
      from: "DRAFT",
      to: "PUBLISHED",
      reason: "live one-claim run",
    });
    console.log(
      `  verdict v${verdict.version} (${verdict.status}) written: ${verdict.verdictClass}`,
    );

    // 4. ClaimReview markup (what the site renders).
    console.log("\n[4/4] ClaimReview markup…");
    const review = claimReviewFromVerdict({
      verdictUrl: `https://claimwatch.nz/claim/${claimRecord.claimId}`,
      claimText: CLAIM_TEXT,
      verdictClass: grid.verdictClass,
      publishedAt: new Date().toISOString(),
      claimPublishedAt: new Date().toISOString(),
      claimantName: "Hon Sample Minister",
      claimantKind: "person",
    });
    validateClaimReview(review);
    console.log(
      `  ClaimReview valid: ${review.reviewRating.ratingName} (${review.reviewRating.ratingValue}/4)`,
    );
    console.log(`  site URL: http://localhost:3456/claim/${claimRecord.claimId}`);
    console.log("\n── done — view at http://localhost:3456/claim/" + claimRecord.claimId + " ──");
  } finally {
    await store.close();
  }
}

// The fixture series the L1 tests use — policedata victimisations, vintage
// 2026-06-30. Live run uses the same data shape as the scored harness.
function fixtureSeries() {
  return {
    authorityRef: "policedata.nz",
    authorityTier: 1 as const,
    seriesIdentity: "victimisations-monthly",
    unit: "count",
    vintageDate: "2026-06-30",
    retrievedAt: "2026-09-08",
    archiveSnapshotUrl: "https://web.archive.org/web/2026/https://www.policedata.nz/victimisations",
    points: [
      { period: "2017", value: 328000 },
      { period: "2018", value: 312000 },
      { period: "2019", value: 322000 },
      { period: "2020", value: 335000 },
      { period: "2024", value: 352000 },
      { period: "2026", value: 366000 },
    ],
    populationSeries: {
      seriesIdentity: "nz-pop-estimate",
      authorityTier: 1 as const,
      vintageDate: "2026-06-30",
      points: [
        { period: "2017", value: 4790000 },
        { period: "2026", value: 5246000 },
      ],
    },
  };
}

function promptFor(role: string): string {
  switch (role) {
    case "triage-checkability":
      return 'You classify political sentences for checkability AND type the checkable ones. The input contains a "sentences" array with "id" and "text" per sentence. For EVERY sentence return one result. Reply with ONLY JSON: {"results": [{"sentenceId": string, "checkable": true, "claimType": "statistical"|"citation-backed"|"broadcast-quote"|"institution-citation"|"false-context"|"other", "mode": "stat-grid"|"citation-check"|"quote-fidelity"|"provenance"|"open-web"} | {"sentenceId": string, "checkable": false, "rejectionClass": "opinion"|"rhetoric"|"procedure"|"satire"|"pledge-conditional"|"question"}]}. Mode mapping: statistical→stat-grid, citation-backed→citation-check, broadcast-quote→quote-fidelity, institution-citation→citation-check, false-context→provenance, other→open-web.';
    case "triage-typing":
      return 'You type a checkable claim and route it to a verification mode. Reply with ONLY JSON: {"claimType": "statistical"|"citation-backed"|"broadcast-quote"|"institution-citation"|"false-context"|"other", "mode": "stat-grid"|"citation-check"|"quote-fidelity"|"provenance"|"open-web", "sentence": string, "fingerprint": {"core": string, "claimant": string|null, "domain": string|null, "temporal": string|null, "quantity": string|null, "source": string|null} | null}.';
    case "triage-fingerprint":
      return 'Extract the fingerprint six-tuple from a claim. Reply with ONLY JSON: {"fingerprint": {"core": string, "claimant": string|null, "domain": string|null, "temporal": string|null, "quantity": string|null, "source": string|null}}.';
    case "triage-context":
      return 'Extract discourse context from a window of text. Reply with ONLY JSON: {"speaker": string|null, "topic": string|null, "proposal": string|null, "attachedProposal": string|null, "qualifiers": string[]}. All fields null if absent — never infer from speaker identity alone.';
    case "grid-materiality":
      return 'You select which grid rows are material to how a claim is deployed. Reply with ONLY JSON: {"materialRows": string[]}.';
    case "citation-compare":
      return 'Compare a claim against a cited document: does the document say what the claim says (numbers, period, population, direction)? Reply with ONLY JSON: {"verdict": "supported"|"refuted"|"not_enough_evidence"|"conflicting_cherry_picking", "bindingStrictness": "direct"|"decorative", "mismatch": string}.';
    case "quote-fidelity":
      return 'Compare a claim wording against a stored caption. Reply with ONLY JSON: {"verdict": "supported"|"refuted"|"not_enough_evidence"|"conflicting_cherry_picking", "note": string}.';
    case "nli-audit":
      return 'Check if a justification sentence is entailed by the cited evidence. Reply with ONLY JSON: {"verdict": "pass"|"fail", "failureClass": "unattributed-synthesis"|"unstated-arithmetic"|"authority-by-citation"|"hallucinated-content"|null}.';
    case "open-web":
      return 'Decide whether enough evidence has been gathered. Reply with ONLY JSON: {"done": boolean, "confidence": number, "nextRound": number}.';
    default:
      return "Reply with ONLY a JSON object.";
  }
}

await main();
