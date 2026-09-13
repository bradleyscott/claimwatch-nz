// Site read model L1 (STORE §3, SITE-MVP §3.1, SIT-R14). The site's live reader
// used to be string SQL over six pipeline tables, reachable by no test at all:
// a column rename could only be discovered by a broken page in production. These
// tests exercise the typed reader against a real migrated scratch database, so
// the read path fails in CI when the schema moves.
//
// The behaviours pinned here are the ones the hand-written SQL had to be trusted
// for: the LATEST verdict per claim, the pack THAT verdict pins (not just any
// pack for the claim), the visible-status filter, and the audit-trail fields the
// page prints or omits.

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSiteReader, type SiteReader, siteReaderPoolConfig } from "./site-reader.ts";
import { createTestStore } from "./store.ts";
import type { Store } from "./store-api.ts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — copy .env.example to .env (gitignored) and fill it in`);
  }
  return value;
}

// Own scratch database: createTestStore drops and recreates it, and vitest forks
// run suites concurrently.
const DATABASE_URL = requireEnv("DATABASE_URL");
const SCRATCH_SUFFIX = "_site_reader";
const SCRATCH_URL = `${DATABASE_URL}${SCRATCH_SUFFIX}`;

let store: Store;
let reader: SiteReader;

beforeAll(async () => {
  store = await createTestStore(DATABASE_URL, { scratchSuffix: SCRATCH_SUFFIX });
  reader = createSiteReader(SCRATCH_URL);
});

afterAll(async () => {
  await reader.close();
  await store.close();
});

function provenance() {
  return {
    pipelineVersion: "0.1.0",
    promptVersions: { "triage-typing": "triage-typing@1" },
    modelVersions: { "triage-typing": "model-x@v1" },
    searchRefs: ["brave:query-hash"],
  };
}

async function seedClaim() {
  return store.recordClaim({
    utteranceText: "Crime is up 30% since 2017.",
    text: "Crime is up 30% since 2017.",
    claimType: "statistical",
    discourseContext: {
      window: "…in the context of law and order debate…",
      attachedProposal: "tougher sentencing",
      speechContext: "said in the House",
    },
    attributionCandidates: [{ name: "Hon Sample Minister", kind: "person", confidence: 0.9 }],
    spokenAt: new Date("2026-09-08T00:00:00Z"),
  });
}

describe("site reader (STORE §3, SIT-R14)", () => {
  it("connects as a READ-ONLY session — the site cannot write even if a query tried", async () => {
    // SITE-MVP §2.1: "The site holds no write path to claims/verdicts". A write
    // the PIPELINE is entitled to make (a fallback-log row) must still be
    // rejected on the site's connection, because the guarantee is the session,
    // not the query list. Asserted on the same config createSiteReader uses.
    const pool = new Pool(siteReaderPoolConfig(SCRATCH_URL));
    try {
      await expect(
        pool.query(
          "INSERT INTO fallback_log (lane, source_id, stage, tier, reason) VALUES ($1,$2,$3,$4,$5)",
          ["lane", "source", "stage", 1, "reason"],
        ),
      ).rejects.toThrow(/read-only transaction/i);
    } finally {
      await pool.end();
    }
  });

  it("answers an unknown claim id with null rather than a partial page", async () => {
    expect(await reader.getVerdictPage("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("reads a verdict page through the typed read model", async () => {
    const claim = await seedClaim();
    await store.recordEvidenceItem({
      ...store.fixtures.statsNzSeries(),
      claimId: claim.claimId,
      plainFinding: "Series shows 12% not 30%.",
      tier: 3,
    });
    const pack = await store.appendEvidencePack(claim.claimId, {
      itemRefs: ["item-1"],
      justifications: ["Series shows 12% not 30%."],
      nliOutcome: "pass",
    });
    const verdict = await store.writeVerdict(claim.claimId, pack.packId, {
      provenance: provenance(),
      verdictClass: "refuted",
      confidence: 0.72,
    });
    await store.logTransition(verdict.verdictId, { from: "DRAFT", to: "PUBLISHED" });

    const page = await reader.getVerdictPage(claim.claimId);
    expect(page?.claimText).toBe("Crime is up 30% since 2017.");
    // Attribution and context ride in jsonb, so these assert the path
    // extraction still lands on the fields the page renders.
    expect(page?.speaker).toBe("Hon Sample Minister");
    expect(page?.speakerAffiliation).toBe("said in the House");
    expect(page?.attachedProposal).toBe("tougher sentencing");
    expect(page?.verdictClass).toBe("refuted");
    expect(page?.confidence).toBeCloseTo(0.72);
    expect(page?.verdictVersion).toBe(1);
    expect(page?.verdictStatus).toBe("PUBLISHED");
    // The trail's first anchor: when the claim was MADE, not when we ingested it.
    expect(page?.claimMadeAt?.toISOString()).toBe("2026-09-08T00:00:00.000Z");
    expect(page?.justifications).toEqual(["Series shows 12% not 30%."]);
    expect(page?.nliOutcome).toBe("pass");

    expect(page?.evidence).toHaveLength(1);
    const item = page?.evidence[0];
    expect(item?.authorityRef).toBe("statsnz");
    expect(item?.seriesIdentity).toBe("cpil1q");
    // Vintage is the reference period, rendered as a date — never a timestamp
    // and never the retrieval time (STO-R3).
    expect(item?.vintageDate).toBe("2026-06-30");
    expect(item?.plainReason).toBe("Series shows 12% not 30%.");
    expect(item?.tier).toBe(3);
    expect(item?.retrievedAt).toBeInstanceOf(Date);
  });

  it("reports the pack the CURRENT verdict pins, not an earlier pack for the claim", async () => {
    const claim = await seedClaim();
    const first = await store.appendEvidencePack(claim.claimId, {
      itemRefs: [],
      justifications: ["first pass"],
      nliOutcome: "fail",
    });
    const v1 = await store.writeVerdict(claim.claimId, first.packId, {
      provenance: provenance(),
      verdictClass: "not_enough_evidence",
      confidence: 0.4,
    });
    await store.logTransition(v1.verdictId, { from: "DRAFT", to: "PUBLISHED" });

    const second = await store.appendEvidencePack(claim.claimId, {
      itemRefs: [],
      justifications: ["second pass"],
      nliOutcome: "pass",
    });
    await store.writeVerdict(claim.claimId, second.packId, {
      provenance: provenance(),
      verdictClass: "supported",
      confidence: 0.9,
    });

    const page = await reader.getVerdictPage(claim.claimId);
    // v2 is the latest version and still DRAFT — visible (the page prints the
    // state) — and its reasoning, check time and audit outcome are the pack's.
    // Reading by pack_id order would have reported the first pack's "fail".
    expect(page?.verdictVersion).toBe(2);
    expect(page?.verdictStatus).toBe("DRAFT");
    expect(page?.justifications).toEqual(["second pass"]);
    expect(page?.nliOutcome).toBe("pass");
    // A pack with no items still reports its own metadata (the trail's "second
    // pass" line is about the reasoning, not about the sources).
    expect(page?.checkedAt).toBeInstanceOf(Date);
    expect(page?.evidence).toEqual([]);
  });

  it("hides a claim whose latest verdict is not public (FROZEN)", async () => {
    const claim = await seedClaim();
    const pack = await store.appendEvidencePack(claim.claimId, {
      itemRefs: [],
      justifications: [],
      nliOutcome: "pass",
    });
    const verdict = await store.writeVerdict(claim.claimId, pack.packId, {
      provenance: provenance(),
      verdictClass: "supported",
      confidence: 0.9,
    });
    await store.logTransition(verdict.verdictId, { from: "DRAFT", to: "PUBLISHED" });
    await store.logTransition(verdict.verdictId, { from: "PUBLISHED", to: "FROZEN" });

    expect(await reader.getVerdictPage(claim.claimId)).toBeNull();
  });

  it("feeds only visible claims, latest verdict first, with a full-page hasMore", async () => {
    const entries = await reader.getFeed(0, 50);
    expect(entries.entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.hasMore).toBe(false);
    for (const entry of entries.entries) {
      expect(typeof entry.claimText).toBe("string");
      expect(entry.publishedAt).toBeInstanceOf(Date);
    }

    const one = await reader.getFeed(0, 1);
    expect(one.entries).toHaveLength(1);
    expect(one.hasMore).toBe(true);
    expect(one.entries[0]?.claimId).toBe(entries.entries[0]?.claimId);
  });
});
