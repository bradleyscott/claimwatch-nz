CREATE TABLE "procedure" (
	"procedure_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"procedure_ref" text NOT NULL,
	"version" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"consumes" jsonb NOT NULL,
	"produces" jsonb NOT NULL,
	"cannot_establish" text NOT NULL,
	"rationale" text NOT NULL,
	"discovered_by" text NOT NULL,
	"search_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procedure_kind_valid" CHECK ("procedure"."kind" IN ('deterministic','research')),
	CONSTRAINT "procedure_status_valid" CHECK ("procedure"."status" IN ('active','retired'))
);
--> statement-breakpoint
CREATE TABLE "verification_plan" (
	"plan_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"plan" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claim" DROP CONSTRAINT "verification_mode_valid";--> statement-breakpoint
DROP INDEX "claim_fingerprint_idx";--> statement-breakpoint
ALTER TABLE "verification_plan" ADD CONSTRAINT "verification_plan_pack_id_evidence_pack_pack_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."evidence_pack"("pack_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "procedure_ref_version_uq" ON "procedure" USING btree ("procedure_ref","version");--> statement-breakpoint
CREATE INDEX "procedure_status_idx" ON "procedure" USING btree ("status");--> statement-breakpoint
CREATE INDEX "verification_plan_pack_idx" ON "verification_plan" USING btree ("pack_id");--> statement-breakpoint
ALTER TABLE "claim" DROP COLUMN "verification_mode";--> statement-breakpoint
ALTER TABLE "claim" DROP COLUMN "fingerprint";--> statement-breakpoint
ALTER TABLE "claim" DROP COLUMN "fingerprint_key";