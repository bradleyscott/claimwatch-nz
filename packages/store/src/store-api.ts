// The store contract the L1 tests exercise. This type exists so the failing
// tests compile before implementation; the implementation (Store schema phase)
// fills it in. Signatures mirror docs/design/STORE.md §3 interfaces.

import type { Pool } from "pg";

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
  fingerprint?: Fingerprint | null;
  discourseContext: DiscourseContext;
  mediaAnchor?: MediaAnchor | null;
  // When the claim was made (broadcast moment / publication date), as opposed
  // to when we ingested it. Absent means "not recorded", never "unknown date
  // guessed at" — the public trail omits the step rather than invent one.
  spokenAt?: Date | null;
  transcriptTier?: "publisher-reviewed" | "publisher-auto" | null;
  // Speaker attribution candidates (ADR-0005 entity model): the first
  // candidate renders on the claim card's "who" line.
  attributionCandidates?: Array<{ name: string; kind: string; confidence: number; basis?: string }>;
}

export interface Fingerprint {
  indicator: string;
  population: string;
  geography: string;
  timeWindow: string;
  baseline: string;
  unit: string;
}

export interface DiscourseContext {
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
  revised?: boolean;
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

export interface Store {
  readonly appliedMigrations: readonly string[];
  readonly fixtures: StoreFixtures;
  close(): Promise<void>;

  recordPublication(fixture: PublicationFixture): Promise<{
    publicationId: string;
    contentHash: string;
    retrievedAt: Date;
    retrievalMethod: string;
    pipelineVersion: string;
  }>;
  countPublications(canonicalUrl: string): Promise<number>;

  recordClaim(fixture: ClaimFixture): Promise<{ claimId: string } & ClaimFixture>;
  recordEvidenceItem(fixture: EvidenceItemFixture): Promise<{
    itemId: string;
    version: number;
    vintageDate: Date;
    retrievedAt: Date;
    archiveSnapshotUrl: string;
  }>;
  appendEvidencePack(claimId: string, fixture: EvidencePackFixture): Promise<{ packId: string }>;

  writeVerdict(claimId: string, packId: string, write: VerdictWrite): Promise<VerdictRecord>;
  logTransition(
    verdictId: string,
    transition: { from: string; to: string; at?: Date; reason?: string },
  ): Promise<void>;
  transitions(
    verdictId: string,
  ): Promise<Array<{ from: string; to: string; at: Date; reason: string | null }>>;

  logFallback(event: FallbackEvent): Promise<void>;
  fallbackRateByLane(): Promise<Array<{ lane: string; count: number }>>;

  // Authority registry (user direction Sept 2026): discovered authorities with
  // recorded provenance; append-only like evidence vintages.
  recordAuthority(fixture: AuthorityFixture): Promise<AuthorityRecord>;
  resolveAuthority(domain: string): Promise<AuthorityRecord | null>;

  // Append-only enforcement probes (STO-R1)
  tryUpdate(
    table: "publication" | "evidence_item" | "evidence_pack" | "verdict_version" | "authority",
  ): Promise<unknown>;
  tryDelete(
    table: "publication" | "evidence_item" | "evidence_pack" | "verdict_version" | "authority",
  ): Promise<unknown>;
  roleCanInsert(role: string, table: string): Promise<boolean>;
  roleCanUpdate(role: string, table: string): Promise<boolean>;
  roleCanSelect(role: string, table: string): Promise<boolean>;
}

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
