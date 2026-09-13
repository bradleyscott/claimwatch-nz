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
    // The claim's CONTENT IDENTITY, derived by triage from the sentence text,
    // the window it was read in and its type (`claimIdFor` in
    // packages/pipeline/src/triage.ts). Unique, so re-ingesting the same document
    // finds the claim it already made instead of making a second one.
    //
    // This is the key TRIAGE §5's "append-idempotent on fingerprint" actually
    // needs: a fingerprint exists for statistical claims only, so it cannot
    // dedupe a quotation or a cited-document claim at all. Nullable because rows
    // ingested before this column exist and because a caller with no triage
    // behind it has no key to give — Postgres allows many NULLs in a unique
    // index, so those rows stay insertable without weakening the constraint.
    claimKey: text("claim_key"),
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
    // Whose words this sentence is (ADR-0019): the `attribute` stage's decision,
    // made at ingestion BEFORE triage reads it, and the eligibility gate on the
    // public record. The first live lane published a verdict about RNZ's own
    // narration — a compound sentence the reporter synthesised, with no speaker —
    // because nothing said which sentences are ours to check.
    //
    // Null means NO decision was recorded: every row ingested before the rule
    // existed, and any writer that has not classified the sentence yet. The
    // reader treats that as NOT eligible (`speakership.ts`), so a claim cannot
    // reach the public record by never being assessed. `quoted-actor` and
    // `author-claim` are the eligible classes; `outlet-prose` and `unresolved`
    // are recorded, never verified.
    speakershipClass: text("speakership_class"),
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
    // Re-ingest idempotency (TRI-R13/STO-R13): one row per content identity, so a
    // re-triage that reaches the same conclusion about the same sentence cannot
    // accumulate a duplicate claim with its own verdict and its own trail.
    uniqueIndex("claim_key_uq").on(t.claimKey),
    check(
      "verification_mode_valid",
      sql`${t.verificationMode} IS NULL OR ${t.verificationMode} IN ('stat-grid','citation-check','quote-fidelity','provenance','open-web')`,
    ),
    // ADR-0019 §1's four classes. The CHECK is the schema-side half of the
    // eligibility rule: `speakership.ts` decides which are publishable, and a
    // value outside the vocabulary cannot be written at all (the site gate and
    // the pipeline classifier both derive from that one list).
    check(
      "speakership_class_valid",
      sql`${t.speakershipClass} IS NULL OR ${t.speakershipClass} IN ('quoted-actor','author-claim','outlet-prose','unresolved')`,
    ),
  ],
);
