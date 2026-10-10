// One-claim live run (ADR-0025, ADR-0026): a small press-release-like document
// through the two live stages — triage (two arms per sentence) → the adversarial
// research loop (assessor → researcher → critiquer) → claim, evidence pack and
// verdict written to the store, viewable on the site.
//
// Usage:
//   set -a; source .env; set +a
//   npx tsx ops/live-one-claim.ts
//
// LIVE_EGRESS-gated by the keys it requires (preflight makes no paid call without
// them). Cost: a handful of generateObject calls plus Serper searches.

import { setDefaultResultOrder } from "node:dns";

setDefaultResultOrder("ipv4first");

import { createHash } from "node:crypto";
import { deriveJurisdiction } from "../packages/pipeline/src/claim-context.ts";
import { extractArticle } from "../packages/pipeline/src/ingestion.ts";
import type { ResearchClaimContext } from "../packages/pipeline/src/research.ts";
import { fetchEvidenceText } from "../packages/pipeline/src/search/fetch-evidence.ts";
import { splitSentences, triageDocument } from "../packages/pipeline/src/triage.ts";
import { claimReviewFromVerdict, validateClaimReview } from "../packages/store/src/claimreview.ts";
import { createStore } from "../packages/store/src/store.ts";
import {
  createTrackedAdapter,
  logCost,
  logRouting,
  PIPELINE_VERSION,
  preflight,
  provenanceFor,
  requireEnv,
  researchAgentPort,
  researchPort,
  runResearch,
  toResearchLoopRecord,
  triagePort,
} from "./live-support.ts";

// A real published article, fetched at run time: a Police Minister's quoted
// statistic with the reporting around it. The document is the item we read, so
// its URL resolves, the Minister is named in it, and the window is the passage
// the quote was cut from (ADR-0008).
const DOC = {
  documentId: "live-run-one-claim",
  genre: "news-report" as const,
  sourceId: "rnz-politics",
  link: "https://www.rnz.co.nz/news/politics/543322/violent-crime-victimisation-rates-steady-not-dropping-data-shows",
  spokenAt: new Date("2025-02-27T12:00:00Z"),
};

// Used only if the live fetch fails; the run then says so rather than inventing a
// document.
const FALLBACK_TEXT =
  "Victimisation rates for violent offences have stayed mostly steady according to new official data. " +
  "Police Minister Mark Mitchell said violent crime had a 51 percent increase from 2018 to 2023 and a 2 percent decrease from 2023 to 2024.";

/** Fetch a URL and extract its article; degrade to the plain fetcher, then a fixture. */
async function fetchDocument(url: string): Promise<{ text: string; title: string }> {
  try {
    const response = await fetch(url, { headers: { "user-agent": "claimwatch-slice/0.1" } });
    const html = await response.text();
    const doc = extractArticle(html, url);
    return { text: doc.text, title: doc.title };
  } catch {
    const fallback = await fetchEvidenceText(url);
    return {
      text: fallback.ok && fallback.text.length > 200 ? fallback.text : FALLBACK_TEXT,
      title: "",
    };
  }
}

async function main(): Promise<void> {
  preflight();

  console.log("── one-claim live run ──");

  // Fetch the real item and run the ingestion extraction ladder over it, so the
  // stored source URL is the one we read and the text is article text, not markup.
  const document = await fetchDocument(DOC.link);
  const documentText = document.text;
  console.log(`document: ${DOC.documentId} (${DOC.genre}) — ${documentText.length} chars`);
  console.log(`  fetched from: ${DOC.link}`);

  // Live adapter + the two stage ports. Provenance records what actually ran.
  const tracked = createTrackedAdapter();
  const triageLlm = triagePort(tracked.adapter);
  const researchLlm = researchPort(tracked.adapter);
  const agentPort = researchAgentPort(tracked.adapter);

  // 1. Triage: two arms per sentence (ADR-0025).
  console.log("\n[1/4] triage (live LLM)…");
  const sentences = splitSentences(documentText);
  const triage = await triageDocument(
    {
      documentId: DOC.documentId,
      genre: DOC.genre,
      documentText,
      sentences: sentences.map((sentence) => ({
        id: sentence.id,
        text: sentence.text,
        // The passage the sentence was cut from, so the page can show the claim
        // in context rather than repeating the sentence.
        window: documentText.slice(
          Math.max(0, sentence.span.start - 500),
          Math.min(documentText.length, sentence.span.end + 500),
        ),
      })),
    },
    triageLlm,
    { decisions: tracked.decisions, decisionRoles: tracked.decisionRoles },
  );
  console.log(
    `  read ${triage.triageRecord.sentencesRead} sentence(s): ${triage.claims.length} claim(s), ` +
      `${triage.triageRecord.setAside.length} set aside, ${triage.triageRecord.held.length} held`,
  );
  for (const drop of triage.triageRecord.setAside) {
    console.log(`    set aside (${drop.rejectionClass}): ${drop.sentenceText.slice(0, 80)}`);
  }
  const funnels = [triage.provenance.decision, triage.claims[0]?.provenance.decision];
  for (const funnel of funnels) {
    if (funnel == null) continue;
    console.log(
      `  decision (${funnel.role}): ${funnel.model} — settled ${funnel.settled}, ` +
        `escalated ${funnel.escalated}${funnel.degraded ? " (DEGRADED)" : ""}`,
    );
  }
  if (triage.claims.length === 0) {
    console.log("  no claim survived triage — nothing to verify.");
    return;
  }
  // Prefer a directly quoted claim that states a number; then any attributed
  // claim with a number; otherwise the first attributed claim.
  const quotedClaims = triage.claims.filter((c) => c.speakershipClass === "quoted-actor");
  const claim =
    quotedClaims.find((c) => /["“]/.test(c.text) && /\d/.test(c.text)) ??
    quotedClaims.find((c) => /\d/.test(c.text)) ??
    quotedClaims[0] ??
    triage.claims[0];
  if (claim == null) return;
  console.log(`  verifying: "${claim.text.slice(0, 110)}"`);
  console.log(`  class: ${claim.speakershipClass}${claim.speaker ? ` (${claim.speaker})` : ""}`);

  // 2. The adversarial research loop (ADR-0026): assessor → researcher → critiquer,
  // capped at MAX_RESEARCH_TURNS.
  console.log("\n[2/4] adversarial research (live LLM + Serper)…");
  const context: ResearchClaimContext = {
    claim: claim.text,
    supports: claim.discourseContext.supports ?? null,
    topic: claim.discourseContext.policyTopic ?? null,
    venue: claim.discourseContext.speechContext ?? null,
    document: documentText,
    // The claim's own document: its republications are the claim, not evidence.
    sourceUrl: DOC.link,
    documentTitle: document.title,
    jurisdiction: deriveJurisdiction({ publicationUrl: DOC.link, sourceId: DOC.sourceId }),
  };
  const { outcome } = await runResearch(context, researchLlm, agentPort);
  console.log(
    `  ${outcome.turnsUsed} turn(s)${outcome.capped ? ` (STOPPED: ${outcome.stopReason})` : ""}; ` +
      `${outcome.evidence.length} piece(s) of evidence; agreement: ${outcome.agreement.agreed}`,
  );
  console.log(
    `  research spend $${(outcome.spentUsd ?? 0).toFixed(4)} of $${outcome.budgetUsd.toFixed(2)} budget`,
  );
  console.log(`  reason: ${outcome.reason}`);
  for (const e of outcome.evidence.slice(0, 4)) {
    console.log(`    · ${e.domain || e.url} — ${e.passage.slice(0, 70)}`);
  }

  // 3. Store writes: claim, evidence items, evidence pack (the loop record).
  console.log("\n[3/4] store writes…");
  const store = await createStore(requireEnv("DATABASE_URL"));
  try {
    // The public reader serves only claims with document provenance, so the
    // slice records the item it read before the claim (ADR-0008).
    const publication = await store.recordPublication({
      sourceId: DOC.sourceId,
      canonicalUrl: DOC.link,
      contentHash: createHash("sha256").update(documentText).digest("hex"),
      retrievedAt: new Date(),
      retrievalMethod: "slice",
      pipelineVersion: PIPELINE_VERSION,
      rawRef: DOC.documentId,
      text: documentText,
    });
    const claimRecord = await store.recordClaim({
      publicationId: publication.publicationId,
      // Content identity from triage makes the write idempotent (TRI-R13).
      claimKey: claim.claimId,
      utteranceText: claim.utteranceText,
      text: claim.text,
      speakershipClass: claim.speakershipClass,
      // One combined classifier decided this (ADR-0025); the genre selected the rule.
      speakershipMethod: "classified",
      genre: DOC.genre,
      triageRecord: triage.triageRecord,
      spokenAt: DOC.spokenAt,
      discourseContext: claim.discourseContext,
      // No confidence: nothing measures entity resolution, and a fabricated 1
      // reads as certainty (store/src/speakership.ts, AttributionCandidate).
      attributionCandidates: claim.speaker
        ? [{ name: claim.speaker, kind: "person", basis: "triage-checkability@1" }]
        : [],
    });
    console.log(`  claim row: ${claimRecord.claimId}`);

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
    console.log(`  evidence pack: ${pack.packId} (${itemRefs.length} item(s))`);

    const verdict = await store.writeVerdict(claimRecord.claimId, pack.packId, {
      provenance: provenanceFor(
        tracked.invokedRoles,
        outcome.evidence.map((e) => e.url),
      ),
      verdictClass: outcome.verdictClass,
      // The critiquer now produces a confidence (ADR-0026 §1), so it is recorded.
      confidence: outcome.confidence,
    });
    await store.logTransition(verdict.verdictId, {
      from: "DRAFT",
      to: "PUBLISHED",
      reason: "one-claim live run",
    });
    console.log(`  verdict v${verdict.version} (${verdict.status}): ${verdict.verdictClass}`);

    // 4. ClaimReview markup (what the site renders).
    console.log("\n[4/4] ClaimReview markup…");
    const review = claimReviewFromVerdict({
      verdictUrl: `https://claimwatch.nz/claim/${claimRecord.claimId}`,
      claimText: claim.text,
      verdictClass: outcome.verdictClass,
      publishedAt: new Date().toISOString(),
      claimPublishedAt: DOC.spokenAt.toISOString(),
      claimantName: claim.speaker ?? "Government (publication)",
      claimantKind: claim.speaker ? "person" : "institution",
    });
    validateClaimReview(review);
    console.log(`  ClaimReview valid: ${review.reviewRating.ratingName}`);
    logRouting(tracked);
    logCost(tracked);
    console.log(`\n  site: http://localhost:3456/claim/${claimRecord.claimId}`);
    console.log("\n── done — one claim end-to-end ──");
  } finally {
    await store.close();
  }
}

await main();
