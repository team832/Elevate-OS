CREATE TABLE "ops"."teacher_report_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"reference_code" text NOT NULL,
	"kind" text DEFAULT 'internal' NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"template_version" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_sha256" text NOT NULL,
	"source_refs" jsonb,
	"generated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_report_exports_period_check" CHECK ("ops"."teacher_report_exports"."period_from" <= "ops"."teacher_report_exports"."period_to"),
	CONSTRAINT "teacher_report_exports_reference_format" CHECK ("ops"."teacher_report_exports"."reference_code" ~ '^TR-[0-9A-Z]{10}$'),
	CONSTRAINT "teacher_report_exports_kind_check" CHECK ("ops"."teacher_report_exports"."kind" IN ('internal')),
	CONSTRAINT "teacher_report_exports_sha256_format" CHECK ("ops"."teacher_report_exports"."snapshot_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "ops"."teacher_report_exports" ADD CONSTRAINT "teacher_report_exports_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."teacher_report_exports" ADD CONSTRAINT "teacher_report_exports_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_report_exports_reference_key" ON "ops"."teacher_report_exports" USING btree ("reference_code");--> statement-breakpoint
CREATE INDEX "teacher_report_exports_staff_idx" ON "ops"."teacher_report_exports" USING btree ("staff_id","created_at");