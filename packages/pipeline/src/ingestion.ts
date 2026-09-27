// Ingestion: shared lane shape (INGESTION §2.1) — fetch, parse, normalise,
// dedupe, document record. Lanes share stages but run as separate workers
// (ADR-0006); every stage is re-runnable and emits provenance, never bare text.

import { createHash } from "node:crypto";
import type { Server } from "node:http";
import { createServer } from "node:http";
import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

// Rate-budget harness contract (test support): scripted responses + request
// counting so lane fetch tests assert bounded retries without live egress.
export interface RateBudgetScript {
  /** Ordered responses per request; the last one repeats. */
  responses: Array<{ status: number; body?: string; headers?: Record<string, string> }>;
}

export interface RateBudgetServer {
  url: string;
  stop(): Promise<void>;
  requestCount(): number;
}

// ---------- feed parsing (Tier 1) ----------

const RssGuid = z.union([
  z.string(),
  z.object({ "#text": z.string() }),
  z.object({ _text: z.string() }),
]);
const RssItem = z.object({
  guid: RssGuid,
  link: z.string(),
  title: z.string(),
  pubDate: z.string(),
  description: z.string().optional(),
});

const RssDocument = z.object({
  rss: z.object({
    channel: z.object({
      item: z.union([RssItem, z.array(RssItem)]).optional(),
    }),
  }),
});

export interface FeedItem {
  guid: string;
  link: string;
  title: string;
  publishedAt: Date;
  description: string;
}

export function parseFeed(xml: string): FeedItem[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "_",
    parseTagValue: false,
    trimValues: true,
  });
  let raw: unknown;
  try {
    raw = parser.parse(xml);
  } catch (e) {
    throw new Error(`feed parse error: ${(e as Error).message}`);
  }
  const result = RssDocument.safeParse(raw);
  if (!result.success) {
    throw new Error(`feed parse error: shape mismatch (${result.error.issues.length} problems)`);
  }
  const rawItems = result.data.rss.channel.item;
  const list = rawItems == null ? [] : Array.isArray(rawItems) ? rawItems : [rawItems];
  return list.map((item) => ({
    guid:
      typeof item.guid === "string"
        ? item.guid
        : "#text" in item.guid
          ? item.guid["#text"]
          : item.guid._text,
    link: item.link,
    title: item.title,
    publishedAt: new Date(item.pubDate),
    description: item.description ?? "",
  }));
}

// ---------- lane health (ING-R1) ----------

export function assertLaneHealthy(state: {
  itemsSeen: number;
  httpStatus: number;
  lastNewItemAgeHours?: number;
  stalenessBandHours?: number;
}): void {
  if (state.httpStatus !== 200) {
    throw new Error(`lane unhealthy: HTTP ${state.httpStatus}`);
  }
  if (state.itemsSeen === 0) {
    throw new Error("lane alarm: 200-but-zero-items feed (distinct from a dead feed)");
  }
  if (
    state.lastNewItemAgeHours != null &&
    state.stalenessBandHours != null &&
    state.lastNewItemAgeHours > state.stalenessBandHours
  ) {
    throw new Error(
      `lane stale: last new item ${state.lastNewItemAgeHours}h ago exceeds band ${state.stalenessBandHours}h`,
    );
  }
}

// ---------- article extraction (Tier 1 readability) ----------

export interface ExtractedDocument {
  title: string;
  text: string;
  canonicalUrl: string;
}

const BOT_WALL = /verify you are human|access denied|are you a robot|checking your browser/i;

// Genuine double-encoding is an entity that decodes to ANOTHER entity:
// `&amp;amp;` -> `&amp;`, `&amp;auml;` -> `&auml;`, `&amp;#39;` -> `&#39;`. The
// previous pattern (`/&amp;[a-zA-Z#]/`) also matched *correct* escaping — a
// venue name (`M&amp;T Stadium`) and every query-string separator
// (`?u=...&amp;id=...`) — so it rejected real RNZ pages whose markup was never
// corrupt, and the lane could not extract a single article (ING-R8, Sept 2026).
const DOUBLE_ENCODED = /&amp;(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});/;

export function extractArticle(html: string, canonicalUrl: string): ExtractedDocument {
  const $ = cheerio.load(html);
  if (BOT_WALL.test($.text())) {
    throw new Error("extract error: bot-wall response, not article content");
  }
  // Detect double-encoding on the RAW input, not the re-serialised DOM:
  // cheerio decodes entities on parse and re-encodes minimally on output, so
  // an escaped entity inside the source (`&amp;amp;`) disappears from
  // $.html() and the corruption would slip through silently (ING-R8).
  if (DOUBLE_ENCODED.test(html)) {
    throw new Error("extract error: encoding violation — double-encoded entities in source");
  }
  const title = $("article h1").first().text() || $("h1").first().text();
  const paragraphs: string[] = [];
  $("article p").each((_, el) => {
    paragraphs.push($(el).text());
  });
  $("article table tr").each((_, tr) => {
    const cells = $(tr)
      .find("th,td")
      .map((__, c) => $(c).text())
      .get();
    if (cells.length > 0) paragraphs.push(cells.join(": "));
  });
  const text = paragraphs.join("\n");
  if (text.length === 0) {
    throw new Error(
      "extract error: empty extraction from known-nonempty document (the AVeriTeC 297/500 failure mode)",
    );
  }
  return { title, text, canonicalUrl };
}

// ---------- captions (VTT/SRT → cue-preserving text) ----------

export interface CaptionTrack {
  cues: Array<{ startS: number; endS: number; speaker: string | null; text: string }>;
  text: string;
}

const SKIP_LINE = /^(WEBVTT|Kind:|Language:|\d+)$/;

export function parseCaptions(vttOrSrt: string): CaptionTrack {
  const body = vttOrSrt.trim();
  if (body === "WEBVTT" || body.length === 0) {
    throw new Error(
      "caption parse error: empty transcript — flagged degraded, never treated as clean text",
    );
  }
  const cues: CaptionTrack["cues"] = [];
  let current: { startS: number; endS: number; speaker: string | null; text: string } | null = null;
  for (const line of body.split(/\r?\n/)) {
    const longMatch = line.match(
      /^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})\s+-->\s+(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})$/,
    );
    const shortMatch = line.match(
      /^(\d{1,2}):(\d{2})[.,](\d{3})\s+-->\s+(\d{1,2}):(\d{2})[.,](\d{3})$/,
    );
    if (longMatch) {
      if (current) cues.push(current);
      current = {
        startS:
          Number(longMatch[1]) * 3600 +
          Number(longMatch[2]) * 60 +
          Number(longMatch[3]) +
          Number(longMatch[4]) / 1000,
        endS:
          Number(longMatch[5]) * 3600 +
          Number(longMatch[6]) * 60 +
          Number(longMatch[7]) +
          Number(longMatch[8]) / 1000,
        speaker: null,
        text: "",
      };
      continue;
    }
    if (shortMatch) {
      if (current) cues.push(current);
      current = {
        startS: Number(shortMatch[1]) * 60 + Number(shortMatch[2]) + Number(shortMatch[3]) / 1000,
        endS: Number(shortMatch[4]) * 60 + Number(shortMatch[5]) + Number(shortMatch[6]) / 1000,
        speaker: null,
        text: "",
      };
      continue;
    }
    const trimmed = line.trim();
    if (current && trimmed.length > 0 && !SKIP_LINE.test(trimmed)) {
      const turn = trimmed.match(/^([A-Z][A-Za-z0-9' ]+?):\s*(.*)$/);
      const speaker = turn?.[1];
      const turnText = turn?.[2];
      if (speaker !== undefined && turnText !== undefined && current.speaker === null) {
        current.speaker = speaker.trim();
        current.text = turnText;
      } else {
        current.text = current.text.length === 0 ? trimmed : `${current.text}\n${trimmed}`;
      }
    }
  }
  if (current) cues.push(current);
  if (cues.length === 0) {
    throw new Error("caption parse error: no cues found in track");
  }
  const text = cues.map((c) => (c.speaker ? `${c.speaker}: ${c.text}` : c.text)).join("\n");
  return { cues, text };
}

// ---------- caption track tiering (ING-R3) ----------

const CaptionTracksPayload = z.object({
  captions: z
    .object({
      playerCaptionsTracklistRenderer: z.object({
        captionTracks: z
          .array(
            z.object({
              baseUrl: z.string(),
              languageCode: z.string(),
              kind: z.string().optional(),
            }),
          )
          .optional(),
      }),
    })
    .optional(),
});

export type CaptionTier = "publisher-reviewed" | "publisher-auto";

export interface CaptionTierResolution {
  tier: CaptionTier;
  trackUrl: string;
  derivedFrom: "track-metadata-kind-asr" | "track-metadata-kind-absent";
}

export function resolveCaptionTier(captionTracksJson: string): CaptionTierResolution {
  const result = CaptionTracksPayload.safeParse(JSON.parse(captionTracksJson));
  if (!result.success) {
    throw new Error(`captionTracks payload malformed: ${result.error.message}`);
  }
  const tracks = result.data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (tracks.length === 0) {
    throw new Error(
      "no captions on this item — explicitly out of scope, no silent empty transcript",
    );
  }
  const manual = tracks.find((t) => t.kind !== "asr");
  if (manual) {
    return {
      tier: "publisher-reviewed",
      trackUrl: manual.baseUrl,
      derivedFrom: "track-metadata-kind-absent",
    };
  }
  const asr = tracks[0];
  if (asr) {
    return {
      tier: "publisher-auto",
      trackUrl: asr.baseUrl,
      derivedFrom: "track-metadata-kind-asr",
    };
  }
  throw new Error("no usable caption track metadata — out of scope");
}

// ---------- media anchors (ING-R4) ----------

export interface MediaAnchor {
  mediaUrl: string;
  startS: number;
  endS: number;
  deepLink: string;
}

export function buildMediaAnchor(input: {
  videoId: string;
  startS: number;
  endS: number | null;
  padSeconds: number;
}): MediaAnchor {
  if (input.endS == null) {
    throw new Error(
      "media anchor error: missing end timestamp — refuse to publish a dead-end 'hear it' link",
    );
  }
  const startS = Math.max(0, input.startS - input.padSeconds);
  const endS = input.endS + input.padSeconds;
  const mediaUrl = `https://www.youtube.com/watch?v=${input.videoId}`;
  const end = Number.isInteger(endS) ? String(endS) : endS.toFixed(1);
  return { mediaUrl, startS, endS, deepLink: `${mediaUrl}&t=${startS}s&end=${end}s` };
}

// ---------- dedupe + hashing (ING-R5/R6, STO-R13) ----------

export function dedupeKey(input: { guid: string; canonicalUrl: string; content: string }): string {
  return createHash("sha256")
    .update(`${input.guid}\n${input.canonicalUrl}\n${input.content}`)
    .digest("hex");
}

export function computeContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// ---------- fetch with bounded retries + budget (ING-R7) ----------

export interface FetchBudgetResult {
  status: number;
  degraded: boolean;
  botWall: boolean;
  text?: string;
}

export async function fetchWithBudget(
  url: string,
  opts: { maxAttempts: number },
): Promise<FetchBudgetResult> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    const response = await fetch(url);
    lastStatus = response.status;
    if (response.status === 429 || response.status >= 500) {
      continue;
    }
    if (response.status === 200) {
      const text = await response.text();
      if (BOT_WALL.test(text) || /<title>Access Denied<\/title>/i.test(text)) {
        return { status: lastStatus, degraded: true, botWall: true };
      }
      return { status: lastStatus, degraded: false, botWall: false, text };
    }
    return { status: lastStatus, degraded: true, botWall: false };
  }
  return { status: lastStatus, degraded: true, botWall: false };
}

// ---------- rate-budget fixture server (test support) ----------
// Node http.createServer (not a runtime-specific server API): the suite runs under
// vitest/Node and must not couple test infrastructure to a specific runtime (CRO-R15 parity).

export async function startRateBudgetServer(
  port: number,
  script: RateBudgetScript,
): Promise<RateBudgetServer> {
  let count = 0;
  const server: Server = createServer((_req, res) => {
    const step = script.responses[Math.min(count, script.responses.length - 1)];
    count++;
    res.writeHead(step?.status ?? 500, step?.headers ?? {});
    res.end(step?.body ?? "");
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  return {
    url: `http://127.0.0.1:${actualPort}/`,
    requestCount: () => count,
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// ---------- institution lane — The Kākā (Substack JSON feed) ----------

const KakaaItem = z.object({
  id: z.string(),
  url: z.string().optional(),
  title: z.string(),
  content_html: z.string().optional(),
  content_text: z.string().optional(),
  date_published: z.string(),
  author: z.object({ name: z.string() }).optional(),
});

const KakaaFeed = z.object({
  version: z.string(),
  title: z.string(),
  items: z.array(KakaaItem),
});

export interface InstitutionFeedItem {
  id: string;
  title: string;
  text: string;
  publishedAt: Date;
  paywalled: boolean;
  quotedClaimOnly: boolean;
  attributionCandidate: { name: string; kind: "institution" };
}

export const INSTITUTION_LANE = {
  parseFeed(json: string): InstitutionFeedItem[] {
    const result = KakaaFeed.safeParse(JSON.parse(json));
    if (!result.error) {
      return result.data.items.map((item) => {
        const paywalled =
          /(paid|subscribe to read)/i.test(item.title) ||
          (item.content_text?.includes("Subscribe") ?? false);
        const text = item.content_html
          ? item.content_html
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
          : (item.content_text ?? "");
        return {
          id: item.id,
          title: item.title,
          text,
          publishedAt: new Date(item.date_published),
          paywalled,
          quotedClaimOnly: paywalled,
          attributionCandidate: { name: "The Kākā", kind: "institution" as const },
        };
      });
    }
    const legacy = JSON.parse(json) as { items?: unknown[] };
    if (Array.isArray(legacy.items)) {
      return legacy.items.map((raw) => {
        const item = raw as {
          id: string;
          title: string;
          content_html?: string;
          content_text?: string;
          date_published: string;
        };
        const text = (item.content_html ?? item.content_text ?? "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        return {
          id: item.id,
          title: item.title,
          text,
          publishedAt: new Date(item.date_published),
          paywalled: false,
          quotedClaimOnly: false,
          attributionCandidate: { name: "The Kākā", kind: "institution" as const },
        };
      });
    }
    throw new Error("institution feed parse error: unrecognised shape");
  },
};

export interface InstitutionFeedItem {
  id: string;
  title: string;
  text: string;
  publishedAt: Date;
  paywalled: boolean;
  quotedClaimOnly: boolean;
  attributionCandidate: { name: string; kind: "institution" };
}

// ---------- false-context curated set (ING-R10) ----------

const FalseContextItem = z.object({
  fixture_id: z.string(),
  item_url: z.string(),
  media_url: z.string(),
  claimed_context: z.string(),
  verified_context: z.string(),
  claim_text: z.string(),
  provenance_notes: z.string(),
  source_urls: z.array(z.string()),
});

const FalseContextFile = z.object({
  version: z.number(),
  description: z.string(),
  licence_status: z.string(),
  items: z.array(FalseContextItem),
});

export interface FalseContextSet {
  isCuratedFixture: true;
  items: Array<{
    fixtureId: string;
    itemUrl: string;
    mediaUrl: string;
    claimedContext: string;
    verifiedContext: string;
    claimText: string;
    provenanceNotes: string;
    sourceUrls: string[];
  }>;
  laneHealthKey: undefined;
}

export function loadFalseContextSet(json: string): FalseContextSet {
  const result = FalseContextFile.safeParse(JSON.parse(json));
  if (!result.success) {
    throw new Error(`false-context set malformed: ${result.error.message}`);
  }
  return {
    isCuratedFixture: true,
    laneHealthKey: undefined,
    items: result.data.items.map((item) => ({
      fixtureId: item.fixture_id,
      itemUrl: item.item_url,
      mediaUrl: item.media_url,
      claimedContext: item.claimed_context,
      verifiedContext: item.verified_context,
      claimText: item.claim_text,
      provenanceNotes: item.provenance_notes,
      sourceUrls: item.source_urls,
    })),
  };
}
