CREATE TABLE "double_label" (
	"double_label_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"first_label_id" uuid NOT NULL,
	"second_label_id" uuid NOT NULL,
	"agreement" boolean NOT NULL,
	CONSTRAINT "double_label_distinct" CHECK ("double_label"."first_label_id" <> "double_label"."second_label_id")
);
--> statement-breakpoint
CREATE TABLE "label" (
	"label_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label_set_version" text DEFAULT 'unassigned' NOT NULL,
	"claim_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"confidence" text NOT NULL,
	"cited_sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"labeller_reasoning" text NOT NULL,
	"evidence_availability" text NOT NULL,
	"source_ecosystem" text NOT NULL,
	"labeller_id" text NOT NULL,
	"label_date" timestamp with time zone NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "label_verdict_valid" CHECK ("label"."verdict" IN ('supported','refuted','not_enough_evidence','conflicting_cherry_picking')),
	CONSTRAINT "label_confidence_valid" CHECK ("label"."confidence" IN ('high','medium','low'))
);
--> statement-breakpoint
CREATE TABLE "label_set" (
	"label_set_version" text PRIMARY KEY NOT NULL,
	"notes" text,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stratum_assignment" (
	"claim_id" uuid NOT NULL,
	"stratum" text NOT NULL,
	"assignment_version" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stratum_assignment_claim_id_assignment_version_pk" PRIMARY KEY("claim_id","assignment_version")
);
--> statement-breakpoint
ALTER TABLE "double_label" ADD CONSTRAINT "double_label_first_label_id_label_label_id_fk" FOREIGN KEY ("first_label_id") REFERENCES "public"."label"("label_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "double_label" ADD CONSTRAINT "double_label_second_label_id_label_label_id_fk" FOREIGN KEY ("second_label_id") REFERENCES "public"."label"("label_id") ON DELETE no action ON UPDATE no action;