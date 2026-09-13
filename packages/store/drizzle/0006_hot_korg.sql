ALTER TABLE "claim" ADD COLUMN "claim_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_key_uq" ON "claim" USING btree ("claim_key");