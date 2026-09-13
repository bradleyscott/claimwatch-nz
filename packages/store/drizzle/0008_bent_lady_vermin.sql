ALTER TABLE "claim" ADD COLUMN "speakership_method" text;--> statement-breakpoint
ALTER TABLE "claim" ADD COLUMN "genre" text;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "speakership_method_valid" CHECK ("claim"."speakership_method" IS NULL OR "claim"."speakership_method" IN ('structural','by-construction','classified'));--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "genre_valid" CHECK ("claim"."genre" IS NULL OR "claim"."genre" IN ('news-report','opinion-analysis','press-release','transcript','institutional-post'));