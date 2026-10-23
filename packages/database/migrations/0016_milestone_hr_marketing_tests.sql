CREATE TABLE "core"."user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_settings_check" CHECK (jsonb_typeof("core"."user_preferences"."settings") = 'object')
);
--> statement-breakpoint
CREATE TABLE "marketing"."calendar_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"item_type" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"programme_id" uuid,
	"audience" text,
	"channel" text,
	"campaign_id" uuid,
	"owner_staff_id" uuid,
	"planned_at" timestamp with time zone,
	"original_planned_at" timestamp with time zone,
	"brief" text,
	"asset_links" text[] DEFAULT '{}'::text[] NOT NULL,
	"related_task_id" uuid,
	"idea_id" uuid,
	"content_item_id" uuid,
	"placement_id" uuid,
	"review_note" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"published_url" text,
	"publication_evidence" text,
	"published_by" uuid,
	"cancelled_reason" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_items_type_check" CHECK ("marketing"."calendar_items"."item_type" IN ('social_post', 'short_video', 'article', 'webinar', 'seminar', 'admission_campaign', 'email_draft', 'landing_page_update')),
	CONSTRAINT "calendar_items_status_check" CHECK ("marketing"."calendar_items"."status" IN ('idea', 'planned', 'in_production', 'submitted', 'approved', 'scheduled', 'published', 'changes_requested', 'cancelled')),
	CONSTRAINT "calendar_items_channel_check" CHECK ("marketing"."calendar_items"."channel" IS NULL OR "marketing"."calendar_items"."channel" IN ('instagram', 'youtube', 'linkedin', 'website', 'email', 'whatsapp', 'online_event', 'in_person', 'other')),
	CONSTRAINT "calendar_items_title_check" CHECK (length(trim(coalesce("marketing"."calendar_items"."title", ''))) > 0),
	CONSTRAINT "calendar_items_planned_check" CHECK (("marketing"."calendar_items"."status" IN ('idea', 'cancelled') OR "marketing"."calendar_items"."planned_at" IS NOT NULL) AND ("marketing"."calendar_items"."planned_at" IS NULL OR "marketing"."calendar_items"."original_planned_at" IS NOT NULL)),
	CONSTRAINT "calendar_items_approved_check" CHECK (("marketing"."calendar_items"."approved_at" IS NULL) = ("marketing"."calendar_items"."approved_by" IS NULL) AND ("marketing"."calendar_items"."status" NOT IN ('approved', 'scheduled', 'published') OR "marketing"."calendar_items"."approved_at" IS NOT NULL)),
	CONSTRAINT "calendar_items_published_check" CHECK (("marketing"."calendar_items"."status" = 'published') = ("marketing"."calendar_items"."published_at" IS NOT NULL) AND ("marketing"."calendar_items"."published_at" IS NULL OR ("marketing"."calendar_items"."published_by" IS NOT NULL AND ("marketing"."calendar_items"."published_url" IS NOT NULL OR length(trim(coalesce("marketing"."calendar_items"."publication_evidence", ''))) > 0)))),
	CONSTRAINT "calendar_items_url_check" CHECK ("marketing"."calendar_items"."published_url" IS NULL OR "marketing"."calendar_items"."published_url" ~ '^https?://'),
	CONSTRAINT "calendar_items_reason_check" CHECK (("marketing"."calendar_items"."status" <> 'cancelled' OR length(trim(coalesce("marketing"."calendar_items"."cancelled_reason", ''))) > 0) AND ("marketing"."calendar_items"."status" <> 'changes_requested' OR length(trim(coalesce("marketing"."calendar_items"."review_note", ''))) > 0)),
	CONSTRAINT "calendar_items_assets_check" CHECK (cardinality("marketing"."calendar_items"."asset_links") <= 20)
);
--> statement-breakpoint
CREATE TABLE "marketing"."optimisation_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"meaning" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "optimisation_categories_key_key" UNIQUE("key"),
	CONSTRAINT "optimisation_categories_key_format" CHECK ("marketing"."optimisation_categories"."key" ~ '^[a-z][a-z0-9_]{1,30}$'),
	CONSTRAINT "optimisation_categories_text_check" CHECK (length(trim(coalesce("marketing"."optimisation_categories"."label", ''))) > 0 AND length(trim(coalesce("marketing"."optimisation_categories"."meaning", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "marketing"."optimisation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_url" text NOT NULL,
	"topic" text NOT NULL,
	"target_query" text,
	"category_key" text NOT NULL,
	"baseline_observation" text,
	"required_change" text,
	"owner_staff_id" uuid,
	"due_on" date,
	"evidence" text,
	"review_state" text DEFAULT 'draft' NOT NULL,
	"review_note" text,
	"measurement_source" text,
	"observation_on" date,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "optimisation_items_review_state_check" CHECK ("marketing"."optimisation_items"."review_state" IN ('draft', 'submitted', 'approved', 'changes_requested')),
	CONSTRAINT "optimisation_items_url_check" CHECK ("marketing"."optimisation_items"."page_url" ~ '^https?://'),
	CONSTRAINT "optimisation_items_topic_check" CHECK (length(trim(coalesce("marketing"."optimisation_items"."topic", ''))) > 0),
	CONSTRAINT "optimisation_items_checklist_check" CHECK (jsonb_typeof("marketing"."optimisation_items"."checklist") = 'array'),
	CONSTRAINT "optimisation_items_review_check" CHECK (("marketing"."optimisation_items"."review_state" <> 'approved' OR length(trim(coalesce("marketing"."optimisation_items"."evidence", ''))) > 0) AND ("marketing"."optimisation_items"."review_state" <> 'changes_requested' OR length(trim(coalesce("marketing"."optimisation_items"."review_note", ''))) > 0))
);
--> statement-breakpoint
CREATE TABLE "marketing"."optimisation_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"query" text NOT NULL,
	"observed_on" date NOT NULL,
	"result" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"note" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "optimisation_observations_source_check" CHECK ("marketing"."optimisation_observations"."source" IN ('manual', 'connected')),
	CONSTRAINT "optimisation_observations_text_check" CHECK (length(trim(coalesce("marketing"."optimisation_observations"."platform", ''))) > 0 AND length(trim(coalesce("marketing"."optimisation_observations"."query", ''))) > 0 AND length(trim(coalesce("marketing"."optimisation_observations"."result", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "marketing"."targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"staff_id" uuid,
	"campaign_id" uuid,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"metric_key" text NOT NULL,
	"target_value" integer NOT NULL,
	"note" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "targets_identity_key" UNIQUE NULLS NOT DISTINCT("scope","staff_id","campaign_id","metric_key","period_start","period_end"),
	CONSTRAINT "targets_scope_check" CHECK ("marketing"."targets"."scope" IN ('employee', 'team', 'campaign')),
	CONSTRAINT "targets_metric_check" CHECK ("marketing"."targets"."metric_key" IN ('qualified_leads', 'follow_ups_completed', 'demo_bookings', 'verified_admissions', 'approved_content', 'published_content', 'campaign_deliverables')),
	CONSTRAINT "targets_scope_ids_check" CHECK (CASE "marketing"."targets"."scope" WHEN 'employee' THEN "marketing"."targets"."staff_id" IS NOT NULL AND "marketing"."targets"."campaign_id" IS NULL WHEN 'campaign' THEN "marketing"."targets"."campaign_id" IS NOT NULL AND "marketing"."targets"."staff_id" IS NULL ELSE "marketing"."targets"."staff_id" IS NULL AND "marketing"."targets"."campaign_id" IS NULL END),
	CONSTRAINT "targets_period_check" CHECK ("marketing"."targets"."period_start" <= "marketing"."targets"."period_end"),
	CONSTRAINT "targets_value_check" CHECK ("marketing"."targets"."target_value" > 0)
);
--> statement-breakpoint
CREATE TABLE "academic"."assessment_batches" (
	"assessment_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_batches_pkey" PRIMARY KEY("assessment_id","batch_id")
);
--> statement-breakpoint
CREATE TABLE "academic"."assessment_roster" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"admission_number_snapshot" text,
	"display_name_snapshot" text NOT NULL,
	"attendance" text DEFAULT 'unmarked' NOT NULL,
	"marks_state" text DEFAULT 'not_entered' NOT NULL,
	"score" numeric(10, 4),
	"rank" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by_user_id" uuid,
	"added_reason" text,
	"removed_at" timestamp with time zone,
	"removed_reason" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_roster_attendance_check" CHECK ("academic"."assessment_roster"."attendance" IN ('unmarked', 'present', 'absent', 'excused')),
	CONSTRAINT "assessment_roster_marks_state_check" CHECK ("academic"."assessment_roster"."marks_state" IN ('not_entered', 'imported', 'verified')),
	CONSTRAINT "assessment_roster_score_shape" CHECK (("academic"."assessment_roster"."marks_state" = 'not_entered') = ("academic"."assessment_roster"."score" IS NULL)),
	CONSTRAINT "assessment_roster_absent_no_score" CHECK ("academic"."assessment_roster"."attendance" NOT IN ('absent', 'excused') OR "academic"."assessment_roster"."score" IS NULL),
	CONSTRAINT "assessment_roster_verified_present" CHECK ("academic"."assessment_roster"."marks_state" <> 'verified' OR "academic"."assessment_roster"."attendance" = 'present'),
	CONSTRAINT "assessment_roster_verified_stamp" CHECK (("academic"."assessment_roster"."marks_state" = 'verified') = ("academic"."assessment_roster"."verified_at" IS NOT NULL) AND ("academic"."assessment_roster"."verified_at" IS NULL) = ("academic"."assessment_roster"."verified_by_user_id" IS NULL)),
	CONSTRAINT "assessment_roster_rank_shape" CHECK ("academic"."assessment_roster"."rank" IS NULL OR ("academic"."assessment_roster"."rank" >= 1 AND "academic"."assessment_roster"."marks_state" = 'verified' AND "academic"."assessment_roster"."removed_at" IS NULL)),
	CONSTRAINT "assessment_roster_removed_pair" CHECK (("academic"."assessment_roster"."removed_at" IS NULL) = ("academic"."assessment_roster"."removed_reason" IS NULL)),
	CONSTRAINT "assessment_roster_version_positive" CHECK ("academic"."assessment_roster"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "academic"."result_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"result_run_id" uuid NOT NULL,
	"ranking_scope" text DEFAULT 'roster' NOT NULL,
	"cohort_batch_ids" uuid[],
	"tie_policy" text DEFAULT 'competition' NOT NULL,
	"provisional" boolean DEFAULT false NOT NULL,
	"completeness" jsonb NOT NULL,
	"status" text DEFAULT 'current' NOT NULL,
	"note" text,
	"published_by_user_id" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_user_id" uuid,
	"withdrawn_reason" text,
	CONSTRAINT "result_publications_version_positive" CHECK ("academic"."result_publications"."version" >= 1),
	CONSTRAINT "result_publications_scope_check" CHECK ("academic"."result_publications"."ranking_scope" IN ('roster', 'cohort')),
	CONSTRAINT "result_publications_tie_policy_check" CHECK ("academic"."result_publications"."tie_policy" IN ('competition')),
	CONSTRAINT "result_publications_status_check" CHECK ("academic"."result_publications"."status" IN ('current', 'superseded', 'withdrawn')),
	CONSTRAINT "result_publications_cohort_shape" CHECK (("academic"."result_publications"."ranking_scope" = 'cohort') = ("academic"."result_publications"."cohort_batch_ids" IS NOT NULL AND cardinality("academic"."result_publications"."cohort_batch_ids") >= 1)),
	CONSTRAINT "result_publications_withdrawn_shape" CHECK (("academic"."result_publications"."status" = 'withdrawn') = ("academic"."result_publications"."withdrawn_at" IS NOT NULL) AND ("academic"."result_publications"."withdrawn_at" IS NULL) = ("academic"."result_publications"."withdrawn_by_user_id" IS NULL) AND ("academic"."result_publications"."withdrawn_at" IS NULL) = ("academic"."result_publications"."withdrawn_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."task_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"window_key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_reminders_kind_check" CHECK ("ops"."task_reminders"."kind" IN ('due_soon', 'overdue', 'unacknowledged')),
	CONSTRAINT "task_reminders_window_check" CHECK (length(trim(coalesce("ops"."task_reminders"."window_key", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."hr_request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"hr_note" text,
	"forwarded_to_staff_id" uuid,
	"visible_to_recipient" boolean DEFAULT false NOT NULL,
	"body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_request_events_kind_check" CHECK ("ops"."hr_request_events"."kind" IN ('submitted', 'reviewed', 'forwarded', 'resolved', 'declined', 'recipient_responded', 'response_relayed', 'note', 'task_created')),
	CONSTRAINT "hr_request_events_forwarded_check" CHECK (("ops"."hr_request_events"."kind" = 'forwarded') = ("ops"."hr_request_events"."forwarded_to_staff_id" IS NOT NULL)),
	CONSTRAINT "hr_request_events_body_check" CHECK ("ops"."hr_request_events"."kind" NOT IN ('forwarded', 'declined', 'recipient_responded', 'response_relayed') OR length(trim(coalesce("ops"."hr_request_events"."body", ''))) > 0),
	CONSTRAINT "hr_request_events_note_check" CHECK ("ops"."hr_request_events"."kind" <> 'note' OR length(trim(coalesce("ops"."hr_request_events"."hr_note", ''))) > 0 OR length(trim(coalesce("ops"."hr_request_events"."body", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."hr_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_staff_id" uuid NOT NULL,
	"recipient_staff_id" uuid,
	"recipient_key" text,
	"category" text NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"related_kind" text DEFAULT 'none' NOT NULL,
	"related_id" uuid,
	"urgency" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"linked_task_id" uuid,
	"created_by" uuid NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_requests_status_check" CHECK ("ops"."hr_requests"."status" IN ('draft', 'submitted', 'reviewed', 'forwarded', 'resolved', 'declined')),
	CONSTRAINT "hr_requests_urgency_check" CHECK ("ops"."hr_requests"."urgency" IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "hr_requests_related_kind_check" CHECK ("ops"."hr_requests"."related_kind" IN ('task', 'batch', 'campaign', 'student', 'test', 'none')),
	CONSTRAINT "hr_requests_related_check" CHECK (("ops"."hr_requests"."related_kind" = 'none') = ("ops"."hr_requests"."related_id" IS NULL)),
	CONSTRAINT "hr_requests_recipient_check" CHECK (num_nonnulls("ops"."hr_requests"."recipient_staff_id", "ops"."hr_requests"."recipient_key") <= 1 AND ("ops"."hr_requests"."recipient_key" IS NULL OR "ops"."hr_requests"."recipient_key" ~ '^[a-z][a-z0-9_]{1,39}$')),
	CONSTRAINT "hr_requests_text_check" CHECK ("ops"."hr_requests"."status" = 'draft' OR (length(trim(coalesce("ops"."hr_requests"."category", ''))) > 0 AND length(trim(coalesce("ops"."hr_requests"."subject", ''))) > 0 AND length(trim(coalesce("ops"."hr_requests"."message", ''))) > 0)),
	CONSTRAINT "hr_requests_submitted_check" CHECK (("ops"."hr_requests"."status" = 'draft') = ("ops"."hr_requests"."submitted_at" IS NULL)),
	CONSTRAINT "hr_requests_decided_check" CHECK (("ops"."hr_requests"."status" IN ('resolved', 'declined')) = ("ops"."hr_requests"."decided_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."score_import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"original" jsonb NOT NULL,
	"parsed" jsonb NOT NULL,
	"match_status" text NOT NULL,
	"match_basis" text DEFAULT 'none' NOT NULL,
	"roster_entry_id" uuid,
	"student_id" uuid,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolution" text,
	"change" text,
	"ai_confirmed" boolean DEFAULT false NOT NULL,
	"overwrite_confirmed" boolean DEFAULT false NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "score_import_rows_number_check" CHECK ("ops"."score_import_rows"."row_no" >= 1),
	CONSTRAINT "score_import_rows_match_status_check" CHECK ("ops"."score_import_rows"."match_status" IN ('matched', 'suggested', 'ambiguous', 'unmatched', 'duplicate')),
	CONSTRAINT "score_import_rows_match_basis_check" CHECK ("ops"."score_import_rows"."match_basis" IN ('admission_number', 'student_code', 'exact_name', 'none')),
	CONSTRAINT "score_import_rows_resolution_check" CHECK ("ops"."score_import_rows"."resolution" IS NULL OR "ops"."score_import_rows"."resolution" IN ('matched', 'skip')),
	CONSTRAINT "score_import_rows_change_check" CHECK ("ops"."score_import_rows"."change" IS NULL OR "ops"."score_import_rows"."change" IN ('new', 'no_change', 'overwrite', 'not_entered')),
	CONSTRAINT "score_import_rows_student_check" CHECK (("ops"."score_import_rows"."roster_entry_id" IS NULL) = ("ops"."score_import_rows"."student_id" IS NULL) AND ("ops"."score_import_rows"."student_id" IS NOT NULL OR ("ops"."score_import_rows"."match_status" NOT IN ('matched', 'duplicate') AND "ops"."score_import_rows"."resolution" IS DISTINCT FROM 'matched' AND "ops"."score_import_rows"."change" IS NULL))),
	CONSTRAINT "score_import_rows_overwrite_check" CHECK (NOT "ops"."score_import_rows"."overwrite_confirmed" OR "ops"."score_import_rows"."change" = 'overwrite')
);
--> statement-breakpoint
CREATE TABLE "ops"."score_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"attachment_id" uuid,
	"source" text NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"sha256" text,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_by" uuid NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "score_imports_source_check" CHECK ("ops"."score_imports"."source" IN ('csv', 'pdf_ai', 'manual')),
	CONSTRAINT "score_imports_status_check" CHECK ("ops"."score_imports"."status" IN ('uploaded', 'staged', 'in_review', 'confirmed', 'cancelled', 'failed')),
	CONSTRAINT "score_imports_file_check" CHECK (("ops"."score_imports"."source" = 'manual') = ("ops"."score_imports"."attachment_id" IS NULL) AND ("ops"."score_imports"."attachment_id" IS NULL) = ("ops"."score_imports"."sha256" IS NULL) AND ("ops"."score_imports"."sha256" IS NULL OR "ops"."score_imports"."sha256" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "score_imports_confirmed_check" CHECK (("ops"."score_imports"."status" = 'confirmed') = ("ops"."score_imports"."confirmed_at" IS NOT NULL) AND ("ops"."score_imports"."confirmed_at" IS NULL) = ("ops"."score_imports"."confirmed_by" IS NULL)),
	CONSTRAINT "score_imports_error_check" CHECK ("ops"."score_imports"."status" <> 'failed' OR length(trim(coalesce("ops"."score_imports"."error", ''))) > 0),
	CONSTRAINT "score_imports_rows_check" CHECK ("ops"."score_imports"."rows_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."lead_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"from_key" text,
	"to_key" text NOT NULL,
	"reason" text,
	"actor_user_id" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_stage_history_changed_check" CHECK ("ops"."lead_stage_history"."from_key" IS DISTINCT FROM "ops"."lead_stage_history"."to_key"),
	CONSTRAINT "lead_stage_history_reason_check" CHECK ("ops"."lead_stage_history"."reason" IS NULL OR length(trim(coalesce("ops"."lead_stage_history"."reason", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."lead_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"kind" text DEFAULT 'open' NOT NULL,
	"requires_reason" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_stages_key_key" UNIQUE("key"),
	CONSTRAINT "lead_stages_key_format" CHECK ("ops"."lead_stages"."key" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "lead_stages_label_check" CHECK (length(trim(coalesce("ops"."lead_stages"."label", ''))) > 0),
	CONSTRAINT "lead_stages_kind_check" CHECK ("ops"."lead_stages"."kind" IN ('open', 'won', 'lost', 'parked'))
);
--> statement-breakpoint
ALTER TABLE "marketing"."ideas" DROP CONSTRAINT "ideas_status_check";--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" DROP CONSTRAINT "staff_tasks_related_kind_check";--> statement-breakpoint
ALTER TABLE "ops"."attachments" DROP CONSTRAINT "attachments_owner_kind_check";--> statement-breakpoint
ALTER TABLE "marketing"."campaigns" ADD COLUMN "programme_id" uuid;--> statement-breakpoint
ALTER TABLE "marketing"."campaigns" ADD COLUMN "audience" text;--> statement-breakpoint
ALTER TABLE "marketing"."campaigns" ADD COLUMN "channels" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing"."campaigns" ADD COLUMN "is_sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing"."ideas" ADD COLUMN "problem_need" text;--> statement-breakpoint
ALTER TABLE "marketing"."ideas" ADD COLUMN "hypothesis" text;--> statement-breakpoint
ALTER TABLE "marketing"."ideas" ADD COLUMN "effort" text;--> statement-breakpoint
ALTER TABLE "marketing"."ideas" ADD COLUMN "expected_outcome" text;--> statement-breakpoint
ALTER TABLE "marketing"."ideas" ADD COLUMN "proposed_format" text;--> statement-breakpoint
ALTER TABLE "marketing"."ideas" ADD COLUMN "proposed_channel" text;--> statement-breakpoint
ALTER TABLE "marketing"."ideas" ADD COLUMN "programme_id" uuid;--> statement-breakpoint
ALTER TABLE "marketing"."ideas" ADD COLUMN "owner_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "marketing"."ideas" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "marketing"."ideas" ADD COLUMN "is_sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD COLUMN "academic_year" text;--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD COLUMN "responsible_teacher_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD COLUMN "evaluator_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD COLUMN "max_marks" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD COLUMN "roster_snapshot_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD COLUMN "is_sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "academic"."teacher_reviews" ADD COLUMN "observation_on" date;--> statement-breakpoint
ALTER TABLE "academic"."teacher_reviews" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."lead_activities" ADD COLUMN "direction" text;--> statement-breakpoint
ALTER TABLE "ops"."lead_activities" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "ops"."lead_activities" ADD COLUMN "next_action" text;--> statement-breakpoint
ALTER TABLE "ops"."lead_activities" ADD COLUMN "next_follow_up_on" date;--> statement-breakpoint
ALTER TABLE "ops"."leads" ADD COLUMN "stage_key" text;--> statement-breakpoint
ALTER TABLE "ops"."leads" ADD COLUMN "stage_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."leads" ADD COLUMN "do_not_contact" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."attachments" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."attachments" ADD COLUMN "supersedes_attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."attachments" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."attachments" ADD COLUMN "release_note" text;--> statement-breakpoint
ALTER TABLE "core"."user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."calendar_items" ADD CONSTRAINT "calendar_items_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "core"."programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."calendar_items" ADD CONSTRAINT "calendar_items_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "marketing"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."calendar_items" ADD CONSTRAINT "calendar_items_owner_staff_id_staff_members_id_fk" FOREIGN KEY ("owner_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."calendar_items" ADD CONSTRAINT "calendar_items_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "marketing"."ideas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."calendar_items" ADD CONSTRAINT "calendar_items_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "marketing"."content_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."calendar_items" ADD CONSTRAINT "calendar_items_placement_id_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "marketing"."placements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."calendar_items" ADD CONSTRAINT "calendar_items_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."calendar_items" ADD CONSTRAINT "calendar_items_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."calendar_items" ADD CONSTRAINT "calendar_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."optimisation_items" ADD CONSTRAINT "optimisation_items_category_key_optimisation_categories_key_fk" FOREIGN KEY ("category_key") REFERENCES "marketing"."optimisation_categories"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."optimisation_items" ADD CONSTRAINT "optimisation_items_owner_staff_id_staff_members_id_fk" FOREIGN KEY ("owner_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."optimisation_items" ADD CONSTRAINT "optimisation_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."optimisation_observations" ADD CONSTRAINT "optimisation_observations_item_id_optimisation_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "marketing"."optimisation_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."optimisation_observations" ADD CONSTRAINT "optimisation_observations_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."targets" ADD CONSTRAINT "targets_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."targets" ADD CONSTRAINT "targets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "marketing"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."targets" ADD CONSTRAINT "targets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."assessment_batches" ADD CONSTRAINT "assessment_batches_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "academic"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."assessment_batches" ADD CONSTRAINT "assessment_batches_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "academic"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."assessment_roster" ADD CONSTRAINT "assessment_roster_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "academic"."assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."assessment_roster" ADD CONSTRAINT "assessment_roster_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "academic"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."assessment_roster" ADD CONSTRAINT "assessment_roster_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "academic"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."assessment_roster" ADD CONSTRAINT "assessment_roster_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."result_publications" ADD CONSTRAINT "result_publications_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "academic"."assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."result_publications" ADD CONSTRAINT "result_publications_result_run_id_result_runs_id_fk" FOREIGN KEY ("result_run_id") REFERENCES "academic"."result_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."result_publications" ADD CONSTRAINT "result_publications_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."result_publications" ADD CONSTRAINT "result_publications_withdrawn_by_user_id_users_id_fk" FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_reminders" ADD CONSTRAINT "task_reminders_task_id_staff_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ops"."staff_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_reminders" ADD CONSTRAINT "task_reminders_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."hr_request_events" ADD CONSTRAINT "hr_request_events_request_id_hr_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "ops"."hr_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."hr_request_events" ADD CONSTRAINT "hr_request_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."hr_request_events" ADD CONSTRAINT "hr_request_events_forwarded_to_staff_id_staff_members_id_fk" FOREIGN KEY ("forwarded_to_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."hr_requests" ADD CONSTRAINT "hr_requests_sender_staff_id_staff_members_id_fk" FOREIGN KEY ("sender_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."hr_requests" ADD CONSTRAINT "hr_requests_recipient_staff_id_staff_members_id_fk" FOREIGN KEY ("recipient_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."hr_requests" ADD CONSTRAINT "hr_requests_linked_task_id_staff_tasks_id_fk" FOREIGN KEY ("linked_task_id") REFERENCES "ops"."staff_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."hr_requests" ADD CONSTRAINT "hr_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."score_import_rows" ADD CONSTRAINT "score_import_rows_import_id_score_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "ops"."score_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."score_imports" ADD CONSTRAINT "score_imports_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "ops"."attachments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."score_imports" ADD CONSTRAINT "score_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."score_imports" ADD CONSTRAINT "score_imports_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lead_stage_history" ADD CONSTRAINT "lead_stage_history_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "ops"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lead_stage_history" ADD CONSTRAINT "lead_stage_history_from_key_lead_stages_key_fk" FOREIGN KEY ("from_key") REFERENCES "ops"."lead_stages"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lead_stage_history" ADD CONSTRAINT "lead_stage_history_to_key_lead_stages_key_fk" FOREIGN KEY ("to_key") REFERENCES "ops"."lead_stages"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lead_stage_history" ADD CONSTRAINT "lead_stage_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_items_planned_idx" ON "marketing"."calendar_items" USING btree ("planned_at");--> statement-breakpoint
CREATE INDEX "calendar_items_owner_planned_idx" ON "marketing"."calendar_items" USING btree ("owner_staff_id","planned_at");--> statement-breakpoint
CREATE INDEX "calendar_items_campaign_idx" ON "marketing"."calendar_items" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "calendar_items_content_item_idx" ON "marketing"."calendar_items" USING btree ("content_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_items_placement_key" ON "marketing"."calendar_items" USING btree ("placement_id");--> statement-breakpoint
CREATE INDEX "optimisation_items_owner_due_idx" ON "marketing"."optimisation_items" USING btree ("owner_staff_id","due_on");--> statement-breakpoint
CREATE INDEX "optimisation_items_category_state_idx" ON "marketing"."optimisation_items" USING btree ("category_key","review_state");--> statement-breakpoint
CREATE INDEX "optimisation_observations_item_idx" ON "marketing"."optimisation_observations" USING btree ("item_id","observed_on");--> statement-breakpoint
CREATE INDEX "targets_period_idx" ON "marketing"."targets" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE INDEX "assessment_batches_batch_idx" ON "academic"."assessment_batches" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_roster_student_key" ON "academic"."assessment_roster" USING btree ("assessment_id","student_id");--> statement-breakpoint
CREATE INDEX "assessment_roster_student_idx" ON "academic"."assessment_roster" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "result_publications_version_key" ON "academic"."result_publications" USING btree ("assessment_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "result_publications_one_current_key" ON "academic"."result_publications" USING btree ("assessment_id") WHERE "academic"."result_publications"."status" = 'current';--> statement-breakpoint
CREATE UNIQUE INDEX "task_reminders_window_key" ON "ops"."task_reminders" USING btree ("task_id","staff_id","kind","window_key");--> statement-breakpoint
CREATE INDEX "hr_request_events_request_idx" ON "ops"."hr_request_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "hr_request_events_forwarded_idx" ON "ops"."hr_request_events" USING btree ("forwarded_to_staff_id","created_at") WHERE "ops"."hr_request_events"."forwarded_to_staff_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "hr_requests_queue_idx" ON "ops"."hr_requests" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "hr_requests_sender_idx" ON "ops"."hr_requests" USING btree ("sender_staff_id","created_at");--> statement-breakpoint
CREATE INDEX "hr_requests_recipient_idx" ON "ops"."hr_requests" USING btree ("recipient_staff_id") WHERE "ops"."hr_requests"."recipient_staff_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "score_import_rows_row_key" ON "ops"."score_import_rows" USING btree ("import_id","row_no");--> statement-breakpoint
CREATE INDEX "score_import_rows_status_idx" ON "ops"."score_import_rows" USING btree ("import_id","match_status");--> statement-breakpoint
CREATE INDEX "score_imports_assessment_idx" ON "ops"."score_imports" USING btree ("assessment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "score_imports_file_key" ON "ops"."score_imports" USING btree ("assessment_id","sha256") WHERE "ops"."score_imports"."status" NOT IN ('cancelled', 'failed');--> statement-breakpoint
CREATE INDEX "lead_stage_history_lead_idx" ON "ops"."lead_stage_history" USING btree ("lead_id","changed_at");--> statement-breakpoint
CREATE INDEX "lead_stage_history_to_idx" ON "ops"."lead_stage_history" USING btree ("to_key","changed_at");--> statement-breakpoint
ALTER TABLE "marketing"."campaigns" ADD CONSTRAINT "campaigns_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "core"."programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."ideas" ADD CONSTRAINT "ideas_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "core"."programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."ideas" ADD CONSTRAINT "ideas_owner_staff_id_staff_members_id_fk" FOREIGN KEY ("owner_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."ideas" ADD CONSTRAINT "ideas_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "marketing"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD CONSTRAINT "assessments_responsible_teacher_staff_id_staff_members_id_fk" FOREIGN KEY ("responsible_teacher_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD CONSTRAINT "assessments_evaluator_staff_id_staff_members_id_fk" FOREIGN KEY ("evaluator_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."teacher_reviews" ADD CONSTRAINT "teacher_reviews_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "academic"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leads" ADD CONSTRAINT "leads_stage_key_lead_stages_key_fk" FOREIGN KEY ("stage_key") REFERENCES "ops"."lead_stages"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attachments" ADD CONSTRAINT "attachments_supersedes_attachment_id_attachments_id_fk" FOREIGN KEY ("supersedes_attachment_id") REFERENCES "ops"."attachments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ideas_owner_idx" ON "marketing"."ideas" USING btree ("owner_staff_id");--> statement-breakpoint
CREATE INDEX "assessments_status_date_idx" ON "academic"."assessments" USING btree ("status","scheduled_date");--> statement-breakpoint
CREATE INDEX "assessments_responsible_teacher_idx" ON "academic"."assessments" USING btree ("responsible_teacher_staff_id");--> statement-breakpoint
CREATE INDEX "assessments_evaluator_idx" ON "academic"."assessments" USING btree ("evaluator_staff_id");--> statement-breakpoint
CREATE INDEX "leads_stage_idx" ON "ops"."leads" USING btree ("stage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_supersedes_key" ON "ops"."attachments" USING btree ("supersedes_attachment_id") WHERE "ops"."attachments"."supersedes_attachment_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing"."campaigns" ADD CONSTRAINT "campaigns_channels_check" CHECK ("marketing"."campaigns"."channels" <@ ARRAY['instagram', 'youtube', 'linkedin', 'website', 'email', 'whatsapp', 'online_event', 'in_person', 'other']::text[]);--> statement-breakpoint
ALTER TABLE "marketing"."ideas" ADD CONSTRAINT "ideas_board_check" CHECK (("marketing"."ideas"."effort" IS NULL OR "marketing"."ideas"."effort" IN ('s', 'm', 'l')) AND ("marketing"."ideas"."proposed_format" IS NULL OR "marketing"."ideas"."proposed_format" IN ('social_post', 'short_video', 'article', 'webinar', 'seminar', 'admission_campaign', 'email_draft', 'landing_page_update')) AND ("marketing"."ideas"."proposed_channel" IS NULL OR "marketing"."ideas"."proposed_channel" IN ('instagram', 'youtube', 'linkedin', 'website', 'email', 'whatsapp', 'online_event', 'in_person', 'other')));--> statement-breakpoint
ALTER TABLE "marketing"."ideas" ADD CONSTRAINT "ideas_status_check" CHECK ("marketing"."ideas"."status" IN ('idea', 'in_development', 'ready', 'held', 'rejected', 'archived', 'submitted', 'approved', 'changes_requested'));--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD CONSTRAINT "assessments_academic_year_format" CHECK ("academic"."assessments"."academic_year" IS NULL OR "academic"."assessments"."academic_year" ~ '^[0-9]{4}-[0-9]{2}$');--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD CONSTRAINT "assessments_max_marks_positive" CHECK ("academic"."assessments"."max_marks" IS NULL OR "academic"."assessments"."max_marks" > 0);--> statement-breakpoint
ALTER TABLE "ops"."lead_activities" ADD CONSTRAINT "lead_activities_direction_check" CHECK ("ops"."lead_activities"."direction" IS NULL OR "ops"."lead_activities"."direction" IN ('inbound', 'outbound'));--> statement-breakpoint
ALTER TABLE "ops"."lead_activities" ADD CONSTRAINT "lead_activities_duration_check" CHECK ("ops"."lead_activities"."duration_seconds" IS NULL OR ("ops"."lead_activities"."kind" = 'call' AND "ops"."lead_activities"."duration_seconds" BETWEEN 0 AND 86400));--> statement-breakpoint
ALTER TABLE "ops"."leads" ADD CONSTRAINT "leads_stage_changed_check" CHECK (("ops"."leads"."stage_key" IS NULL) = ("ops"."leads"."stage_changed_at" IS NULL));--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_related_kind_check" CHECK ("ops"."staff_tasks"."related_kind" IS NULL OR "ops"."staff_tasks"."related_kind" IN ('batch', 'subject', 'campaign', 'event', 'test', 'hr_request'));--> statement-breakpoint
ALTER TABLE "ops"."attachments" ADD CONSTRAINT "attachments_version_check" CHECK ("ops"."attachments"."version" >= 1 AND ("ops"."attachments"."version" = 1) = ("ops"."attachments"."supersedes_attachment_id" IS NULL) AND "ops"."attachments"."supersedes_attachment_id" IS DISTINCT FROM "ops"."attachments"."id");--> statement-breakpoint
ALTER TABLE "ops"."attachments" ADD CONSTRAINT "attachments_release_check" CHECK ("ops"."attachments"."release_note" IS NULL OR "ops"."attachments"."released_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "ops"."attachments" ADD CONSTRAINT "attachments_owner_kind_check" CHECK ("ops"."attachments"."owner_kind" IN ('task', 'task_submission', 'task_update', 'attendance_correction', 'feedback_import', 'feedback_evidence', 'work_report', 'staff_private', 'hr_request', 'assessment_paper', 'assessment_key', 'score_import'));