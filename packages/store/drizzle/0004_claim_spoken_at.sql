-- The claim's own date: when it was MADE (broadcast moment, or the publication
-- date of the item it was said in), as distinct from created_at, which is when
-- we ingested it. Nullable and additive — no historical row is touched, and an
-- absent value renders as "not recorded" on the public trail rather than a guess
-- (SITE-MVP §2.3).
ALTER TABLE "claim" ADD COLUMN "spoken_at" timestamp with time zone;
