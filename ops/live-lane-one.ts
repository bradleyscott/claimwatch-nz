// Lane 2 (RNZ politics RSS) — a LIVE run that starts from a scraped source
// instead of a hardcoded claim string.
//
// INGESTION §2.3: feed → article → publication row. Then the simplified pipeline
// (ADR-0025, ADR-0026): triage (two arms per sentence) → the adversarial
// research loop → claim + evidence pack + verdict → ClaimReview. Everything is
// recorded with provenance; nothing is hand-edited.
//
// Usage:
//   set -a; source .env; set +a
//   npx tsx ops/live-lane-one.ts [itemIndex] [claimIndex]
//
//   itemIndex  which feed item to read (default 0 = newest)
//   claimIndex which checkable claim in that article to verify (default: the
//              first attributed claim, else the first claim)
//
// Cost: 1 triage pass (chunked), then the loop's calls (assessor + researcher +
// critiquer per turn, capped at 3 turns) plus Serper searches. ADR-0011 puts the
// verdict tier on Anthropic (Claude Sonnet 5) and the research tier on OpenRouter
// (GLM-5.3-Flash), so BOTH keys plus SERPER_API_KEY are required — preflight
// names any that are missing before a single paid call is made.

import { setDefaultResultOrder } from "node:dns";

setDefaultResultOrder("ipv4first");

import { createHash } from "node:crypto";
import { deriveJurisdiction } from "../packages/pipeline/src/claim-context.ts";
import {
  assertLaneHealthy,
  computeContentHash,
  dedupeKey,
  extractArticle,
  parseFeed,
} from "../packages/pipeline/src/ingestion.ts";
import type { ResearchClaimContext } from "../packages/pipeline/src/research.ts";
import { splitSentences, triageDocument } from "../packages/pipeline/src/triage.ts";
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

// ---------- lane config (INGESTION §2.3) ----------

const LANE = {
  sourceId: "rnz-politics",
  feedUrl: "https://www.rnz.co.nz/rss/political.xml",
  retrievalMethod: "tier-1-rss+readability",
  // ING-R1: a feed that answers 200 with nothing in it is a distinct alarm from
  // a dead feed, and a feed whose newest item is days old is stale, not healthy.
  stalenessBandHours: 48,
} as const;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36";

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

  const tracked = createTrackedAdapter();
  const triageLlm = triagePort(tracked.adapter);
  const researchLlm = researchPort(tracked.adapter);
  const agentPort = researchAgentPort(tracked.adapter);

  // 1. Feed (Tier 1, deterministic).
  console.log("\n[1/5] ingest: feed (Tier 1 RSS)…");
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
  console.log("\n[2/5] ingest: article (Tier 1 readability)…");
  const html = await fetchText(item.link);
  const doc = extractArticle(html, item.link);
  // Identity hashes the RAW fetched body, never the extracted text: hashing
  // extraction output would change the identity of an UNCHANGED document when the
  // extractor improves → a second publication row and duplicate claims (STO-R13).
  const contentHash = computeContentHash(html);
  console.log(`  extracted ${doc.text.length} chars from ${item.link}`);
  console.log(
    `  dedupe key  ${dedupeKey({ guid: item.guid, canonicalUrl: item.link, content: html }).slice(0, 16)}…`,
  );

  const store = await createStore(requireEnv("DATABASE_URL"));
  try {
    const publication = await store.recordPublication({
      sourceId: LANE.sourceId,
      canonicalUrl: item.link,
      contentHash,
      retrievedAt: new Date(),
      retrievalMethod: LANE.retrievalMethod,
      pipelineVersion: "0.1.0-ops-live",
      rawRef: `raw/${contentHash.slice(0, 16)}.html`,
      text: doc.text,
    });
    console.log(`  publication row: ${publication.publicationId}`);

    // 3. Triage: two arms decide whose words it is and whether it is checkable
    // is checkable (ADR-0025). The context pass runs per claim over the WHOLE
    // document (ADR-0026).
    console.log("\n[3/5] triage (live LLM)…");
    const sentences = splitSentences(doc.text);
    const paragraphs = doc.text
      .split(/\n+/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0);
    // The claim's window is the passage it was cut from — stored verbatim as the
    // auditable artefact. The context pass reads the document, not this.
    const windowFor = (sentenceText: string): string =>
      paragraphs.find((paragraph) => paragraph.includes(sentenceText)) ?? item.title;

    const triage = await triageDocument(
      {
        documentId: publication.publicationId,
        // Declared, not classified: this lane reads a news feed. A news report
        // mislabelled `opinion-analysis` would make the reporter's own assertions
        // eligible (ADR-0025 §2).
        genre: "news-report",
        documentText: doc.text,
        sentences: sentences.map((sentence) => ({
          id: sentence.id,
          text: sentence.text,
          window: windowFor(sentence.text),
        })),
      },
      triageLlm,
      { decisions: tracked.decisions, decisionRoles: tracked.decisionRoles },
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
      console.log(`    held: ${held.sentenceText.slice(0, 70)}`);
    }
    if (triage.claims.length === 0) {
      console.log("\n  no claim survived triage — nothing to verify. The ingest half is recorded.");
      return;
    }

    const claim =
      claimArg != null
        ? triage.claims[Number(claimArg)]
        : (triage.claims.find((c) => c.speakershipClass === "quoted-actor") ?? triage.claims[0]);
    if (claim == null) {
      throw new Error(`no claim at index ${claimArg ?? "first attributed/first"}`);
    }
    console.log(`\n  verifying: "${claim.text.slice(0, 110)}"`);
    console.log(`  class: ${claim.speakershipClass}${claim.speaker ? ` (${claim.speaker})` : ""}`);

    // 4. The adversarial research loop (ADR-0026). The assessor plans, the
    // researcher searches/fetches/extracts, the critiquer decides sufficiency and
    // is the publication gate.
    console.log("\n[4/5] adversarial research (live LLM + Serper)…");
    const context: ResearchClaimContext = {
      claim: claim.text,
      supports: claim.discourseContext.supports ?? null,
      topic: claim.discourseContext.policyTopic ?? null,
      venue: claim.discourseContext.speechContext ?? null,
      document: doc.text,
      jurisdiction: deriveJurisdiction({
        publicationUrl: item.link,
        sourceId: LANE.sourceId,
      }),
    };
    const { outcome } = await runResearch(context, researchLlm, agentPort);
    console.log(
      `  ${outcome.turnsUsed} turn(s)${outcome.capped ? " (CAP BOUND)" : ""}; ` +
        `${outcome.evidence.length} piece(s) of evidence; agreement: ${outcome.agreement.agreed}`,
    );
    console.log(`  reason: ${outcome.reason}`);
    if (outcome.gaps.length > 0) {
      console.log(`  gaps: ${outcome.gaps.join(" | ").slice(0, 200)}`);
    }

    // 5. Store writes + ClaimReview.
    console.log("\n[5/5] store writes…");
    const claimRecord = await store.recordClaim({
      publicationId: publication.publicationId,
      // Content identity (TRI-R13): a re-run of the same article finds the claim
      // it already made instead of inserting a second row for the same sentence.
      claimKey: claim.claimId,
      // The scope decision, written whole: the class, the method and the genre
      // that selected the rule (ADR-0025 §2; the reader gate requires all three).
      speakershipClass: claim.speakershipClass,
      speakershipMethod: "classified",
      genre: "news-report",
      utteranceText: claim.utteranceText,
      text: claim.text,
      triageRecord: triage.triageRecord,
      spokenAt: item.publishedAt,
      attributionCandidates: claim.speaker
        ? [{ name: claim.speaker, kind: "person", basis: "triage-checkability@1" }]
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
      reason: "lane 2 live run (RNZ politics RSS)",
    });
    console.log(`  verdict v${verdict.version} (${verdict.status}): ${verdict.verdictClass}`);

    const review = claimReviewFromVerdict({
      verdictUrl: `https://claimwatch.nz/claim/${claimRecord.claimId}`,
      claimText: claim.text,
      verdictClass: outcome.verdictClass,
      publishedAt: new Date().toISOString(),
      claimPublishedAt: item.publishedAt.toISOString(),
      claimantName: "RNZ (publication)",
      claimantKind: "institution",
    });
    validateClaimReview(review);
    console.log(`  ClaimReview valid: ${review.reviewRating.ratingName}`);
    logRouting(tracked);
    console.log(`\n  site: http://localhost:3456/claim/${claimRecord.claimId}`);
    console.log("\n── done — lane 2 end-to-end ──");
  } finally {
    await store.close();
  }
}

await main();
