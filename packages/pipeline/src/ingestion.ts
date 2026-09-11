// Ingestion: shared lane shape (INGESTION §2.1) — fetch, parse, normalise,
// dedupe, document record. Implementation follows the failing tests; this
// contract file carries the types the tests reference.

import type { RateBudgetScript, RateBudgetServer } from "../fixtures/rate-budget-server.ts";

export interface FeedItem {
  guid: string;
  link: string;
  title: string;
  publishedAt: Date;
  description: string;
}

export function parseFeed(xml: string): FeedItem[] {
  throw new Error("parseFeed: not implemented — Ingestion phase");
}

export function assertLaneHealthy(state: { itemsSeen: number; httpStatus: number; lastNewItemAgeHours?: number; stalenessBandHours?: number }): void {
  throw new Error("assertLaneHealthy: not implemented — Ingestion phase");
}

export interface ExtractedDocument {
  title: string;
  text: string;
  canonicalUrl: string;
}

export function extractArticle(html: string, canonicalUrl: string): ExtractedDocument {
  throw new Error("extractArticle: not implemented — Ingestion phase");
}

export interface CaptionTrack {
  cues: Array<{ startS: number; endS: number; speaker: string | null; text: string }>;
  text: string;
}

export function parseCaptions(vttOrSrt: string): CaptionTrack {
  throw new Error("parseCaptions: not implemented — Ingestion phase");
}
export async function startRateBudgetServer(port: number, script: RateBudgetScript): Promise<RateBudgetServer> {
  throw new Error("startRateBudgetServer: not implemented — Ingestion phase");
}

export type CaptionTier = "publisher-reviewed" | "publisher-auto";

export interface CaptionTierResolution {
  tier: CaptionTier;
  trackUrl: string;
  derivedFrom: "track-metadata-kind-asr" | "track-metadata-kind-absent";
}

export function resolveCaptionTier(captionTracksJson: string): CaptionTierResolution {
  throw new Error("resolveCaptionTier: not implemented — Ingestion phase");
}

export interface MediaAnchor {
  mediaUrl: string;
  startS: number;
  endS: number;
  deepLink: string;
}

export function buildMediaAnchor(input: { videoId: string; startS: number; endS: number | null; padSeconds: number }): MediaAnchor {
  throw new Error("buildMediaAnchor: not implemented — Ingestion phase");
}

export function dedupeKey(input: { guid: string; canonicalUrl: string; content: string }): string {
  throw new Error("dedupeKey: not implemented — Ingestion phase");
}

export function computeContentHash(content: string): string {
  throw new Error("computeContentHash: not implemented — Ingestion phase");
}

export async function fetchWithBudget(url: string, opts: { maxAttempts: number }): Promise<{ degraded: boolean; botWall: boolean; text?: string; status: number }> {
  throw new Error("fetchWithBudget: not implemented — Ingestion phase");
}

export const INSTITUTION_LANE = {
  parseFeed(json: string): Array<{
    id: string;
    title: string;
    text: string;
    publishedAt: Date;
    paywalled: boolean;
    quotedClaimOnly: boolean;
    attributionCandidate: { name: string; kind: "institution" };
  }> {
    throw new Error("INSTITUTION_LANE.parseFeed: not implemented — Ingestion phase");
  },
};

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
  throw new Error("loadFalseContextSet: not implemented — Ingestion phase");
}