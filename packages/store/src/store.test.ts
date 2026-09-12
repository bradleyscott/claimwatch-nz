// STO-R13 / CRO-R9 — idempotent re-ingest: identical fixture twice → one row.
// STO-R1 — append-only: UPDATE/DELETE raise on append-only tables.
// STO-R3 — vintage_date present and distinct from retrieved_at on series rows.
// STO-R14 — verdict transitions: legal logged, illegal rejected, freeze honoured.
// STO-R15 — context fields absent stay null (no defaults).
// STO-R2 — v1 → v2 with monotonic version + structured diff on validated pack.
// STO-R12 — fallback_log rows land per lane/stage/reason.
// STO-R10 — no verdict without full provenance (write-path constraint).
//
// Authored BEFORE implementation (TDD red). Do not mutate without approval.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestStore } from "./store.ts";
// Contracts under test — implemented in this phase:
//   { migrate, pool, tables, appendOnlyGuards, recordPublication, recordClaim,
//     recordEvidenceItem, appendEvidencePack, writeVerdictV1, writeVerdictV2,
//     logTransition, logFallback, FREEZE_WINDOW }
import type { Store } from "./store-api.ts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — copy .env.example to .env (gitignored) and fill it in`);
  }
  return value;
}

// No committed connection strings (Bradley, Sept 2026): credentials come from
// .env (gitignored — see .env.example) or the CI environment. The database
// name is infra wiring, not a requirement — createTestStore wipes whichever
// database it gets.
const DATABASE_URL = requireEnv("DATABASE_URL");

let store: Store;

beforeAll(async () => {
  store = await createTestStore(DATABASE_URL);
});

afterAll(async () => {
  await store.close();
});

describe("migrations", () => {
  it("applies the full chain from zero into a scratch database", async () => {
    // createTestStore already ran migrate() from zero on the scratch DB.
    expect(store.appliedMigrations.length).toBeGreaterThan(0);
  });

  it("rejects UPDATE and DELETE on append-only tables (STO-R1)", async () => {
    const appendOnly = [
      "publication",
      "evidence_item",
      "evidence_pack",
      "verdict_version",
    ] as const;
    for (const table of appendOnly) {
      await expect(store.tryUpdate(table)).rejects.toThrow();
      await expect(store.tryDelete(table)).rejects.toThrow();
    }
  });

  it("grants pipeline role INSERT/SELECT only, site role SELECT only (STO-R1)", async () => {
    await expect(store.roleCanInsert("pipeline", "publication")).resolves.toBe(true);
    await expect(store.roleCanUpdate("pipeline", "publication")).resolves.toBe(false);
    await expect(store.roleCanSelect("site", "publication")).resolves.toBe(true);
    await expect(store.roleCanUpdate("site", "publication")).resolves.toBe(false);
  });
});

describe("ingest idempotency", () => {
  it("re-ingesting an identical fixture yields one publication row (STO-R13)", async () => {
    const fixture = store.fixtures.beehiveRelease();
    const first = await store.recordPublication(fixture);
    const second = await store.recordPublication(fixture);
    expect(second.publicationId).toBe(first.publicationId);
    const count = await store.countPublications(fixture.canonicalUrl);
    expect(count).toBe(1);
  });

  it("records provenance fields on every publication (ING-R13)", async () => {
    const fixture = store.fixtures.rnzArticle();
    const rec = await store.recordPublication(fixture);
    expect(rec.contentHash).toBeTruthy();
    expect(rec.retrievedAt).toBeInstanceOf(Date);
    expect(rec.retrievalMethod).toBeTruthy();
    expect(rec.pipelineVersion).toBeTruthy();
  });
});

describe("claim records", () => {
  it("keeps context fields null when absent — never defaulted (STO-R15)", async () => {
    const claim = await store.recordClaim(store.fixtures.claimWithoutContext());
    expect(claim.discourseContext.attachedProposal).toBeNull();
    expect(claim.discourseContext.argumentDirection).toBeNull();
  });

  it("stores verbatim utterance + window alongside normalised text (TRI-R7)", async () => {
    const claim = await store.recordClaim(store.fixtures.statClaim());
    expect(claim.utteranceText.length).toBeGreaterThan(0);
    expect(claim.text.length).toBeGreaterThan(0);
    expect(claim.fingerprint).toMatchObject({
      indicator: expect.any(String),
      population: expect.any(String),
      geography: expect.any(String),
      timeWindow: expect.any(String),
      baseline: expect.any(String),
      unit: expect.any(String),
    });
  });
});

describe("evidence and vintages", () => {
  it("stores vintage_date distinct from retrieved_at on every series row (STO-R3)", async () => {
    const item = await store.recordEvidenceItem(store.fixtures.statsNzSeries());
    expect(item.vintageDate).toBeInstanceOf(Date);
    expect(item.retrievedAt).toBeInstanceOf(Date);
    expect(item.vintageDate.getTime()).not.toBe(item.retrievedAt.getTime());
    expect(item.archiveSnapshotUrl).toBeTruthy();
  });

  it("appends a new version on re-fetch instead of updating (STO-R1)", async () => {
    const v1 = await store.recordEvidenceItem(store.fixtures.statsNzSeries());
    const v2 = await store.recordEvidenceItem(store.fixtures.statsNzSeries({ revised: true }));
    expect(v2.version).toBe(v1.version + 1);
    expect(v2.itemId).not.toBe(v1.itemId);
  });
});

describe("verdict versioning", () => {
  it("writes v1 with full provenance — refuses without it (STO-R10)", async () => {
    const claim = await store.recordClaim(store.fixtures.statClaim());
    const pack = await store.appendEvidencePack(claim.claimId, store.fixtures.evidencePack());
    await expect(
      store.writeVerdict(claim.claimId, pack.packId, { provenance: null }),
    ).rejects.toThrow();

    const v1 = await store.writeVerdict(claim.claimId, pack.packId, {
      provenance: store.fixtures.fullProvenance(),
      verdictClass: "conflicting_cherry_picking",
      confidence: 0.72,
    });
    expect(v1.version).toBe(1);
    expect(v1.provenance.pipelineVersion).toBeTruthy();
    expect(v1.provenance.promptVersions.triage).toBeTruthy();
  });

  it("writes v2 with a structured diff on a validated pack (STO-R2)", async () => {
    const claim = await store.recordClaim(store.fixtures.statClaim());
    const pack1 = await store.appendEvidencePack(claim.claimId, store.fixtures.evidencePack());
    const pack2 = await store.appendEvidencePack(
      claim.claimId,
      store.fixtures.evidencePack({ revised: true }),
    );
    const v1 = await store.writeVerdict(claim.claimId, pack1.packId, {
      provenance: store.fixtures.fullProvenance(),
      verdictClass: "conflicting_cherry_picking",
      confidence: 0.72,
    });
    const v2 = await store.writeVerdict(claim.claimId, pack2.packId, {
      provenance: store.fixtures.fullProvenance(),
      verdictClass: "supported",
      confidence: 0.81,
    });
    expect(v2.version).toBe(2);
    expect(v2.supersededBy).toBeNull();
    expect(v1.supersededBy).toBe(v2.verdictId);
    expect(v2.diff).toMatchObject({
      verdictClass: { from: "conflicting_cherry_picking", to: "supported" },
    });
  });
});

describe("transition log and freeze", () => {
  it("logs every legal transition and rejects illegal ones (STO-R14)", async () => {
    const claim = await store.recordClaim(store.fixtures.statClaim());
    const pack = await store.appendEvidencePack(claim.claimId, store.fixtures.evidencePack());
    const v1 = await store.writeVerdict(claim.claimId, pack.packId, {
      provenance: store.fixtures.fullProvenance(),
    });

    await store.logTransition(v1.verdictId, { from: "DRAFT", to: "PUBLISHED", reason: "verified" });
    const logged = await store.transitions(v1.verdictId);
    expect(logged).toHaveLength(1);

    await expect(
      store.logTransition(v1.verdictId, { from: "PUBLISHED", to: "DRAFT" }),
    ).rejects.toThrow();
  });

  it("rejects MUTATED transitions while the freeze window is active (STO-R14)", async () => {
    const claim = await store.recordClaim(store.fixtures.statClaim());
    const pack = await store.appendEvidencePack(claim.claimId, store.fixtures.evidencePack());
    const v1 = await store.writeVerdict(claim.claimId, pack.packId, {
      provenance: store.fixtures.fullProvenance(),
    });
    await store.logTransition(v1.verdictId, { from: "DRAFT", to: "PUBLISHED", reason: "verified" });

    const insideFreeze = new Date("2026-11-10T00:00:00Z");
    await expect(
      store.logTransition(v1.verdictId, { from: "PUBLISHED", to: "MUTATED", at: insideFreeze }),
    ).rejects.toThrow(/freeze/i);
  });
});

describe("fallback log", () => {
  it("lands Tier-2 events with lane/stage/reason, queryable per lane (STO-R12)", async () => {
    await store.logFallback({
      lane: "youtube-captions",
      sourceId: "1news",
      stage: "extract",
      tier: 2,
      reason: "vtt-parse-failed",
    });
    await store.logFallback({
      lane: "beehive-rss",
      sourceId: "beehive",
      stage: "extract",
      tier: 2,
      reason: "readability-empty",
    });
    const rates = await store.fallbackRateByLane();
    expect(rates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ lane: "youtube-captions", count: 1 }),
        expect.objectContaining({ lane: "beehive-rss", count: 1 }),
      ]),
    );
  });
});
