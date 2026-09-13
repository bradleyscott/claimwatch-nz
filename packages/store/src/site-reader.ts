// Site read model (STORE §3, SITE-MVP §3.1): the site is a READER over the
// typed store, and this module is the whole of that read path — Drizzle queries
// against the shared schema, no string SQL.
//
// It lives in `packages/store` rather than `apps/site` because STORE §2.1 makes
// the store the single definition of claim/verdict/evidence shapes "shared by
// pipeline (write), site (read), harness (export)". The site used to hand-write
// its SELECT list inside template literals; `pg` returns `any` rows, so a column
// rename left `pnpm typecheck` green and broke the page at request time — or,
// for a nullable field, silently dropped a step from the public audit trail.
// Here the same rename is a compile error (Sept 2026).
//
// Two properties the previous string SQL had to be trusted for and this module
// gets from the schema:
//   * "latest verdict per claim" is computed from the same monotonic `version`
//     column the write path assigns (STO-R2), not a second hand-written
//     MAX() that could drift;
//   * the evidence rows come from the pack the VERDICT pins
//     (`verdict_version.evidence_pack_id`), never from "some pack for this
//     claim" — a claim with an earlier pack used to report that pack's check
//     time and audit outcome beside the current verdict.

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { z } from "zod";
import * as s from "./schema/index.ts";

/**
 * Connection options for every site read. The site holds no write path to
 * claims/verdicts (SITE-MVP §2.1) — its own pool as a READ-ONLY session means
 * that is a property Postgres enforces on the connection, not a convention the
 * query list is trusted to keep. The `site` role's SELECT-only grants remain the
 * second lock once a login-capable role is provisioned (0003_roles.sql creates
 * it NOLOGIN; a password would have to come from env, AGENTS rule 6).
 */
export function siteReaderPoolConfig(databaseUrl: string): PoolConfig {
  return { connectionString: databaseUrl, options: "-c default_transaction_read_only=on" };
}

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

/**
 * The live reader. `SiteStore` in `apps/site` is the DI seam pages render
 * through; this is the only implementation that talks to Postgres.
 */
export interface SiteReader {
  getVerdictPage(claimId: string): Promise<VerdictPageData | null>;
  getFeed(page: number, pageSize: number): Promise<{ entries: FeedEntry[]; hasMore: boolean }>;
  close(): Promise<void>;
}

// A verdict a reader may be shown. DRAFT is deliberate: the page's audit
// vocabulary prints the state, so an unpublished check renders as "DRAFT"
// rather than being hidden (SITE-MVP §2.3).
const SITE_VISIBLE_STATUSES = ["DRAFT", "PUBLISHED"] as const;

// evidence_pack.justifications is jsonb (`unknown` to the type system); the
// write path appends string[]. Parse at the boundary rather than trusting it.
const Justifications = z.array(z.string());

export function createSiteReader(databaseUrl: string): SiteReader {
  const pool = new Pool(siteReaderPoolConfig(databaseUrl));
  const db: NodePgDatabase = drizzle(pool);

  // Latest verdict version per claim. Nothing here decides what "latest" means:
  // `version` is monotonic per claim and only the store's write path assigns it
  // (STO-R2), so "superseded" stays derivable rather than re-stated.
  //
  // DISTINCT ON rather than MAX() + GROUP BY: the aggregate would hand back an
  // aliased SQL expression, which Drizzle renders UNQUALIFIED — `version =` in a
  // join against a table that also has a `version` column is ambiguous
  // (42702). Selecting the real column keeps the CTE reference qualified.
  const latestVerdict = db.$with("latest_verdict").as(
    db
      .selectDistinctOn([s.verdictVersion.claimId], {
        claimId: s.verdictVersion.claimId,
        version: s.verdictVersion.version,
      })
      .from(s.verdictVersion)
      .orderBy(s.verdictVersion.claimId, desc(s.verdictVersion.version)),
  );

  return {
    async getVerdictPage(claimId: string): Promise<VerdictPageData | null> {
      const [row] = await db
        .with(latestVerdict)
        .select({
          claimId: s.claim.claimId,
          claimText: s.claim.utteranceText,
          // jsonb paths: genuinely SQL-shaped, so Drizzle's `sql` template
          // (STORE §2.1, ADR-0014) — the COLUMN is bound through the schema, so
          // a rename still fails typecheck; only the JSON keys are literals here.
          attachedProposal: sql<string | null>`${s.claim.discourseContext}->>'attachedProposal'`,
          speechContext: sql<string | null>`${s.claim.discourseContext}->>'speechContext'`,
          speakerName: sql<string | null>`${s.claim.attributionCandidates}->0->>'name'`,
          transcriptTier: s.claim.transcriptTier,
          claimType: s.claim.claimType,
          spokenAt: s.claim.spokenAt,
          claimRecordedAt: s.claim.createdAt,
          claimPromptVersions: s.claim.promptVersions,
          claimModelVersion: s.claim.modelVersion,
          publisher: s.publication.publisher,
          sourceRetrievedAt: s.publication.retrievedAt,
          verdictClass: s.verdictVersion.verdictClass,
          // numeric drains as a string; cast in SQL so the value stays exact to
          // the page boundary and Zod can range-check it (no float parsing in TS).
          confidence: sql<number | null>`${s.verdictVersion.confidence}::float8`,
          publishedAt: s.verdictVersion.createdAt,
          verdictVersionNumber: s.verdictVersion.version,
          verdictStatus: s.verdictVersion.status,
          evidencePackId: s.verdictVersion.evidencePackId,
          pipelineVersion: s.verdictProvenance.pipelineVersion,
          promptVersions: s.verdictProvenance.promptVersions,
          modelVersions: s.verdictProvenance.modelVersions,
          searchRefs: s.verdictProvenance.searchRefs,
        })
        .from(s.claim)
        .leftJoin(s.publication, eq(s.publication.publicationId, s.claim.publicationId))
        .innerJoin(latestVerdict, eq(latestVerdict.claimId, s.claim.claimId))
        .innerJoin(
          s.verdictVersion,
          and(
            eq(s.verdictVersion.claimId, s.claim.claimId),
            eq(s.verdictVersion.version, latestVerdict.version),
          ),
        )
        .leftJoin(
          s.verdictProvenance,
          eq(s.verdictProvenance.provenanceId, s.verdictVersion.provenanceId),
        )
        .where(
          and(
            eq(s.claim.claimId, claimId),
            inArray(s.verdictVersion.status, SITE_VISIBLE_STATUSES),
          ),
        )
        .limit(1);
      if (row == null) return null;

      // The pack THIS verdict pins, by primary key. A pack is one row (append-
      // only, and the verdict references the exact one), so this is a lookup —
      // not a join whose per-item repetition has to be de-duplicated in TS, and
      // a pack that cites no items still reports its own check time and outcome.
      const [pack] = await db
        .select({
          justifications: s.evidencePack.justifications,
          createdAt: s.evidencePack.createdAt,
          nliOutcome: s.evidencePack.nliOutcome,
        })
        .from(s.evidencePack)
        .where(eq(s.evidencePack.packId, row.evidencePackId))
        .limit(1);

      // The sources recorded for the claim the pack belongs to. The page
      // re-orders these by stored source class for display
      // (`evidence-source-labels.ts`); the read model stays in series order so
      // the ordering decision lives in one place.
      const itemRows = await db
        .select({
          authorityRef: s.evidenceItem.authorityRef,
          seriesIdentity: s.evidenceItem.seriesIdentity,
          vintageDate: s.evidenceItem.vintageDate,
          url: s.evidenceItem.url,
          retrievedAt: s.evidenceItem.retrievedAt,
          plainFinding: s.evidenceItem.plainFinding,
          tier: s.evidenceItem.tier,
        })
        .from(s.evidenceItem)
        .where(eq(s.evidenceItem.claimId, row.claimId))
        .orderBy(asc(s.evidenceItem.seriesIdentity));

      // evidence_pack.justifications is jsonb (`unknown` to the type system);
      // the write path appends string[]. Parse at the boundary, and treat an
      // absent or empty list as "no commentary" rather than an empty step.
      const parsedJustifications = pack ? Justifications.safeParse(pack.justifications) : undefined;
      const justifications =
        parsedJustifications?.success && parsedJustifications.data.length > 0
          ? parsedJustifications.data
          : [];

      return VerdictPageData.parse({
        claimId: row.claimId,
        claimText: row.claimText,
        speaker: row.speakerName ?? null,
        speakerAffiliation: row.speechContext ?? null,
        transcriptTier: row.transcriptTier ?? null,
        publishedAt: row.publishedAt,
        verdictClass: row.verdictClass,
        confidence: row.confidence ?? null,
        mediaAnchor: null, // caption lanes land with the YouTube slice
        attachedProposal: row.attachedProposal,
        evidence: itemRows.map((e) => ({
          authorityRef: e.authorityRef,
          seriesIdentity: e.seriesIdentity,
          vintageDate: e.vintageDate.toISOString().slice(0, 10),
          // The adjudicator's per-source finding — what THIS source says
          // relevant to the claim. Empty for stat-grid series rows (the series
          // itself is the finding).
          plainReason: e.plainFinding ?? "",
          url: e.url,
          tier: e.tier,
          retrievedAt: e.retrievedAt,
        })),
        justifications,
        pipelineVersion: row.pipelineVersion ?? "unknown",
        promptVersions: row.promptVersions ?? {},
        modelVersions: row.modelVersions ?? {},
        searchRefs: row.searchRefs ?? [],
        claimMadeAt: row.spokenAt ?? null,
        claimRecordedAt: row.claimRecordedAt ?? null,
        sourceRetrievedAt: row.sourceRetrievedAt ?? null,
        claimType: row.claimType ?? null,
        publisher: row.publisher ?? null,
        claimPromptVersions: row.claimPromptVersions ?? {},
        claimModelVersion: row.claimModelVersion ?? null,
        // The pack is one row per claim (append-only, latest pack last): the
        // first row carries the pack's own timestamps even when it has no items.
        checkedAt: pack?.createdAt ?? null,
        nliOutcome: pack?.nliOutcome ?? null,
        verdictVersion: row.verdictVersionNumber ?? 1,
        verdictStatus: row.verdictStatus ?? "PUBLISHED",
      });
    },

    async getFeed(
      page: number,
      pageSize: number,
    ): Promise<{
      entries: FeedEntry[];
      hasMore: boolean;
    }> {
      const rows = await db
        .with(latestVerdict)
        .select({
          claimId: s.claim.claimId,
          claimText: s.claim.utteranceText,
          verdictClass: s.verdictVersion.verdictClass,
          publishedAt: s.verdictVersion.createdAt,
        })
        .from(s.claim)
        .innerJoin(latestVerdict, eq(latestVerdict.claimId, s.claim.claimId))
        .innerJoin(
          s.verdictVersion,
          and(
            eq(s.verdictVersion.claimId, s.claim.claimId),
            eq(s.verdictVersion.version, latestVerdict.version),
          ),
        )
        .where(inArray(s.verdictVersion.status, SITE_VISIBLE_STATUSES))
        .orderBy(desc(s.verdictVersion.createdAt))
        .offset(page * pageSize)
        .limit(pageSize);

      return {
        entries: rows.map((r) =>
          FeedEntry.parse({
            claimId: r.claimId,
            claimText: r.claimText,
            verdictClass: r.verdictClass,
            publishedAt: r.publishedAt,
          }),
        ),
        hasMore: rows.length === pageSize,
      };
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
