CREATE TABLE "core"."login_attempts" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"failures" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "login_attempts_key_check" CHECK ("core"."login_attempts"."key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "login_attempts_failures_check" CHECK ("core"."login_attempts"."failures" >= 0),
	CONSTRAINT "login_attempts_expiry_check" CHECK ("core"."login_attempts"."locked_until" IS NULL OR "core"."login_attempts"."expires_at" >= "core"."login_attempts"."locked_until")
);
--> statement-breakpoint
CREATE TABLE "ops"."attachment_files" (
	"key" uuid PRIMARY KEY NOT NULL,
	"bytes" "bytea" NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachment_files_size_check" CHECK ("ops"."attachment_files"."size_bytes" BETWEEN 1 AND 8388608 AND "ops"."attachment_files"."size_bytes" = octet_length("ops"."attachment_files"."bytes"))
);
--> statement-breakpoint
ALTER TABLE "ops"."attachments" DROP CONSTRAINT "attachments_owner_kind_check";--> statement-breakpoint
ALTER TABLE "academic"."teacher_unavailability" ADD COLUMN "source" text DEFAULT 'coordinator' NOT NULL;--> statement-breakpoint
ALTER TABLE "academic"."teacher_unavailability" ADD COLUMN "ops_leave_record_id" uuid;--> statement-breakpoint
CREATE INDEX "login_attempts_expires_idx" ON "core"."login_attempts" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_unavailability_ops_leave_record_key" ON "academic"."teacher_unavailability" USING btree ("ops_leave_record_id") WHERE "academic"."teacher_unavailability"."ops_leave_record_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "academic"."teacher_unavailability" ADD CONSTRAINT "teacher_unavailability_source_check" CHECK ("academic"."teacher_unavailability"."source" IN ('coordinator', 'hr_leave') AND ("academic"."teacher_unavailability"."source" = 'hr_leave') = ("academic"."teacher_unavailability"."ops_leave_record_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "ops"."attachments" ADD CONSTRAINT "attachments_owner_kind_check" CHECK ("ops"."attachments"."owner_kind" IN ('task', 'task_submission', 'task_update', 'attendance_correction', 'feedback_import', 'feedback_evidence', 'work_report', 'staff_private', 'hr_request', 'assessment_paper', 'assessment_key', 'score_import', 'leave_application'));