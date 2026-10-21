CREATE TABLE "ops"."fee_structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"programme_codes" text[] NOT NULL,
	"label" text NOT NULL,
	"mode" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"billing_period" text DEFAULT 'course_total' NOT NULL,
	"instalment_count" integer,
	"instalment_note" text,
	"billing_note" text,
	"source" text NOT NULL,
	"source_note" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_structures_codes_check" CHECK (cardinality("ops"."fee_structures"."programme_codes") BETWEEN 1 AND 3),
	CONSTRAINT "fee_structures_mode_check" CHECK ("ops"."fee_structures"."mode" IN ('online', 'offline_sikar', 'both')),
	CONSTRAINT "fee_structures_period_check" CHECK ("ops"."fee_structures"."billing_period" IN ('course_total', 'per_month')),
	CONSTRAINT "fee_structures_source_check" CHECK ("ops"."fee_structures"."source" IN ('sample', 'website_stated', 'owner_approved')),
	CONSTRAINT "fee_structures_status_check" CHECK ("ops"."fee_structures"."status" IN ('draft', 'approved')),
	CONSTRAINT "fee_structures_amount_positive" CHECK ("ops"."fee_structures"."amount_paise" > 0),
	CONSTRAINT "fee_structures_instalments_check" CHECK ("ops"."fee_structures"."instalment_count" IS NULL OR "ops"."fee_structures"."instalment_count" BETWEEN 1 AND 24),
	CONSTRAINT "fee_structures_sample_check" CHECK ("ops"."fee_structures"."is_sample" = ("ops"."fee_structures"."source" = 'sample')),
	CONSTRAINT "fee_structures_approved_check" CHECK ("ops"."fee_structures"."status" <> 'approved' OR "ops"."fee_structures"."source" = 'owner_approved')
);
--> statement-breakpoint
ALTER TABLE "ops"."fee_structures" ADD CONSTRAINT "fee_structures_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_structures_combination_mode_key" ON "ops"."fee_structures" USING btree ("programme_codes","mode");