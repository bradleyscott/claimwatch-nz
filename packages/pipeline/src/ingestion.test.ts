// ING-R1..R14: the per-lane L1 contract. Authored before implementation
// (TDD red). Every LLM/search call is mocked or absent; fetches go to the
// rate-budget fixture server only (CRO-R6 — tests must never hit live APIs).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

// Contracts under test — implemented in this phase:
//   parseFeed, extractArticle, parseCaptions, resolveCaptionTier,
//   buildMediaAnchor, normaliseDocument, dedupeKey, hashContent,
//   startRateBudgetServer, createLane, KAKAA_INSTITUTION_LANE
import {
  assertLaneHealthy,
  buildMediaAnchor,
  computeContentHash,
  dedupeKey,
  extractArticle,
  fetchWithBudget,
  INSTITUTION_LANE,
  loadFalseContextSet,
  parseCaptions,
  parseFeed,
  resolveCaptionTier,
  startRateBudgetServer,
} from "./ingestion.ts";

describe("feed parsing (Tier 1)", () => {
  it("extracts items, GUIDs, links, dates from the Beehive feed", () => {
    const items = parseFeed(readFixture("beehive-feed.xml"));
    expect(items).toHaveLength(2);
    expect(items[0]?.guid).toBe(
      "https://www.beehive.govt.nz/release/government-boosts-flood-resilience",
    );
    expect(items[0]?.link).toContain("beehive.govt.nz");
    expect(items[0]?.publishedAt).toBeInstanceOf(Date);
    expect(items[1]?.title).toContain("Crime prevention");
  });

  it("extracts items from the RNZ feed", () => {
    const items = parseFeed(readFixture("rnz-feed.xml"));
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toContain("health funding");
  });

  it("flags a 200-but-zero-items feed as a distinct staleness alarm, not healthy (ING-R1)", () => {
    const items = parseFeed(readFixture("feed-200-zero-items.xml"));
    expect(items).toHaveLength(0);
    expect(() => assertLaneHealthy({ itemsSeen: 0, httpStatus: 200 })).toThrow(/zero-items/i);
  });

  it("flags a frozen feed as stale when last-new-item age exceeds the cadence (ING-R1)", () => {
    expect(() =>
      assertLaneHealthy({
        itemsSeen: 16,
        httpStatus: 200,
        lastNewItemAgeHours: 72,
        stalenessBandHours: 6,
      }),
    ).toThrow(/stale/i);
  });

  it("rejects malformed XML with a parse error, never silent empty extraction (ING-R2)", () => {
    expect(() => parseFeed(readFixture("feed-malformed.xml"))).toThrow(/parse/i);
  });
});

describe("article extraction (Tier 1 readability)", () => {
  it("extracts headline, body paragraphs, and the table from the Beehive release", () => {
    const doc = extractArticle(
      readFixture("beehive-release.html"),
      "https://www.beehive.govt.nz/release/government-boosts-flood-resilience",
    );
    expect(doc.title).toContain("flood resilience");
    expect(doc.text).toContain("$200 million");
    expect(doc.text).toContain("2024");
    expect(doc.text).toContain("$120m");
  });

  it("round-trips Māori macrons through HTML entities byte-exact (ING-R8)", () => {
    const doc = extractArticle(
      readFixture("rnz-article.html"),
      "https://www.rnz.co.nz/news/political/health-funding-record",
    );
    expect(doc.text).toContain("Tāpu");
  });

  it("detects double-encoded entities instead of silently corrupting (ING-R8)", () => {
    expect(() =>
      extractArticle(readFixture("rnz-article-double-encoded.html"), "https://www.rnz.co.nz/x"),
    ).toThrow(/encoding/i);
  });
});

describe("caption track tiering (ING-R3)", () => {
  it("kind:asr → publisher-auto (Tier 2)", () => {
    const tier = resolveCaptionTier(readFixture("captions-tracks-asr-only.json"));
    expect(tier.tier).toBe("publisher-auto");
  });

  it("manual English track without kind:asr → publisher-reviewed (Tier 1)", () => {
    const tier = resolveCaptionTier(readFixture("captions-tracks-manual-only.json"));
    expect(tier.tier).toBe("publisher-reviewed");
  });

  it("both tracks → prefer publisher-reviewed, never the ASR track", () => {
    const tier = resolveCaptionTier(readFixture("captions-tracks-both.json"));
    expect(tier.tier).toBe("publisher-reviewed");
    expect(tier.trackUrl).not.toContain("kind=asr");
  });

  it("no tracks → explicit out-of-scope, not a silent empty transcript", () => {
    expect(() => resolveCaptionTier(readFixture("captions-tracks-none.json"))).toThrow(
      /no captions/i,
    );
  });

  it("provenance is never defaulted: tier comes from the track's own metadata", () => {
    const asr = resolveCaptionTier(readFixture("captions-tracks-asr-only.json"));
    expect(asr.derivedFrom).toBe("track-metadata-kind-asr");
    const manual = resolveCaptionTier(readFixture("captions-tracks-manual-only.json"));
    expect(manual.derivedFrom).toBe("track-metadata-kind-absent");
  });
});

describe("caption parsing (VTT/SRT → cue-preserving text)", () => {
  it("preserves speaker turns and cue timestamps from VTT", () => {
    const track = parseCaptions(readFixture("captions-asr.vtt"));
    expect(track.cues.length).toBeGreaterThanOrEqual(5);
    expect(track.cues[0]?.startS).toBe(0);
    expect(track.text).toContain("Unemployment is at a record low");
    expect(track.text).toContain("young Maori");
  });

  it("parses SRT with the same cue structure", () => {
    const track = parseCaptions(readFixture("captions-asr.srt"));
    expect(track.cues.length).toBe(3);
    expect(track.cues[1]?.startS).toBeCloseTo(4.5, 1);
  });

  it("flags an empty transcript as degraded, never as clean text (ING-R2)", () => {
    expect(() => parseCaptions(readFixture("captions-empty.vtt"))).toThrow(/empty/i);
  });
});

describe("media_anchor construction (ING-R4)", () => {
  it("builds the anchor from cue span with padding and a t=/end= deep link", () => {
    const anchor = buildMediaAnchor({
      videoId: "qa1234567890",
      startS: 4.5,
      endS: 9.8,
      padSeconds: 2,
    });
    expect(anchor.mediaUrl).toBe("https://www.youtube.com/watch?v=qa1234567890");
    expect(anchor.startS).toBe(2.5);
    expect(anchor.endS).toBe(11.8);
    expect(anchor.deepLink).toContain("t=2");
  });

  it("rejects anchors with a missing end timestamp — never a dead-end link", () => {
    expect(() =>
      buildMediaAnchor({ videoId: "qa1234567890", startS: 4.5, endS: null, padSeconds: 2 }),
    ).toThrow(/end/i);
  });
});

describe("dedupe (ING-R5, R6)", () => {
  it("identical documents collapse to the same dedupe key", () => {
    const a = dedupeKey({ guid: "g1", canonicalUrl: "https://x/y", content: "same" });
    const b = dedupeKey({ guid: "g1", canonicalUrl: "https://x/y", content: "same" });
    expect(a).toBe(b);
    const different = dedupeKey({
      guid: "g1",
      canonicalUrl: "https://x/y",
      content: "different content",
    });
    expect(different).not.toBe(b);
  });

  it("content hash is stable across re-ingest (STO-R13 precondition)", () => {
    const h1 = computeContentHash(readFixture("rnz-article.html"));
    const h2 = computeContentHash(readFixture("rnz-article.html"));
    expect(h1).toBe(h2);
    expect(h1).not.toBe(computeContentHash(readFixture("beehive-release.html")));
  });
});

describe("institution lane — The Kākā (ING-R9)", () => {
  it("parses the Substack JSON feed with free + paid-truncated items", () => {
    const items = INSTITUTION_LANE.parseFeed(readFixture("kakaa-feed.json"));
    expect(items).toHaveLength(2);
    expect(items[0]?.paywalled).toBe(false);
    expect(items[1]?.paywalled).toBe(true);
    expect(items[1]?.text).toContain("Subscribe");
  });

  it("paid-tier truncated items carry the quoted-claim-only flag, never a full fetch (ING-R9)", () => {
    const items = INSTITUTION_LANE.parseFeed(readFixture("kakaa-feed.json"));
    const paid = items[1];
    expect(paid?.quotedClaimOnly).toBe(true);
  });

  it("carries the organisation attribution candidate (§3.2)", () => {
    const items = INSTITUTION_LANE.parseFeed(readFixture("kakaa-feed.json"));
    expect(items[0]?.attributionCandidate).toMatchObject({ name: "The Kākā", kind: "institution" });
  });
});

describe("false-context curated set (ING-R10)", () => {
  it("loads the versioned fixture set with provenance fields intact", () => {
    const set = loadFalseContextSet(readFixture("false-context-set.json"));
    expect(set.items).toHaveLength(2);
    expect(set.items[0]?.fixtureId).toBe("fc-001");
    expect(set.items[0]?.claimedContext).toContain("2026 storm");
    expect(set.items[0]?.verifiedContext).toContain("Cyclone Gabrielle");
    expect(set.isCuratedFixture).toBe(true);
  });

  it("curated fixtures are never lane-health-registered (no scheduler surface)", () => {
    const set = loadFalseContextSet(readFixture("false-context-set.json"));
    expect(set.laneHealthKey).toBeUndefined();
  });
});

describe("rate budget + bounded retries (ING-R7)", () => {
  it("stops retrying after 429 within the request budget", async () => {
    const server = await startRateBudgetServer(0, {
      responses: [
        { status: 429, body: "rate limited", headers: { "retry-after": "1" } },
        { status: 429, body: "rate limited" },
        { status: 429, body: "rate limited" },
      ],
    });
    try {
      const result = await fetchWithBudget(server.url, { maxAttempts: 3 });
      expect(result.degraded).toBe(true);
      expect(server.requestCount()).toBeLessThanOrEqual(3);
    } finally {
      await server.stop();
    }
  });

  it("treats a bot-wall 200 as a failure signal, not content (ING-R2/7)", async () => {
    const server = await startRateBudgetServer(0, {
      responses: [
        {
          status: 200,
          body: "<html><head><title>Access Denied</title></head><body>Verify you are human</body></html>",
          headers: {},
        },
      ],
    });
    try {
      const result = await fetchWithBudget(server.url, { maxAttempts: 2 });
      expect(result.botWall).toBe(true);
      expect(result.text).toBeUndefined();
    } finally {
      await server.stop();
    }
  });
});
