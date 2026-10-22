CREATE TABLE "academic"."batch_placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrolment_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"reason" text,
	"placed_by_user_id" uuid,
	"transfer_from_placement_id" uuid,
	"ended_by_user_id" uuid,
	"ended_reason" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_placements_dates_order" CHECK ("academic"."batch_placements"."end_date" IS NULL OR "academic"."batch_placements"."end_date" >= "academic"."batch_placements"."start_date"),
	CONSTRAINT "batch_placements_transfer_reason" CHECK ("academic"."batch_placements"."transfer_from_placement_id" IS NULL OR "academic"."batch_placements"."reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "academic"."session_demo_attendees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"ops_demo_session_id" uuid NOT NULL,
	"core_student_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"demo_day_number" integer NOT NULL,
	"status" text DEFAULT 'not_recorded' NOT NULL,
	"recorded_by_user_id" uuid,
	"recorded_at" timestamp with time zone,
	"note" text,
	"added_by_user_id" uuid NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_demo_attendees_status_check" CHECK ("academic"."session_demo_attendees"."status" IN ('not_recorded', 'present', 'absent', 'late', 'excused')),
	CONSTRAINT "session_demo_attendees_day_range" CHECK ("academic"."session_demo_attendees"."demo_day_number" BETWEEN 1 AND 10),
	CONSTRAINT "session_demo_attendees_recorded_has_actor" CHECK ("academic"."session_demo_attendees"."status" = 'not_recorded' OR ("academic"."session_demo_attendees"."recorded_by_user_id" IS NOT NULL AND "academic"."session_demo_attendees"."recorded_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "academic"."session_teachers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"participation" text NOT NULL,
	"replaces_staff_id" uuid,
	"reason" text,
	"authorised_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "session_teachers_role_check" CHECK ("academic"."session_teachers"."role" IN ('primary', 'co_teacher', 'substitute')),
	CONSTRAINT "session_teachers_participation_check" CHECK ("academic"."session_teachers"."participation" IN ('planned', 'actual')),
	CONSTRAINT "session_teachers_substitution_authorised" CHECK ("academic"."session_teachers"."replaces_staff_id" IS NULL OR ("academic"."session_teachers"."reason" IS NOT NULL AND "academic"."session_teachers"."authorised_by_user_id" IS NOT NULL AND "academic"."session_teachers"."replaces_staff_id" <> "academic"."session_teachers"."staff_id"))
);
--> statement-breakpoint
CREATE TABLE "academic"."teacher_unavailability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"reason" text NOT NULL,
	"entered_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	CONSTRAINT "teacher_unavailability_dates_order" CHECK ("academic"."teacher_unavailability"."to_date" >= "academic"."teacher_unavailability"."from_date"),
	CONSTRAINT "teacher_unavailability_cancel_pair" CHECK (("academic"."teacher_unavailability"."cancelled_at" IS NULL) = ("academic"."teacher_unavailability"."cancelled_by_user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "academic"."timetable_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"room_id" uuid,
	"online_link" text,
	"weekday" integer NOT NULL,
	"start_time" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_by_user_id" uuid,
	"published_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timetable_patterns_status_check" CHECK ("academic"."timetable_patterns"."status" IN ('draft', 'published', 'retired')),
	CONSTRAINT "timetable_patterns_weekday_range" CHECK ("academic"."timetable_patterns"."weekday" BETWEEN 1 AND 7),
	CONSTRAINT "timetable_patterns_start_time_format" CHECK ("academic"."timetable_patterns"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "timetable_patterns_duration_range" CHECK ("academic"."timetable_patterns"."duration_minutes" BETWEEN 5 AND 600),
	CONSTRAINT "timetable_patterns_effective_order" CHECK ("academic"."timetable_patterns"."effective_to" IS NULL OR "academic"."timetable_patterns"."effective_to" >= "academic"."timetable_patterns"."effective_from"),
	CONSTRAINT "timetable_patterns_published_stamp" CHECK (("academic"."timetable_patterns"."published_at" IS NULL) = ("academic"."timetable_patterns"."published_by_user_id" IS NULL) AND ("academic"."timetable_patterns"."status" = 'draft' OR "academic"."timetable_patterns"."published_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "academic"."teacher_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_key" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"author_staff_id" uuid NOT NULL,
	"academic_student_id" uuid,
	"core_student_id" uuid,
	"subject_id" uuid,
	"review_type" text NOT NULL,
	"session_id" uuid,
	"enrolment_id" uuid,
	"ops_demo_session_id" uuid,
	"period_from" date,
	"period_to" date,
	"strengths" text,
	"areas_for_support" text,
	"attendance_evidence" text,
	"homework_evidence" text,
	"academic_concerns" text,
	"suggested_action" text,
	"follow_up_on" date,
	"visibility" text DEFAULT 'internal' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"supersedes_id" uuid,
	"submitted_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_reason" text,
	"created_by_user_id" uuid NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_reviews_type_check" CHECK ("academic"."teacher_reviews"."review_type" IN ('demo_session', 'periodic_progress', 'assessment_follow_up', 'support_referral')),
	CONSTRAINT "teacher_reviews_status_check" CHECK ("academic"."teacher_reviews"."status" IN ('draft', 'submitted', 'withdrawn')),
	CONSTRAINT "teacher_reviews_visibility_check" CHECK ("academic"."teacher_reviews"."visibility" IN ('internal', 'shareable')),
	CONSTRAINT "teacher_reviews_student_ref" CHECK ("academic"."teacher_reviews"."academic_student_id" IS NOT NULL OR "academic"."teacher_reviews"."core_student_id" IS NOT NULL),
	CONSTRAINT "teacher_reviews_version_positive" CHECK ("academic"."teacher_reviews"."version" >= 1),
	CONSTRAINT "teacher_reviews_period_order" CHECK ("academic"."teacher_reviews"."period_from" IS NULL OR "academic"."teacher_reviews"."period_to" IS NULL OR "academic"."teacher_reviews"."period_from" <= "academic"."teacher_reviews"."period_to"),
	CONSTRAINT "teacher_reviews_status_stamps" CHECK (("academic"."teacher_reviews"."status" <> 'submitted' OR "academic"."teacher_reviews"."submitted_at" IS NOT NULL) AND ("academic"."teacher_reviews"."status" <> 'withdrawn' OR ("academic"."teacher_reviews"."withdrawn_at" IS NOT NULL AND "academic"."teacher_reviews"."withdrawn_reason" IS NOT NULL))),
	CONSTRAINT "teacher_reviews_not_self_superseding" CHECK ("academic"."teacher_reviews"."supersedes_id" IS NULL OR "academic"."teacher_reviews"."supersedes_id" <> "academic"."teacher_reviews"."id")
);
--> statement-breakpoint
CREATE TABLE "ops"."task_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"depends_on_task_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_dependencies_not_self" CHECK ("ops"."task_dependencies"."task_id" <> "ops"."task_dependencies"."depends_on_task_id")
);
--> statement-breakpoint
CREATE TABLE "ops"."task_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"from_staff_id" uuid,
	"to_staff_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_events_kind_check" CHECK ("ops"."task_events"."kind" IN ('created', 'assigned', 'reassigned', 'acknowledged', 'clarification_requested', 'status_changed', 'submitted_for_review', 'review_approved', 'changes_requested', 'reopened', 'cancelled', 'due_changed', 'priority_changed', 'comment', 'imported', 'dependency_added', 'edited')),
	CONSTRAINT "task_events_status_check" CHECK (("ops"."task_events"."from_status" IS NULL OR "ops"."task_events"."from_status" IN ('pending', 'in_progress', 'done', 'blocked', 'on_hold', 'in_review', 'cancelled')) AND ("ops"."task_events"."to_status" IS NULL OR "ops"."task_events"."to_status" IN ('pending', 'in_progress', 'done', 'blocked', 'on_hold', 'in_review', 'cancelled'))),
	CONSTRAINT "task_events_status_change_check" CHECK ("ops"."task_events"."kind" <> 'status_changed' OR "ops"."task_events"."to_status" IS NOT NULL),
	CONSTRAINT "task_events_owner_change_check" CHECK ("ops"."task_events"."kind" NOT IN ('assigned', 'reassigned') OR "ops"."task_events"."to_staff_id" IS NOT NULL),
	CONSTRAINT "task_events_reason_check" CHECK ("ops"."task_events"."kind" NOT IN ('clarification_requested', 'changes_requested', 'reopened', 'cancelled') OR length(trim(coalesce("ops"."task_events"."reason", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."task_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_staff_id" uuid NOT NULL,
	"occurred_on" date NOT NULL,
	"occurred_at" timestamp with time zone,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"work_performed" text NOT NULL,
	"result" text,
	"evidence" text,
	"remaining_work" text,
	"blocker" text,
	"next_step" text,
	"duration_minutes" integer,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"corrects_update_id" uuid,
	"correction_reason" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	CONSTRAINT "task_updates_work_check" CHECK (length(trim("ops"."task_updates"."work_performed")) > 0),
	CONSTRAINT "task_updates_duration_check" CHECK ("ops"."task_updates"."duration_minutes" IS NULL OR "ops"."task_updates"."duration_minutes" BETWEEN 1 AND 1440),
	CONSTRAINT "task_updates_interval_check" CHECK ("ops"."task_updates"."ended_at" IS NULL OR ("ops"."task_updates"."started_at" IS NOT NULL AND "ops"."task_updates"."ended_at" > "ops"."task_updates"."started_at")),
	CONSTRAINT "task_updates_correction_check" CHECK ("ops"."task_updates"."corrects_update_id" IS NULL OR ("ops"."task_updates"."corrects_update_id" <> "ops"."task_updates"."id" AND length(trim(coalesce("ops"."task_updates"."correction_reason", ''))) > 0))
);
--> statement-breakpoint
CREATE TABLE "ops"."eod_report_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"narrative" jsonb NOT NULL,
	"source_cutoff_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"submitted_to_staff_id" uuid,
	"revision_of_version_id" uuid,
	"revision_request_event_id" uuid,
	CONSTRAINT "eod_report_versions_revision_check" CHECK ("ops"."eod_report_versions"."version" >= 1 AND ("ops"."eod_report_versions"."version" = 1) = ("ops"."eod_report_versions"."revision_of_version_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."eod_review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"version_id" uuid,
	"kind" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"text" text,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eod_review_events_kind_check" CHECK ("ops"."eod_review_events"."kind" IN ('viewed', 'comment', 'clarification_requested', 'revision_requested', 'acknowledged', 'follow_up_task_created')),
	CONSTRAINT "eod_review_events_text_check" CHECK ("ops"."eod_review_events"."kind" NOT IN ('comment', 'clarification_requested', 'revision_requested') OR length(trim(coalesce("ops"."eod_review_events"."text", ''))) > 0),
	CONSTRAINT "eod_review_events_task_check" CHECK (("ops"."eod_review_events"."kind" = 'follow_up_task_created') = ("ops"."eod_review_events"."task_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."task_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_filename" text NOT NULL,
	"source_sha256" text NOT NULL,
	"source_kind" text DEFAULT 'deskday_backup_json' NOT NULL,
	"source_version" text,
	"staff_id" uuid NOT NULL,
	"status" text DEFAULT 'previewed' NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw" jsonb NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	"committed_by_user_id" uuid,
	CONSTRAINT "task_import_batches_sha_check" CHECK ("ops"."task_import_batches"."source_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "task_import_batches_kind_check" CHECK ("ops"."task_import_batches"."source_kind" IN ('deskday_backup_json')),
	CONSTRAINT "task_import_batches_status_check" CHECK ("ops"."task_import_batches"."status" IN ('previewed', 'committed', 'failed')),
	CONSTRAINT "task_import_batches_committed_check" CHECK (("ops"."task_import_batches"."status" = 'committed') = ("ops"."task_import_batches"."committed_at" IS NOT NULL) AND ("ops"."task_import_batches"."committed_at" IS NULL) = ("ops"."task_import_batches"."committed_by_user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."task_import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"legacy_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"outcome" text NOT NULL,
	"task_id" uuid,
	"eod_report_id" uuid,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_import_rows_kind_check" CHECK ("ops"."task_import_rows"."kind" IN ('task', 'report')),
	CONSTRAINT "task_import_rows_outcome_check" CHECK ("ops"."task_import_rows"."outcome" IN ('accepted', 'skipped', 'changed', 'duplicate', 'unresolved', 'failed')),
	CONSTRAINT "task_import_rows_target_check" CHECK (("ops"."task_import_rows"."kind" = 'task' AND "ops"."task_import_rows"."eod_report_id" IS NULL) OR ("ops"."task_import_rows"."kind" = 'report' AND "ops"."task_import_rows"."task_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."review_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_key" uuid NOT NULL,
	"review_version" integer NOT NULL,
	"acknowledged_by_user_id" uuid NOT NULL,
	"note" text,
	"follow_up" text,
	"follow_up_on" date,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_acknowledgements_version_check" CHECK ("ops"."review_acknowledgements"."review_version" >= 1),
	CONSTRAINT "review_acknowledgements_follow_up_check" CHECK ("ops"."review_acknowledgements"."follow_up_on" IS NULL OR "ops"."review_acknowledgements"."follow_up" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "academic"."attempts" DROP CONSTRAINT "attempts_status_check";--> statement-breakpoint
ALTER TABLE "academic"."attempts" DROP CONSTRAINT "attempts_shape";--> statement-breakpoint
ALTER TABLE "academic"."class_records" DROP CONSTRAINT "class_records_state_check";--> statement-breakpoint
ALTER TABLE "academic"."class_records" DROP CONSTRAINT "class_records_activity_check";--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" DROP CONSTRAINT "eod_reports_status_check";--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" DROP CONSTRAINT "eod_reports_submitted_check";--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" DROP CONSTRAINT "eod_reports_reviewed_check";--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" DROP CONSTRAINT "staff_tasks_status_check";--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" DROP CONSTRAINT "staff_tasks_reason_check";--> statement-breakpoint
DROP INDEX "ops"."staff_tasks_status_idx";--> statement-breakpoint
ALTER TABLE "academic"."result_runs" ALTER COLUMN "answer_key_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD COLUMN "published_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "academic"."attempts" ADD COLUMN "manual_score" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "academic"."attempts" ADD COLUMN "marked_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "academic"."attempts" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "academic"."batches" ADD COLUMN "campus" text;--> statement-breakpoint
ALTER TABLE "academic"."batches" ADD COLUMN "coordinator_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "academic"."batches" ADD COLUMN "is_sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "academic"."class_records" ADD COLUMN "materials" text;--> statement-breakpoint
ALTER TABLE "academic"."class_records" ADD COLUMN "homework" text;--> statement-breakpoint
ALTER TABLE "academic"."class_records" ADD COLUMN "homework_due_on" date;--> statement-breakpoint
ALTER TABLE "academic"."class_records" ADD COLUMN "difficulties" text;--> statement-breakpoint
ALTER TABLE "academic"."class_records" ADD COLUMN "next_plan" text;--> statement-breakpoint
ALTER TABLE "academic"."class_records" ADD COLUMN "catch_up_needed" text;--> statement-breakpoint
ALTER TABLE "academic"."class_records" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "academic"."class_records" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "academic"."class_sessions" ADD COLUMN "pattern_id" uuid;--> statement-breakpoint
ALTER TABLE "academic"."class_sessions" ADD COLUMN "kind" text DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "academic"."class_sessions" ADD COLUMN "makeup_for_session_id" uuid;--> statement-breakpoint
ALTER TABLE "academic"."class_sessions" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "academic"."class_sessions" ADD COLUMN "delivered_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "academic"."class_sessions" ADD COLUMN "delivery_note" text;--> statement-breakpoint
ALTER TABLE "academic"."class_sessions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "academic"."enrolments" ADD COLUMN "academic_year" text;--> statement-breakpoint
ALTER TABLE "academic"."interventions" ADD COLUMN "evidence" text;--> statement-breakpoint
ALTER TABLE "academic"."interventions" ADD COLUMN "goal" text;--> statement-breakpoint
ALTER TABLE "academic"."interventions" ADD COLUMN "review_on" date;--> statement-breakpoint
ALTER TABLE "academic"."results" ADD COLUMN "state" text DEFAULT 'scored' NOT NULL;--> statement-breakpoint
ALTER TABLE "academic"."students" ADD COLUMN "core_student_id" uuid;--> statement-breakpoint
ALTER TABLE "academic"."students" ADD COLUMN "is_sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "academic"."teacher_assignments" ADD COLUMN "role" text DEFAULT 'primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ADD COLUMN "next_day_plan" text;--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ADD COLUMN "current_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ADD COLUMN "is_sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "source" text DEFAULT 'self' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "requester_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "requester_note" text;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "backup_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "reviewer_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "review_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "acceptance_criteria" text;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "linked_ref" text;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "received_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "planned_start_on" date;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "acknowledged_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "legacy_ref" text;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "is_sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Backfills (reviewed by hand, 21 Oct 2026). Only facts already on record; unknowns stay unknown.
-- Old results: absent meant "no score"; exempt/withheld did not exist before 0009.
UPDATE "academic"."results" SET "state" = 'absent' WHERE "absent";--> statement-breakpoint
-- R14: a stored end date means the assignment row is ended; "current" is read from the dates.
UPDATE "academic"."teacher_assignments" SET "status" = 'ended' WHERE "end_date" IS NOT NULL;--> statement-breakpoint
-- R13: one open placement for each ACTIVE enrolment that already has a batch (placed_by = the enrolment's creator; null when the system created it). Closed enrolments have no end date on record and get none.
INSERT INTO "academic"."batch_placements" ("enrolment_id", "batch_id", "start_date", "reason", "placed_by_user_id", "is_sample")
SELECT e."id", e."batch_id", COALESCE(e."start_date", (e."created_at" AT TIME ZONE 'Asia/Kolkata')::date), 'Backfilled from the enrolment''s batch (migration 0009)', e."created_by_user_id", s."is_sample"
FROM "academic"."enrolments" e JOIN "academic"."students" s ON s."id" = e."student_id"
WHERE e."status" = 'active' AND e."batch_id" IS NOT NULL;--> statement-breakpoint
-- Task source from what the row already records (no events are invented for old tasks).
UPDATE "ops"."staff_tasks" SET "source" = 'recurring' WHERE "recurrence_parent_id" IS NOT NULL;--> statement-breakpoint
UPDATE "ops"."staff_tasks" SET "source" = 'manager' WHERE "recurrence_parent_id" IS NULL AND "assigned_by_staff_id" IS NOT NULL AND "assigned_by_staff_id" <> "staff_id";--> statement-breakpoint
-- Every already-submitted EOD becomes version 1 of itself (its frozen snapshot and summary).
INSERT INTO "ops"."eod_report_versions" ("report_id", "version", "snapshot", "narrative", "source_cutoff_at", "submitted_at", "submitted_by_user_id", "submitted_to_staff_id")
SELECT r."id", 1, r."snapshot", jsonb_build_object('summary', r."summary", 'nextDayPlan', NULL, 'notes', NULL), r."submitted_at", r."submitted_at", r."created_by", r."submitted_to_staff_id"
FROM "ops"."eod_reports" r WHERE r."submitted_at" IS NOT NULL;--> statement-breakpoint
UPDATE "ops"."eod_reports" SET "current_version" = 1 WHERE "submitted_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "academic"."batch_placements" ADD CONSTRAINT "batch_placements_enrolment_id_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "academic"."enrolments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."batch_placements" ADD CONSTRAINT "batch_placements_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "academic"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."batch_placements" ADD CONSTRAINT "batch_placements_placed_by_user_id_users_id_fk" FOREIGN KEY ("placed_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."batch_placements" ADD CONSTRAINT "batch_placements_transfer_from_placement_id_batch_placements_id_fk" FOREIGN KEY ("transfer_from_placement_id") REFERENCES "academic"."batch_placements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."batch_placements" ADD CONSTRAINT "batch_placements_ended_by_user_id_users_id_fk" FOREIGN KEY ("ended_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."session_demo_attendees" ADD CONSTRAINT "session_demo_attendees_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "academic"."class_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."session_demo_attendees" ADD CONSTRAINT "session_demo_attendees_core_student_id_students_id_fk" FOREIGN KEY ("core_student_id") REFERENCES "core"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."session_demo_attendees" ADD CONSTRAINT "session_demo_attendees_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."session_demo_attendees" ADD CONSTRAINT "session_demo_attendees_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."session_teachers" ADD CONSTRAINT "session_teachers_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "academic"."class_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."session_teachers" ADD CONSTRAINT "session_teachers_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."session_teachers" ADD CONSTRAINT "session_teachers_replaces_staff_id_staff_members_id_fk" FOREIGN KEY ("replaces_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."session_teachers" ADD CONSTRAINT "session_teachers_authorised_by_user_id_users_id_fk" FOREIGN KEY ("authorised_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."teacher_unavailability" ADD CONSTRAINT "teacher_unavailability_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."teacher_unavailability" ADD CONSTRAINT "teacher_unavailability_entered_by_user_id_users_id_fk" FOREIGN KEY ("entered_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."teacher_unavailability" ADD CONSTRAINT "teacher_unavailability_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."timetable_patterns" ADD CONSTRAINT "timetable_patterns_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "academic"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."timetable_patterns" ADD CONSTRAINT "timetable_patterns_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "academic"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."timetable_patterns" ADD CONSTRAINT "timetable_patterns_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."timetable_patterns" ADD CONSTRAINT "timetable_patterns_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "academic"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."timetable_patterns" ADD CONSTRAINT "timetable_patterns_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."timetable_patterns" ADD CONSTRAINT "timetable_patterns_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."teacher_reviews" ADD CONSTRAINT "teacher_reviews_author_staff_id_staff_members_id_fk" FOREIGN KEY ("author_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."teacher_reviews" ADD CONSTRAINT "teacher_reviews_academic_student_id_students_id_fk" FOREIGN KEY ("academic_student_id") REFERENCES "academic"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."teacher_reviews" ADD CONSTRAINT "teacher_reviews_core_student_id_students_id_fk" FOREIGN KEY ("core_student_id") REFERENCES "core"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."teacher_reviews" ADD CONSTRAINT "teacher_reviews_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "academic"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."teacher_reviews" ADD CONSTRAINT "teacher_reviews_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "academic"."class_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."teacher_reviews" ADD CONSTRAINT "teacher_reviews_enrolment_id_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "academic"."enrolments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."teacher_reviews" ADD CONSTRAINT "teacher_reviews_supersedes_id_teacher_reviews_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "academic"."teacher_reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."teacher_reviews" ADD CONSTRAINT "teacher_reviews_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_staff_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ops"."staff_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_staff_tasks_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "ops"."staff_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_dependencies" ADD CONSTRAINT "task_dependencies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_events" ADD CONSTRAINT "task_events_task_id_staff_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ops"."staff_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_events" ADD CONSTRAINT "task_events_from_staff_id_staff_members_id_fk" FOREIGN KEY ("from_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_events" ADD CONSTRAINT "task_events_to_staff_id_staff_members_id_fk" FOREIGN KEY ("to_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_events" ADD CONSTRAINT "task_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_updates" ADD CONSTRAINT "task_updates_task_id_staff_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ops"."staff_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_updates" ADD CONSTRAINT "task_updates_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_updates" ADD CONSTRAINT "task_updates_author_staff_id_staff_members_id_fk" FOREIGN KEY ("author_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_updates" ADD CONSTRAINT "task_updates_corrects_update_id_task_updates_id_fk" FOREIGN KEY ("corrects_update_id") REFERENCES "ops"."task_updates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."eod_report_versions" ADD CONSTRAINT "eod_report_versions_report_id_eod_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "ops"."eod_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."eod_report_versions" ADD CONSTRAINT "eod_report_versions_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."eod_report_versions" ADD CONSTRAINT "eod_report_versions_submitted_to_staff_id_staff_members_id_fk" FOREIGN KEY ("submitted_to_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."eod_report_versions" ADD CONSTRAINT "eod_report_versions_revision_of_version_id_eod_report_versions_id_fk" FOREIGN KEY ("revision_of_version_id") REFERENCES "ops"."eod_report_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."eod_report_versions" ADD CONSTRAINT "eod_report_versions_revision_request_event_id_eod_review_events_id_fk" FOREIGN KEY ("revision_request_event_id") REFERENCES "ops"."eod_review_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."eod_review_events" ADD CONSTRAINT "eod_review_events_report_id_eod_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "ops"."eod_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."eod_review_events" ADD CONSTRAINT "eod_review_events_version_id_eod_report_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "ops"."eod_report_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."eod_review_events" ADD CONSTRAINT "eod_review_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."eod_review_events" ADD CONSTRAINT "eod_review_events_task_id_staff_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ops"."staff_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_import_batches" ADD CONSTRAINT "task_import_batches_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_import_batches" ADD CONSTRAINT "task_import_batches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_import_batches" ADD CONSTRAINT "task_import_batches_committed_by_user_id_users_id_fk" FOREIGN KEY ("committed_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_import_rows" ADD CONSTRAINT "task_import_rows_batch_id_task_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "ops"."task_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_import_rows" ADD CONSTRAINT "task_import_rows_task_id_staff_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ops"."staff_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_import_rows" ADD CONSTRAINT "task_import_rows_eod_report_id_eod_reports_id_fk" FOREIGN KEY ("eod_report_id") REFERENCES "ops"."eod_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."review_acknowledgements" ADD CONSTRAINT "review_acknowledgements_acknowledged_by_user_id_users_id_fk" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "batch_placements_one_open_key" ON "academic"."batch_placements" USING btree ("enrolment_id") WHERE "academic"."batch_placements"."end_date" IS NULL;--> statement-breakpoint
CREATE INDEX "batch_placements_batch_dates_idx" ON "academic"."batch_placements" USING btree ("batch_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "session_demo_attendees_session_demo_key" ON "academic"."session_demo_attendees" USING btree ("session_id","ops_demo_session_id");--> statement-breakpoint
CREATE INDEX "session_demo_attendees_demo_idx" ON "academic"."session_demo_attendees" USING btree ("ops_demo_session_id");--> statement-breakpoint
CREATE INDEX "session_demo_attendees_student_idx" ON "academic"."session_demo_attendees" USING btree ("core_student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_teachers_active_key" ON "academic"."session_teachers" USING btree ("session_id","staff_id","participation") WHERE "academic"."session_teachers"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "session_teachers_staff_idx" ON "academic"."session_teachers" USING btree ("staff_id","participation");--> statement-breakpoint
CREATE INDEX "teacher_unavailability_staff_from_idx" ON "academic"."teacher_unavailability" USING btree ("staff_id","from_date");--> statement-breakpoint
CREATE INDEX "timetable_patterns_batch_status_idx" ON "academic"."timetable_patterns" USING btree ("batch_id","status");--> statement-breakpoint
CREATE INDEX "timetable_patterns_staff_weekday_idx" ON "academic"."timetable_patterns" USING btree ("staff_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_reviews_version_key" ON "academic"."teacher_reviews" USING btree ("review_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_reviews_one_draft_key" ON "academic"."teacher_reviews" USING btree ("review_key") WHERE "academic"."teacher_reviews"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "teacher_reviews_core_student_idx" ON "academic"."teacher_reviews" USING btree ("core_student_id");--> statement-breakpoint
CREATE INDEX "teacher_reviews_academic_student_idx" ON "academic"."teacher_reviews" USING btree ("academic_student_id");--> statement-breakpoint
CREATE INDEX "teacher_reviews_author_status_idx" ON "academic"."teacher_reviews" USING btree ("author_staff_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "task_dependencies_pair_key" ON "ops"."task_dependencies" USING btree ("task_id","depends_on_task_id");--> statement-breakpoint
CREATE INDEX "task_dependencies_depends_on_idx" ON "ops"."task_dependencies" USING btree ("depends_on_task_id");--> statement-breakpoint
CREATE INDEX "task_events_task_occurred_idx" ON "ops"."task_events" USING btree ("task_id","occurred_at");--> statement-breakpoint
CREATE INDEX "task_events_actor_occurred_idx" ON "ops"."task_events" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "task_updates_author_day_idx" ON "ops"."task_updates" USING btree ("author_staff_id","occurred_on");--> statement-breakpoint
CREATE INDEX "task_updates_task_recorded_idx" ON "ops"."task_updates" USING btree ("task_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_updates_corrects_key" ON "ops"."task_updates" USING btree ("corrects_update_id") WHERE "ops"."task_updates"."corrects_update_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "eod_report_versions_report_version_key" ON "ops"."eod_report_versions" USING btree ("report_id","version");--> statement-breakpoint
CREATE INDEX "eod_review_events_report_created_idx" ON "ops"."eod_review_events" USING btree ("report_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_import_batches_source_staff_key" ON "ops"."task_import_batches" USING btree ("source_sha256","staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_import_rows_batch_record_key" ON "ops"."task_import_rows" USING btree ("batch_id","kind","legacy_id");--> statement-breakpoint
CREATE INDEX "task_import_rows_task_idx" ON "ops"."task_import_rows" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_acknowledgements_key" ON "ops"."review_acknowledgements" USING btree ("review_key","review_version","acknowledged_by_user_id");--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD CONSTRAINT "assessments_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."attempts" ADD CONSTRAINT "attempts_marked_by_user_id_users_id_fk" FOREIGN KEY ("marked_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."batches" ADD CONSTRAINT "batches_coordinator_staff_id_staff_members_id_fk" FOREIGN KEY ("coordinator_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_sessions" ADD CONSTRAINT "class_sessions_pattern_id_timetable_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "academic"."timetable_patterns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_sessions" ADD CONSTRAINT "class_sessions_makeup_for_session_id_class_sessions_id_fk" FOREIGN KEY ("makeup_for_session_id") REFERENCES "academic"."class_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_sessions" ADD CONSTRAINT "class_sessions_delivered_by_user_id_users_id_fk" FOREIGN KEY ("delivered_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."students" ADD CONSTRAINT "students_core_student_id_students_id_fk" FOREIGN KEY ("core_student_id") REFERENCES "core"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_requester_staff_id_staff_members_id_fk" FOREIGN KEY ("requester_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_backup_staff_id_staff_members_id_fk" FOREIGN KEY ("backup_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_reviewer_staff_id_staff_members_id_fk" FOREIGN KEY ("reviewer_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_acknowledged_by_user_id_users_id_fk" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_import_batch_id_task_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "ops"."task_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batches_coordinator_idx" ON "academic"."batches" USING btree ("coordinator_staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "class_sessions_pattern_date_key" ON "academic"."class_sessions" USING btree ("pattern_id","date") WHERE "academic"."class_sessions"."pattern_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "enrolments_active_student_course_key" ON "academic"."enrolments" USING btree ("student_id","course_id") WHERE "academic"."enrolments"."status" = 'active' AND "academic"."enrolments"."course_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "students_core_student_key" ON "academic"."students" USING btree ("core_student_id") WHERE "academic"."students"."core_student_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "staff_tasks_status_due_idx" ON "ops"."staff_tasks" USING btree ("status","due_on");--> statement-breakpoint
CREATE INDEX "staff_tasks_reviewer_status_idx" ON "ops"."staff_tasks" USING btree ("reviewer_staff_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_tasks_legacy_ref_key" ON "ops"."staff_tasks" USING btree ("legacy_ref") WHERE "ops"."staff_tasks"."legacy_ref" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD CONSTRAINT "assessments_publication_pair" CHECK (("academic"."assessments"."published_at" IS NULL) = ("academic"."assessments"."published_by_user_id" IS NULL));--> statement-breakpoint
ALTER TABLE "academic"."attempts" ADD CONSTRAINT "attempts_status_check" CHECK ("academic"."attempts"."status" IN ('submitted', 'absent', 'exempt', 'withheld'));--> statement-breakpoint
ALTER TABLE "academic"."attempts" ADD CONSTRAINT "attempts_shape" CHECK (("academic"."attempts"."status" IN ('absent', 'exempt') AND "academic"."attempts"."responses" IS NULL AND "academic"."attempts"."manual_score" IS NULL) OR ("academic"."attempts"."status" = 'submitted' AND ("academic"."attempts"."responses" IS NOT NULL OR "academic"."attempts"."manual_score" IS NOT NULL)) OR "academic"."attempts"."status" NOT IN ('absent', 'exempt', 'submitted'));--> statement-breakpoint
ALTER TABLE "academic"."class_records" ADD CONSTRAINT "class_records_draft_unsubmitted" CHECK ("academic"."class_records"."state" <> 'draft' OR "academic"."class_records"."submitted_at" IS NULL);--> statement-breakpoint
ALTER TABLE "academic"."class_records" ADD CONSTRAINT "class_records_state_check" CHECK ("academic"."class_records"."state" IN ('draft', 'submitted', 'verified', 'superseded'));--> statement-breakpoint
ALTER TABLE "academic"."class_records" ADD CONSTRAINT "class_records_activity_check" CHECK ("academic"."class_records"."activity" IN ('main', 'practice', 'catch_up', 'test', 'discussion', 'revision', 'doubt_solving'));--> statement-breakpoint
ALTER TABLE "academic"."class_sessions" ADD CONSTRAINT "class_sessions_kind_check" CHECK ("academic"."class_sessions"."kind" IN ('regular', 'makeup', 'doubt', 'extra'));--> statement-breakpoint
ALTER TABLE "academic"."class_sessions" ADD CONSTRAINT "class_sessions_makeup_link" CHECK ("academic"."class_sessions"."makeup_for_session_id" IS NULL OR "academic"."class_sessions"."kind" = 'makeup');--> statement-breakpoint
ALTER TABLE "academic"."class_sessions" ADD CONSTRAINT "class_sessions_delivery_pair" CHECK (("academic"."class_sessions"."delivered_at" IS NULL) = ("academic"."class_sessions"."delivered_by_user_id" IS NULL));--> statement-breakpoint
ALTER TABLE "academic"."results" ADD CONSTRAINT "results_state_check" CHECK ("academic"."results"."state" IN ('scored', 'absent', 'exempt', 'withheld'));--> statement-breakpoint
ALTER TABLE "academic"."results" ADD CONSTRAINT "results_state_shape" CHECK (("academic"."results"."state" = 'scored') = ("academic"."results"."total_score" IS NOT NULL) AND "academic"."results"."absent" = ("academic"."results"."state" <> 'scored'));--> statement-breakpoint
ALTER TABLE "academic"."teacher_assignments" ADD CONSTRAINT "teacher_assignments_role_check" CHECK ("academic"."teacher_assignments"."role" IN ('primary', 'co_teacher', 'substitute'));--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ADD CONSTRAINT "eod_reports_version_check" CHECK ("ops"."eod_reports"."current_version" >= 0 AND "ops"."eod_reports"."version" >= 1);--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ADD CONSTRAINT "eod_reports_status_check" CHECK ("ops"."eod_reports"."status" IN ('draft', 'submitted', 'revision_requested', 'acknowledged'));--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ADD CONSTRAINT "eod_reports_submitted_check" CHECK (("ops"."eod_reports"."status" = 'draft') = ("ops"."eod_reports"."submitted_at" IS NULL));--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ADD CONSTRAINT "eod_reports_reviewed_check" CHECK (("ops"."eod_reports"."reviewed_by" IS NULL) = ("ops"."eod_reports"."reviewed_at" IS NULL) AND ("ops"."eod_reports"."reviewed_at" IS NULL OR "ops"."eod_reports"."status" <> 'draft'));--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_source_check" CHECK ("ops"."staff_tasks"."source" IN ('manager', 'self', 'verbal', 'academic', 'import', 'recurring'));--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_version_check" CHECK ("ops"."staff_tasks"."version" >= 1);--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_acknowledged_check" CHECK (("ops"."staff_tasks"."acknowledged_at" IS NULL) = ("ops"."staff_tasks"."acknowledged_by_user_id" IS NULL));--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_backup_check" CHECK ("ops"."staff_tasks"."backup_staff_id" IS NULL OR "ops"."staff_tasks"."backup_staff_id" <> "ops"."staff_tasks"."staff_id");--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_status_check" CHECK ("ops"."staff_tasks"."status" IN ('pending', 'in_progress', 'done', 'blocked', 'on_hold', 'in_review', 'cancelled'));--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_reason_check" CHECK ("ops"."staff_tasks"."status" NOT IN ('blocked', 'on_hold', 'cancelled') OR length(trim(coalesce("ops"."staff_tasks"."reason", ''))) > 0);