CREATE TABLE "core"."students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."checklist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"actor_user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_entries_subject_check" CHECK ("ops"."checklist_entries"."subject_type" IN ('demo', 'admission')),
	CONSTRAINT "checklist_entries_status_check" CHECK ("ops"."checklist_entries"."status" IN ('complete', 'pending', 'waived', 'not_applicable')),
	CONSTRAINT "checklist_entries_item_format" CHECK ("ops"."checklist_entries"."item_key" ~ '^[a-z][a-z0-9_]{1,59}$'),
	CONSTRAINT "checklist_entries_waive_reason" CHECK ("ops"."checklist_entries"."status" <> 'waived' OR length(trim(coalesce("ops"."checklist_entries"."reason", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."demo_session_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"field" text NOT NULL,
	"previous_value" text,
	"new_value" text,
	"reason" text,
	"actor_user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_session_changes_field_check" CHECK ("ops"."demo_session_changes"."field" IN ('attendance', 'schedule', 'mock', 'teacher'))
);
--> statement-breakpoint
CREATE TABLE "ops"."demo_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"demo_id" uuid NOT NULL,
	"session_number" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"programme_id" uuid,
	"subject" text,
	"teacher_staff_id" uuid,
	"attendance" text DEFAULT 'scheduled' NOT NULL,
	"recorded_at" timestamp with time zone,
	"recorded_by" uuid,
	"notes" text,
	"mock_status" text DEFAULT 'not_required' NOT NULL,
	"mock_attempt_ref" text,
	"exception_reason" text,
	"teacher_notified_at" timestamp with time zone,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_sessions_number_check" CHECK ("ops"."demo_sessions"."session_number" BETWEEN 1 AND 10),
	CONSTRAINT "demo_sessions_attendance_check" CHECK ("ops"."demo_sessions"."attendance" IN ('scheduled', 'present', 'absent', 'rescheduled', 'cancelled', 'not_recorded')),
	CONSTRAINT "demo_sessions_mock_check" CHECK ("ops"."demo_sessions"."mock_status" IN ('not_required', 'pending', 'prepared', 'scheduled', 'completed')),
	CONSTRAINT "demo_sessions_ends_after_start" CHECK ("ops"."demo_sessions"."ends_at" IS NULL OR "ops"."demo_sessions"."ends_at" > "ops"."demo_sessions"."starts_at"),
	CONSTRAINT "demo_sessions_recorded_has_actor" CHECK ("ops"."demo_sessions"."attendance" NOT IN ('present', 'absent') OR ("ops"."demo_sessions"."recorded_at" IS NOT NULL AND "ops"."demo_sessions"."recorded_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."admission_number_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"previous_number" text,
	"new_number" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text,
	"actor_user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_number_changes_kind_check" CHECK ("ops"."admission_number_changes"."kind" IN ('auto', 'manual')),
	CONSTRAINT "admission_number_changes_manual_reason" CHECK ("ops"."admission_number_changes"."kind" = 'auto' OR length(trim(coalesce("ops"."admission_number_changes"."reason", ''))) >= 10)
);
--> statement-breakpoint
CREATE TABLE "ops"."admission_number_counters" (
	"scope_key" text PRIMARY KEY NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_number_counters_next_check" CHECK ("ops"."admission_number_counters"."next_value" >= 1),
	CONSTRAINT "admission_number_counters_scope_format" CHECK ("ops"."admission_number_counters"."scope_key" ~ '^(all|Y[0-9]{4})$')
);
--> statement-breakpoint
CREATE TABLE "ops"."exit_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"exit_status" text NOT NULL,
	"exit_date" date NOT NULL,
	"reason" text NOT NULL,
	"exit_feedback" text,
	"guardian_feedback" text,
	"fee_reference" text,
	"reactivation_allowed" boolean DEFAULT false NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reactivated_by" uuid,
	"reactivated_at" timestamp with time zone,
	CONSTRAINT "exit_records_status_check" CHECK ("ops"."exit_records"."exit_status" IN ('withdrawn', 'completed', 'transferred', 'cancelled_before_enrolment', 'other_inactive')),
	CONSTRAINT "exit_records_reason_check" CHECK (length(trim("ops"."exit_records"."reason")) > 0),
	CONSTRAINT "exit_records_reactivated_pair" CHECK (("ops"."exit_records"."reactivated_by" IS NULL) = ("ops"."exit_records"."reactivated_at" IS NULL)),
	CONSTRAINT "exit_records_reactivation_allowed" CHECK ("ops"."exit_records"."reactivated_at" IS NULL OR "ops"."exit_records"."reactivation_allowed")
);
--> statement-breakpoint
CREATE TABLE "ops"."guardians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_identity_id" uuid NOT NULL,
	"lead_id" uuid,
	"full_name" text NOT NULL,
	"relationship" text NOT NULL,
	"phone" text,
	"email" text,
	"preferred_contact" text,
	"consent_status" text DEFAULT 'not_recorded' NOT NULL,
	"consent_recorded_at" timestamp with time zone,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guardians_relationship_check" CHECK ("ops"."guardians"."relationship" IN ('mother', 'father', 'guardian', 'other')),
	CONSTRAINT "guardians_phone_e164" CHECK ("ops"."guardians"."phone" IS NULL OR "ops"."guardians"."phone" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "guardians_email_lowercase" CHECK ("ops"."guardians"."email" IS NULL OR "ops"."guardians"."email" = lower("ops"."guardians"."email")),
	CONSTRAINT "guardians_preferred_check" CHECK ("ops"."guardians"."preferred_contact" IS NULL OR "ops"."guardians"."preferred_contact" IN ('call', 'whatsapp', 'sms', 'email')),
	CONSTRAINT "guardians_consent_check" CHECK ("ops"."guardians"."consent_status" IN ('given', 'refused', 'withdrawn', 'not_recorded'))
);
--> statement-breakpoint
CREATE TABLE "ops"."report_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_identity_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"fields_included" jsonb NOT NULL,
	"reference_code" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_exports_period_check" CHECK ("ops"."report_exports"."period_from" <= "ops"."report_exports"."period_to"),
	CONSTRAINT "report_exports_reference_format" CHECK ("ops"."report_exports"."reference_code" ~ '^SR-[0-9A-Z]{10}$')
);
--> statement-breakpoint
CREATE TABLE "ops"."appointment_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"field" text NOT NULL,
	"previous_value" text,
	"new_value" text,
	"reason" text,
	"actor_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."appointment_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"staff_id" uuid,
	"guardian_ref" uuid,
	"student_id" uuid,
	"role" text,
	CONSTRAINT "appointment_participants_ref_matches_kind" CHECK (("ops"."appointment_participants"."kind" = 'staff' AND "ops"."appointment_participants"."staff_id" IS NOT NULL) OR ("ops"."appointment_participants"."kind" = 'guardian' AND "ops"."appointment_participants"."guardian_ref" IS NOT NULL) OR ("ops"."appointment_participants"."kind" = 'student' AND "ops"."appointment_participants"."student_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."staff_subject_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid,
	"subject" text NOT NULL,
	"programme_id" uuid,
	"verification_status" text DEFAULT 'unverified' NOT NULL,
	"source_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_subject_capabilities_verification_check" CHECK ("ops"."staff_subject_capabilities"."verification_status" IN ('unverified', 'confirmed'))
);
--> statement-breakpoint
CREATE TABLE "ops"."student_teacher_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_staff_id" uuid NOT NULL,
	"student_id" uuid,
	"submitted_by_kind" text NOT NULL,
	"subject_ref" text,
	"feedback_on" date NOT NULL,
	"rating" integer,
	"comment" text NOT NULL,
	"moderation_status" text DEFAULT 'pending' NOT NULL,
	"moderation_note" text,
	"moderated_by" uuid,
	"moderated_at" timestamp with time zone,
	"visibility" text DEFAULT 'staff_only' NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_teacher_feedback_moderation_check" CHECK ("ops"."student_teacher_feedback"."moderation_status" IN ('pending', 'approved', 'rejected', 'hidden')),
	CONSTRAINT "student_teacher_feedback_rating_check" CHECK ("ops"."student_teacher_feedback"."rating" IS NULL OR "ops"."student_teacher_feedback"."rating" BETWEEN 1 AND 5),
	CONSTRAINT "student_teacher_feedback_visibility_check" CHECK ("ops"."student_teacher_feedback"."visibility" IN ('staff_only', 'teacher_and_staff'))
);
--> statement-breakpoint
CREATE TABLE "ops"."teacher_student_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_staff_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"observed_on" date NOT NULL,
	"related_ref" text,
	"observations" text NOT NULL,
	"strengths" text,
	"areas_to_improve" text,
	"action_plan" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_student_feedback_status_check" CHECK ("ops"."teacher_student_feedback"."status" IN ('draft', 'final')),
	CONSTRAINT "teacher_student_feedback_version_check" CHECK ("ops"."teacher_student_feedback"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "ops"."fee_instalments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"due_date" date NOT NULL,
	"amount_paise" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_instalments_sequence_positive" CHECK ("ops"."fee_instalments"."sequence" >= 1),
	CONSTRAINT "fee_instalments_amount_positive" CHECK ("ops"."fee_instalments"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."fee_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"label" text NOT NULL,
	"pricing_reference" text,
	"total_paise" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approval_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_plans_status_check" CHECK ("ops"."fee_plans"."status" IN ('draft', 'active', 'closed')),
	CONSTRAINT "fee_plans_total_positive" CHECK ("ops"."fee_plans"."total_paise" > 0),
	CONSTRAINT "fee_plans_currency_inr" CHECK ("ops"."fee_plans"."currency" = 'INR'),
	CONSTRAINT "fee_plans_approved_check" CHECK ("ops"."fee_plans"."status" = 'draft' OR ("ops"."fee_plans"."approval_id" IS NOT NULL AND "ops"."fee_plans"."approved_by" IS NOT NULL AND "ops"."fee_plans"."approved_at" IS NOT NULL)),
	CONSTRAINT "fee_plans_closed_check" CHECK ("ops"."fee_plans"."status" <> 'closed' OR ("ops"."fee_plans"."closed_by" IS NOT NULL AND "ops"."fee_plans"."close_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."lead_handoff_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketing_lead_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"duplicate_deliveries" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"lead_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_handoff_receipts_status_check" CHECK ("ops"."lead_handoff_receipts"."status" IN ('received', 'duplicate_review', 'accepted', 'failed')),
	CONSTRAINT "lead_handoff_receipts_lead_check" CHECK ("ops"."lead_handoff_receipts"."status" NOT IN ('accepted', 'duplicate_review') OR "ops"."lead_handoff_receipts"."lead_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "ops"."admission_transitions" DROP CONSTRAINT "admission_transitions_to_check";--> statement-breakpoint
ALTER TABLE "ops"."admissions" DROP CONSTRAINT "admissions_status_check";--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" DROP CONSTRAINT "counselling_sessions_status_check";--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" DROP CONSTRAINT "counselling_sessions_mode_check";--> statement-breakpoint
ALTER TABLE "ops"."fee_records" DROP CONSTRAINT "fee_records_kind_check";--> statement-breakpoint
DROP INDEX "ops"."admissions_one_open_per_programme";--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ALTER COLUMN "admission_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ALTER COLUMN "lead_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."admissions" ADD COLUMN "admission_number" text;--> statement-breakpoint
ALTER TABLE "ops"."admissions" ADD COLUMN "student_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."admissions" ADD COLUMN "hold_review_date" date;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD COLUMN "type" text DEFAULT 'student_counselling' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD COLUMN "student_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD COLUMN "demo_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD COLUMN "organiser_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD COLUMN "ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD COLUMN "timezone" text DEFAULT 'Asia/Kolkata' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD COLUMN "programme_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD COLUMN "purpose" text;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD COLUMN "reminder_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD COLUMN "follow_up_on" date;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD COLUMN "programme_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD COLUMN "counsellor_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD COLUMN "planned_session_count" integer;--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD COLUMN "outcome" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD COLUMN "outcome_reason" text;--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD COLUMN "outcome_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD COLUMN "outcome_by" uuid;--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD COLUMN "converted_admission_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD COLUMN "is_sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."fee_records" ADD COLUMN "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."fee_records" ADD COLUMN "instalment_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."staff_profiles" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "ops"."staff_profiles" ADD COLUMN "staff_ref" text;--> statement-breakpoint
ALTER TABLE "ops"."staff_profiles" ADD COLUMN "verification_status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."staff_profiles" ADD COLUMN "role_note" text;--> statement-breakpoint
ALTER TABLE "ops"."staff_profiles" ADD COLUMN "source_note" text;--> statement-breakpoint
ALTER TABLE "ops"."checklist_entries" ADD CONSTRAINT "checklist_entries_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."demo_session_changes" ADD CONSTRAINT "demo_session_changes_session_id_demo_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "ops"."demo_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."demo_session_changes" ADD CONSTRAINT "demo_session_changes_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."demo_sessions" ADD CONSTRAINT "demo_sessions_demo_id_demos_id_fk" FOREIGN KEY ("demo_id") REFERENCES "ops"."demos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."demo_sessions" ADD CONSTRAINT "demo_sessions_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "core"."programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."demo_sessions" ADD CONSTRAINT "demo_sessions_teacher_staff_id_staff_members_id_fk" FOREIGN KEY ("teacher_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."demo_sessions" ADD CONSTRAINT "demo_sessions_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."demo_sessions" ADD CONSTRAINT "demo_sessions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."admission_number_changes" ADD CONSTRAINT "admission_number_changes_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "ops"."admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."admission_number_changes" ADD CONSTRAINT "admission_number_changes_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."exit_records" ADD CONSTRAINT "exit_records_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "ops"."admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."exit_records" ADD CONSTRAINT "exit_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."exit_records" ADD CONSTRAINT "exit_records_reactivated_by_users_id_fk" FOREIGN KEY ("reactivated_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."guardians" ADD CONSTRAINT "guardians_student_identity_id_students_id_fk" FOREIGN KEY ("student_identity_id") REFERENCES "core"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."guardians" ADD CONSTRAINT "guardians_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "ops"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."guardians" ADD CONSTRAINT "guardians_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."guardians" ADD CONSTRAINT "guardians_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."report_exports" ADD CONSTRAINT "report_exports_student_identity_id_students_id_fk" FOREIGN KEY ("student_identity_id") REFERENCES "core"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."report_exports" ADD CONSTRAINT "report_exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."appointment_changes" ADD CONSTRAINT "appointment_changes_appointment_id_counselling_sessions_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "ops"."counselling_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."appointment_changes" ADD CONSTRAINT "appointment_changes_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."appointment_participants" ADD CONSTRAINT "appointment_participants_appointment_id_counselling_sessions_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "ops"."counselling_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."appointment_participants" ADD CONSTRAINT "appointment_participants_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."appointment_participants" ADD CONSTRAINT "appointment_participants_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "core"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_subject_capabilities" ADD CONSTRAINT "staff_subject_capabilities_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_subject_capabilities" ADD CONSTRAINT "staff_subject_capabilities_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "core"."programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD CONSTRAINT "student_teacher_feedback_teacher_staff_id_staff_members_id_fk" FOREIGN KEY ("teacher_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD CONSTRAINT "student_teacher_feedback_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "core"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD CONSTRAINT "student_teacher_feedback_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."student_teacher_feedback" ADD CONSTRAINT "student_teacher_feedback_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."teacher_student_feedback" ADD CONSTRAINT "teacher_student_feedback_teacher_staff_id_staff_members_id_fk" FOREIGN KEY ("teacher_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."teacher_student_feedback" ADD CONSTRAINT "teacher_student_feedback_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "core"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."teacher_student_feedback" ADD CONSTRAINT "teacher_student_feedback_supersedes_id_teacher_student_feedback_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "ops"."teacher_student_feedback"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."teacher_student_feedback" ADD CONSTRAINT "teacher_student_feedback_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."fee_instalments" ADD CONSTRAINT "fee_instalments_plan_id_fee_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "ops"."fee_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."fee_plans" ADD CONSTRAINT "fee_plans_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "ops"."admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."fee_plans" ADD CONSTRAINT "fee_plans_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "core"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."fee_plans" ADD CONSTRAINT "fee_plans_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "core"."approvals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."fee_plans" ADD CONSTRAINT "fee_plans_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."fee_plans" ADD CONSTRAINT "fee_plans_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."fee_plans" ADD CONSTRAINT "fee_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lead_handoff_receipts" ADD CONSTRAINT "lead_handoff_receipts_event_id_integration_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "core"."integration_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lead_handoff_receipts" ADD CONSTRAINT "lead_handoff_receipts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "ops"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Hand-written backfill (coordinator, 20 Oct 2026; notes in docs/parts/admissions-*.md)
UPDATE "ops"."counselling_sessions" SET "ends_at" = "scheduled_at" + interval '60 minutes', "reminder_status" = 'not_applicable';--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ALTER COLUMN "ends_at" SET NOT NULL;--> statement-breakpoint
UPDATE "ops"."counselling_sessions" SET "location" = CASE "mode" WHEN 'in_person' THEN 'Sikar centre' WHEN 'phone' THEN 'Phone call' END, "mode" = CASE WHEN "mode" = 'in_person' THEN 'offline' ELSE 'online' END WHERE "mode" IN ('in_person', 'phone', 'video');--> statement-breakpoint
UPDATE "ops"."counselling_sessions" SET "status" = 'cancelled', "cancel_reason" = 'No-show (migrated)' WHERE "status" = 'no_show';--> statement-breakpoint
INSERT INTO "ops"."appointment_participants" ("appointment_id", "kind", "staff_id", "role") SELECT "id", 'staff', "counsellor_staff_id", 'counsellor' FROM "ops"."counselling_sessions";--> statement-breakpoint
UPDATE "ops"."demos" SET "planned_session_count" = LEAST(GREATEST(cardinality("day_dates"), 1), 10);--> statement-breakpoint
ALTER TABLE "ops"."demos" ALTER COLUMN "planned_session_count" SET NOT NULL;--> statement-breakpoint
UPDATE "ops"."demos" SET "outcome" = 'cancelled', "outcome_at" = "updated_at", "outcome_reason" = 'Legacy demo-level status: ' || "status" WHERE "status" IN ('cancelled', 'missed');--> statement-breakpoint
INSERT INTO "ops"."demo_sessions" ("demo_id", "session_number", "starts_at", "subject", "teacher_staff_id", "attendance", "recorded_at", "recorded_by", "exception_reason")
SELECT d."id", u.n::int, (u.day::timestamp AT TIME ZONE 'Asia/Kolkata'),
  CASE WHEN cardinality(d."subjects") = 1 THEN d."subjects"[1] END,
  (SELECT min(t."staff_id"::text)::uuid FROM "ops"."demo_teachers" t WHERE t."demo_id" = d."id" HAVING count(*) = 1),
  CASE d."status" WHEN 'attended' THEN 'present' WHEN 'missed' THEN 'absent' WHEN 'cancelled' THEN 'cancelled' ELSE 'scheduled' END,
  CASE WHEN d."status" IN ('attended', 'missed') THEN coalesce(d."completed_at", d."updated_at") END,
  CASE WHEN d."status" IN ('attended', 'missed') THEN d."created_by" END,
  'Legacy demo: day recorded without a time'
FROM "ops"."demos" d, unnest(d."day_dates") WITH ORDINALITY AS u(day, n)
WHERE u.n <= 10;--> statement-breakpoint
CREATE INDEX "students_full_name_idx" ON "core"."students" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "checklist_entries_subject_idx" ON "ops"."checklist_entries" USING btree ("subject_type","subject_id","item_key","at");--> statement-breakpoint
CREATE INDEX "demo_session_changes_session_idx" ON "ops"."demo_session_changes" USING btree ("session_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "demo_sessions_number_key" ON "ops"."demo_sessions" USING btree ("demo_id","session_number");--> statement-breakpoint
CREATE INDEX "demo_sessions_starts_idx" ON "ops"."demo_sessions" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "demo_sessions_teacher_idx" ON "ops"."demo_sessions" USING btree ("teacher_staff_id","starts_at");--> statement-breakpoint
CREATE INDEX "admission_number_changes_admission_idx" ON "ops"."admission_number_changes" USING btree ("admission_id","at");--> statement-breakpoint
CREATE INDEX "exit_records_admission_idx" ON "ops"."exit_records" USING btree ("admission_id","recorded_at");--> statement-breakpoint
CREATE INDEX "guardians_student_idx" ON "ops"."guardians" USING btree ("student_identity_id");--> statement-breakpoint
CREATE INDEX "guardians_phone_idx" ON "ops"."guardians" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "guardians_email_idx" ON "ops"."guardians" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "report_exports_reference_key" ON "ops"."report_exports" USING btree ("reference_code");--> statement-breakpoint
CREATE INDEX "report_exports_student_idx" ON "ops"."report_exports" USING btree ("student_identity_id","at");--> statement-breakpoint
CREATE INDEX "appointment_changes_appointment_idx" ON "ops"."appointment_changes" USING btree ("appointment_id","at");--> statement-breakpoint
CREATE INDEX "appointment_participants_appointment_idx" ON "ops"."appointment_participants" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "appointment_participants_staff_idx" ON "ops"."appointment_participants" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_subject_capabilities_staff_subject_key" ON "ops"."staff_subject_capabilities" USING btree ("staff_id","subject") WHERE "ops"."staff_subject_capabilities"."staff_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_subject_capabilities_unassigned_key" ON "ops"."staff_subject_capabilities" USING btree ("subject") WHERE "ops"."staff_subject_capabilities"."staff_id" IS NULL;--> statement-breakpoint
CREATE INDEX "student_teacher_feedback_teacher_idx" ON "ops"."student_teacher_feedback" USING btree ("teacher_staff_id","moderation_status");--> statement-breakpoint
CREATE INDEX "teacher_student_feedback_student_idx" ON "ops"."teacher_student_feedback" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "teacher_student_feedback_teacher_idx" ON "ops"."teacher_student_feedback" USING btree ("teacher_staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_student_feedback_supersedes_key" ON "ops"."teacher_student_feedback" USING btree ("supersedes_id") WHERE "ops"."teacher_student_feedback"."supersedes_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_instalments_plan_sequence_key" ON "ops"."fee_instalments" USING btree ("plan_id","sequence");--> statement-breakpoint
CREATE INDEX "fee_plans_student_idx" ON "ops"."fee_plans" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_plans_one_open_per_admission" ON "ops"."fee_plans" USING btree ("admission_id") WHERE "ops"."fee_plans"."status" <> 'closed';--> statement-breakpoint
CREATE UNIQUE INDEX "lead_handoff_receipts_marketing_lead_key" ON "ops"."lead_handoff_receipts" USING btree ("marketing_lead_id");--> statement-breakpoint
CREATE INDEX "lead_handoff_receipts_status_idx" ON "ops"."lead_handoff_receipts" USING btree ("status");--> statement-breakpoint
ALTER TABLE "ops"."admissions" ADD CONSTRAINT "admissions_student_identity_id_students_id_fk" FOREIGN KEY ("student_identity_id") REFERENCES "core"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD CONSTRAINT "counselling_sessions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "core"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD CONSTRAINT "counselling_sessions_demo_id_demos_id_fk" FOREIGN KEY ("demo_id") REFERENCES "ops"."demos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD CONSTRAINT "counselling_sessions_organiser_staff_id_staff_members_id_fk" FOREIGN KEY ("organiser_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD CONSTRAINT "counselling_sessions_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "core"."programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD CONSTRAINT "demos_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "core"."programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD CONSTRAINT "demos_counsellor_staff_id_staff_members_id_fk" FOREIGN KEY ("counsellor_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD CONSTRAINT "demos_outcome_by_users_id_fk" FOREIGN KEY ("outcome_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD CONSTRAINT "demos_converted_admission_id_admissions_id_fk" FOREIGN KEY ("converted_admission_id") REFERENCES "ops"."admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admissions_admission_number_key" ON "ops"."admissions" USING btree ("admission_number");--> statement-breakpoint
CREATE INDEX "admissions_student_identity_idx" ON "ops"."admissions" USING btree ("student_identity_id");--> statement-breakpoint
CREATE INDEX "counselling_sessions_staff_time_idx" ON "ops"."counselling_sessions" USING btree ("counsellor_staff_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "counselling_sessions_student_idx" ON "ops"."counselling_sessions" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "demos_outcome_idx" ON "ops"."demos" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "demos_counsellor_idx" ON "ops"."demos" USING btree ("counsellor_staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demos_one_open_per_admission" ON "ops"."demos" USING btree ("admission_id") WHERE "ops"."demos"."outcome" = 'open';--> statement-breakpoint
CREATE INDEX "fee_records_plan_idx" ON "ops"."fee_records" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_profiles_staff_ref_key" ON "ops"."staff_profiles" USING btree ("staff_ref") WHERE "ops"."staff_profiles"."staff_ref" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "admissions_one_open_per_programme" ON "ops"."admissions" USING btree ("lead_id","programme_id") WHERE "ops"."admissions"."status" NOT IN ('enrolled', 'lost', 'withdrawn', 'completed', 'transferred', 'cancelled_before_enrolment', 'other_inactive');--> statement-breakpoint
ALTER TABLE "ops"."admission_transitions" ADD CONSTRAINT "admission_transitions_to_check" CHECK ("ops"."admission_transitions"."to_status" IN ('new', 'contacted', 'counselling_scheduled', 'counselled', 'demo_scheduled', 'demo_attended', 'admission_pending', 'admitted', 'enrolment_requested', 'enrolled', 'lost', 'on_hold', 'withdrawn', 'completed', 'transferred', 'cancelled_before_enrolment', 'other_inactive'));--> statement-breakpoint
ALTER TABLE "ops"."admissions" ADD CONSTRAINT "admissions_number_format" CHECK ("ops"."admissions"."admission_number" IS NULL OR "ops"."admissions"."admission_number" ~ '^[A-Za-z0-9][A-Za-z0-9/-]{0,39}$');--> statement-breakpoint
ALTER TABLE "ops"."admissions" ADD CONSTRAINT "admissions_status_check" CHECK ("ops"."admissions"."status" IN ('new', 'contacted', 'counselling_scheduled', 'counselled', 'demo_scheduled', 'demo_attended', 'admission_pending', 'admitted', 'enrolment_requested', 'enrolled', 'lost', 'on_hold', 'withdrawn', 'completed', 'transferred', 'cancelled_before_enrolment', 'other_inactive'));--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD CONSTRAINT "counselling_sessions_type_check" CHECK ("ops"."counselling_sessions"."type" IN ('student_counselling', 'guardian_counselling', 'teacher_academic', 'parent_teacher_meeting', 'admission_follow_up', 'demo_review'));--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD CONSTRAINT "counselling_sessions_reminder_check" CHECK ("ops"."counselling_sessions"."reminder_status" IN ('pending', 'sent_in_app', 'simulated', 'not_applicable'));--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD CONSTRAINT "counselling_sessions_ends_after_start" CHECK ("ops"."counselling_sessions"."ends_at" > "ops"."counselling_sessions"."scheduled_at");--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD CONSTRAINT "counselling_sessions_has_subject" CHECK ("ops"."counselling_sessions"."student_id" IS NOT NULL OR "ops"."counselling_sessions"."lead_id" IS NOT NULL OR "ops"."counselling_sessions"."admission_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD CONSTRAINT "counselling_sessions_cancel_reason" CHECK ("ops"."counselling_sessions"."status" <> 'cancelled' OR "ops"."counselling_sessions"."cancel_reason" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD CONSTRAINT "counselling_sessions_status_check" CHECK ("ops"."counselling_sessions"."status" IN ('proposed', 'scheduled', 'confirmed', 'completed', 'cancelled', 'rescheduled'));--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD CONSTRAINT "counselling_sessions_mode_check" CHECK ("ops"."counselling_sessions"."mode" IN ('offline', 'online'));--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD CONSTRAINT "demos_outcome_check" CHECK ("ops"."demos"."outcome" IN ('open', 'converted', 'declined', 'withdrawn', 'not_converted', 'cancelled'));--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD CONSTRAINT "demos_planned_sessions_check" CHECK ("ops"."demos"."planned_session_count" BETWEEN 1 AND 10);--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD CONSTRAINT "demos_outcome_recorded" CHECK (("ops"."demos"."outcome" = 'open') = ("ops"."demos"."outcome_at" IS NULL));--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD CONSTRAINT "demos_outcome_reason" CHECK ("ops"."demos"."outcome" IN ('open', 'converted') OR length(trim(coalesce("ops"."demos"."outcome_reason", ''))) > 0);--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD CONSTRAINT "demos_converted_link" CHECK (("ops"."demos"."outcome" = 'converted') = ("ops"."demos"."converted_admission_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "ops"."fee_records" ADD CONSTRAINT "fee_records_kind_check" CHECK ("ops"."fee_records"."kind" IN ('due', 'received', 'refund', 'adjustment', 'discount', 'waiver'));--> statement-breakpoint
ALTER TABLE "ops"."staff_profiles" ADD CONSTRAINT "staff_profiles_verification_check" CHECK ("ops"."staff_profiles"."verification_status" IN ('unverified', 'confirmed'));