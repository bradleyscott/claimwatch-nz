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
  // Nullable, and never defaulted: an absent confidence must stay absent rather
  // than be invented as 0.5. Nothing renders it today (SIT-R6) — see
  // `verdict-page.ts` for why.
  confidence: z.number().min(0).max(1).nullable(),
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
      // Source classification code written by the open-web loop (1-6; see
      // packages/pipeline/src/search/vetting.ts TIER_GUIDANCE). Rendered on the
      // verdict page as a plain-language description (lib/evidence-source-labels),
      // never as the raw code — that stays in the trail's technical record.
      tier: z.number().nullable().default(null),
      // When we fetched this source (evidence_item.retrieved_at) — the trail
      // prints it beside the vintage date, because "as at when" is half of what
      // a source means (SITE-MVP §2.3).
      retrievedAt: z.coerce.date().nullable().default(null),
    }),
  ),
  pipelineVersion: z.string(),
  promptVersions: z.record(z.string(), z.string()),
  // The pack's human-readable justifications — the "how it was refuted"
  // commentary (evidence_pack.justifications). Absent → empty array.
  justifications: z.array(z.string()).default([]),
  modelVersions: z.record(z.string(), z.string()).default({}),
  searchRefs: z.array(z.string()).default([]),
  // --- The trail's inputs (SITE-MVP §2.3, Sept 2026) -------------------------
  // Every one defaults to "not recorded" rather than to a guessed value: the
  // trail omits a step whose date the store does not hold, so a missing field
  // loses a step instead of inventing one. Nullable per field, not per object,
  // so a half-recorded claim still renders the half it has.
  /** When the claim was made (claim.spoken_at) — the trail's first anchor. */
  claimMadeAt: z.coerce.date().nullable().default(null),
  /** When we recorded the claim (claim.created_at). */
  claimRecordedAt: z.coerce.date().nullable().default(null),
  /** When we retrieved the document it came from (publication.retrieved_at). */
  sourceRetrievedAt: z.coerce.date().nullable().default(null),
  /** Store claim type — decides which method the claim got (TRIAGE typing). */
  claimType: z.string().nullable().default(null),
  /** Publisher of the item the claim appeared in (publication.publisher). */
  publisher: z.string().nullable().default(null),
  /**
   * Prompt versions recorded ON THE CLAIM (claim.prompt_versions) — the triage
   * roles, written when the claim was typed. The verdict's provenance carries
   * the whole run's roles; this is the claim's own record, and it is what makes
   * the "we logged it" step's audit line true rather than empty.
   */
  claimPromptVersions: z.record(z.string(), z.string()).default({}),
  /** Model that did the claim's triage (claim.model_version). */
  claimModelVersion: z.string().nullable().default(null),
  /** When the evidence was assembled (evidence_pack.created_at). */
  checkedAt: z.coerce.date().nullable().default(null),
  /** Publication gate outcome (evidence_pack.nli_outcome). */
  nliOutcome: z.string().nullable().default(null),
  /** Monotonic verdict version — 1 means never revised (STO-R2). */
  verdictVersion: z.number().int().default(1),
  verdictStatus: z.string().default("PUBLISHED"),
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
                c.transcript_tier, c.claim_type, c.spoken_at, c.created_at AS claim_recorded_at,
                c.prompt_versions AS claim_prompt_versions, c.model_version AS claim_model_version,
                pub.publisher, pub.retrieved_at AS source_retrieved_at,
                v.verdict_class, v.confidence::float8 AS confidence,
                v.created_at AS published_at, v.version AS verdict_version, v.status AS verdict_status,
                prv.pipeline_version, prv.prompt_versions, prv.model_versions, prv.search_refs
         FROM claim c
         LEFT JOIN publication pub ON pub.publication_id = c.publication_id
         JOIN verdict_version v ON v.claim_id = c.claim_id AND v.version =
              (SELECT MAX(version) FROM verdict_version WHERE claim_id = c.claim_id)
         LEFT JOIN verdict_provenance prv ON prv.provenance_id = v.provenance_id
        WHERE c.claim_id = $1::uuid AND v.status IN ('DRAFT','PUBLISHED')`,
        [claimId],
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      // The pack carries the human-readable justifications (the "how it was
      // refuted" commentary); the items carry the source rows.
      const evidence = await pool.query(
        `SELECT e.authority_ref, e.series_identity, e.vintage_date, e.url, e.retrieved_at,
                e.plain_finding, e.tier, ep.justifications, ep.created_at AS pack_created_at,
                ep.nli_outcome
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
        confidence: row.confidence ?? null,
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
            // The adjudicator's per-source finding — what THIS source says
            // relevant to the claim. Empty for stat-grid series rows (the
            // series itself is the finding).
            plainReason: e.plain_finding ?? "",
            url: e.url ?? "",
            tier: e.tier ?? null,
            retrievedAt: e.retrieved_at ?? null,
          })),
        justifications,
        pipelineVersion: row.pipeline_version ?? "unknown",
        promptVersions: row.prompt_versions ?? {},
        modelVersions: row.model_versions ?? {},
        searchRefs: row.search_refs ?? [],
        claimMadeAt: row.spoken_at ?? null,
        claimRecordedAt: row.claim_recorded_at ?? null,
        sourceRetrievedAt: row.source_retrieved_at ?? null,
        claimType: row.claim_type ?? null,
        publisher: row.publisher ?? null,
        claimPromptVersions: row.claim_prompt_versions ?? {},
        claimModelVersion: row.claim_model_version ?? null,
        // The pack is one row per claim (append-only, latest pack last): the
        // first row carries the pack's own timestamps even when it has no items.
        checkedAt: evidence.rows[0]?.pack_created_at ?? null,
        nliOutcome: evidence.rows[0]?.nli_outcome ?? null,
        verdictVersion: row.verdict_version ?? 1,
        verdictStatus: row.verdict_status ?? "PUBLISHED",
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
