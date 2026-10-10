// One-claim AVeriTeC dev-set slice: a REAL benchmark claim from the pinned
// dev.json through the simplified pipeline with live LLMs — triage (ADR-0025) →
// the adversarial research loop (ADR-0026) → Dataset B prediction → the claim,
// evidence pack and verdict written to the store. The point is flow validation
// against real benchmark data, not verdict quality.
//
// Usage:
//   npx tsx ops/live-averitec-one.ts [claimIndex?]
//
// LIVE_EGRESS-gated by the keys it requires (preflight).

import { setDefaultResultOrder } from "node:dns";

setDefaultResultOrder("ipv4first");

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ResearchClaimContext } from "../packages/pipeline/src/research.ts";
import { triageDocument } from "../packages/pipeline/src/triage.ts";
import { claimReviewFromVerdict, validateClaimReview } from "../packages/store/src/claimreview.ts";
import { createStore } from "../packages/store/src/store.ts";
import {
  createTrackedAdapter,
  logRouting,
  preflight,
  provenanceFor,
  requireEnv,
  researchAgentPort,
  researchPort,
  runResearch,
  toResearchLoopRecord,
  triagePort,
} from "./live-support.ts";

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

/**
 * AVeriTeC dates are `DD-MM-YYYY` calendar dates rather than instants, so they are
 * anchored at noon UTC — the same day in New Zealand whatever offset is in force.
 * An unparseable value returns null: the trail drops the step rather than
 * inventing a date.
 */
function claimDateToSpokenAt(value: string): Date | null {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  const parsed = new Date(`${year}-${month}-${day}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

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
  preflight();

  const devSet: AveritecClaim[] = JSON.parse(
    readFileSync("packages/harness/data/dev.json", "utf8"),
  );
  const index = Number(process.argv[2] ?? "0");

  // The numerical-claim-with-QAs subset: claims that state a figure and come with
  // the benchmark's own evidence questions.
  const pool = devSet.filter(
    (d) =>
      (d.claim_types ?? []).includes("Numerical Claim") &&
      (d.questions?.length ?? 0) > 0 &&
      d.speaker,
  );
  const target = pool[index % pool.length];
  if (!target) {
    throw new Error(`no numerical claim with QAs at index ${index} (pool size ${pool.length})`);
  }
  console.log("── one-claim AVeriTeC dev-set slice ──");
  console.log(
    `claim [pool index ${index % pool.length} of ${pool.length}]: "${target.claim.slice(0, 120)}"`,
  );
  console.log(
    `ground-truth label: ${target.label} | speaker: ${target.speaker} | date: ${target.claim_date}`,
  );
  console.log(`benchmark evidence QAs available: ${target.questions.length}`);

  const tracked = createTrackedAdapter();
  const triageLlm = triagePort(tracked.adapter);
  const researchLlm = researchPort(tracked.adapter);
  const agentPort = researchAgentPort(tracked.adapter);

  // 1. Triage: two arms per sentence (ADR-0025).
  //
  // The genre is declared `opinion-analysis` on purpose. An AVeriTeC claim is a
  // bare assertion attributed to a named speaker, with no quotation and no
  // attribution verb in the sentence itself — so under `news-report` the combined
  // classifier would (correctly) call it outlet prose and the slice would have
  // nothing to verify. `author-claim` is the eligible class that keeps an
  // unattributed assertion checkable, and it is available only for this genre
  // (ADR-0025 §2).
  console.log("\n[1/4] triage (live LLM)…");
  const doc = {
    documentId: `averitec-${devSet.indexOf(target)}`,
    genre: "opinion-analysis" as const,
    documentText: target.claim,
    sentences: [{ id: "s1", text: target.claim, window: `claim date ${target.claim_date}` }],
  };
  const triage = await triageDocument(doc, triageLlm, {
    decisions: tracked.decisions,
    decisionRoles: tracked.decisionRoles,
  });
  if (triage.claims.length === 0) {
    console.log(
      "  no claim survived triage — dropped:",
      triage.dropLog.map((d) => d.rejectionClass).join(", "),
    );
    return;
  }
  const [claim] = triage.claims;
  // noUncheckedIndexedAccess: the empty-claims case returned above, but TS needs
  // the narrowing spelled out.
  if (claim == null) return;
  console.log(`  → class ${claim.speakershipClass}`);

  // 2. The adversarial research loop (ADR-0026).
  console.log("\n[2/4] adversarial research (live LLM + Serper)…");
  const context: ResearchClaimContext = {
    claim: claim.text,
    supports: claim.discourseContext.supports ?? null,
    topic: claim.discourseContext.policyTopic ?? null,
    venue: claim.discourseContext.speechContext ?? null,
    document: target.claim,
    // AVeriTeC is an international benchmark with no source document, so the
    // jurisdiction is genuinely unknown — null, not guessed.
    jurisdiction: null,
  };
  const { outcome } = await runResearch(context, researchLlm, agentPort);
  console.log(
    `  ${outcome.turnsUsed} turn(s)${outcome.capped ? " (CAP BOUND)" : ""}; ` +
      `${outcome.evidence.length} piece(s) of evidence; agreement: ${outcome.agreement.agreed}`,
  );
  console.log(`  reason: ${outcome.reason}`);
  for (const e of outcome.evidence.slice(0, 4)) {
    console.log(`    · ${e.domain || e.url} — ${e.passage.slice(0, 70)}`);
  }

  // 3. Dataset B prediction record.
  console.log("\n[3/4] Dataset B prediction…");
  const prediction = {
    claim: target.claim,
    label: pipelineVerdict(target.label),
    pipelineVerdict: outcome.verdictClass,
    groundTruthLabel: target.label,
    match: pipelineVerdict(target.label) === outcome.verdictClass,
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
    `  ground truth: ${target.label} | pipeline: ${outcome.verdictClass} | match: ${prediction.match}`,
  );

  // 4. Store writes + ClaimReview.
  console.log("\n[4/4] store writes…");
  const store = await createStore(requireEnv("DATABASE_URL"));
  try {
    const claimRecord = await store.recordClaim({
      claimKey: claim.claimId,
      utteranceText: claim.utteranceText,
      text: claim.text,
      speakershipClass: claim.speakershipClass,
      speakershipMethod: "classified",
      genre: doc.genre,
      triageRecord: triage.triageRecord,
      // The benchmark's own claim date, so the public trail can say when the claim
      // was made rather than only when we checked it. An unparseable date stays
      // absent rather than guessed.
      spokenAt: claimDateToSpokenAt(target.claim_date),
      attributionCandidates: target.speaker
        ? [{ name: target.speaker, kind: "person", basis: "benchmark metadata" }]
        : [],
      discourseContext: claim.discourseContext,
    });

    const itemRefs: string[] = [];
    const seenUrls = new Set<string>();
    for (const e of outcome.evidence) {
      if (seenUrls.has(e.url)) continue;
      seenUrls.add(e.url);
      try {
        const written = await store.recordEvidenceItem({
          claimId: claimRecord.claimId,
          authorityRef: e.domain || new URL(e.url).hostname,
          seriesIdentity: e.title || e.url,
          vintageDate: new Date(),
          url: e.url,
          archiveSnapshotUrl: "",
          contentHash: createHash("sha256").update(e.url).digest("hex"),
          plainFinding: e.passage,
          tier: e.tier,
        });
        itemRefs.push(written.itemId);
      } catch {
        // A duplicate or malformed source never blocks the pack.
      }
    }

    const justifications =
      outcome.justifications.length > 0 ? outcome.justifications : [outcome.reason];
    const pack = await store.appendEvidencePack(claimRecord.claimId, {
      itemRefs,
      justifications,
      research: toResearchLoopRecord(outcome),
    });
    const verdict = await store.writeVerdict(claimRecord.claimId, pack.packId, {
      provenance: provenanceFor(
        tracked.invokedRoles,
        outcome.evidence.map((e) => e.url),
      ),
      verdictClass: outcome.verdictClass,
      confidence: outcome.confidence,
    });
    await store.logTransition(verdict.verdictId, {
      from: "DRAFT",
      to: "PUBLISHED",
      reason: "averitec one-claim slice",
    });
    const review = claimReviewFromVerdict({
      verdictUrl: `https://claimwatch.nz/claim/${claimRecord.claimId}`,
      claimText: target.claim,
      verdictClass: outcome.verdictClass,
      publishedAt: new Date().toISOString(),
      claimPublishedAt: new Date().toISOString(),
      claimantName: target.speaker ?? "Unknown",
      claimantKind: "person",
    });
    validateClaimReview(review);
    console.log(`  verdict v${verdict.version} written: ${verdict.verdictClass}`);
    logRouting(tracked);
    console.log(`  site: http://localhost:3456/claim/${claimRecord.claimId}`);
    console.log("\n── done — AVeriTeC claim end-to-end ──");
    console.log(JSON.stringify({ prediction }, null, 2).slice(0, 600));
  } finally {
    await store.close();
  }
}

await main();
