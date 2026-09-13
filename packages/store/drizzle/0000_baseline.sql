CREATE TABLE "claim" (
	"claim_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_id" uuid,
	"segment_id" uuid,
	"sentence_span" jsonb,
	"utterance_text" text NOT NULL,
	"text" text NOT NULL,
	"claim_type" text NOT NULL,
	"fingerprint" jsonb,
	"fingerprint_key" text,
	"embedding" text,
	"discourse_context" jsonb NOT NULL,
	"media_anchor" jsonb,
	"transcript_tier" text,
	"caption_quality_flag" text,
	"attribution_candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_curated_fixture" boolean DEFAULT false NOT NULL,
	"pipeline_version" text NOT NULL,
	"prompt_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claimant_entity" (
	"entity_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"affiliation" text,
	"cross_links" jsonb
);
--> statement-breakpoint
CREATE TABLE "publication" (
	"publication_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"canonical_url" text NOT NULL,
	"content_hash" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"retrieval_method" text NOT NULL,
	"pipeline_version" text NOT NULL,
	"publisher" text,
	"raw_ref" text NOT NULL,
	"text" text NOT NULL,
	"transcript" text,
	"transcript_tier" text,
	"track_hash" text,
	"is_curated_fixture" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segment" (
	"segment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_id" uuid,
	"span_start" integer,
	"span_end" integer,
	"summary" text,
	"turn_structure" jsonb
);
--> statement-breakpoint
CREATE TABLE "authority" (
	"authority_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"authority_ref" text NOT NULL,
	"source_url" text NOT NULL,
	"tier" integer NOT NULL,
	"rationale" text NOT NULL,
	"confidence" numeric NOT NULL,
	"discovered_by" text NOT NULL,
	"search_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_item" (
	"item_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid,
	"authority_ref" text NOT NULL,
	"series_identity" text NOT NULL,
	"vintage_date" timestamp with time zone NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"url" text NOT NULL,
	"archive_snapshot_url" text NOT NULL,
	"content_hash" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"plain_finding" text,
	"tier" integer
);
--> statement-breakpoint
CREATE TABLE "evidence_pack" (
	"pack_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"item_refs" jsonb NOT NULL,
	"grid_result" jsonb,
	"justifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nli_outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fallback_log" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lane" text NOT NULL,
	"source_id" text NOT NULL,
	"stage" text NOT NULL,
	"tier" integer NOT NULL,
	"reason" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verdict_provenance" (
	"provenance_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_version" text NOT NULL,
	"prompt_versions" jsonb NOT NULL,
	"model_versions" jsonb NOT NULL,
	"search_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cost_latency_refs" jsonb
);
--> statement-breakpoint
CREATE TABLE "verdict_transition_log" (
	"transition_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"verdict_id" uuid NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"reason" text,
	"actor" text DEFAULT 'pipeline' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verdict_version" (
	"verdict_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"verdict_class" text NOT NULL,
	"confidence" numeric(4, 3),
	"evidence_pack_id" uuid NOT NULL,
	"provenance_id" uuid NOT NULL,
	"diff" jsonb,
	"superseded_by" uuid,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verdict_class_valid" CHECK ("verdict_version"."verdict_class" IN ('supported','refuted','not_enough_evidence','conflicting_cherry_picking','pledge','conditional')),
	CONSTRAINT "verdict_status_valid" CHECK ("verdict_version"."status" IN ('DRAFT','PUBLISHED','CONTESTED','VALIDATING','MUTATED','FROZEN'))
);
--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_publication_id_publication_publication_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publication"("publication_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_segment_id_segment_segment_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segment"("segment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment" ADD CONSTRAINT "segment_publication_id_publication_publication_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publication"("publication_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_item" ADD CONSTRAINT "evidence_item_claim_id_claim_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("claim_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_pack" ADD CONSTRAINT "evidence_pack_claim_id_claim_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("claim_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdict_transition_log" ADD CONSTRAINT "verdict_transition_log_verdict_id_verdict_version_verdict_id_fk" FOREIGN KEY ("verdict_id") REFERENCES "public"."verdict_version"("verdict_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdict_version" ADD CONSTRAINT "verdict_version_claim_id_claim_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("claim_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdict_version" ADD CONSTRAINT "verdict_version_evidence_pack_id_evidence_pack_pack_id_fk" FOREIGN KEY ("evidence_pack_id") REFERENCES "public"."evidence_pack"("pack_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdict_version" ADD CONSTRAINT "verdict_version_provenance_id_verdict_provenance_provenance_id_fk" FOREIGN KEY ("provenance_id") REFERENCES "public"."verdict_provenance"("provenance_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_fingerprint_idx" ON "claim" USING btree ("fingerprint_key");--> statement-breakpoint
CREATE INDEX "claim_publication_idx" ON "claim" USING btree ("publication_id");--> statement-breakpoint
CREATE INDEX "claim_type_idx" ON "claim" USING btree ("claim_type");--> statement-breakpoint
CREATE UNIQUE INDEX "claimant_entity_name_kind_uq" ON "claimant_entity" USING btree ("name","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "publication_content_hash_uq" ON "publication" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "publication_canonical_url_idx" ON "publication" USING btree ("canonical_url");--> statement-breakpoint
CREATE INDEX "publication_source_idx" ON "publication" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "segment_publication_idx" ON "segment" USING btree ("publication_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_item_series_vintage_uq" ON "evidence_item" USING btree ("series_identity","vintage_date","version");--> statement-breakpoint
CREATE INDEX "evidence_item_claim_idx" ON "evidence_item" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "evidence_pack_claim_idx" ON "evidence_pack" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "fallback_log_lane_idx" ON "fallback_log" USING btree ("lane");--> statement-breakpoint
CREATE INDEX "fallback_log_source_stage_idx" ON "fallback_log" USING btree ("source_id","stage");--> statement-breakpoint
CREATE INDEX "verdict_provenance_pipeline_idx" ON "verdict_provenance" USING btree ("pipeline_version");--> statement-breakpoint
CREATE INDEX "verdict_transition_verdict_idx" ON "verdict_transition_log" USING btree ("verdict_id");--> statement-breakpoint
CREATE UNIQUE INDEX "verdict_version_claim_version_uq" ON "verdict_version" USING btree ("claim_id","version");