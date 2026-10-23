CREATE TABLE "core"."branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'provisional' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_status_check" CHECK ("core"."branches"."status" IN ('active', 'provisional', 'archived')),
	CONSTRAINT "branches_code_format" CHECK ("core"."branches"."code" ~ '^[A-Z][A-Z0-9_]{1,39}$')
);
--> statement-breakpoint
CREATE TABLE "marketing"."campaign_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_members_role_check" CHECK ("marketing"."campaign_members"."role" IN ('owner', 'member')),
	CONSTRAINT "campaign_members_dates_order" CHECK ("marketing"."campaign_members"."to_date" IS NULL OR "marketing"."campaign_members"."to_date" >= "marketing"."campaign_members"."from_date")
);
--> statement-breakpoint
CREATE TABLE "ops"."attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"original_name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"is_sample" boolean DEFAULT false NOT NULL,
	CONSTRAINT "attachments_owner_kind_check" CHECK ("ops"."attachments"."owner_kind" IN ('task', 'task_submission', 'task_update', 'attendance_correction', 'feedback_import', 'feedback_evidence', 'work_report', 'staff_private')),
	CONSTRAINT "attachments_purpose_check" CHECK ("ops"."attachments"."purpose" IN ('reference', 'evidence', 'deliverable', 'source_file', 'preview', 'import_source', 'photo')),
	CONSTRAINT "attachments_size_check" CHECK ("ops"."attachments"."size_bytes" BETWEEN 1 AND 8388608),
	CONSTRAINT "attachments_sha_check" CHECK ("ops"."attachments"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "attachments_name_check" CHECK (length(trim(coalesce("ops"."attachments"."original_name", ''))) > 0 AND length("ops"."attachments"."original_name") <= 255),
	CONSTRAINT "attachments_mime_check" CHECK (length(trim(coalesce("ops"."attachments"."mime", ''))) > 0),
	CONSTRAINT "attachments_storage_key_check" CHECK (length(trim(coalesce("ops"."attachments"."storage_key", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."staff_departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"from_date" date,
	"to_date" date,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_departments_dates_check" CHECK ("ops"."staff_departments"."to_date" IS NULL OR "ops"."staff_departments"."from_date" IS NULL OR "ops"."staff_departments"."to_date" >= "ops"."staff_departments"."from_date")
);
--> statement-breakpoint
CREATE TABLE "ops"."staff_manager_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"manager_staff_id" uuid,
	"from_date" date,
	"to_date" date,
	"changed_by" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_manager_history_dates_check" CHECK ("ops"."staff_manager_history"."to_date" IS NULL OR "ops"."staff_manager_history"."from_date" IS NULL OR "ops"."staff_manager_history"."to_date" >= "ops"."staff_manager_history"."from_date"),
	CONSTRAINT "staff_manager_history_not_self" CHECK ("ops"."staff_manager_history"."manager_staff_id" IS NULL OR "ops"."staff_manager_history"."manager_staff_id" <> "ops"."staff_manager_history"."staff_id")
);
--> statement-breakpoint
CREATE TABLE "ops"."staff_private_details" (
	"staff_id" uuid PRIMARY KEY NOT NULL,
	"personal_phone" text,
	"personal_email" text,
	"address" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"photo_attachment_id" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."attendance_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"requested_status" text,
	"requested_in" timestamp with time zone,
	"requested_out" timestamp with time zone,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_corrections_status_check" CHECK ("ops"."attendance_corrections"."status" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "attendance_corrections_requested_status_check" CHECK ("ops"."attendance_corrections"."requested_status" IS NULL OR "ops"."attendance_corrections"."requested_status" IN ('present', 'absent', 'half_day', 'unmarked', 'on_leave', 'holiday', 'weekly_off')),
	CONSTRAINT "attendance_corrections_reason_check" CHECK (length(trim(coalesce("ops"."attendance_corrections"."reason", ''))) > 0),
	CONSTRAINT "attendance_corrections_something_check" CHECK (num_nonnulls("ops"."attendance_corrections"."requested_status", "ops"."attendance_corrections"."requested_in", "ops"."attendance_corrections"."requested_out") > 0),
	CONSTRAINT "attendance_corrections_decided_check" CHECK (("ops"."attendance_corrections"."status" = 'pending') = ("ops"."attendance_corrections"."decided_at" IS NULL) AND ("ops"."attendance_corrections"."decided_at" IS NULL) = ("ops"."attendance_corrections"."decided_by" IS NULL) AND ("ops"."attendance_corrections"."status" <> 'rejected' OR length(trim(coalesce("ops"."attendance_corrections"."decision_note", ''))) > 0))
);
--> statement-breakpoint
CREATE TABLE "ops"."attendance_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sha256" text NOT NULL,
	"source_label" text NOT NULL,
	"rows" jsonb NOT NULL,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_valid" integer DEFAULT 0 NOT NULL,
	"rows_invalid" integer DEFAULT 0 NOT NULL,
	"rows_duplicate" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'preview' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	"committed_by" uuid,
	"is_sample" boolean DEFAULT false NOT NULL,
	CONSTRAINT "attendance_imports_sha_check" CHECK ("ops"."attendance_imports"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "attendance_imports_status_check" CHECK ("ops"."attendance_imports"."status" IN ('preview', 'committed')),
	CONSTRAINT "attendance_imports_committed_check" CHECK (("ops"."attendance_imports"."status" = 'committed') = ("ops"."attendance_imports"."committed_at" IS NOT NULL) AND ("ops"."attendance_imports"."committed_at" IS NULL) = ("ops"."attendance_imports"."committed_by" IS NULL)),
	CONSTRAINT "attendance_imports_counts_check" CHECK (LEAST("ops"."attendance_imports"."rows_total", "ops"."attendance_imports"."rows_valid", "ops"."attendance_imports"."rows_invalid", "ops"."attendance_imports"."rows_duplicate") >= 0 AND "ops"."attendance_imports"."rows_valid" + "ops"."attendance_imports"."rows_invalid" + "ops"."attendance_imports"."rows_duplicate" <= "ops"."attendance_imports"."rows_total"),
	CONSTRAINT "attendance_imports_source_check" CHECK (length(trim(coalesce("ops"."attendance_imports"."source_label", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."attendance_punches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"punched_at" timestamp with time zone NOT NULL,
	"direction" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"import_id" uuid,
	"entered_by" uuid NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_punches_direction_check" CHECK ("ops"."attendance_punches"."direction" IN ('in', 'out')),
	CONSTRAINT "attendance_punches_source_check" CHECK ("ops"."attendance_punches"."source" IN ('manual', 'import')),
	CONSTRAINT "attendance_punches_import_check" CHECK (("ops"."attendance_punches"."source" = 'import') = ("ops"."attendance_punches"."import_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."daily_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"status" text DEFAULT 'unmarked' NOT NULL,
	"first_in" timestamp with time zone,
	"last_out" timestamp with time zone,
	"late_minutes" integer,
	"missing_checkout" boolean DEFAULT false NOT NULL,
	"basis" text DEFAULT 'computed' NOT NULL,
	"decided_by_user_id" uuid,
	"note" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_attendance_status_check" CHECK ("ops"."daily_attendance"."status" IN ('present', 'absent', 'half_day', 'unmarked', 'on_leave', 'holiday', 'weekly_off')),
	CONSTRAINT "daily_attendance_basis_check" CHECK ("ops"."daily_attendance"."basis" IN ('computed', 'hr_decision')),
	CONSTRAINT "daily_attendance_decided_check" CHECK (("ops"."daily_attendance"."basis" = 'hr_decision') = ("ops"."daily_attendance"."decided_by_user_id" IS NOT NULL)),
	CONSTRAINT "daily_attendance_times_check" CHECK ("ops"."daily_attendance"."last_out" IS NULL OR "ops"."daily_attendance"."first_in" IS NULL OR "ops"."daily_attendance"."last_out" >= "ops"."daily_attendance"."first_in"),
	CONSTRAINT "daily_attendance_late_check" CHECK ("ops"."daily_attendance"."late_minutes" IS NULL OR "ops"."daily_attendance"."late_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"holiday_on" date NOT NULL,
	"name" text NOT NULL,
	"branch_id" uuid,
	"decision_state" text DEFAULT 'proposed' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holidays_day_branch_key" UNIQUE NULLS NOT DISTINCT("holiday_on","branch_id"),
	CONSTRAINT "holidays_name_check" CHECK (length(trim(coalesce("ops"."holidays"."name", ''))) > 0),
	CONSTRAINT "holidays_decision_state_check" CHECK ("ops"."holidays"."decision_state" IN ('proposed', 'approved', 'locked', 'open', 'pending_verification', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "ops"."leave_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"approved_by" uuid NOT NULL,
	"reason" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_records_status_check" CHECK ("ops"."leave_records"."status" IN ('approved', 'cancelled')),
	CONSTRAINT "leave_records_dates_check" CHECK ("ops"."leave_records"."to_date" >= "ops"."leave_records"."from_date"),
	CONSTRAINT "leave_records_kind_check" CHECK (length(trim(coalesce("ops"."leave_records"."kind", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."work_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"weekly_pattern" jsonb NOT NULL,
	"grace_minutes" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_schedules_name_check" CHECK (length(trim(coalesce("ops"."work_schedules"."name", ''))) > 0),
	CONSTRAINT "work_schedules_pattern_check" CHECK (jsonb_typeof("ops"."work_schedules"."weekly_pattern") = 'object'),
	CONSTRAINT "work_schedules_grace_check" CHECK ("ops"."work_schedules"."grace_minutes" BETWEEN 0 AND 240)
);
--> statement-breakpoint
CREATE TABLE "ops"."task_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_checklist_items_text_check" CHECK (length(trim(coalesce("ops"."task_checklist_items"."text", ''))) > 0),
	CONSTRAINT "task_checklist_items_position_check" CHECK ("ops"."task_checklist_items"."position" >= 0),
	CONSTRAINT "task_checklist_items_done_check" CHECK (("ops"."task_checklist_items"."done_at" IS NULL) = ("ops"."task_checklist_items"."done_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."task_collaborators" (
	"task_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_collaborators_pkey" PRIMARY KEY("task_id","staff_id")
);
--> statement-breakpoint
CREATE TABLE "ops"."task_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"submission_id" uuid,
	"decision" text NOT NULL,
	"note" text,
	"reviewer_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_reviews_decision_check" CHECK ("ops"."task_reviews"."decision" IN ('approved', 'changes_requested', 'comment')),
	CONSTRAINT "task_reviews_submission_check" CHECK ("ops"."task_reviews"."decision" = 'comment' OR "ops"."task_reviews"."submission_id" IS NOT NULL),
	CONSTRAINT "task_reviews_note_check" CHECK ("ops"."task_reviews"."decision" = 'approved' OR length(trim(coalesce("ops"."task_reviews"."note", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."task_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"completion_note" text NOT NULL,
	"evidence" text,
	"submitted_by_user_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_submissions_version_check" CHECK ("ops"."task_submissions"."version" >= 1),
	CONSTRAINT "task_submissions_note_check" CHECK (length(trim(coalesce("ops"."task_submissions"."completion_note", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."teacher_development_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_staff_id" uuid NOT NULL,
	"summary_id" uuid,
	"action" text NOT NULL,
	"owner_staff_id" uuid,
	"due_on" date,
	"status" text DEFAULT 'open' NOT NULL,
	"agreed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_development_actions_action_check" CHECK (length(trim(coalesce("ops"."teacher_development_actions"."action", ''))) > 0),
	CONSTRAINT "teacher_development_actions_status_check" CHECK ("ops"."teacher_development_actions"."status" IN ('open', 'done', 'dropped'))
);
--> statement-breakpoint
CREATE TABLE "ops"."teacher_feedback_import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"outcome" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"feedback_id" uuid,
	CONSTRAINT "teacher_feedback_import_rows_number_check" CHECK ("ops"."teacher_feedback_import_rows"."row_number" >= 1),
	CONSTRAINT "teacher_feedback_import_rows_outcome_check" CHECK ("ops"."teacher_feedback_import_rows"."outcome" IN ('valid', 'invalid', 'duplicate', 'unresolved')),
	CONSTRAINT "teacher_feedback_import_rows_feedback_check" CHECK ("ops"."teacher_feedback_import_rows"."feedback_id" IS NULL OR "ops"."teacher_feedback_import_rows"."outcome" = 'valid')
);
--> statement-breakpoint
CREATE TABLE "ops"."teacher_feedback_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sha256" text NOT NULL,
	"original_name" text NOT NULL,
	"status" text DEFAULT 'preview' NOT NULL,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_valid" integer DEFAULT 0 NOT NULL,
	"rows_invalid" integer DEFAULT 0 NOT NULL,
	"rows_duplicate" integer DEFAULT 0 NOT NULL,
	"mapping" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	"is_sample" boolean DEFAULT false NOT NULL,
	CONSTRAINT "teacher_feedback_imports_sha_check" CHECK ("ops"."teacher_feedback_imports"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "teacher_feedback_imports_status_check" CHECK ("ops"."teacher_feedback_imports"."status" IN ('preview', 'committed', 'discarded')),
	CONSTRAINT "teacher_feedback_imports_committed_check" CHECK (("ops"."teacher_feedback_imports"."status" = 'committed') = ("ops"."teacher_feedback_imports"."committed_at" IS NOT NULL)),
	CONSTRAINT "teacher_feedback_imports_counts_check" CHECK (LEAST("ops"."teacher_feedback_imports"."rows_total", "ops"."teacher_feedback_imports"."rows_valid", "ops"."teacher_feedback_imports"."rows_invalid", "ops"."teacher_feedback_imports"."rows_duplicate") >= 0 AND "ops"."teacher_feedback_imports"."rows_valid" + "ops"."teacher_feedback_imports"."rows_invalid" + "ops"."teacher_feedback_imports"."rows_duplicate" <= "ops"."teacher_feedback_imports"."rows_total"),
	CONSTRAINT "teacher_feedback_imports_name_check" CHECK (length(trim(coalesce("ops"."teacher_feedback_imports"."original_name", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."teacher_feedback_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_staff_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"response_count" integer NOT NULL,
	"eligible_population" integer,
	"rating_scale_max" integer NOT NULL,
	"category_means" jsonb NOT NULL,
	"strengths" text,
	"areas_to_improve" text,
	"summary_text" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_feedback_summaries_status_check" CHECK ("ops"."teacher_feedback_summaries"."status" IN ('draft', 'approved', 'withdrawn')),
	CONSTRAINT "teacher_feedback_summaries_period_check" CHECK ("ops"."teacher_feedback_summaries"."period_end" >= "ops"."teacher_feedback_summaries"."period_start"),
	CONSTRAINT "teacher_feedback_summaries_counts_check" CHECK ("ops"."teacher_feedback_summaries"."response_count" >= 0 AND ("ops"."teacher_feedback_summaries"."eligible_population" IS NULL OR "ops"."teacher_feedback_summaries"."eligible_population" >= "ops"."teacher_feedback_summaries"."response_count")),
	CONSTRAINT "teacher_feedback_summaries_scale_check" CHECK ("ops"."teacher_feedback_summaries"."rating_scale_max" BETWEEN 2 AND 10),
	CONSTRAINT "teacher_feedback_summaries_approved_check" CHECK (("ops"."teacher_feedback_summaries"."approved_at" IS NULL) = ("ops"."teacher_feedback_summaries"."approved_by" IS NULL) AND ("ops"."teacher_feedback_summaries"."status" <> 'approved' OR "ops"."teacher_feedback_summaries"."approved_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "academic"."teacher_assignments" DROP CONSTRAINT "teacher_assignments_status_check";--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" DROP CONSTRAINT "student_teacher_feedback_rating_check";--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" DROP CONSTRAINT "staff_tasks_status_check";--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" DROP CONSTRAINT "staff_tasks_reason_check";--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" DROP CONSTRAINT "staff_tasks_one_related";--> statement-breakpoint
ALTER TABLE "ops"."task_events" DROP CONSTRAINT "task_events_kind_check";--> statement-breakpoint
ALTER TABLE "ops"."task_events" DROP CONSTRAINT "task_events_status_check";--> statement-breakpoint
ALTER TABLE "ops"."task_events" DROP CONSTRAINT "task_events_reason_check";--> statement-breakpoint
DROP INDEX "ops"."eod_reports_staff_date_key";--> statement-breakpoint
ALTER TABLE "academic"."teacher_assignments" ALTER COLUMN "batch_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ALTER COLUMN "report_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "academic"."teacher_assignments" ADD COLUMN "academic_year" text;--> statement-breakpoint
ALTER TABLE "academic"."teacher_assignments" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "academic"."teacher_assignments" ADD COLUMN "course_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."staff_profiles" ADD COLUMN "employment_status" text DEFAULT 'not_recorded' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."staff_profiles" ADD COLUMN "joined_on" date;--> statement-breakpoint
ALTER TABLE "ops"."staff_profiles" ADD COLUMN "left_on" date;--> statement-breakpoint
ALTER TABLE "ops"."staff_profiles" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."staff_profiles" ADD COLUMN "work_schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."staff_profiles" ADD COLUMN "timezone" text DEFAULT 'Asia/Kolkata' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD COLUMN "rating_scale_max" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD COLUMN "category_ratings" jsonb;--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD COLUMN "period_start" date;--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD COLUMN "period_end" date;--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD COLUMN "collection_method" text;--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD COLUMN "subject_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD COLUMN "course_label" text;--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD COLUMN "import_row" integer;--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD COLUMN "is_anonymous" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD COLUMN "respondent_identifiable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD COLUMN "reviewed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD COLUMN "is_sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "related_kind" text;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "related_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "related_label" text;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "expected_deliverable" text;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "parent_task_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "visibility" text DEFAULT 'assignee_chain' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "original_due_on" date;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "original_due_time" time;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "blocked_kind" text;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "blocked_reason" text;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "first_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "last_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ADD COLUMN "period_kind" text DEFAULT 'day' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ADD COLUMN "period_start" date;--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ADD COLUMN "period_end" date;--> statement-breakpoint
-- Hand-written backfill (D-024 review): existing rows, before the new constraints are added.--> statement-breakpoint
-- 1. Tasks: the original deadline is the deadline on record today.--> statement-breakpoint
UPDATE "ops"."staff_tasks" SET "original_due_on" = "due_on", "original_due_time" = "due_time";--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ALTER COLUMN "original_due_on" SET NOT NULL;--> statement-breakpoint
-- 2. Tasks: blocked / on_hold stop being statuses (R4). The flag keeps kind, reason and time;
-- the status returns to the latest open status in the task's history, else by progress.--> statement-breakpoint
UPDATE "ops"."staff_tasks" t SET
  "blocked_kind" = t."status",
  "blocked_reason" = t."reason",
  "blocked_at" = coalesce((SELECT max(e."occurred_at") FROM "ops"."task_events" e WHERE e."task_id" = t."id" AND e."to_status" = t."status"), t."updated_at"),
  "status" = coalesce((SELECT e."to_status" FROM "ops"."task_events" e WHERE e."task_id" = t."id" AND e."to_status" IN ('pending', 'in_progress', 'in_review') ORDER BY e."occurred_at" DESC, e."created_at" DESC LIMIT 1), CASE WHEN t."progress_percent" > 0 THEN 'in_progress' ELSE 'pending' END),
  "reason" = NULL
WHERE t."status" IN ('blocked', 'on_hold');--> statement-breakpoint
-- 3. Tasks: submission and approval times from the history; an in-review task with no
-- submitted event uses its last change time.--> statement-breakpoint
UPDATE "ops"."staff_tasks" t SET "first_submitted_at" = s."first_at", "last_submitted_at" = s."last_at"
FROM (SELECT "task_id", min("occurred_at") AS "first_at", max("occurred_at") AS "last_at" FROM "ops"."task_events" WHERE "kind" = 'submitted_for_review' GROUP BY 1) s
WHERE s."task_id" = t."id";--> statement-breakpoint
UPDATE "ops"."staff_tasks" SET "first_submitted_at" = "updated_at", "last_submitted_at" = "updated_at"
WHERE "status" = 'in_review' AND "last_submitted_at" IS NULL;--> statement-breakpoint
UPDATE "ops"."staff_tasks" t SET "approved_at" = a."at"
FROM (SELECT "task_id", max("occurred_at") AS "at" FROM "ops"."task_events" WHERE "kind" = 'review_approved' GROUP BY 1) a
WHERE a."task_id" = t."id" AND t."status" = 'done';--> statement-breakpoint
-- 4. Reports: every existing report is a day report (R7).--> statement-breakpoint
UPDATE "ops"."eod_reports" SET "period_start" = "report_date", "period_end" = "report_date";--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ALTER COLUMN "period_start" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ALTER COLUMN "period_end" SET NOT NULL;--> statement-breakpoint
-- 5. Staff profiles: a staff record that is active or on leave is employed; inactive stays
-- not_recorded (no exit date is on record).--> statement-breakpoint
UPDATE "ops"."staff_profiles" p SET "employment_status" = 'active'
FROM "core"."staff_members" m WHERE m."id" = p."staff_id" AND m."status" IN ('active', 'on_leave');--> statement-breakpoint
ALTER TABLE "marketing"."campaign_members" ADD CONSTRAINT "campaign_members_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "marketing"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."campaign_members" ADD CONSTRAINT "campaign_members_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."campaign_members" ADD CONSTRAINT "campaign_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attachments" ADD CONSTRAINT "attachments_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_departments" ADD CONSTRAINT "staff_departments_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_departments" ADD CONSTRAINT "staff_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_departments" ADD CONSTRAINT "staff_departments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_manager_history" ADD CONSTRAINT "staff_manager_history_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_manager_history" ADD CONSTRAINT "staff_manager_history_manager_staff_id_staff_members_id_fk" FOREIGN KEY ("manager_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_manager_history" ADD CONSTRAINT "staff_manager_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_private_details" ADD CONSTRAINT "staff_private_details_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_private_details" ADD CONSTRAINT "staff_private_details_photo_attachment_id_attachments_id_fk" FOREIGN KEY ("photo_attachment_id") REFERENCES "ops"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_private_details" ADD CONSTRAINT "staff_private_details_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attendance_corrections" ADD CONSTRAINT "attendance_corrections_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attendance_corrections" ADD CONSTRAINT "attendance_corrections_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attendance_corrections" ADD CONSTRAINT "attendance_corrections_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attendance_imports" ADD CONSTRAINT "attendance_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attendance_imports" ADD CONSTRAINT "attendance_imports_committed_by_users_id_fk" FOREIGN KEY ("committed_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attendance_punches" ADD CONSTRAINT "attendance_punches_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attendance_punches" ADD CONSTRAINT "attendance_punches_import_id_attendance_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "ops"."attendance_imports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attendance_punches" ADD CONSTRAINT "attendance_punches_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."daily_attendance" ADD CONSTRAINT "daily_attendance_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."daily_attendance" ADD CONSTRAINT "daily_attendance_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."holidays" ADD CONSTRAINT "holidays_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "core"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."holidays" ADD CONSTRAINT "holidays_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_records" ADD CONSTRAINT "leave_records_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_records" ADD CONSTRAINT "leave_records_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."work_schedules" ADD CONSTRAINT "work_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_staff_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ops"."staff_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_checklist_items" ADD CONSTRAINT "task_checklist_items_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_collaborators" ADD CONSTRAINT "task_collaborators_task_id_staff_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ops"."staff_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_collaborators" ADD CONSTRAINT "task_collaborators_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_collaborators" ADD CONSTRAINT "task_collaborators_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_reviews" ADD CONSTRAINT "task_reviews_task_id_staff_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ops"."staff_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_reviews" ADD CONSTRAINT "task_reviews_submission_id_task_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "ops"."task_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_reviews" ADD CONSTRAINT "task_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_submissions" ADD CONSTRAINT "task_submissions_task_id_staff_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ops"."staff_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_submissions" ADD CONSTRAINT "task_submissions_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."teacher_development_actions" ADD CONSTRAINT "teacher_development_actions_teacher_staff_id_staff_members_id_fk" FOREIGN KEY ("teacher_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."teacher_development_actions" ADD CONSTRAINT "teacher_development_actions_summary_id_teacher_feedback_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "ops"."teacher_feedback_summaries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."teacher_development_actions" ADD CONSTRAINT "teacher_development_actions_owner_staff_id_staff_members_id_fk" FOREIGN KEY ("owner_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."teacher_development_actions" ADD CONSTRAINT "teacher_development_actions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."teacher_feedback_import_rows" ADD CONSTRAINT "teacher_feedback_import_rows_import_id_teacher_feedback_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "ops"."teacher_feedback_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."teacher_feedback_import_rows" ADD CONSTRAINT "teacher_feedback_import_rows_feedback_id_student_teacher_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "ops"."student_teacher_feedback"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."teacher_feedback_imports" ADD CONSTRAINT "teacher_feedback_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."teacher_feedback_summaries" ADD CONSTRAINT "teacher_feedback_summaries_teacher_staff_id_staff_members_id_fk" FOREIGN KEY ("teacher_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."teacher_feedback_summaries" ADD CONSTRAINT "teacher_feedback_summaries_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."teacher_feedback_summaries" ADD CONSTRAINT "teacher_feedback_summaries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branches_code_key" ON "core"."branches" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_members_active_key" ON "marketing"."campaign_members" USING btree ("campaign_id","staff_id") WHERE "marketing"."campaign_members"."to_date" IS NULL;--> statement-breakpoint
CREATE INDEX "campaign_members_staff_idx" ON "marketing"."campaign_members" USING btree ("staff_id") WHERE "marketing"."campaign_members"."to_date" IS NULL;--> statement-breakpoint
CREATE INDEX "attachments_owner_idx" ON "ops"."attachments" USING btree ("owner_kind","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_storage_key_key" ON "ops"."attachments" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_departments_current_key" ON "ops"."staff_departments" USING btree ("staff_id","department_id") WHERE "ops"."staff_departments"."to_date" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_departments_one_primary_key" ON "ops"."staff_departments" USING btree ("staff_id") WHERE "ops"."staff_departments"."is_primary" AND "ops"."staff_departments"."to_date" IS NULL;--> statement-breakpoint
CREATE INDEX "staff_departments_department_idx" ON "ops"."staff_departments" USING btree ("department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_manager_history_current_key" ON "ops"."staff_manager_history" USING btree ("staff_id") WHERE "ops"."staff_manager_history"."to_date" IS NULL;--> statement-breakpoint
CREATE INDEX "staff_manager_history_manager_idx" ON "ops"."staff_manager_history" USING btree ("manager_staff_id");--> statement-breakpoint
CREATE INDEX "attendance_corrections_staff_date_idx" ON "ops"."attendance_corrections" USING btree ("staff_id","work_date");--> statement-breakpoint
CREATE INDEX "attendance_corrections_status_idx" ON "ops"."attendance_corrections" USING btree ("status","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_corrections_one_pending_key" ON "ops"."attendance_corrections" USING btree ("staff_id","work_date") WHERE "ops"."attendance_corrections"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_imports_sha256_key" ON "ops"."attendance_imports" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_punches_staff_time_key" ON "ops"."attendance_punches" USING btree ("staff_id","punched_at","direction");--> statement-breakpoint
CREATE INDEX "attendance_punches_import_idx" ON "ops"."attendance_punches" USING btree ("import_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_attendance_staff_date_key" ON "ops"."daily_attendance" USING btree ("staff_id","work_date");--> statement-breakpoint
CREATE INDEX "daily_attendance_date_status_idx" ON "ops"."daily_attendance" USING btree ("work_date","status");--> statement-breakpoint
CREATE INDEX "leave_records_staff_from_idx" ON "ops"."leave_records" USING btree ("staff_id","from_date");--> statement-breakpoint
CREATE UNIQUE INDEX "work_schedules_name_key" ON "ops"."work_schedules" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "work_schedules_one_default_key" ON "ops"."work_schedules" USING btree ("is_default") WHERE "ops"."work_schedules"."is_default";--> statement-breakpoint
CREATE INDEX "task_checklist_items_task_idx" ON "ops"."task_checklist_items" USING btree ("task_id","position");--> statement-breakpoint
CREATE INDEX "task_collaborators_staff_idx" ON "ops"."task_collaborators" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "task_reviews_task_idx" ON "ops"."task_reviews" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_reviews_one_decision_key" ON "ops"."task_reviews" USING btree ("submission_id") WHERE "ops"."task_reviews"."decision" <> 'comment';--> statement-breakpoint
CREATE UNIQUE INDEX "task_submissions_task_version_key" ON "ops"."task_submissions" USING btree ("task_id","version");--> statement-breakpoint
CREATE INDEX "teacher_development_actions_teacher_idx" ON "ops"."teacher_development_actions" USING btree ("teacher_staff_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_feedback_import_rows_row_key" ON "ops"."teacher_feedback_import_rows" USING btree ("import_id","row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_feedback_imports_sha256_key" ON "ops"."teacher_feedback_imports" USING btree ("sha256") WHERE "ops"."teacher_feedback_imports"."status" <> 'discarded';--> statement-breakpoint
CREATE INDEX "teacher_feedback_summaries_teacher_idx" ON "ops"."teacher_feedback_summaries" USING btree ("teacher_staff_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_feedback_summaries_period_key" ON "ops"."teacher_feedback_summaries" USING btree ("teacher_staff_id","period_start","period_end") WHERE "ops"."teacher_feedback_summaries"."status" <> 'withdrawn';--> statement-breakpoint
ALTER TABLE "academic"."teacher_assignments" ADD CONSTRAINT "teacher_assignments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "core"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."teacher_assignments" ADD CONSTRAINT "teacher_assignments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "academic"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_profiles" ADD CONSTRAINT "staff_profiles_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "core"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_profiles" ADD CONSTRAINT "staff_profiles_work_schedule_id_work_schedules_id_fk" FOREIGN KEY ("work_schedule_id") REFERENCES "ops"."work_schedules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD CONSTRAINT "student_teacher_feedback_import_id_teacher_feedback_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "ops"."teacher_feedback_imports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD CONSTRAINT "student_teacher_feedback_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_parent_task_id_staff_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "ops"."staff_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_assignments_pending_key" ON "academic"."teacher_assignments" USING btree ("staff_member_id","subject_id") WHERE "academic"."teacher_assignments"."status" = 'pending' AND "academic"."teacher_assignments"."batch_id" IS NULL;--> statement-breakpoint
CREATE INDEX "staff_profiles_branch_idx" ON "ops"."staff_profiles" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "student_teacher_feedback_period_idx" ON "ops"."student_teacher_feedback" USING btree ("teacher_staff_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "student_teacher_feedback_import_row_key" ON "ops"."student_teacher_feedback" USING btree ("import_id","import_row") WHERE "ops"."student_teacher_feedback"."import_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "staff_tasks_staff_status_idx" ON "ops"."staff_tasks" USING btree ("staff_id","status");--> statement-breakpoint
CREATE INDEX "staff_tasks_parent_idx" ON "ops"."staff_tasks" USING btree ("parent_task_id") WHERE "ops"."staff_tasks"."parent_task_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "staff_tasks_related_idx" ON "ops"."staff_tasks" USING btree ("related_kind","related_id") WHERE "ops"."staff_tasks"."related_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "eod_reports_staff_period_key" ON "ops"."eod_reports" USING btree ("staff_id","period_kind","period_start");--> statement-breakpoint
CREATE INDEX "eod_reports_period_idx" ON "ops"."eod_reports" USING btree ("period_kind","period_start");--> statement-breakpoint
ALTER TABLE "academic"."teacher_assignments" ADD CONSTRAINT "teacher_assignments_batch_check" CHECK ("academic"."teacher_assignments"."batch_id" IS NOT NULL OR "academic"."teacher_assignments"."status" = 'pending');--> statement-breakpoint
ALTER TABLE "academic"."teacher_assignments" ADD CONSTRAINT "teacher_assignments_year_check" CHECK ("academic"."teacher_assignments"."academic_year" IS NULL OR "academic"."teacher_assignments"."academic_year" ~ '^[0-9]{4}-[0-9]{2}$');--> statement-breakpoint
ALTER TABLE "academic"."teacher_assignments" ADD CONSTRAINT "teacher_assignments_status_check" CHECK ("academic"."teacher_assignments"."status" IN ('pending', 'active', 'ended'));--> statement-breakpoint
ALTER TABLE "ops"."staff_profiles" ADD CONSTRAINT "staff_profiles_employment_status_check" CHECK ("ops"."staff_profiles"."employment_status" IN ('active', 'on_notice', 'exited', 'not_recorded'));--> statement-breakpoint
ALTER TABLE "ops"."staff_profiles" ADD CONSTRAINT "staff_profiles_left_check" CHECK (("ops"."staff_profiles"."left_on" IS NULL OR "ops"."staff_profiles"."joined_on" IS NULL OR "ops"."staff_profiles"."left_on" >= "ops"."staff_profiles"."joined_on") AND ("ops"."staff_profiles"."employment_status" <> 'exited' OR "ops"."staff_profiles"."left_on" IS NOT NULL) AND ("ops"."staff_profiles"."left_on" IS NULL OR "ops"."staff_profiles"."employment_status" IN ('on_notice', 'exited')));--> statement-breakpoint
ALTER TABLE "ops"."staff_profiles" ADD CONSTRAINT "staff_profiles_timezone_check" CHECK (length("ops"."staff_profiles"."timezone") > 0);--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD CONSTRAINT "student_teacher_feedback_method_check" CHECK ("ops"."student_teacher_feedback"."collection_method" IS NULL OR "ops"."student_teacher_feedback"."collection_method" IN ('form', 'paper', 'interview', 'import', 'other'));--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD CONSTRAINT "student_teacher_feedback_scale_check" CHECK ("ops"."student_teacher_feedback"."rating_scale_max" BETWEEN 2 AND 10);--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD CONSTRAINT "student_teacher_feedback_category_check" CHECK ("ops"."student_teacher_feedback"."category_ratings" IS NULL OR jsonb_typeof("ops"."student_teacher_feedback"."category_ratings") = 'object');--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD CONSTRAINT "student_teacher_feedback_period_check" CHECK (("ops"."student_teacher_feedback"."period_start" IS NULL) = ("ops"."student_teacher_feedback"."period_end" IS NULL) AND ("ops"."student_teacher_feedback"."period_end" IS NULL OR "ops"."student_teacher_feedback"."period_end" >= "ops"."student_teacher_feedback"."period_start"));--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD CONSTRAINT "student_teacher_feedback_import_check" CHECK (("ops"."student_teacher_feedback"."import_id" IS NULL) = ("ops"."student_teacher_feedback"."import_row" IS NULL));--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD CONSTRAINT "student_teacher_feedback_anonymous_check" CHECK (NOT "ops"."student_teacher_feedback"."is_anonymous" OR "ops"."student_teacher_feedback"."student_id" IS NULL);--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD CONSTRAINT "student_teacher_feedback_identifiable_check" CHECK ("ops"."student_teacher_feedback"."student_id" IS NULL OR "ops"."student_teacher_feedback"."respondent_identifiable");--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD CONSTRAINT "student_teacher_feedback_reviewed_check" CHECK (("ops"."student_teacher_feedback"."reviewed_at" IS NULL) = ("ops"."student_teacher_feedback"."reviewed_by_user_id" IS NULL));--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD CONSTRAINT "student_teacher_feedback_rating_check" CHECK ("ops"."student_teacher_feedback"."rating" IS NULL OR "ops"."student_teacher_feedback"."rating" BETWEEN 1 AND "ops"."student_teacher_feedback"."rating_scale_max");--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_blocked_kind_check" CHECK ("ops"."staff_tasks"."blocked_kind" IS NULL OR "ops"."staff_tasks"."blocked_kind" IN ('blocked', 'on_hold'));--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_blocked_check" CHECK (("ops"."staff_tasks"."blocked_at" IS NULL) = ("ops"."staff_tasks"."blocked_kind" IS NULL) AND ("ops"."staff_tasks"."blocked_at" IS NULL) = ("ops"."staff_tasks"."blocked_reason" IS NULL) AND ("ops"."staff_tasks"."blocked_reason" IS NULL OR length(trim(coalesce("ops"."staff_tasks"."blocked_reason", ''))) > 0));--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_submitted_check" CHECK (("ops"."staff_tasks"."first_submitted_at" IS NULL) = ("ops"."staff_tasks"."last_submitted_at" IS NULL) AND ("ops"."staff_tasks"."last_submitted_at" IS NULL OR "ops"."staff_tasks"."last_submitted_at" >= "ops"."staff_tasks"."first_submitted_at") AND ("ops"."staff_tasks"."status" <> 'in_review' OR "ops"."staff_tasks"."last_submitted_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_related_kind_check" CHECK ("ops"."staff_tasks"."related_kind" IS NULL OR "ops"."staff_tasks"."related_kind" IN ('batch', 'subject', 'campaign', 'event'));--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_related_check" CHECK (("ops"."staff_tasks"."related_kind" IS NULL) = ("ops"."staff_tasks"."related_id" IS NULL) AND ("ops"."staff_tasks"."related_label" IS NULL OR "ops"."staff_tasks"."related_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_visibility_check" CHECK ("ops"."staff_tasks"."visibility" IN ('assignee_chain', 'department', 'collaborators'));--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_not_own_parent" CHECK ("ops"."staff_tasks"."parent_task_id" IS NULL OR "ops"."staff_tasks"."parent_task_id" <> "ops"."staff_tasks"."id");--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_status_check" CHECK ("ops"."staff_tasks"."status" IN ('pending', 'in_progress', 'done', 'in_review', 'cancelled', 'draft', 'changes_requested'));--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_reason_check" CHECK ("ops"."staff_tasks"."status" <> 'cancelled' OR length(trim(coalesce("ops"."staff_tasks"."reason", ''))) > 0);--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_one_related" CHECK (num_nonnulls("ops"."staff_tasks"."lead_id", "ops"."staff_tasks"."admission_id", "ops"."staff_tasks"."student_id", "ops"."staff_tasks"."related_id") <= 1);--> statement-breakpoint
ALTER TABLE "ops"."task_events" ADD CONSTRAINT "task_events_kind_check" CHECK ("ops"."task_events"."kind" IN ('created', 'assigned', 'reassigned', 'acknowledged', 'clarification_requested', 'status_changed', 'submitted_for_review', 'review_approved', 'changes_requested', 'reopened', 'cancelled', 'due_changed', 'priority_changed', 'comment', 'imported', 'dependency_added', 'edited', 'blocked_set', 'blocked_cleared', 'checklist_changed', 'collaborator_added', 'delivered'));--> statement-breakpoint
ALTER TABLE "ops"."task_events" ADD CONSTRAINT "task_events_status_check" CHECK (("ops"."task_events"."from_status" IS NULL OR "ops"."task_events"."from_status" IN ('pending', 'in_progress', 'done', 'in_review', 'cancelled', 'draft', 'changes_requested', 'blocked', 'on_hold')) AND ("ops"."task_events"."to_status" IS NULL OR "ops"."task_events"."to_status" IN ('pending', 'in_progress', 'done', 'in_review', 'cancelled', 'draft', 'changes_requested', 'blocked', 'on_hold')));--> statement-breakpoint
ALTER TABLE "ops"."task_events" ADD CONSTRAINT "task_events_reason_check" CHECK ("ops"."task_events"."kind" NOT IN ('clarification_requested', 'changes_requested', 'reopened', 'cancelled', 'blocked_set') OR length(trim(coalesce("ops"."task_events"."reason", ''))) > 0);--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ADD CONSTRAINT "eod_reports_period_kind_check" CHECK ("ops"."eod_reports"."period_kind" IN ('day', 'week', 'month'));--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ADD CONSTRAINT "eod_reports_period_check" CHECK (("ops"."eod_reports"."period_kind" = 'day') = ("ops"."eod_reports"."report_date" IS NOT NULL) AND ("ops"."eod_reports"."report_date" IS NULL OR "ops"."eod_reports"."report_date" = "ops"."eod_reports"."period_start") AND CASE "ops"."eod_reports"."period_kind" WHEN 'day' THEN "ops"."eod_reports"."period_end" = "ops"."eod_reports"."period_start" WHEN 'week' THEN "ops"."eod_reports"."period_end" = "ops"."eod_reports"."period_start" + 6 ELSE extract(day FROM "ops"."eod_reports"."period_start") = 1 AND "ops"."eod_reports"."period_end" = ("ops"."eod_reports"."period_start" + interval '1 month' - interval '1 day')::date END);