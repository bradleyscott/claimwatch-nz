// The store contract the L1 tests exercise. This type exists so the failing
// tests compile before implementation; the implementation (Store schema phase)
// fills it in. Signatures mirror docs/design/STORE.md §3 interfaces.

import type { Pool } from "pg";
import type { ProcedureRecord, VerificationPlan } from "./procedure.ts";
import type {
  AttributionCandidate,
  Genre,
  SpeakershipClass,
  SpeakershipMethod,
} from "./speakership.ts";
import type { TriageRecordInput } from "./triage-record.ts";

export interface PublicationFixture {
  sourceId: string;
  canonicalUrl: string;
  contentHash: string;
  retrievedAt: Date;
  retrievalMethod: string;
  pipelineVersion: string;
  rawRef: string;
  text: string;
}

export interface ClaimFixture {
  publicationId?: string;
  utteranceText: string;
  text: string;
  claimType:
    | "statistical"
    | "citation-backed"
    | "broadcast-quote"
    | "institution-citation"
    | "false-context"
    | "other";
  /**
   * The claim's content identity, derived by triage (`TypedClaim.claimId`).
   * Supplying it makes the write idempotent: re-ingesting the same document
   * returns the claim that already exists rather than creating a duplicate
   * (TRI-R13). Absent → the row is inserted unconditionally, which is what a
   * caller with no triage behind it wants.
   */
  claimKey?: string | null;
  /**
   * Whose words this sentence is (ADR-0019 §1), decided by the `attribute`
   * stage before triage reads it. Optional and nullable: absent means NO
   * eligibility decision was recorded, which the reader treats as not
   * publishable — a claim cannot reach the public record by never being
   * assessed. `quoted-actor` and `author-claim` are the eligible classes.
   */
  speakershipClass?: SpeakershipClass | null;
  /**
   * How that class was decided (ADR-0019 §2): the document's own structure, the
   * publishing body by construction, or a classifier. Part of the decision, not
   * metadata about it — a class with no method cannot be disclosed with its
   * confidence, so it does not publish.
   */
  speakershipMethod?: SpeakershipMethod | null;
  /**
   * The document's genre (ADR-0019 §2), which selected the eligibility rule.
   * Stored so the selection is auditable after the fact; a class with no genre
   * does not publish, for the same reason as the method.
   */
  genre?: Genre | null;
  /**
   * Triage's output for the document this claim came from (claim.triage_record)
   * — how many sentences were read, and which were set aside or held. Optional:
   * a caller with only a single sentence to record legitimately has no document
   * record, and the page then omits the section rather than inventing counts.
   */
  triageRecord?: TriageRecordInput | null;
  discourseContext: StoredDiscourseContext;
  mediaAnchor?: MediaAnchor | null;
  // When the claim was made (broadcast moment / publication date), as opposed
  // to when we ingested it. Absent means "not recorded", never "unknown date
  // guessed at" — the public trail omits the step rather than invent one.
  spokenAt?: Date | null;
  transcriptTier?: "publisher-reviewed" | "publisher-auto" | null;
  // Speaker attribution candidates (ADR-0005 entity model): the first
  // candidate renders on the claim card's "who" line.
  attributionCandidates?: AttributionCandidate[];
}

// `Fingerprint` used to be declared here — {indicator, population, geography,
// timeWindow, baseline, unit} — while the pipeline produced a different six-part
// tuple and the stat-grid consumed THAT one. Two shapes, one name, no mapping
// between them, and the flagship verdict's window and magnitude were read out of
// the pipeline's version by regex. ADR-0023 removed it entirely: the window and
// the magnitude are now parsed at the point of use, inside the procedure that
// needs them, and stored with the check that consumed them.

/**
 * The STORED discourse-context shape (ADR-0008), as `claim.discourse_context`
 * holds it. Deliberately not named `DiscourseContext`: triage has a type of that
 * name covering the same material with different field names, and the two being
 * identically named is what let the boundary between them go unwritten for so
 * long — `contextFromLlm` ran in tests only, and nothing mapped its output into
 * this shape, so `attached_proposal` was always null and the verdict page's "as
 * deployed" line could never render (Sept 2026). The mapping is
 * `toStoredDiscourseContext` in `packages/pipeline/src/triage.ts`.
 */
export interface StoredDiscourseContext {
  speechContext?: string | null;
  policyTopic?: string | null;
  attachedProposal?: string | null;
  argumentDirection?: "problem" | "success" | null;
  contextQualifiers?: string | null;
  window: string;
}

export interface MediaAnchor {
  mediaUrl: string;
  startS: number;
  endS: number;
  deepLink: string;
}

export interface EvidenceItemFixture {
  claimId?: string;
  authorityRef: string;
  seriesIdentity: string;
  vintageDate: Date;
  url: string;
  archiveSnapshotUrl: string;
  contentHash: string;
  revised?: boolean;
  // Open-web evidence: what this source actually says relevant to the claim,
  // and its reliability tier (1-6, null when unclassified).
  plainFinding?: string | null;
  tier?: number | null;
}

export interface EvidencePackFixture {
  itemRefs: string[];
  gridResult?: unknown;
  justifications: string[];
  nliOutcome: "pass" | "fail";
  /**
   * The plan this verification ran (ADR-0023). Written alongside the pack as its
   * own append-only row (`verification_plan`), not as a column on the pack,
   * because `evidence_pack` is append-only and backfilling a column into
   * historical rows mutates them.
   */
  plan?: VerificationPlan | null;
  revised?: boolean;
}

/** A procedure library row as the store holds it (ADR-0023 §2). */
export interface ProcedureFixture extends Omit<ProcedureRecord, "searchRefs" | "status"> {
  searchRefs?: string[];
  status?: "active" | "retired";
}

export interface ProvenanceFixture {
  pipelineVersion: string;
  promptVersions: Record<string, string>;
  modelVersions: Record<string, string>;
  searchRefs: string[];
}

export interface VerdictWrite {
  provenance: ProvenanceFixture | null;
  verdictClass?:
    | "supported"
    | "refuted"
    | "not_enough_evidence"
    | "conflicting_cherry_picking"
    | "pledge"
    | "conditional";
  confidence?: number;
}

export interface VerdictRecord {
  verdictId: string;
  claimId: string;
  version: number;
  status: "DRAFT" | "PUBLISHED" | "CONTESTED" | "VALIDATING" | "MUTATED" | "FROZEN";
  verdictClass: NonNullable<VerdictWrite["verdictClass"]>;
  confidence: number;
  evidencePackId: string;
  provenance: ProvenanceFixture;
  diff: Record<string, { from: unknown; to: unknown }> | null;
  supersededBy: string | null;
}

export interface FallbackEvent {
  lane: string;
  sourceId: string;
  stage: string;
  tier: 1 | 2 | 3;
  reason: string;
}

export type AppendOnlyTable =
  | "publication"
  | "evidence_item"
  | "evidence_pack"
  | "verdict_version"
  | "authority";

/**
 * Capability slices of the store (ISP). A consumer depends on the slice it uses,
 * not the whole 25-method surface: the pipeline writes claims, evidence and
 * verdicts; the site reads through `site-reader.ts`; the harness exports.
 *
 * The test-only surfaces — the fixture factory and the append-only probes — are
 * deliberately NOT on `Store`; `createTestStore` returns `TestStore` which adds
 * them, so production code cannot reach them by type.
 */

export interface MigrationState {
  readonly appliedMigrations: readonly string[];
}

export interface PublicationWriter {
  recordPublication(fixture: PublicationFixture): Promise<{
    publicationId: string;
    contentHash: string;
    retrievedAt: Date;
    retrievalMethod: string;
    pipelineVersion: string;
  }>;
  countPublications(canonicalUrl: string): Promise<number>;
}

export interface ClaimWriter {
  recordClaim(fixture: ClaimFixture): Promise<{ claimId: string } & ClaimFixture>;
}

export interface EvidenceWriter {
  recordEvidenceItem(fixture: EvidenceItemFixture): Promise<{
    itemId: string;
    version: number;
    vintageDate: Date;
    retrievedAt: Date;
    archiveSnapshotUrl: string;
  }>;
  appendEvidencePack(claimId: string, fixture: EvidencePackFixture): Promise<{ packId: string }>;
}

export interface VerdictWriter {
  writeVerdict(claimId: string, packId: string, write: VerdictWrite): Promise<VerdictRecord>;
  logTransition(
    verdictId: string,
    transition: { from: string; to: string; at?: Date; reason?: string },
  ): Promise<void>;
  transitions(
    verdictId: string,
  ): Promise<Array<{ from: string; to: string; at: Date; reason: string | null }>>;
}

export interface FallbackLog {
  logFallback(event: FallbackEvent): Promise<void>;
  fallbackRateByLane(): Promise<Array<{ lane: string; count: number }>>;
}

/** Discovered authorities with recorded provenance; append-only like vintages. */
export interface AuthorityRegistry {
  recordAuthority(fixture: AuthorityFixture): Promise<AuthorityRecord>;
  resolveAuthority(domain: string): Promise<AuthorityRecord | null>;
  /** The active procedure library (ADR-0023 §3): what the planner may suggest from. */
  listProcedures(): Promise<ProcedureFixture[]>;
  /** Add a library row. On conflict the existing row is left alone, never edited. */
  recordProcedure(fixture: ProcedureFixture): Promise<{ procedureRef: string }>;
}

/** Append-only enforcement probes (STO-R1). Test-only. */
export interface AppendOnlyProbe {
  tryUpdate(table: AppendOnlyTable): Promise<unknown>;
  tryDelete(table: AppendOnlyTable): Promise<unknown>;
  roleCanInsert(role: string, table: string): Promise<boolean>;
  roleCanUpdate(role: string, table: string): Promise<boolean>;
  roleCanSelect(role: string, table: string): Promise<boolean>;
}

/** Fixture factory. Test-only. */
export interface FixtureProvider {
  readonly fixtures: StoreFixtures;
}

/** The production store: every capability, none of the test-only surface. */
export interface Store
  extends MigrationState,
    PublicationWriter,
    ClaimWriter,
    EvidenceWriter,
    VerdictWriter,
    FallbackLog,
    AuthorityRegistry {
  close(): Promise<void>;
}

/** What `createTestStore` returns: the store plus the test-only surfaces. */
export type TestStore = Store & FixtureProvider & AppendOnlyProbe;

export interface AuthorityRecord {
  authorityId: string;
  domain: string;
  sourceUrl: string;
  authorityRef: string;
  tier: number;
  rationale: string;
  confidence: number;
  discoveredBy: string;
  searchRefs: string[];
  discoveredAt: Date;
}

export interface AuthorityFixture {
  domain: string;
  sourceUrl: string;
  authorityRef: string;
  tier: number;
  rationale: string;
  confidence: number;
  discoveredBy: string;
  searchRefs: string[];
}

export interface StoreFixtures {
  beehiveRelease(): PublicationFixture;
  rnzArticle(): PublicationFixture;
  claimWithoutContext(): ClaimFixture;
  statClaim(): ClaimFixture;
  statsNzSeries(opts?: { revised?: boolean }): EvidenceItemFixture;
  evidencePack(opts?: { revised?: boolean }): EvidencePackFixture;
  fullProvenance(): ProvenanceFixture;
}

export type { Pool };
