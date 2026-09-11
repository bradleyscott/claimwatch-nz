// Read-only store access for the site (SITE-MVP §3.1): the site is a reader
// over the typed store — the feedback table is the only write, and it lives
// behind an API route, not this module. Contract surface for tests; the live
// pool lands with the deployment slice.

import { z } from "zod";

export const VerdictPageData = z.object({
  claimId: z.string(),
  claimText: z.string(),
  speaker: z.string().nullable(),
  speakerAffiliation: z.string().nullable(),
  publishedAt: z.coerce.date(),
  verdictClass: z.enum([
    "supported",
    "refuted",
    "not_enough_evidence",
    "conflicting_cherry_picking",
  ]),
  confidence: z.number().min(0).max(1),
  attachedProposal: z.string().nullable(),
  mediaAnchor: z
    .object({ mediaUrl: z.string(), startS: z.number(), endS: z.number(), deepLink: z.string() })
    .nullable(),
  transcriptTier: z.string().nullable(),
  evidence: z.array(
    z.object({
      authorityRef: z.string(),
      seriesIdentity: z.string(),
      vintageDate: z.string(),
      plainReason: z.string(),
    }),
  ),
  pipelineVersion: z.string(),
  promptVersions: z.record(z.string(), z.string()),
});
export type VerdictPageData = z.infer<typeof VerdictPageData>;

export const FeedEntry = z.object({
  claimId: z.string(),
  claimText: z.string(),
  verdictClass: z.enum([
    "supported",
    "refuted",
    "not_enough_evidence",
    "conflicting_cherry_picking",
  ]),
  publishedAt: z.coerce.date(),
});
export type FeedEntry = z.infer<typeof FeedEntry>;

export interface SiteStore {
  getVerdictPage(claimId: string): Promise<VerdictPageData | null>;
  getFeed(page: number, pageSize: number): Promise<{ entries: FeedEntry[]; hasMore: boolean }>;
}

/** Fixture-backed store for L4a smoke tests and the empty-store edge case (SIT-R14). */
export function fixtureSiteStore(
  entries: FeedEntry[],
  pages?: Record<string, VerdictPageData>,
): SiteStore {
  return {
    async getVerdictPage(claimId) {
      return pages?.[claimId] ?? null;
    },
    async getFeed(page, pageSize) {
      const start = page * pageSize;
      return {
        entries: entries.slice(start, start + pageSize),
        hasMore: entries.length > start + pageSize,
      };
    },
  };
}
