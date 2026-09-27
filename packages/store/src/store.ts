// Store implementation: real Postgres via Drizzle. Append-only enforced by
// grants + triggers in SQL (applied by ensureGuards); fixtures serve the tests.
// Contract: store-api.ts (frozen — tests authored first).

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { and, desc, eq, is, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migrateDb } from "drizzle-orm/node-postgres/migrator";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { z } from "zod";
import {
  assertPlanValid,
  VerificationPlan as PlanSchema,
  ProcedureRecord,
  SEEDED_PROCEDURES,
} from "./procedure.ts";
import * as s from "./schema/index.ts";
import { AttributionCandidate } from "./speakership.ts";
import type {
  AuthorityFixture,
  AuthorityRecord,
  ClaimFixture,
  EvidenceItemFixture,
  EvidencePackFixture,
  ProcedureFixture,
  PublicationFixture,
  Store,
  StoreFixtures,
  TestStore,
  VerdictRecord,
  VerdictWrite,
} from "./store-api.ts";

// Append-only tables (STORE §2.4, STO-R1). Exported so the store suite can
// assert it against the guard triggers actually present in the database — the
// one schema fact that cannot be derived from a column type (Sept 2026).
export const APPEND_ONLY_TABLES = [
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
    const claimKey = fixture.claimKey ?? null;
    const [r] = await this.db
      .insert(s.claim)
      .values({
        claimKey,
        publicationId: fixture.publicationId ?? null,
        utteranceText: fixture.utteranceText,
        text: fixture.text,
        claimType: fixture.claimType,
        speakershipClass: fixture.speakershipClass ?? null,
        speakershipMethod: fixture.speakershipMethod ?? null,
        genre: fixture.genre ?? null,
        discourseContext: fixture.discourseContext,
        triageRecord: fixture.triageRecord ?? null,
        mediaAnchor: fixture.mediaAnchor ?? null,
        spokenAt: fixture.spokenAt ?? null,
        transcriptTier: fixture.transcriptTier ?? null,
        pipelineVersion: "test",
        attributionCandidates: z
          .array(AttributionCandidate)
          .parse(fixture.attributionCandidates ?? []),
      })
      // Idempotent on content identity (TRI-R13): a re-ingest of the same
      // document finds the claim it already made. Without this, a re-triage
      // whose set-aside boundary moved — which happens, because the checkability
      // decision is a model judgement — creates a second claim for the same
      // sentence, with its own verdict and its own trail, and nothing points at
      // the original. The EXISTING row wins and is never updated: a claim is
      // written once, so the record on its page stays the run that produced it.
      .onConflictDoNothing()
      .returning({ claimId: s.claim.claimId });
    if (r != null) return { claimId: r.claimId, ...fixture };
    if (claimKey == null) throw new Error("claim insert returned no row");
    const [existing] = await this.db
      .select({ claimId: s.claim.claimId })
      .from(s.claim)
      .where(eq(s.claim.claimKey, claimKey))
      .limit(1);
    if (existing == null) throw new Error("claim upsert produced no row");
    return { claimId: existing.claimId, ...fixture };
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
    // The plan is its own row (ADR-0023 §5), inserted here so a pack and the
    // plan that produced it can never exist in different states. Validated at the
    // boundary: a plan with a declined required step and no reason is a defect,
    // and the schema refuses to store one.
    if (fixture.plan != null) {
      // Parsed and checked through the shared rule, not a local copy: the plan
      // shape has exactly one definition (`./procedure.ts`) and so does the
      // question of whether a plan is acceptable.
      const plan = PlanSchema.parse(fixture.plan);
      assertPlanValid(plan);
      await this.db.insert(s.verificationPlan).values({ packId: r.packId, plan });
    }
    return { packId: r.packId };
  }

  /**
   * Add or update a procedure library row (ADR-0023 §2). On conflict the row is
   * left ALONE rather than overwritten: a procedure's declared bound and
   * rationale are part of what was published when a verdict used it, so changing
   * one means a new `version`, not an edit. This is the same rule the verdict
   * tables live under, applied to the library.
   */
  async recordProcedure(fixture: ProcedureFixture): Promise<{ procedureRef: string }> {
    const parsed = ProcedureRecord.parse(fixture);
    await this.db
      .insert(s.procedure)
      .values({
        procedureRef: parsed.procedureRef,
        version: parsed.version,
        kind: parsed.kind,
        title: parsed.title,
        consumes: parsed.consumes,
        produces: parsed.produces,
        cannotEstablish: parsed.cannotEstablish,
        rationale: parsed.rationale,
        discoveredBy: parsed.discoveredBy,
        searchRefs: parsed.searchRefs,
        status: parsed.status,
      })
      .onConflictDoNothing();
    return { procedureRef: parsed.procedureRef };
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

  /**
   * The active procedure library (ADR-0023 §3). The planner SUGGESTS from this
   * and is never bound by it — a planner that could only choose from here would
   * have the fixed taxonomy back under a different name.
   *
   * Retired rows are excluded, like retired authorities: a procedure that was
   * withdrawn must stop being suggested, while its row stays for the verdicts
   * that used it.
   */
  async listProcedures(): Promise<ProcedureFixture[]> {
    const rows = await this.db
      .select()
      .from(s.procedure)
      .where(eq(s.procedure.status, "active"))
      .orderBy(s.procedure.procedureRef);
    return rows.map((r) => ({
      procedureRef: r.procedureRef,
      version: r.version,
      kind: r.kind as ProcedureFixture["kind"],
      title: r.title,
      consumes: (r.consumes ?? []) as string[],
      produces: (r.produces ?? []) as string[],
      cannotEstablish: r.cannotEstablish,
      rationale: r.rationale,
      discoveredBy: r.discoveredBy,
      searchRefs: (r.searchRefs ?? []) as string[],
      status: r.status as "active" | "retired",
    }));
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

  // These probes DELIBERATELY send a hand-written statement to the raw pool:
  // their job is to prove the DATABASE rejects UPDATE/DELETE regardless of the
  // client library, so they must not go through drizzle's typed builder (that
  // would test drizzle, not the guards).

  // They also stay on `pool.query` rather than `db.execute(sql…)` on purpose:
  // drizzle wraps driver failures in its own `Failed query: …` error, which
  // HIDES the guard's message — `"publication" is append-only`, the executable
  // documentation of STORE §2.4 — from everyone who sees the failure (Sept 2026).
  // The identifiers are still not hand-typed: `idColumn` reads the primary key
  // from the schema, so a column rename cannot silently desynchronise them.
  async tryUpdate(table: (typeof APPEND_ONLY_TABLES)[number]): Promise<unknown> {
    await this.seedProbeRow(table);
    const id = idColumn(table);
    return this.pool.query(`UPDATE ${table} SET ${id} = ${id} WHERE ${id} IS NOT NULL`);
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

  // Postgres introspection (has_table_privilege) — not a drizzle query-builder
  // use case, so the statement is hand-written; the arguments are still bound.
  private async hasPrivilege(role: string, table: string, privilege: string): Promise<boolean> {
    const result = await this.db.execute(
      sql`SELECT has_table_privilege(${role}, ${table}, ${privilege}) AS allowed`,
    );
    return result.rows[0]?.allowed === true;
  }
}

/**
 * Primary-key column name per table, read from the Drizzle schema. This was a
 * hand-written map; a table added without updating it threw only when a probe
 * happened to touch that table, and the drill's parallel lists had already
 * drifted by the time anyone noticed (Sept 2026). Deriving it makes the schema
 * the single place a column name is stated.
 */
const ID_COLUMN_BY_TABLE: Record<string, string | undefined> = Object.fromEntries(
  Object.values(s)
    .filter((value) => is(value, PgTable))
    .map((table) => {
      const config = getTableConfig(table);
      return [config.name, config.columns.find((column) => column.primary)?.name];
    }),
);

function idColumn(table: string): string {
  const column = ID_COLUMN_BY_TABLE[table];
  if (column === undefined) {
    throw new Error(`no primary-key column found in the schema for table ${table}`);
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
      // This fixture carried the six-part fingerprint. Removed with the object
      // (ADR-0023); the figures procedure parses the window and magnitude it
      // needs at the point of use.
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
      promptVersions: {
        "triage-typing": "triage-typing@1",
        "citation-compare": "citation-compare@1",
      },
      modelVersions: { "citation-compare": "model-x@v1" },
      searchRefs: ["brave:query-hash"],
    }),
  };
}

/**
 * The scratch database name for a suite, made unique PER PROCESS.
 *
 * One suffix per suite handles vitest's parallel forks, but not two sessions (or
 * two CI shards) running the same suite at once: they picked the same name, and
 * each `DROP DATABASE … WITH (FORCE)` killed the other's connections mid-test.
 * Three sessions doing that wedged the container runtime outright on
 * 2026-09-13, leaving 18 stale scratch databases behind. The run id is the
 * process, so nothing has to be coordinated: two runs cannot collide, whatever
 * they are doing. Set `CW_TEST_RUN_ID` to pin it (CI shards log the value).
 *
 * `scratchDatabaseUrl` is exported so a suite that needs the URL derives it the
 * same way this does, instead of appending to the connection string by hand —
 * which silently ignored query parameters and could not have produced a name
 * this function would accept.
 */
export function scratchDatabaseUrl(databaseUrl: string, scratchSuffix: string): string {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${scratchDatabaseName(databaseUrl, scratchSuffix)}`;
  return parsed.toString();
}

function scratchDatabaseName(databaseUrl: string, scratchSuffix: string): string {
  const runId = process.env.CW_TEST_RUN_ID ?? `p${process.pid}`;
  const name = `${new URL(databaseUrl).pathname.replace(/^\//, "")}${scratchSuffix}_${runId}`;
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`unsafe scratch database name: ${name}`);
  }
  return name;
}

export async function createTestStore(
  databaseUrl: string,
  opts?: { scratchSuffix?: string },
): Promise<TestStore> {
  let url = databaseUrl;
  if (opts?.scratchSuffix) {
    // Vitest runs files in parallel forks; every suite gets its own scratch
    // database, created on demand, and the run id keeps other sessions out of it.
    const scratchName = scratchDatabaseName(databaseUrl, opts.scratchSuffix);
    // Drop + recreate the WHOLE scratch database — not just the public
    // schema. Drizzle tracks applied migrations in its own schema
    // (drizzle.__drizzle_migrations), so a public-only wipe leaves stale
    // "applied" rows while the tables are gone; the next migrate() then
    // no-ops on an empty database.
    const admin = new Pool({ connectionString: databaseUrl });
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${scratchName}"`);
    } finally {
      await admin.end();
    }
    url = scratchDatabaseUrl(databaseUrl, opts.scratchSuffix);
  }
  const pool = new Pool({ connectionString: url });
  const appliedMigrations = await migrate(pool);
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
  // Migrations apply the full chain — tables, seeds, append-only guards,
  // roles — via Drizzle's native migrator. Everything the old TS-side
  // ensureRoles/ensureAppendOnlyGuards helpers did now lives in the
  // migration chain (0001_seeds / 0002_guards / 0003_roles).
  const appliedMigrations = await migrate(pool);
  return new PgStore(pool, appliedMigrations);
}

/**
 * Migration entrypoint: delegates to Drizzle's native migrator, which applies
 * the generated chain in packages/store/drizzle/ and tracks applied state in
 * the drizzle_migrations table — native concurrency handling, no custom
 * locks. Idempotent: safe on every service startup.
 */
export async function migrate(pool: Pool): Promise<string[]> {
  const db = drizzle(pool);
  // The migrations folder ships inside the @cw/store package. Bundlers
  // (Next.js turbopack) rewrite import.meta.url, so anchor on the package
  // location via require.resolve of our own package.json.
  const pkgJsonPath = createRequire(import.meta.url).resolve("../package.json");
  const migrationsFolder = join(dirname(pkgJsonPath), "drizzle");
  await migrateDb(db, { migrationsFolder });
  // The procedure library's seeded rows (ADR-0023 §1) are written here rather
  // than as hand-written SQL in the chain: the generated migration stays purely
  // generated and reviewable, the ref list and the rows that carry its rationale
  // live in one file and cannot drift apart, and an upsert skips any row that
  // already exists so re-running the chain is a no-op — the same idempotency the
  // authority seeds get from their `WHERE NOT EXISTS` guard.
  //
  // Seed rows are marked `discoveredBy: "seed"` so a reader of the table can tell
  // a designed entry from one the pipeline found (the `0001_seeds.sql`
  // convention).
  for (const seed of SEEDED_PROCEDURES) {
    const parsed = ProcedureRecord.parse(seed);
    await db
      .insert(s.procedure)
      .values({
        procedureRef: parsed.procedureRef,
        version: parsed.version,
        kind: parsed.kind,
        title: parsed.title,
        consumes: parsed.consumes,
        produces: parsed.produces,
        cannotEstablish: parsed.cannotEstablish,
        rationale: parsed.rationale,
        discoveredBy: parsed.discoveredBy,
        searchRefs: parsed.searchRefs,
        status: parsed.status,
      })
      .onConflictDoNothing();
  }
  return ["drizzle-chain", "procedure-seeds"];
}
