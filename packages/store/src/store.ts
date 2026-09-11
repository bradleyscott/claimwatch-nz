// Store implementation: real Postgres via Drizzle. Append-only enforced by
// grants + triggers in SQL (applied by ensureGuards); fixtures serve the tests.
// Contract: store-api.ts (frozen — tests authored first).

import { Pool } from "pg";
import type {
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
  // Derived supersession index: verdictId → the verdict that superseded it.
  // Append-only tables are never UPDATEd; supersede is derivable from
  // monotonic versions and indexed here for the returned live records.
  private supersededByIndex = new Map<string, string>();

  constructor(pool: Pool, appliedMigrations: string[]) {
    this.pool = pool;
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
    const insert = await this.pool.query(
      `INSERT INTO publication (source_id, canonical_url, content_hash, retrieved_at, retrieval_method, pipeline_version, raw_ref, text)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (content_hash) DO NOTHING
       RETURNING publication_id, content_hash, retrieved_at, retrieval_method, pipeline_version`,
      [
        fixture.sourceId,
        fixture.canonicalUrl,
        fixture.contentHash,
        fixture.retrievedAt,
        fixture.retrievalMethod,
        fixture.pipelineVersion,
        fixture.rawRef,
        fixture.text,
      ],
    );
    const rows =
      insert.rows.length > 0
        ? insert.rows
        : (
            await this.pool.query(
              `SELECT publication_id, content_hash, retrieved_at, retrieval_method, pipeline_version FROM publication WHERE content_hash = $1`,
              [fixture.contentHash],
            )
          ).rows;
    const r = rows[0];
    return {
      publicationId: r.publication_id,
      contentHash: r.content_hash,
      retrievedAt: r.retrieved_at,
      retrievalMethod: r.retrieval_method,
      pipelineVersion: r.pipeline_version,
    };
  }

  async countPublications(canonicalUrl: string): Promise<number> {
    const r = await this.pool.query(
      "SELECT COUNT(*)::int AS n FROM publication WHERE canonical_url = $1",
      [canonicalUrl],
    );
    return r.rows[0].n;
  }

  async recordClaim(fixture: ClaimFixture): Promise<{ claimId: string } & ClaimFixture> {
    const rows = await this.pool.query(
      `INSERT INTO claim (publication_id, utterance_text, text, claim_type, fingerprint, discourse_context, media_anchor, transcript_tier, pipeline_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING claim_id`,
      [
        fixture.publicationId ?? null,
        fixture.utteranceText,
        fixture.text,
        fixture.claimType,
        fixture.fingerprint ? JSON.stringify(fixture.fingerprint) : null,
        JSON.stringify(fixture.discourseContext),
        fixture.mediaAnchor ? JSON.stringify(fixture.mediaAnchor) : null,
        fixture.transcriptTier ?? null,
        "test",
      ],
    );
    return { claimId: rows.rows[0].claim_id, ...fixture };
  }

  async recordEvidenceItem(fixture: EvidenceItemFixture): Promise<{
    itemId: string;
    version: number;
    vintageDate: Date;
    retrievedAt: Date;
    archiveSnapshotUrl: string;
  }> {
    const prior = await this.pool.query(
      `SELECT COALESCE(MAX(version),0) AS v FROM evidence_item WHERE series_identity = $1`,
      [fixture.seriesIdentity],
    );
    const version = prior.rows[0].v + 1;
    const rows = await this.pool.query(
      `INSERT INTO evidence_item (claim_id, authority_ref, series_identity, vintage_date, retrieved_at, url, archive_snapshot_url, content_hash, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING item_id, version, vintage_date, retrieved_at, archive_snapshot_url`,
      [
        fixture.claimId ?? null,
        fixture.authorityRef,
        fixture.seriesIdentity,
        fixture.vintageDate,
        new Date(),
        fixture.url,
        fixture.archiveSnapshotUrl,
        fixture.contentHash,
        version,
      ],
    );
    const r = rows.rows[0];
    return {
      itemId: r.item_id,
      version: r.version,
      vintageDate: r.vintage_date,
      retrievedAt: r.retrieved_at,
      archiveSnapshotUrl: r.archive_snapshot_url,
    };
  }

  async appendEvidencePack(
    claimId: string,
    fixture: EvidencePackFixture,
  ): Promise<{ packId: string }> {
    const rows = await this.pool.query(
      `INSERT INTO evidence_pack (claim_id, item_refs, grid_result, justifications, nli_outcome)
       VALUES ($1,$2,$3,$4,$5) RETURNING pack_id`,
      [
        claimId,
        JSON.stringify(fixture.itemRefs),
        fixture.gridResult ? JSON.stringify(fixture.gridResult) : null,
        JSON.stringify(fixture.justifications),
        fixture.nliOutcome,
      ],
    );
    return { packId: rows.rows[0].pack_id };
  }

  async writeVerdict(claimId: string, packId: string, write: VerdictWrite): Promise<VerdictRecord> {
    if (!write.provenance) {
      throw new Error("verdict requires full provenance (STO-R10)");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const prior = await client.query(
        `SELECT version FROM verdict_version WHERE claim_id = $1 ORDER BY version DESC LIMIT 1`,
        [claimId],
      );
      const version = (prior.rows[0]?.version ?? 0) + 1;
      const provRows = await client.query(
        `INSERT INTO verdict_provenance (pipeline_version, prompt_versions, model_versions, search_refs)
         VALUES ($1,$2,$3,$4) RETURNING provenance_id`,
        [
          write.provenance.pipelineVersion,
          JSON.stringify(write.provenance.promptVersions),
          JSON.stringify(write.provenance.modelVersions),
          JSON.stringify(write.provenance.searchRefs),
        ],
      );
      const provenanceId = provRows.rows[0].provenance_id;
      const inserted = await client.query(
        `INSERT INTO verdict_version (claim_id, version, status, verdict_class, confidence, evidence_pack_id, provenance_id, diff)
         VALUES ($1,$2,'DRAFT',$3,$4,$5,$6,$7) RETURNING verdict_id`,
        [
          claimId,
          version,
          write.verdictClass ?? "not_enough_evidence",
          write.confidence != null ? String(write.confidence) : null,
          packId,
          provenanceId,
          null,
        ],
      );
      const verdictId = inserted.rows[0].verdict_id;
      let diff: VerdictRecord["diff"] = null;
      if (version > 1) {
        const prev = await client.query(
          `SELECT verdict_class, verdict_id FROM verdict_version WHERE claim_id = $1 AND version = $2`,
          [claimId, version - 1],
        );
        diff = {
          verdictClass: {
            from: prev.rows[0].verdict_class,
            to: write.verdictClass ?? "not_enough_evidence",
          },
        };
        // Append-only: never UPDATE the superseded row. Monotonic versions make
        // "superseded" derivable — a v(n) is superseded iff v(n+1) exists. The
        // live-record getter below exposes that without touching v1's row.
        this.supersededByIndex.set(prev.rows[0].verdict_id, verdictId);
      }
      await client.query("COMMIT");
      const index = this.supersededByIndex;
      return {
        verdictId,
        claimId,
        version,
        status: "DRAFT",
        verdictClass: write.verdictClass ?? "not_enough_evidence",
        confidence: write.confidence ?? 0,
        evidencePackId: packId,
        provenance: write.provenance,
        diff,
        get supersededBy() {
          return index.get(verdictId) ?? null;
        },
      };
    } finally {
      client.release();
    }
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
    await this.pool.query(
      `INSERT INTO verdict_transition_log (verdict_id, from_status, to_status, reason, actor, at)
       VALUES ($1,$2,$3,$4,'pipeline',$5)`,
      [
        verdictId,
        transition.from,
        transition.to,
        transition.reason ?? null,
        transition.at ?? new Date(),
      ],
    );
  }

  async transitions(
    verdictId: string,
  ): Promise<Array<{ from: string; to: string; at: Date; reason: string | null }>> {
    const rows = await this.pool.query(
      `SELECT from_status, to_status, at, reason FROM verdict_transition_log WHERE verdict_id = $1 ORDER BY at`,
      [verdictId],
    );
    return rows.rows.map((r) => ({
      from: r.from_status,
      to: r.to_status,
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
    await this.pool.query(
      `INSERT INTO fallback_log (lane, source_id, stage, tier, reason) VALUES ($1,$2,$3,$4,$5)`,
      [event.lane, event.sourceId, event.stage, event.tier, event.reason],
    );
  }

  async fallbackRateByLane(): Promise<Array<{ lane: string; count: number }>> {
    const rows = await this.pool.query(
      `SELECT lane, COUNT(*)::int AS count FROM fallback_log GROUP BY lane ORDER BY lane`,
    );
    return rows.rows.map((r) => ({ lane: r.lane, count: r.count }));
  }

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

export async function ensureAppendOnlyGuards(pool: Pool): Promise<void> {
  for (const table of APPEND_ONLY_TABLES) {
    await pool.query(`
      CREATE OR REPLACE FUNCTION ${table}_append_only_guard() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await pool.query(`DROP TRIGGER IF EXISTS ${table}_append_only ON ${table}`);
    await pool.query(
      `CREATE TRIGGER ${table}_append_only BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${table}_append_only_guard()`,
    );
  }
}
