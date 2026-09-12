// Store implementation: real Postgres via Drizzle. Append-only enforced by
// grants + triggers in SQL (applied by ensureGuards); fixtures serve the tests.
// Contract: store-api.ts (frozen — tests authored first).

import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as s from "./schema/index.ts";
import type {
  AuthorityFixture,
  AuthorityRecord,
  ClaimFixture,
  EvidenceItemFixture,
  EvidencePackFixture,
  PublicationFixture,
  Store,
  StoreFixtures,
  VerdictRecord,
  VerdictWrite,
} from "./store-api.ts";

const APPEND_ONLY_TABLES = [
  "publication",
  "evidence_item",
  "evidence_pack",
  "verdict_version",
  "authority",
] as const;
export const FREEZE_START = "2026-11-05T00:00:00Z";
export const FREEZE_END = "2026-11-27T23:59:59Z";

const LEGAL_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PUBLISHED"],
  PUBLISHED: ["CONTESTED", "FROZEN"],
  CONTESTED: ["VALIDATING", "FROZEN"],
  VALIDATING: ["PUBLISHED", "MUTATED", "FROZEN"],
  MUTATED: ["AUDIT", "FROZEN"],
  AUDIT: ["PUBLISHED", "FROZEN"],
  FROZEN: ["PUBLISHED", "MUTATED"],
};

export class PgStore implements Store {
  readonly appliedMigrations: readonly string[];
  readonly fixtures: StoreFixtures;
  private pool: Pool;
  private db: NodePgDatabase;
  // Derived supersession index: verdictId → the verdict that superseded it.
  // Append-only tables are never UPDATEd; supersede is derivable from
  // monotonic versions and indexed here for the returned live records.
  private supersededByIndex = new Map<string, string>();

  constructor(pool: Pool, appliedMigrations: string[]) {
    this.pool = pool;
    this.db = drizzle(pool);
    this.appliedMigrations = appliedMigrations;
    this.fixtures = makeFixtures();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async recordPublication(fixture: PublicationFixture): Promise<{
    publicationId: string;
    contentHash: string;
    retrievedAt: Date;
    retrievalMethod: string;
    pipelineVersion: string;
  }> {
    // Idempotent by content hash (STO-R13): insert, and on conflict select
    // the existing row — drizzle's onConflictDoNothing + a follow-up select.
    const inserted = await this.db
      .insert(s.publication)
      .values({
        sourceId: fixture.sourceId,
        canonicalUrl: fixture.canonicalUrl,
        contentHash: fixture.contentHash,
        retrievedAt: fixture.retrievedAt,
        retrievalMethod: fixture.retrievalMethod,
        pipelineVersion: fixture.pipelineVersion,
        rawRef: fixture.rawRef,
        text: fixture.text,
      })
      .onConflictDoNothing()
      .returning({
        publicationId: s.publication.publicationId,
        contentHash: s.publication.contentHash,
        retrievedAt: s.publication.retrievedAt,
        retrievalMethod: s.publication.retrievalMethod,
        pipelineVersion: s.publication.pipelineVersion,
      });
    const r =
      inserted[0] ??
      (
        await this.db
          .select({
            publicationId: s.publication.publicationId,
            contentHash: s.publication.contentHash,
            retrievedAt: s.publication.retrievedAt,
            retrievalMethod: s.publication.retrievalMethod,
            pipelineVersion: s.publication.pipelineVersion,
          })
          .from(s.publication)
          .where(eq(s.publication.contentHash, fixture.contentHash))
          .limit(1)
      )[0];
    if (r == null) throw new Error("publication upsert produced no row");
    return {
      publicationId: r.publicationId,
      contentHash: r.contentHash,
      retrievedAt: r.retrievedAt,
      retrievalMethod: r.retrievalMethod,
      pipelineVersion: r.pipelineVersion,
    };
  }

  async countPublications(canonicalUrl: string): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.publication)
      .where(eq(s.publication.canonicalUrl, canonicalUrl));
    return r?.n ?? 0;
  }

  async recordClaim(fixture: ClaimFixture): Promise<{ claimId: string } & ClaimFixture> {
    const [r] = await this.db
      .insert(s.claim)
      .values({
        publicationId: fixture.publicationId ?? null,
        utteranceText: fixture.utteranceText,
        text: fixture.text,
        claimType: fixture.claimType,
        fingerprint: fixture.fingerprint ?? null,
        discourseContext: fixture.discourseContext,
        mediaAnchor: fixture.mediaAnchor ?? null,
        transcriptTier: fixture.transcriptTier ?? null,
        pipelineVersion: "test",
        attributionCandidates: fixture.attributionCandidates ?? [],
      })
      .returning({ claimId: s.claim.claimId });
    if (r == null) throw new Error("claim insert returned no row");
    return { claimId: r.claimId, ...fixture };
  }

  async recordEvidenceItem(fixture: EvidenceItemFixture): Promise<{
    itemId: string;
    version: number;
    vintageDate: Date;
    retrievedAt: Date;
    archiveSnapshotUrl: string;
  }> {
    // Monotonic version per series identity (STO-R3): MAX+1 under the same
    // series key.
    const [prior] = await this.db
      .select({ v: sql<number>`coalesce(max(${s.evidenceItem.version}), 0)` })
      .from(s.evidenceItem)
      .where(eq(s.evidenceItem.seriesIdentity, fixture.seriesIdentity));
    const version = (prior?.v ?? 0) + 1;
    const [r] = await this.db
      .insert(s.evidenceItem)
      .values({
        claimId: fixture.claimId ?? null,
        authorityRef: fixture.authorityRef,
        seriesIdentity: fixture.seriesIdentity,
        vintageDate: fixture.vintageDate,
        retrievedAt: new Date(),
        url: fixture.url,
        archiveSnapshotUrl: fixture.archiveSnapshotUrl,
        contentHash: fixture.contentHash,
        version,
        plainFinding: fixture.plainFinding ?? null,
        tier: fixture.tier ?? null,
      })
      .returning({
        itemId: s.evidenceItem.itemId,
        version: s.evidenceItem.version,
        vintageDate: s.evidenceItem.vintageDate,
        retrievedAt: s.evidenceItem.retrievedAt,
        archiveSnapshotUrl: s.evidenceItem.archiveSnapshotUrl,
      });
    if (r == null) throw new Error("evidence_item insert returned no row");
    return {
      itemId: r.itemId,
      version: r.version,
      vintageDate: r.vintageDate,
      retrievedAt: r.retrievedAt,
      archiveSnapshotUrl: r.archiveSnapshotUrl,
    };
  }

  async appendEvidencePack(
    claimId: string,
    fixture: EvidencePackFixture,
  ): Promise<{ packId: string }> {
    const [r] = await this.db
      .insert(s.evidencePack)
      .values({
        claimId,
        itemRefs: fixture.itemRefs,
        gridResult: fixture.gridResult ?? null,
        justifications: fixture.justifications,
        nliOutcome: fixture.nliOutcome,
      })
      .returning({ packId: s.evidencePack.packId });
    if (r == null) throw new Error("evidence_pack insert returned no row");
    return { packId: r.packId };
  }
  async writeVerdict(claimId: string, packId: string, write: VerdictWrite): Promise<VerdictRecord> {
    const provenance = write.provenance;
    if (provenance == null) {
      throw new Error("verdict requires full provenance (STO-R10)");
    }
    // Multi-row atomic write: drizzle's transaction wraps the version bump,
    // provenance insert and verdict insert — same guarantees as the old
    // BEGIN/COMMIT client block.
    return this.db.transaction(async (tx) => {
      const [prior] = await tx
        .select({ version: s.verdictVersion.version })
        .from(s.verdictVersion)
        .where(eq(s.verdictVersion.claimId, claimId))
        .orderBy(desc(s.verdictVersion.version))
        .limit(1);
      const version = (prior?.version ?? 0) + 1;
      const [prov] = await tx
        .insert(s.verdictProvenance)
        .values({
          pipelineVersion: provenance.pipelineVersion,
          promptVersions: provenance.promptVersions,
          modelVersions: provenance.modelVersions,
          searchRefs: provenance.searchRefs,
        })
        .returning({ provenanceId: s.verdictProvenance.provenanceId });
      if (prov == null) throw new Error("provenance insert returned no row");
      const [inserted] = await tx
        .insert(s.verdictVersion)
        .values({
          claimId,
          version,
          status: "DRAFT",
          verdictClass: write.verdictClass ?? "not_enough_evidence",
          confidence: write.confidence != null ? String(write.confidence) : null,
          evidencePackId: packId,
          provenanceId: prov.provenanceId,
          diff: null,
        })
        .returning({ verdictId: s.verdictVersion.verdictId });
      if (inserted == null) throw new Error("verdict insert returned no row");
      const verdictId = inserted.verdictId;
      let diff: VerdictRecord["diff"] = null;
      if (version > 1) {
        const [prev] = await tx
          .select({
            verdictClass: s.verdictVersion.verdictClass,
            verdictId: s.verdictVersion.verdictId,
          })
          .from(s.verdictVersion)
          .where(
            and(eq(s.verdictVersion.claimId, claimId), eq(s.verdictVersion.version, version - 1)),
          );
        if (prev == null) throw new Error(`v${version - 1} missing for diff`);
        diff = {
          verdictClass: {
            from: prev.verdictClass,
            to: write.verdictClass ?? "not_enough_evidence",
          },
        };
        // Append-only: never UPDATE the superseded row. Monotonic versions make
        // "superseded" derivable — a v(n) is superseded iff v(n+1) exists. The
        // live-record getter below exposes that without touching v1's row.
        this.supersededByIndex.set(prev.verdictId, verdictId);
      }
      const index = this.supersededByIndex;
      return {
        verdictId,
        claimId,
        version,
        status: "DRAFT",
        verdictClass: write.verdictClass ?? "not_enough_evidence",
        confidence: write.confidence ?? 0,
        evidencePackId: packId,
        provenance,
        diff,
        get supersededBy() {
          return index.get(verdictId) ?? null;
        },
      };
    });
  }

  async logTransition(
    verdictId: string,
    transition: { from: string; to: string; at?: Date; reason?: string },
  ): Promise<void> {
    // Freeze first: inside 5–27 Nov the window itself is the rejection reason,
    // ahead of the legality map (STO-R14, ADR-0002 s 199A response).
    if (transition.to === "MUTATED") {
      const at = transition.at ?? new Date();
      if (at >= new Date(FREEZE_START) && at <= new Date(FREEZE_END)) {
        throw new Error("mutation rejected: freeze window active (STO-R14)");
      }
    }
    const legal = LEGAL_TRANSITIONS[transition.from] ?? [];
    if (!legal.includes(transition.to)) {
      throw new Error(`illegal transition ${transition.from} → ${transition.to} (STO-R14)`);
    }
    await this.db.insert(s.verdictTransitionLog).values({
      verdictId,
      fromStatus: transition.from,
      toStatus: transition.to,
      reason: transition.reason ?? null,
      actor: "pipeline",
      at: transition.at ?? new Date(),
    });
    // The transition IS the status change. The append-only guard on
    // verdict_version exempts status-only updates (lifecycle, not history);
    // the log row above records every change (STO-R14). Without this the
    // verdict stayed DRAFT forever — the site reader's status filter never
    // saw published verdicts, and no lifecycle ever advanced.
    await this.db
      .update(s.verdictVersion)
      .set({ status: transition.to })
      .where(eq(s.verdictVersion.verdictId, verdictId));
  }

  async transitions(
    verdictId: string,
  ): Promise<Array<{ from: string; to: string; at: Date; reason: string | null }>> {
    const rows = await this.db
      .select()
      .from(s.verdictTransitionLog)
      .where(eq(s.verdictTransitionLog.verdictId, verdictId))
      .orderBy(s.verdictTransitionLog.at);
    return rows.map((r) => ({
      from: r.fromStatus,
      to: r.toStatus,
      at: r.at,
      reason: r.reason,
    }));
  }

  async logFallback(event: {
    lane: string;
    sourceId: string;
    stage: string;
    tier: number;
    reason: string;
  }): Promise<void> {
    await this.db.insert(s.fallbackLog).values({
      lane: event.lane,
      sourceId: event.sourceId,
      stage: event.stage,
      tier: event.tier,
      reason: event.reason,
    });
  }

  async recordAuthority(fixture: AuthorityFixture): Promise<AuthorityRecord> {
    const [r] = await this.db
      .insert(s.authority)
      .values({
        domain: fixture.domain,
        authorityRef: fixture.authorityRef,
        sourceUrl: fixture.sourceUrl,
        tier: fixture.tier,
        rationale: fixture.rationale,
        confidence: String(fixture.confidence),
        discoveredBy: fixture.discoveredBy,
        searchRefs: fixture.searchRefs,
      })
      .returning({ authorityId: s.authority.authorityId, discoveredAt: s.authority.discoveredAt });
    if (r == null) throw new Error("authority insert returned no row");
    return {
      authorityId: r.authorityId,
      domain: fixture.domain,
      sourceUrl: fixture.sourceUrl,
      authorityRef: fixture.authorityRef,
      tier: fixture.tier,
      rationale: fixture.rationale,
      confidence: fixture.confidence,
      discoveredBy: fixture.discoveredBy,
      searchRefs: fixture.searchRefs,
      discoveredAt: r.discoveredAt,
    };
  }

  async resolveAuthority(domain: string): Promise<AuthorityRecord | null> {
    // Active only — retired rows never resolve. Best candidate: highest tier,
    // then latest discovery (a newer T1 with a fresher vintage beats an older
    // equal-tier row).
    const rows = await this.db
      .select()
      .from(s.authority)
      .where(and(eq(s.authority.domain, domain), eq(s.authority.status, "active")))
      .orderBy(s.authority.tier, desc(s.authority.discoveredAt))
      .limit(1);
    const r = rows[0];
    if (r == null) return null;
    return {
      authorityId: r.authorityId,
      domain: r.domain,
      sourceUrl: r.sourceUrl,
      authorityRef: r.authorityRef,
      tier: r.tier,
      rationale: r.rationale,
      confidence: Number(r.confidence),
      discoveredBy: r.discoveredBy,
      searchRefs: (r.searchRefs ?? []) as string[],
      discoveredAt: r.discoveredAt,
    };
  }

  async fallbackRateByLane(): Promise<Array<{ lane: string; count: number }>> {
    const rows = await this.db
      .select({ lane: s.fallbackLog.lane, count: sql<number>`count(*)::int` })
      .from(s.fallbackLog)
      .groupBy(s.fallbackLog.lane)
      .orderBy(s.fallbackLog.lane);
    return rows.map((r) => ({ lane: r.lane, count: r.count }));
  }

  // These probes DELIBERATELY use raw SQL: their job is to prove the database
  // rejects UPDATE/DELETE regardless of the client library. Routing them
  // through drizzle would test drizzle, not the guards.
  async tryUpdate(table: (typeof APPEND_ONLY_TABLES)[number]): Promise<unknown> {
    await this.seedProbeRow(table);
    return this.pool.query(
      `UPDATE ${table} SET ${idColumn(table)} = ${idColumn(table)} WHERE ${idColumn(table)} IS NOT NULL`,
    );
  }

  async tryDelete(table: (typeof APPEND_ONLY_TABLES)[number]): Promise<unknown> {
    await this.seedProbeRow(table);
    return this.pool.query(`DELETE FROM ${table} WHERE ctid IS NOT NULL`);
  }

  // Row-level triggers only fire when a row is actually touched; the probe row
  // makes the UPDATE/DELETE attempt deterministic regardless of test order
  // (a no-op statement on an empty table must not count as a pass).
  private async seedProbeRow(table: (typeof APPEND_ONLY_TABLES)[number]): Promise<void> {
    if (table === "publication") {
      await this.recordPublication(this.fixtures.beehiveRelease());
      return;
    }
    const claim = await this.recordClaim(this.fixtures.statClaim());
    if (table === "evidence_item") {
      await this.recordEvidenceItem({ ...this.fixtures.statsNzSeries(), claimId: claim.claimId });
      return;
    }
    if (table === "evidence_pack") {
      await this.appendEvidencePack(claim.claimId, this.fixtures.evidencePack());
      return;
    }
    const pack = await this.appendEvidencePack(claim.claimId, this.fixtures.evidencePack());
    await this.writeVerdict(claim.claimId, pack.packId, {
      provenance: this.fixtures.fullProvenance(),
    });
  }

  async roleCanInsert(role: string, table: string): Promise<boolean> {
    return this.hasPrivilege(role, table, "INSERT");
  }

  async roleCanUpdate(role: string, table: string): Promise<boolean> {
    return this.hasPrivilege(role, table, "UPDATE");
  }

  async roleCanSelect(role: string, table: string): Promise<boolean> {
    return this.hasPrivilege(role, table, "SELECT");
  }

  // Postgres introspection (has_table_privilege) — not a drizzle use case.
  private async hasPrivilege(role: string, table: string, privilege: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT has_table_privilege($1, $2, $3) AS allowed`, [
      role,
      table,
      privilege,
    ]);
    return r.rows[0].allowed === true;
  }
}

const ID_COLUMN_BY_TABLE: Record<string, string> = {
  publication: "publication_id",
  evidence_item: "item_id",
  evidence_pack: "pack_id",
  verdict_version: "verdict_id",
  authority: "authority_id",
};

function idColumn(table: string): string {
  const column = ID_COLUMN_BY_TABLE[table];
  if (column === undefined) {
    throw new Error(`no id column mapped for table ${table}`);
  }
  return column;
}

function makeFixtures(): StoreFixtures {
  const _hash = (s: string) => `hash-${s}`;
  return {
    beehiveRelease: () => ({
      sourceId: "beehive-rss",
      canonicalUrl: "https://www.beehive.govt.nz/release/test-release",
      contentHash: "beehive-test-hash",
      retrievedAt: new Date("2026-09-10T00:00:00Z"),
      retrievalMethod: "tier1-rss-readability",
      pipelineVersion: "0.1.0",
      rawRef: "raw/beehive-test.html",
      text: "Test release text",
    }),
    rnzArticle: () => ({
      sourceId: "rnz-politics",
      canonicalUrl: "https://www.rnz.co.nz/news/political/test-article",
      contentHash: "rnz-test-hash",
      retrievedAt: new Date("2026-09-10T01:00:00Z"),
      retrievalMethod: "tier1-rss-readability",
      pipelineVersion: "0.1.0",
      rawRef: "raw/rnz-test.html",
      text: "Test article text",
    }),
    claimWithoutContext: () => ({
      utteranceText: "Unemployment is at record lows.",
      text: "Unemployment is at record lows.",
      claimType: "other",
      discourseContext: { window: "", attachedProposal: null, argumentDirection: null },
    }),
    statClaim: () => ({
      utteranceText: "Crime is up 30% since 2017.",
      text: "Crime is up 30% since 2017.",
      claimType: "statistical",
      fingerprint: {
        indicator: "crime",
        population: "all",
        geography: "NZ",
        timeWindow: "2017-now",
        baseline: "2017",
        unit: "percent-change",
      },
      discourseContext: {
        window: "…in the context of law and order debate…",
        attachedProposal: "tougher sentencing",
        argumentDirection: "problem",
      },
    }),
    statsNzSeries: (opts) => ({
      authorityRef: "statsnz",
      seriesIdentity: "cpil1q",
      vintageDate: new Date("2026-06-30T00:00:00Z"),
      url: "https://www.stats.govt.nz/series/cpil1q",
      archiveSnapshotUrl: `https://web.archive.org/web/2026/https://www.stats.govt.nz/series/cpil1q${opts?.revised ? "-v2" : ""}`,
      contentHash: `series-hash-${opts?.revised ? "rev2" : "1"}`,
    }),
    evidencePack: (opts) => ({
      itemRefs: opts?.revised ? ["item-2"] : ["item-1"],
      gridResult: { rows: ["window", "per-capita"] },
      justifications: ["Series shows 12% not 30%."],
      nliOutcome: "pass",
    }),
    fullProvenance: () => ({
      pipelineVersion: "0.1.0",
      promptVersions: { triage: "triage@1", adjudication: "adjudication@1" },
      modelVersions: { adjudication: "model-x@v1" },
      searchRefs: ["brave:query-hash"],
    }),
  };
}

export async function createTestStore(
  databaseUrl: string,
  opts?: { scratchSuffix?: string },
): Promise<Store> {
  let url = databaseUrl;
  if (opts?.scratchSuffix) {
    // Vitest runs files in parallel forks; every suite wiping ONE shared
    // scratch DB interferes with the others (fallback counts, idempotency
    // fixtures). Each suite gets its own database, created on demand.
    const parsed = new URL(databaseUrl);
    const scratchName = `${parsed.pathname.replace(/^\//, "")}${opts.scratchSuffix}`;
    if (!/^[a-z_][a-z0-9_]*$/.test(scratchName)) {
      throw new Error(`unsafe scratch database name: ${scratchName}`);
    }
    const admin = new Pool({ connectionString: databaseUrl });
    try {
      const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [
        scratchName,
      ]);
      if (exists.rowCount === 0) {
        await admin.query(`CREATE DATABASE "${scratchName}"`);
      }
    } finally {
      await admin.end();
    }
    parsed.pathname = `/${scratchName}`;
    url = parsed.toString();
  }
  const pool = new Pool({ connectionString: url });
  // Scratch semantics: every run applies the chain from zero (STO-R5, and the
  // "from zero" migration test). Drop everything in the public schema first.
  await pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  const appliedMigrations = await migrate(pool);
  await ensureRoles(pool);
  await ensureAppendOnlyGuards(pool);
  return new PgStore(pool, appliedMigrations);
}

/**
 * Live-run store: migrates and guards WITHOUT dropping the schema. The
 * authority registry (and every other table) persists across runs — this is
 * what makes discovered authorities amortise. Tests use createTestStore (from
 * zero); production/live-run code uses this.
 */
export async function createStore(databaseUrl: string): Promise<Store> {
  const pool = new Pool({ connectionString: databaseUrl });
  const appliedMigrations = await migrate(pool);
  await ensureRoles(pool);
  await ensureAppendOnlyGuards(pool);
  return new PgStore(pool, appliedMigrations);
}

async function ensureRoles(pool: Pool): Promise<void> {
  for (const role of ["pipeline", "site", "harness"]) {
    await pool.query(
      `DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    );
  }
  await pool.query(`GRANT USAGE ON SCHEMA public TO pipeline, site, harness`);
  const pipelineTables = [
    "publication",
    "segment",
    "claim",
    "claimant_entity",
    "evidence_item",
    "evidence_pack",
    "verdict_version",
    "verdict_transition_log",
    "fallback_log",
    "verdict_provenance",
    "authority",
  ];
  for (const table of pipelineTables) {
    await pool.query(`GRANT INSERT, SELECT ON ${table} TO pipeline`);
    await pool.query(`GRANT SELECT ON ${table} TO site`);
  }
}
export async function migrate(pool: Pool): Promise<string[]> {
  const applied: string[] = [];
  const run = async (name: string, statement: string) => {
    await pool.query(statement);
    applied.push(name);
  };

  await run("001-extensions", `CREATE EXTENSION IF NOT EXISTS vector`);
  await run("002-publication", documentsDdl());
  await run(
    "003-publication-hash-uq",
    `CREATE UNIQUE INDEX IF NOT EXISTS publication_content_hash_uq ON publication (content_hash)`,
  );
  await run("004-segment", segmentDdl());
  await run("005-claimant-entity", claimantEntityDdl());
  await run("006-claim", claimDdl());
  await run("007-evidence-item", evidenceDdl());
  await run("008-evidence-pack", evidencePackDdl());
  await run("009-verdict-provenance", verdictProvenanceDdl());
  await run("010-verdict-version", verdictVersionDdl());
  await run("011-verdict-transition-log", verdictTransitionLogDdl());
  await run("012-fallback-log", fallbackLogDdl());
  await run("013-authority", authorityDdl());
  await run("014-authority-seed", authoritySeed());
  // Additive columns for existing databases (open-web evidence findings).
  await run(
    "015-evidence-finding",
    `ALTER TABLE evidence_item ADD COLUMN IF NOT EXISTS plain_finding text`,
  );
  await run("016-evidence-tier", `ALTER TABLE evidence_item ADD COLUMN IF NOT EXISTS tier integer`);
  return applied;
}

function documentsDdl(): string {
  return `
  CREATE TABLE IF NOT EXISTS publication (
    publication_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id text NOT NULL,
    canonical_url text NOT NULL,
    content_hash text NOT NULL,
    retrieved_at timestamptz NOT NULL,
    retrieval_method text NOT NULL,
    pipeline_version text NOT NULL,
    publisher text,
    raw_ref text NOT NULL,
    text text NOT NULL,
    transcript text,
    transcript_tier text,
    track_hash text,
    is_curated_fixture boolean NOT NULL DEFAULT false
  )`;
}
function segmentDdl(): string {
  return `
  CREATE TABLE IF NOT EXISTS segment (
    segment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    publication_id uuid NOT NULL REFERENCES publication(publication_id),
    span_start integer,
    span_end integer,
    summary text,
    turn_structure jsonb
  )`;
}

function claimantEntityDdl(): string {
  return `
  CREATE TABLE IF NOT EXISTS claimant_entity (
    entity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    kind text NOT NULL,
    aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
    affiliation text,
    cross_links jsonb
  )`;
}

function claimDdl(): string {
  return `
  CREATE TABLE IF NOT EXISTS claim (
    claim_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    publication_id uuid REFERENCES publication(publication_id),
    segment_id uuid REFERENCES segment(segment_id),
    sentence_span jsonb,
    utterance_text text NOT NULL,
    text text NOT NULL,
    claim_type text NOT NULL,
    fingerprint jsonb,
    fingerprint_key text,
    embedding text,
    discourse_context jsonb NOT NULL,
    media_anchor jsonb,
    transcript_tier text,
    caption_quality_flag text,
    attribution_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
    is_curated_fixture boolean NOT NULL DEFAULT false,
    pipeline_version text NOT NULL,
    prompt_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
    model_version text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
}
function evidenceDdl(): string {
  return `
  CREATE TABLE IF NOT EXISTS evidence_item (
    item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id uuid REFERENCES claim(claim_id),
    authority_ref text NOT NULL,
    series_identity text NOT NULL,
    vintage_date timestamptz NOT NULL,
    retrieved_at timestamptz NOT NULL,
    url text NOT NULL,
    archive_snapshot_url text NOT NULL,
    content_hash text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    plain_finding text,
    tier integer,
    UNIQUE (series_identity, vintage_date, version)
  )`;
}

function evidencePackDdl(): string {
  return `
  CREATE TABLE IF NOT EXISTS evidence_pack (
    pack_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id uuid NOT NULL REFERENCES claim(claim_id),
    item_refs jsonb NOT NULL,
    grid_result jsonb,
    justifications jsonb NOT NULL DEFAULT '[]'::jsonb,
    nli_outcome text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
}

function verdictProvenanceDdl(): string {
  return `
  CREATE TABLE IF NOT EXISTS verdict_provenance (
    provenance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_version text NOT NULL,
    prompt_versions jsonb NOT NULL,
    model_versions jsonb NOT NULL,
    search_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    cost_latency_refs jsonb
  )`;
}

function verdictVersionDdl(): string {
  return `
  CREATE TABLE IF NOT EXISTS verdict_version (
    verdict_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id uuid NOT NULL REFERENCES claim(claim_id),
    version integer NOT NULL,
    status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','CONTESTED','VALIDATING','MUTATED','FROZEN')),
    verdict_class text NOT NULL CHECK (verdict_class IN ('supported','refuted','not_enough_evidence','conflicting_cherry_picking','pledge','conditional')),
    confidence numeric(4,3),
    evidence_pack_id uuid NOT NULL REFERENCES evidence_pack(pack_id),
    provenance_id uuid NOT NULL REFERENCES verdict_provenance(provenance_id),
    diff jsonb,
    superseded_by uuid REFERENCES verdict_version(verdict_id),
    superseded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (claim_id, version)
  )`;
}

function verdictTransitionLogDdl(): string {
  return `
  CREATE TABLE IF NOT EXISTS verdict_transition_log (
    transition_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    verdict_id uuid NOT NULL REFERENCES verdict_version(verdict_id),
    from_status text NOT NULL,
    to_status text NOT NULL,
    reason text,
    actor text NOT NULL DEFAULT 'pipeline',
    at timestamptz NOT NULL DEFAULT now()
  )`;
}

function fallbackLogDdl(): string {
  return `
  CREATE TABLE IF NOT EXISTS fallback_log (
    event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lane text NOT NULL,
    source_id text NOT NULL,
    stage text NOT NULL,
    tier integer NOT NULL,
    reason text NOT NULL,
    at timestamptz NOT NULL DEFAULT now()
  )`;
}
// Authority registry (user direction, Sept 2026): no pre-declared gate —
// authorities are discovered over time, classified by the declared tier model,
// and persisted with discovery provenance. Append-only: what we believed at
// discovery time is a recorded fact; retirement supersedes, never rewrites.
function authorityDdl(): string {
  return `
  CREATE TABLE IF NOT EXISTS authority (
    authority_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    domain text NOT NULL,
    authority_ref text NOT NULL,
    source_url text NOT NULL,
    tier integer NOT NULL CHECK (tier BETWEEN 1 AND 6),
    rationale text NOT NULL,
    confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    discovered_by text NOT NULL,
    search_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
    discovered_at timestamptz NOT NULL DEFAULT now()
  )`;
}

// Seeds sit on the same footing as discoveries — 'seed' provenance, tier
// declared by the initial design (all T1 NZ Crown).
function authoritySeed(): string {
  return `
  INSERT INTO authority (domain, authority_ref, source_url, tier, rationale, confidence, discovered_by, search_refs)
  SELECT * FROM (VALUES
    ('crime-statistics', 'policedata.nz', 'https://www.policedata.nz', 1, 'NZ Police official crime data portal (initial design seed)', 1.0, 'seed', '[]'::jsonb),
    ('economic-forecasts', 'treasury.govt.nz', 'https://www.treasury.govt.nz', 1, 'NZ Treasury official forecasts (initial design seed)', 1.0, 'seed', '[]'::jsonb),
    ('population-estimates', 'stats.govt.nz', 'https://www.stats.govt.nz', 1, 'Stats NZ official population estimates (initial design seed)', 1.0, 'seed', '[]'::jsonb)
  ) AS seed(domain, authority_ref, source_url, tier, rationale, confidence, discovered_by, search_refs)
  WHERE NOT EXISTS (SELECT 1 FROM authority WHERE discovered_by = 'seed')`;
}

export async function ensureAppendOnlyGuards(pool: Pool): Promise<void> {
  for (const table of APPEND_ONLY_TABLES) {
    // verdict_version's STATUS column is lifecycle, not history: transitions
    // (DRAFT → PUBLISHED → …) must update it, and the transition log records
    // every change (STO-R14). The append-only guard on that table therefore
    // fires only when any column OTHER than status changes — the row itself
    // stays append-only.
    const whenClause =
      table === "verdict_version" ? "WHEN (OLD.status IS NOT DISTINCT FROM NEW.status)" : "";
    await pool.query(`
      CREATE OR REPLACE FUNCTION ${table}_append_only_guard() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await pool.query(`DROP TRIGGER IF EXISTS ${table}_append_only ON ${table}`);
    // Split-trigger migration: the verdict_version UPDATE/DELETE split renamed
    // the triggers — old combined AND split names must drop cleanly.
    await pool.query(`DROP TRIGGER IF EXISTS ${table}_append_only_update ON ${table}`);
    await pool.query(`DROP TRIGGER IF EXISTS ${table}_append_only_delete ON ${table}`);
    if (table === "verdict_version") {
      // UPDATE: allowed only when nothing but status changed. DELETE: always
      // forbidden (no WHEN clause — it cannot reference NEW).
      await pool.query(
        `CREATE TRIGGER ${table}_append_only_update BEFORE UPDATE ON ${table} FOR EACH ROW
         WHEN (OLD.status IS NOT DISTINCT FROM NEW.status)
         EXECUTE FUNCTION ${table}_append_only_guard()`,
      );
      await pool.query(
        `CREATE TRIGGER ${table}_append_only_delete BEFORE DELETE ON ${table} FOR EACH ROW
         EXECUTE FUNCTION ${table}_append_only_guard()`,
      );
    } else {
      await pool.query(
        `CREATE TRIGGER ${table}_append_only BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW
         EXECUTE FUNCTION ${table}_append_only_guard()`,
      );
    }
  }
}
