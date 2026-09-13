ALTER TABLE "claim" ADD COLUMN "verification_mode" text;--> statement-breakpoint
ALTER TABLE "claim" ADD COLUMN "triage_record" jsonb;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "verification_mode_valid" CHECK ("claim"."verification_mode" IS NULL OR "claim"."verification_mode" IN ('stat-grid','citation-check','quote-fidelity','provenance','open-web'));