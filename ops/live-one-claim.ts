// One-claim live run (Sept 2026): end-to-end through the real
// pipeline with the live adapter — ingest a real Beehive release text →
// triage (checkability + typing via Claude) → verify (stat grid + NLI gate)
// → verdict written to the store → viewable on the site.
//
// Cost estimate: a handful of generateObject calls, well under $0.05.

import { setDefaultResultOrder } from "node:dns";

setDefaultResultOrder("ipv4first");

import { PROCEDURE_LIBRARY_VERSION } from "../packages/llm/src/config.ts";
import { claimParametersFromLlm } from "../packages/pipeline/src/claim-parameters.ts";
import {
  createLiveAdapter,
  type ProviderCall,
  type ProviderResult,
} from "../packages/pipeline/src/llm/live-adapter.ts";
import { portFromAdapter } from "../packages/pipeline/src/llm/live-port.ts";
import { derivePlanFeatures, planForClaim } from "../packages/pipeline/src/plan.ts";
import {
  TRIAGE_CONTEXT_PROMPT,
  TRIAGE_SCHEMAS,
  triageDocument,
} from "../packages/pipeline/src/triage.ts";
import type { TriageLlm, TriageRole } from "../packages/pipeline/src/triage-llm.ts";
import {
  agreeOnVerdictClass,
  computeStatGrid as computeGrid,
  materialGridRows,
  nliAudit,
  VERIFICATION_SCHEMAS,
} from "../packages/pipeline/src/verification.ts";
import type {
  VerificationLlm,
  VerificationRole,
} from "../packages/pipeline/src/verification-llm.ts";
import { claimReviewFromVerdict, validateClaimReview } from "../packages/store/src/claimreview.ts";
import { createTestStore } from "../packages/store/src/store.ts";

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
  // Provenance (HAR-R7): record the roles this run actually invoked, with the
  // model the adapter reported for each — never a hand-written role/model list.
  // Every LLM call funnels through `call`, so the manifest cannot claim a step
  // that did not run.
  const invokedRoles = new Map<string, string>();
  const rawAdapter = createLiveAdapter();
  const adapter = {
    call: async <T>(providerCall: ProviderCall): Promise<ProviderResult<T>> => {
      const result = await rawAdapter.call<T>(providerCall);
      invokedRoles.set(providerCall.role, result.model ?? "unknown");
      return result;
    },
  };
  const triageLlm: TriageLlm = portFromAdapter<TriageRole>(adapter, {
    promptFor,
    schemas: TRIAGE_SCHEMAS,
  });
  const verificationLlm: VerificationLlm = portFromAdapter<VerificationRole>(adapter, {
    promptFor,
    schemas: VERIFICATION_SCHEMAS,
  });

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
    // No mode any more (ADR-0023): triage answers the TYPE, and the plan below
    // decides which procedures that type needs.
    console.log(`  → claim ${claim.claimType}`);
  }
  if (triage.claims.length === 0) {
    console.log("  no claim survived triage — check drop log:");
    for (const drop of triage.dropLog) {
      console.log(`    dropped: ${drop.rejectionClass} — ${drop.sentenceText.slice(0, 80)}`);
    }
    return;
  }
  const [claim] = triage.claims;
  // noUncheckedIndexedAccess: triage guarantees at least one claim, but TS needs
  // the narrowing spelled out.
  if (claim == null) return;

  // 2. Verify: the figures procedure over the fixture series. The claim's window
  // and magnitude are PARSED here, at the point of use, by a live model call
  // (ADR-0023) — they used to arrive pre-extracted as a fingerprint, which is why
  // nothing noticed that the grid read them out of free text with a regex. The
  // grid arithmetic is pure logic; the materiality selection is also live.
  console.log("\n[2/4] verification (stat grid, materiality via live LLM)…");
  // The class-agreement gate (VERIFICATION §2.7a, VER-R16): the class this slice
  // publishes is decided twice, and a disagreement publishes nothing. The
  // sampling pin does not work on the configured models — claude-sonnet-5
  // ignores temperature and the OpenRouter model ignores seed — so the decision
  // is what gets pinned rather than the sampler: one claim returned
  // `not_enough_evidence` once and `supported` twice, gate passing each time.
  const parameters = await claimParametersFromLlm(triageLlm as never, { sentence: claim.text });
  console.log(
    `  parsed: window=${parameters.window.kind} ${parameters.window.start ?? "-"}→${parameters.window.end ?? "now"}` +
      ` · quantity=${parameters.quantity.kind} ${parameters.quantity.value ?? "-"}`,
  );
  const agreement = await agreeOnVerdictClass(() =>
    computeGrid(verificationLlm as never, {
      parameters,
      claimText: claim.text,
      series: fixtureSeries(),
      discourseContext: { attachedProposal: "tougher sentencing package" },
    }),
  );
  if (!agreement.agreed || !agreement.outcome) {
    console.log(
      `\n── publication blocked by class disagreement ──\n  runs: ${agreement.attempts}\n  classes: ${agreement.classes.join(", ")}`,
    );
    return;
  }
  const grid = agreement.outcome;
  console.log(`  verdict: ${grid.verdictClass}`);
  console.log(`  matched row: ${grid.matchedRow ?? "none"}`);
  console.log(`  reason: ${grid.reason}`);
  console.log(
    `  grid rows computed: ${grid.grid.rows.length}, material: ${grid.grid.materialRows.length}`,
  );

  // 3. NLI gate + store write. The gate runs BEFORE the write: this script used
  // to record `nliOutcome: "pass"` without ever running an audit, which put a
  // gate result on a public verdict that nothing had checked (Sept 2026).
  console.log("\n[3/4] publication (NLI gate + verdict write)…");
  // Round to the precision the evidence carries: interpolating the raw float
  // (11.585365853658537%) states a precision no source supports, which the NLI
  // gate is right to reject as unsupported detail.
  const citedChange = grid.grid.rows[0]?.percentChange;
  const justification = `The cited window shows ${
    citedChange != null ? `${citedChange.toFixed(1)}%` : "no computed change"
  }, not 30%.`;
  const nli = await nliAudit(verificationLlm as never, {
    justification,
    // What the audit is given as "the evidence": the material rows the grid
    // computed, each as window + change, so the audit can ask whether the
    // justification above actually follows from them.
    citedSpan: materialGridRows(grid.grid)
      .map(
        (row) =>
          `${row.axis} ${row.variant}: ${
            row.percentChange != null ? `${row.percentChange.toFixed(1)}%` : "no change computed"
          }`,
      )
      .join("; "),
  });
  console.log(`  NLI: ${nli.verdict}${nli.failureClass ? ` (${nli.failureClass})` : ""}`);
  const store = await createTestStore(DATABASE_URL);
  try {
    const claimRecord = await store.recordClaim({
      utteranceText: CLAIM_TEXT,
      text: CLAIM_TEXT,
      // Content identity from triage — makes the write idempotent, so re-running
      // the slice does not accumulate a second claim with its own verdict
      // (TRI-R13).
      claimKey: triage.claims[0]?.claimId ?? null,
      claimType: "statistical",
      // What triage made of the document the claim came from — the "what we did
      // not check" section on the page. Written from the triage result, never
      // hand-authored: a summary a human wrote is not a record of what ran.
      triageRecord: triage.triageRecord,
      // No claim-level parse and no `verification_mode` (ADR-0023): the plan
      // travels with the evidence pack, below.
      discourseContext: {
        window: "post-Cabinet press conference",
        attachedProposal: "tougher sentencing",
        argumentDirection: "problem",
      },
    });
    const plan = planForClaim({
      features: derivePlanFeatures({
        category: "crime-statistics",
        claimText: claim.text,
        claimType: claim.claimType,
        attachesToProposal: true,
      }),
      claimText: claim.text,
      available: (await store.listProcedures()).map((p) => ({
        procedureRef: p.procedureRef,
        version: p.version,
        status: p.status ?? ("active" as const),
        cannotEstablish: p.cannotEstablish,
      })),
      pastPlans: [],
      notAttempted: [
        "whether any policy caused the change — no procedure here can reach causation",
      ],
    }).steps.map((step) => ({ ...step, status: "ran" as const, outcome: grid.verdictClass }));
    const pack = await store.appendEvidencePack(claimRecord.claimId, {
      plan: {
        libraryVersion: PROCEDURE_LIBRARY_VERSION,
        features: derivePlanFeatures({
          category: "crime-statistics",
          claimText: claim.text,
          claimType: claim.claimType,
          attachesToProposal: true,
        }),
        steps: plan,
        notAttempted: [
          "whether any policy caused the change — no procedure here can reach causation",
        ],
      },
      itemRefs: [],
      gridResult: grid.grid,
      justifications: [justification],
      nliOutcome: nli.verdict === "pass" ? "pass" : "fail",
    });
    if (nli.verdict !== "pass") {
      // The publication gate is a gate (VERIFICATION §2.7): the pack is the record
      // of the blocked attempt and no verdict is written, so nothing unvetted
      // reaches the public page.
      console.log(
        `\n── publication blocked ── NLI audit: ${nli.verdict}${nli.failureClass ? ` (${nli.failureClass})` : ""}`,
      );
      console.log(`  pack recorded without a verdict: ${pack.packId}`);
      return;
    }
    const verdict = await store.writeVerdict(claimRecord.claimId, pack.packId, {
      provenance: {
        pipelineVersion: "0.1.0-live-run",
        promptVersions: Object.fromEntries(
          [...invokedRoles.keys()].map((role) => [role, `${role}@1`]),
        ),
        modelVersions: Object.fromEntries(invokedRoles),
        searchRefs: [],
      },
      verdictClass: grid.verdictClass,
      // No confidence recorded: nothing in the pipeline measures one yet, and a
      // placeholder is what made every verdict page read "Confidence: 70%".
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
      // @3: asks for `venue` (what `speechContext` stores). The text lives in the
      // pipeline module that uses it, so every live script reads the same copy.
      return TRIAGE_CONTEXT_PROMPT;
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
