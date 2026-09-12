// Site store (SITE-MVP §3.1): the site is a READER over the typed store —
// no write path to claims/verdicts (feedback stays behind the API route).
// Three surfaces: the live Postgres reader, a fixture-backed store for L4a
// smoke tests + empty-store edges (SIT-R14), and the DI seam pages render
// through.

import { Pool } from "pg";
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
      // Source link-out (evidence_item.url) — the mockup renders every
      // evidence row's source as a link; absent → text-only row.
      url: z.string().default(""),
    }),
  ),
  pipelineVersion: z.string(),
  promptVersions: z.record(z.string(), z.string()),
  // The pack's human-readable justifications — the "how it was refuted"
  // commentary (evidence_pack.justifications). Absent → empty array.
  justifications: z.array(z.string()).default([]),
  modelVersions: z.record(z.string(), z.string()).default({}),
  searchRefs: z.array(z.string()).default([]),
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

/** Live Postgres reader over the typed store (SITE-MVP §3.1). Read-only. */
export function liveSiteStore(databaseUrl: string): SiteStore {
  const pool = new Pool({ connectionString: databaseUrl });
  return {
    async getVerdictPage(claimId: string): Promise<VerdictPageData | null> {
      const result = await pool.query(
        `SELECT c.claim_id, c.utterance_text AS claim_text,
                c.discourse_context->>'attachedProposal' AS attached_proposal,
                c.discourse_context->>'speechContext' AS speech_context,
                c.attribution_candidates->0->>'name' AS speaker_name,
                c.transcript_tier,
                v.verdict_class, v.confidence::float8 AS confidence,
                v.created_at AS published_at,
                p.pipeline_version, p.prompt_versions, p.model_versions, p.search_refs
         FROM claim c
         JOIN verdict_version v ON v.claim_id = c.claim_id AND v.version =
              (SELECT MAX(version) FROM verdict_version WHERE claim_id = c.claim_id)
         LEFT JOIN verdict_provenance p ON p.provenance_id = v.provenance_id
        WHERE c.claim_id = $1::uuid AND v.status IN ('DRAFT','PUBLISHED')`,
        [claimId],
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      // The pack carries the human-readable justifications (the "how it was
      // refuted" commentary); the items carry the source rows.
      const evidence = await pool.query(
        `SELECT e.authority_ref, e.series_identity, e.vintage_date, e.url,
                ep.justifications
         FROM evidence_pack ep
         LEFT JOIN evidence_item e ON e.claim_id = ep.claim_id
         WHERE ep.claim_id = $1::uuid
         ORDER BY ep.pack_id`,
        [claimId],
      );
      const justifications =
        evidence.rows.find((r) => r.justifications?.length)?.justifications ?? [];
      return VerdictPageData.parse({
        claimId: row.claim_id,
        claimText: row.claim_text,
        speaker: row.speaker_name ?? null,
        speakerAffiliation: row.speech_context ?? null,
        transcriptTier: row.transcript_tier ?? null,
        publishedAt: row.published_at,
        verdictClass: row.verdict_class,
        confidence: row.confidence ?? 0.5,
        mediaAnchor: null, // caption lanes land with the YouTube slice
        attachedProposal: row.attached_proposal,
        // The pack LEFT JOIN means claims with a pack but no items produce
        // null-padded rows — evidence exists as justifications only.
        evidence: evidence.rows
          .filter((e) => e.authority_ref != null)
          .map((e) => ({
            authorityRef: e.authority_ref,
            seriesIdentity: e.series_identity,
            vintageDate:
              e.vintage_date instanceof Date
                ? e.vintage_date.toISOString().slice(0, 10)
                : String(e.vintage_date),
            plainReason: "",
            url: e.url ?? "",
          })),
        justifications,
        pipelineVersion: row.pipeline_version ?? "unknown",
        promptVersions: row.prompt_versions ?? {},
        modelVersions: row.model_versions ?? {},
        searchRefs: row.search_refs ?? [],
      });
    },
    async getFeed(
      page: number,
      pageSize: number,
    ): Promise<{ entries: FeedEntry[]; hasMore: boolean }> {
      const result = await pool.query(
        `SELECT c.claim_id, c.utterance_text AS claim_text, v.verdict_class, v.created_at AS published_at
         FROM claim c
         JOIN verdict_version v ON v.claim_id = c.claim_id AND v.version =
              (SELECT MAX(version) FROM verdict_version WHERE claim_id = c.claim_id)
         WHERE v.status IN ('DRAFT','PUBLISHED')
         ORDER BY v.created_at DESC
         OFFSET $1 LIMIT $2`,
        [page * pageSize, pageSize],
      );
      return {
        entries: result.rows.map((r) =>
          FeedEntry.parse({
            claimId: r.claim_id,
            claimText: r.claim_text,
            verdictClass: r.verdict_class,
            publishedAt: r.published_at,
          }),
        ),
        hasMore: result.rows.length === pageSize,
      };
    },
  };
}

// DI seam: L4a render tests pin the fixture store; production installs the
// live reader via installLiveStore (one-way latch — pages don't re-install per
// request). resetSiteStore clears the latch for hermetic tests.
let activeSiteStore: SiteStore = fixtureSiteStore([]);
let liveInstalled = false;
let pinnedOverride = false;

export function getSiteStore(): SiteStore {
  return activeSiteStore;
}

export function setSiteStore(store: SiteStore): void {
  activeSiteStore = store;
}

/** Installs the live reader once; later calls are no-ops. */
export function installLiveStore(databaseUrl: string): void {
  if (liveInstalled || pinnedOverride) return;
  setSiteStore(liveSiteStore(databaseUrl));
  liveInstalled = true;
}

/** Test seam: pins the fixture store AND blocks installLiveStore re-latching. */
export function pinFixtureStore(store: SiteStore): void {
  setSiteStore(store);
  pinnedOverride = true;
  liveInstalled = false;
}

/** Test seam reset: clears the latch so a pinned fixture store takes effect. */
export function resetSiteStore(): void {
  setSiteStore(fixtureSiteStore([]));
  liveInstalled = false;
  pinnedOverride = false;
}
