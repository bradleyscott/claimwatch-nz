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
import { isEligibleSpeakership } from "./speakership.ts";
import { createTestStore } from "./store.ts";
import type { ClaimFixture, Store } from "./store-api.ts";
import { TriageRecord } from "./triage-record.ts";

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
// Distinct content hashes for the documents the fixtures come from
// (`publication.content_hash` is unique — STO-R13).
let publicationSeq = 0;

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

async function seedClaim(overrides: Partial<ClaimFixture> = {}, documented = true) {
  // By default the claim carries the document it came from: that is what the
  // site serves, so the fixtures represent the public record rather than the
  // evaluation corpus. `documented: false` is the corpus case, asserted below.
  let publicationId: string | undefined;
  if (documented) {
    publicationSeq += 1;
    const publication = await store.recordPublication({
      ...store.fixtures.beehiveRelease(),
      // `publication.content_hash` is unique (STO-R13), so each fixture document
      // needs its own hash.
      contentHash: `hash-claim-${publicationSeq}`,
    });
    publicationId = publication.publicationId;
  }
  return store.recordClaim({
    ...(publicationId ? { publicationId } : {}),
    utteranceText: "Crime is up 30% since 2017.",
    text: "Crime is up 30% since 2017.",
    claimType: "statistical",
    // Eligible by default: the site serves claims that are in scope (ADR-0019),
    // so the fixtures are in scope — with a COMPLETE decision — unless a test
    // says otherwise. The gate requires the method and genre too, because the
    // page has to disclose how the claim was attributed.
    speakershipClass: "quoted-actor",
    speakershipMethod: "structural",
    genre: "transcript",
    discourseContext: {
      window: "…in the context of law and order debate…",
      attachedProposal: "tougher sentencing",
      speechContext: "said in the House",
    },
    attributionCandidates: [{ name: "Hon Sample Minister", kind: "person", confidence: 0.9 }],
    spokenAt: new Date("2026-09-08T00:00:00Z"),
    ...overrides,
  });
}

/** A published verdict, returned with its id so a test can drive the lifecycle on. */
async function publishVerdictWithId(overrides: Partial<ClaimFixture> = {}) {
  const claim = await seedClaim(overrides);
  const pack = await store.appendEvidencePack(claim.claimId, {
    itemRefs: [],
    justifications: [],
    nliOutcome: "pass",
  });
  const verdict = await store.writeVerdict(claim.claimId, pack.packId, {
    provenance: provenance(),
    verdictClass: "refuted",
  });
  await store.logTransition(verdict.verdictId, { from: "DRAFT", to: "PUBLISHED" });
  return { claim, verdictId: verdict.verdictId };
}

/** A published verdict, so the claim has a page to read at all. */
async function publishVerdict(claimId: string): Promise<void> {
  const pack = await store.appendEvidencePack(claimId, {
    itemRefs: [],
    justifications: [],
    nliOutcome: "pass",
  });
  const verdict = await store.writeVerdict(claimId, pack.packId, {
    provenance: provenance(),
    verdictClass: "refuted",
  });
  await store.logTransition(verdict.verdictId, { from: "DRAFT", to: "PUBLISHED" });
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

  it("carries the verification mode and the triage record, and leaves both absent when unrecorded", async () => {
    // Recorded: the two things the mode-aware "how this verdict was made"
    // section is selected by and justified from.
    const recorded = await seedClaim({
      verificationMode: "stat-grid",
      triageRecord: {
        sentencesRead: 12,
        checked: 3,
        setAside: [
          { sentenceText: "We will deliver growth.", rejectionClass: "pledge-conditional" },
        ],
        held: [{ sentenceText: "Housing will be fixed.", reason: "no deadline has passed" }],
      },
    });
    await publishVerdict(recorded.claimId);

    const page = await reader.getVerdictPage(recorded.claimId);
    expect(page?.verificationMode).toBe("stat-grid");
    expect(page?.triageRecord?.sentencesRead).toBe(12);
    expect(page?.triageRecord?.checked).toBe(3);
    // Verbatim, not paraphrased: the disclosure is only checkable against the
    // source document if the sentence is the source's own text.
    expect(page?.triageRecord?.setAside[0]?.sentenceText).toBe("We will deliver growth.");
    expect(page?.triageRecord?.setAside[0]?.rejectionClass).toBe("pledge-conditional");
    expect(page?.triageRecord?.held[0]?.reason).toBe("no deadline has passed");

    // Unrecorded: every row ingested before the columns existed behaves this
    // way (there is no backfill), and the page must omit both sections rather
    // than guess a mode or render an empty "nothing was set aside".
    const bare = await seedClaim();
    await publishVerdict(bare.claimId);
    const barePage = await reader.getVerdictPage(bare.claimId);
    expect(barePage?.verificationMode).toBeNull();
    expect(barePage?.triageRecord).toBeNull();
  });

  it("defaults the triage lists when a record omits them", async () => {
    // The page prints counts AND lists. An interview where nothing was set
    // aside is a real, reportable state, so the schema fills the arrays rather
    // than rejecting the record — and the stored jsonb is whatever was written,
    // so the READ side has to tolerate a record that predates a list field.
    // Both halves are asserted here: the parse rule, then the round trip.
    const partial = TriageRecord.parse({ sentencesRead: 4, checked: 1 });
    expect(partial.setAside).toEqual([]);
    expect(partial.held).toEqual([]);

    const claim = await seedClaim({ verificationMode: "citation-check", triageRecord: partial });
    await publishVerdict(claim.claimId);
    const page = await reader.getVerdictPage(claim.claimId);
    expect(page?.triageRecord?.checked).toBe(1);
    expect(page?.triageRecord?.setAside).toEqual([]);
    expect(page?.triageRecord?.held).toEqual([]);
  });

  it("serves only records with document provenance, and the corpus on request", async () => {
    // The public default. On 2026-09-13 the live store served 26 published
    // verdicts of which 25 had no publication and 19 cited no evidence: the feed
    // showed one claim text up to twelve times with contradictory classes, all
    // of it AVeriTeC evaluation rows written straight into the live store by a
    // slice script. This gate is what keeps that corpus out of the public record
    // without deleting it — the harness and our own inspection still read it
    // through `includeIneligible` (ING-R10's "fixture records treated as a
    // production lane", arriving at the site).
    const documented = await seedClaim();
    await publishVerdict(documented.claimId);
    const unprovenanced = await seedClaim({}, false);
    await publishVerdict(unprovenanced.claimId);

    // A page for a record with no document behind it does not exist publicly...
    expect(await reader.getVerdictPage(unprovenanced.claimId)).toBeNull();
    expect((await reader.getVerdictPage(documented.claimId))?.claimId).toBe(documented.claimId);
    // ...and the escape hatch is explicit rather than implicit.
    expect(
      (await reader.getVerdictPage(unprovenanced.claimId, { includeIneligible: true }))?.claimId,
    ).toBe(unprovenanced.claimId);

    // The feed and the page make the SAME decision — a claim listable but not
    // readable is worse than either.
    const publicFeed = await reader.getFeed(0, 100);
    expect(publicFeed.entries.map((e) => e.claimId)).toContain(documented.claimId);
    expect(publicFeed.entries.map((e) => e.claimId)).not.toContain(unprovenanced.claimId);
    const corpus = await reader.getFeed(0, 100, { includeIneligible: true });
    expect(corpus.entries.map((e) => e.claimId)).toContain(unprovenanced.claimId);
    expect(corpus.entries.length).toBeGreaterThan(publicFeed.entries.length);
  });

  it("publishes only positively in-scope speakership, and fails closed on unclassified claims", async () => {
    // ADR-0019's scope rule, enforced where it cannot be skipped. The first live
    // lane published a verdict about RNZ's own narration — a compound sentence
    // the reporter synthesised, with no speaker — so `outlet-prose` must not
    // reach the public record even though the row exists, is published, and has
    // a document behind it.
    const outletProse = await seedClaim({ speakershipClass: "outlet-prose" });
    await publishVerdict(outletProse.claimId);
    const unresolved = await seedClaim({ speakershipClass: "unresolved" });
    await publishVerdict(unresolved.claimId);
    const authorClaim = await seedClaim({ speakershipClass: "author-claim" });
    await publishVerdict(authorClaim.claimId);
    // No decision recorded at all — the state every row ingested before
    // ADR-0019 is in, and the state the live store's 29 claims are in.
    const unclassified = await seedClaim({ speakershipClass: null });
    await publishVerdict(unclassified.claimId);

    // Eligible classes publish; ineligible ones are recorded but never served.
    expect((await reader.getVerdictPage(authorClaim.claimId))?.claimId).toBe(authorClaim.claimId);
    expect(await reader.getVerdictPage(outletProse.claimId)).toBeNull();
    expect(await reader.getVerdictPage(unresolved.claimId)).toBeNull();
    // Fail CLOSED: unclassified is not "probably fine". A claim has to be
    // positively classified in scope, not merely never judged out of it —
    // otherwise publishing is the default and the ADR-0019 defect returns
    // through the back door of an older writer.
    expect(await reader.getVerdictPage(unclassified.claimId)).toBeNull();

    // The class reaches the read model, so the page can say how a claim was
    // attributed (ADR-0019 §5) rather than guessing from the speaker string.
    const page = await reader.getVerdictPage(authorClaim.claimId);
    expect(page?.speakershipClass).toBe("author-claim");
    expect(page?.speakershipMethod).toBe("structural");
    expect(page?.genre).toBe("transcript");
    expect(
      (await reader.getVerdictPage(outletProse.claimId, { includeIneligible: true }))
        ?.speakershipClass,
    ).toBe("outlet-prose");
  });

  it("requires a COMPLETE scope decision — a class with no method or genre does not publish", async () => {
    // ADR-0019 §5 makes the page disclose how a claim was attributed, and §2 says
    // the rule is genre-dependent. So an in-scope class with no provenance is not
    // a publishable decision: it is a claim whose confidence and rule-selection
    // cannot be stated. This is also the guard against a lane asserting a class
    // purely to make a page render — the class alone is not enough.
    const noMethod = await seedClaim({
      speakershipClass: "quoted-actor",
      speakershipMethod: null,
    });
    await publishVerdict(noMethod.claimId);
    const noGenre = await seedClaim({ speakershipClass: "author-claim", genre: null });
    await publishVerdict(noGenre.claimId);

    expect(await reader.getVerdictPage(noMethod.claimId)).toBeNull();
    expect(await reader.getVerdictPage(noGenre.claimId)).toBeNull();
    // ...and they are only hidden by the gate, not broken: the corpus view shows
    // the half-recorded decision rather than pretending it is not there.
    expect(
      (await reader.getVerdictPage(noMethod.claimId, { includeIneligible: true }))
        ?.speakershipClass,
    ).toBe("quoted-actor");
    expect(
      (await reader.getVerdictPage(noGenre.claimId, { includeIneligible: true }))?.genre,
    ).toBeNull();
  });

  it("the SQL gate and the speakership rule agree — one rule, two expressions", async () => {
    // `isEligibleSpeakership` states the rule in TypeScript; the reader states it
    // in SQL (`inArray` + two `isNotNull`s). Two expressions of one rule drift
    // silently, and the helper alone is unreachable — nothing calls it, because
    // the filter has to run in the database to paginate. This is where they meet:
    // every combination that matters is seeded, then both are asked the same
    // question and must give the same answer. Without this, adding a required
    // field to one expression and not the other would publish the difference.
    const cases: Partial<ClaimFixture>[] = [
      // Eligible on both counts.
      { speakershipClass: "quoted-actor", speakershipMethod: "structural", genre: "transcript" },
      {
        speakershipClass: "author-claim",
        speakershipMethod: "classified",
        genre: "opinion-analysis",
      },
      // Class recorded, but out of scope: recorded, never verified (ADR-0019 §1).
      { speakershipClass: "outlet-prose", speakershipMethod: "classified", genre: "news-report" },
      { speakershipClass: "unresolved", speakershipMethod: "classified", genre: "news-report" },
      // A half-recorded decision: in-scope class, no provenance for it.
      { speakershipClass: "quoted-actor", speakershipMethod: null, genre: "transcript" },
      { speakershipClass: "quoted-actor", speakershipMethod: "structural", genre: null },
      // No decision at all — every row ingested before ADR-0019.
      { speakershipClass: null, speakershipMethod: null, genre: null },
    ];

    for (const fixture of cases) {
      const claim = await seedClaim(fixture);
      await publishVerdict(claim.claimId);
      const served = (await reader.getVerdictPage(claim.claimId)) !== null;
      expect(served, `SQL gate disagrees with the rule for ${JSON.stringify(fixture)}`).toBe(
        isEligibleSpeakership({
          speakershipClass: fixture.speakershipClass ?? null,
          speakershipMethod: fixture.speakershipMethod ?? null,
          genre: fixture.genre ?? null,
        }),
      );
    }
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

  // SITE-MVP §2.3 makes these reachable in prose — "a FROZEN verdict is a fact the
  // reader should meet on the page, not in a footnote" — and STORE §3 says
  // contested verdicts render "contested — under review", while the reader served
  // DRAFT and PUBLISHED only. The consequence was that the 5 Nov freeze would
  // remove live pages (Sept 2026). The page prints `state ${status}`, so serving
  // them required no site change.
  it("serves a frozen verdict, so the freeze cannot remove a live page", async () => {
    const { claim, verdictId } = await publishVerdictWithId();
    await store.logTransition(verdictId, { from: "PUBLISHED", to: "FROZEN" });

    const page = await reader.getVerdictPage(claim.claimId);
    expect(page?.verdictStatus).toBe("FROZEN");
    // One constant gates the feed too, so a frozen claim stays listable — the
    // decision was about reachability, not just page rendering.
    const feed = await reader.getFeed(0, 50);
    expect(feed.entries.map((e) => e.claimId)).toContain(claim.claimId);
  });

  it("serves a contested verdict, which the page renders as under review (STORE §3)", async () => {
    const { claim, verdictId } = await publishVerdictWithId();
    await store.logTransition(verdictId, { from: "PUBLISHED", to: "CONTESTED" });

    const page = await reader.getVerdictPage(claim.claimId);
    expect(page?.verdictStatus).toBe("CONTESTED");
  });

  it("still hides a claim whose latest verdict has no public rendering decision", async () => {
    // The filter keeps teeth. VALIDATING is reachable in the store's lifecycle
    // (PUBLISHED → CONTESTED → VALIDATING) but its public treatment is undecided,
    // so it is excluded by decision rather than by omission — STORE §6 open
    // question 11.
    const { claim, verdictId } = await publishVerdictWithId();
    await store.logTransition(verdictId, { from: "PUBLISHED", to: "CONTESTED" });
    await store.logTransition(verdictId, { from: "CONTESTED", to: "VALIDATING" });

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
