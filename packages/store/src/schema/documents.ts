// Document hierarchy (ADR-0008): publication → segment → claim.
// Provenance columns are NOT NULL (ING-R13): every record carries source,
// retrieval method, content hash, pipeline version. Hash enforces ingest
// idempotency (STO-R13): same content → same row, never a duplicate.

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const publication = pgTable(
  "publication",
  {
    publicationId: uuid("publication_id").primaryKey().defaultRandom(),
    sourceId: text("source_id").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    contentHash: text("content_hash").notNull(),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    retrievalMethod: text("retrieval_method").notNull(),
    pipelineVersion: text("pipeline_version").notNull(),
    publisher: text("publisher"),
    rawRef: text("raw_ref").notNull(),
    text: text("text").notNull(),
    // Caption lanes (ADR-0007)
    transcript: text("transcript"),
    transcriptTier: text("transcript_tier"), // publisher-reviewed | publisher-auto
    trackHash: text("track_hash"),
    // Curated false-context fixtures (ING-R10) — never a live lane
    isCuratedFixture: boolean("is_curated_fixture").notNull().default(false),
  },
  (t) => [
    uniqueIndex("publication_content_hash_uq").on(t.contentHash),
    index("publication_canonical_url_idx").on(t.canonicalUrl),
    index("publication_source_idx").on(t.sourceId),
  ],
);

export const segment = pgTable(
  "segment",
  {
    segmentId: uuid("segment_id").primaryKey().defaultRandom(),
    publicationId: uuid("publication_id").references(() => publication.publicationId),
    spanStart: integer("span_start"),
    spanEnd: integer("span_end"),
    summary: text("summary"),
    turnStructure: jsonb("turn_structure"),
  },
  (t) => [index("segment_publication_idx").on(t.publicationId)],
);

export const claimantEntity = pgTable(
  "claimant_entity",
  {
    entityId: uuid("entity_id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    kind: text("kind").notNull(), // person | party | institution
    aliases: jsonb("aliases").notNull().default([]),
    affiliation: text("affiliation"), // at time of statement
    crossLinks: jsonb("cross_links"),
  },
  (t) => [uniqueIndex("claimant_entity_name_kind_uq").on(t.name, t.kind)],
);

export const claim = pgTable(
  "claim",
  {
    claimId: uuid("claim_id").primaryKey().defaultRandom(),
    publicationId: uuid("publication_id").references(() => publication.publicationId),
    segmentId: uuid("segment_id").references(() => segment.segmentId),
    sentenceSpan: jsonb("sentence_span"),
    utteranceText: text("utterance_text").notNull(),
    text: text("text").notNull(),
    claimType: text("claim_type").notNull(),
    // Which check this claim got, decided by triage's mode routing BEFORE any
    // evidence is fetched — the one decision that cannot be made honestly after
    // the answer is known, and the field the verdict page's mode-aware trail
    // selects its explanation with (SITE-MVP §2.3, Sept 2026).
    //
    // Stored rather than derived: the four non-statistical modes follow
    // deterministically from `claim_type`, but a statistical claim routes to
    // stat-grid ONLY on an authority-registry hit and to the open-web loop
    // otherwise (mode-routing.ts, Sept 2026) — and the registry is not visible
    // to the site. Null for every row ingested before this column existed, which
    // the page renders as an absent check rather than guessing one.
    verificationMode: text("verification_mode"),
    fingerprint: jsonb("fingerprint"),
    fingerprintKey: text("fingerprint_key"),
    embedding: text("embedding"), // pgvector vector; populated by triage phase
    discourseContext: jsonb("discourse_context").notNull(), // nullable fields inside, never defaulted
    mediaAnchor: jsonb("media_anchor"),
    // When the claim was MADE — the broadcast moment or the publication date of
    // the item it was said in — as distinct from `createdAt`, which is when we
    // ingested it. The public trail needs both to say "said on 8 Sep, checked on
    // 9 Sep" (SITE-MVP §2.3); nullable because some sources carry no usable
    // date and every row ingested before this column existed has none, and an
    // absent date must render as "we do not have this" rather than as a guess.
    spokenAt: timestamp("spoken_at", { withTimezone: true }),
    transcriptTier: text("transcript_tier"),
    captionQualityFlag: text("caption_quality_flag"),
    attributionCandidates: jsonb("attribution_candidates").notNull().default([]),
    // The triage pass's own output for the document this claim came from: how
    // many sentences were classified, which ones were set aside and under which
    // rejection class, and which were held without grading. This is the "what we
    // did not check" disclosure — the honest edge of every verdict, since a
    // finding about one sentence is not a finding about the interview it came
    // from. Computed on every run and discarded until Sept 2026; nullable
    // because rows ingested before it exist, and the page then omits the section
    // rather than rendering an empty one.
    triageRecord: jsonb("triage_record"),
    isCuratedFixture: boolean("is_curated_fixture").notNull().default(false),
    pipelineVersion: text("pipeline_version").notNull(),
    promptVersions: jsonb("prompt_versions").notNull().default({}),
    modelVersion: text("model_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("claim_fingerprint_idx").on(t.fingerprintKey),
    index("claim_publication_idx").on(t.publicationId),
    index("claim_type_idx").on(t.claimType),
    check(
      "verification_mode_valid",
      sql`${t.verificationMode} IS NULL OR ${t.verificationMode} IN ('stat-grid','citation-check','quote-fidelity','provenance','open-web')`,
    ),
  ],
);
