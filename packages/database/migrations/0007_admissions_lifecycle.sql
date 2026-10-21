CREATE TABLE "ops"."kyc_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"guardian_id" uuid,
	"document_type" text NOT NULL,
	"masked_reference" text NOT NULL,
	"verification_status" text DEFAULT 'unverified' NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"verification_note" text,
	"superseded_by_id" uuid,
	"superseded_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kyc_documents_subject_check" CHECK ("ops"."kyc_documents"."subject_type" IN ('student', 'guardian')),
	CONSTRAINT "kyc_documents_guardian_link" CHECK (("ops"."kyc_documents"."subject_type" = 'guardian') = ("ops"."kyc_documents"."guardian_id" IS NOT NULL)),
	CONSTRAINT "kyc_documents_type_format" CHECK ("ops"."kyc_documents"."document_type" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "kyc_documents_masked_check" CHECK (length("ops"."kyc_documents"."masked_reference") BETWEEN 2 AND 40 AND length(regexp_replace("ops"."kyc_documents"."masked_reference", '[^0-9]', '', 'g')) <= 4 AND "ops"."kyc_documents"."masked_reference" ~ '[Xx*•]'),
	CONSTRAINT "kyc_documents_verification_check" CHECK ("ops"."kyc_documents"."verification_status" IN ('unverified', 'verified', 'rejected')),
	CONSTRAINT "kyc_documents_verified_pair" CHECK (("ops"."kyc_documents"."verification_status" = 'unverified') = ("ops"."kyc_documents"."verified_by" IS NULL AND "ops"."kyc_documents"."verified_at" IS NULL)),
	CONSTRAINT "kyc_documents_rejected_note" CHECK ("ops"."kyc_documents"."verification_status" <> 'rejected' OR length(trim(coalesce("ops"."kyc_documents"."verification_note", ''))) > 0),
	CONSTRAINT "kyc_documents_superseded_pair" CHECK (("ops"."kyc_documents"."superseded_by_id" IS NULL) = ("ops"."kyc_documents"."superseded_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."student_siblings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"sibling_student_id" uuid NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_siblings_ordered" CHECK ("ops"."student_siblings"."student_id" < "ops"."student_siblings"."sibling_student_id")
);
--> statement-breakpoint
CREATE TABLE "ops"."event_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"provider_ref" text,
	"recipient_count" integer,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_by" uuid,
	"sent_at" timestamp with time zone,
	CONSTRAINT "event_messages_channel_check" CHECK ("ops"."event_messages"."channel" IN ('email', 'sms', 'whatsapp', 'in_app')),
	CONSTRAINT "event_messages_status_check" CHECK ("ops"."event_messages"."status" IN ('draft', 'simulated', 'sent')),
	CONSTRAINT "event_messages_sent_check" CHECK (("ops"."event_messages"."status" = 'draft') = ("ops"."event_messages"."sent_by" IS NULL AND "ops"."event_messages"."sent_at" IS NULL) AND ("ops"."event_messages"."status" <> 'sent' OR length(trim(coalesce("ops"."event_messages"."provider_ref", ''))) > 0)),
	CONSTRAINT "event_messages_recipients_check" CHECK ("ops"."event_messages"."recipient_count" IS NULL OR "ops"."event_messages"."recipient_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."admission_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"application_version" integer NOT NULL,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reauth_method" text NOT NULL,
	"reauth_verified_at" timestamp with time zone NOT NULL,
	"accepted_snapshot" jsonb NOT NULL,
	"admission_number" text NOT NULL,
	CONSTRAINT "admission_approvals_reauth_check" CHECK ("ops"."admission_approvals"."reauth_method" IN ('password')),
	CONSTRAINT "admission_approvals_version_check" CHECK ("ops"."admission_approvals"."application_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "ops"."application_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"template_version" text NOT NULL,
	"pdf_sha256" text NOT NULL,
	"generated_by" uuid NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_forms_id_version_key" UNIQUE("id","application_id","version"),
	CONSTRAINT "application_forms_version_check" CHECK ("ops"."application_forms"."version" >= 1),
	CONSTRAINT "application_forms_hash_format" CHECK ("ops"."application_forms"."pdf_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "ops"."application_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_versions_version_key" UNIQUE("application_id","version"),
	CONSTRAINT "application_versions_version_check" CHECK ("ops"."application_versions"."version" >= 1),
	CONSTRAINT "application_versions_hash_format" CHECK ("ops"."application_versions"."content_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "ops"."applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"student_id" uuid NOT NULL,
	"admission_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"demo_id" uuid,
	"previous_admission_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"academic_year" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_reference_format" CHECK ("ops"."applications"."reference" ~ '^APP-[0-9]{6}$'),
	CONSTRAINT "applications_origin_check" CHECK ("ops"."applications"."origin" IN ('demo', 'direct', 'readmission')),
	CONSTRAINT "applications_status_check" CHECK ("ops"."applications"."status" IN ('draft', 'ready_for_review', 'form_generated', 'signatures_confirmed', 'admission_confirmed', 'withdrawn')),
	CONSTRAINT "applications_demo_link" CHECK (("ops"."applications"."origin" = 'demo') = ("ops"."applications"."demo_id" IS NOT NULL)),
	CONSTRAINT "applications_readmission_link" CHECK (("ops"."applications"."origin" = 'readmission') = ("ops"."applications"."previous_admission_id" IS NOT NULL)),
	CONSTRAINT "applications_version_check" CHECK ("ops"."applications"."current_version" >= 1),
	CONSTRAINT "applications_year_format" CHECK ("ops"."applications"."academic_year" IS NULL OR "ops"."applications"."academic_year" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "ops"."signature_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"form_id" uuid NOT NULL,
	"signers" jsonb NOT NULL,
	"signed_on" date NOT NULL,
	"confirmed_by" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invalidated_at" timestamp with time zone,
	"invalidated_by" uuid,
	"invalidated_reason" text,
	CONSTRAINT "signature_confirmations_signers_check" CHECK (jsonb_array_length("ops"."signature_confirmations"."signers") >= 1),
	CONSTRAINT "signature_confirmations_invalidated_check" CHECK (("ops"."signature_confirmations"."invalidated_at" IS NULL) = ("ops"."signature_confirmations"."invalidated_by" IS NULL) AND ("ops"."signature_confirmations"."invalidated_at" IS NULL) = ("ops"."signature_confirmations"."invalidated_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."material_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"item_id" uuid,
	"catalogue_code" text NOT NULL,
	"title" text NOT NULL,
	"edition" text,
	"quantity" integer NOT NULL,
	"kind" text NOT NULL,
	"issued_on" date NOT NULL,
	"note" text,
	"actor_user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_issues_code_format" CHECK ("ops"."material_issues"."catalogue_code" ~ '^[a-z][a-z0-9_]{1,59}$'),
	CONSTRAINT "material_issues_quantity_check" CHECK ("ops"."material_issues"."quantity" >= 1),
	CONSTRAINT "material_issues_kind_check" CHECK ("ops"."material_issues"."kind" IN ('issue', 'return', 'replacement'))
);
--> statement-breakpoint
CREATE TABLE "ops"."onboarding_item_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"evidence_ref" text,
	"actor_user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_item_events_status_check" CHECK ("ops"."onboarding_item_events"."status" IN ('not_started', 'in_progress', 'completed', 'blocked', 'not_applicable')),
	CONSTRAINT "onboarding_item_events_blocked_note" CHECK ("ops"."onboarding_item_events"."status" <> 'blocked' OR length(trim(coalesce("ops"."onboarding_item_events"."note", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."onboarding_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"template_id" uuid,
	"template_version" integer,
	"item_key" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"owner_staff_id" uuid,
	"due_date" date,
	"added_explicitly" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_items_key_format" CHECK ("ops"."onboarding_items"."item_key" ~ '^[a-z][a-z0-9_]{1,59}$'),
	CONSTRAINT "onboarding_items_kind_check" CHECK ("ops"."onboarding_items"."kind" IN ('check', 'biometric', 'material')),
	CONSTRAINT "onboarding_items_template_check" CHECK (("ops"."onboarding_items"."template_id" IS NULL) = ("ops"."onboarding_items"."template_version" IS NULL) AND ("ops"."onboarding_items"."template_id" IS NULL) = "ops"."onboarding_items"."added_explicitly")
);
--> statement-breakpoint
CREATE TABLE "ops"."onboarding_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"version" integer NOT NULL,
	"programme_codes" text[] NOT NULL,
	"class_category" text,
	"items" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_templates_code_format" CHECK ("ops"."onboarding_templates"."code" ~ '^[a-z][a-z0-9_]{1,59}$'),
	CONSTRAINT "onboarding_templates_version_check" CHECK ("ops"."onboarding_templates"."version" >= 1),
	CONSTRAINT "onboarding_templates_codes_check" CHECK (cardinality("ops"."onboarding_templates"."programme_codes") >= 1),
	CONSTRAINT "onboarding_templates_category_check" CHECK ("ops"."onboarding_templates"."class_category" IS NULL OR "ops"."onboarding_templates"."class_category" IN ('class_9', 'class_10', 'class_11', 'class_12', 'gap_year', 'graduate', 'other')),
	CONSTRAINT "onboarding_templates_status_check" CHECK ("ops"."onboarding_templates"."status" IN ('draft', 'active', 'retired'))
);
--> statement-breakpoint
ALTER TABLE "ops"."demo_sessions" DROP CONSTRAINT "demo_sessions_number_check";--> statement-breakpoint
ALTER TABLE "ops"."demo_sessions" DROP CONSTRAINT "demo_sessions_attendance_check";--> statement-breakpoint
ALTER TABLE "ops"."demo_sessions" DROP CONSTRAINT "demo_sessions_recorded_has_actor";--> statement-breakpoint
ALTER TABLE "ops"."demos" DROP CONSTRAINT "demos_outcome_check";--> statement-breakpoint
ALTER TABLE "ops"."demos" DROP CONSTRAINT "demos_planned_sessions_check";--> statement-breakpoint
ALTER TABLE "ops"."appointments" DROP CONSTRAINT "appointments_type_check";--> statement-breakpoint
ALTER TABLE "ops"."appointments" DROP CONSTRAINT "appointments_has_person";--> statement-breakpoint
ALTER TABLE "ops"."admissions" ADD COLUMN "legacy_verification" text;--> statement-breakpoint
ALTER TABLE "ops"."admissions" ADD COLUMN "legacy_verified_by" uuid;--> statement-breakpoint
ALTER TABLE "ops"."admissions" ADD COLUMN "legacy_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."admissions" ADD COLUMN "application_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."leads" ADD COLUMN "interested_programme_codes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."leads" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "ops"."leads" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "ops"."leads" ADD COLUMN "emergency_contact_name" text;--> statement-breakpoint
ALTER TABLE "ops"."leads" ADD COLUMN "emergency_contact_phone" text;--> statement-breakpoint
ALTER TABLE "ops"."demo_sessions" ADD COLUMN "day_number" integer;--> statement-breakpoint
ALTER TABLE "ops"."demo_sessions" ADD COLUMN "is_substitute" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."demo_sessions" ADD COLUMN "academic_session_ref" text;--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD COLUMN "planned_day_count" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."exit_records" ADD COLUMN "reason_code" text;--> statement-breakpoint
ALTER TABLE "ops"."exit_records" ADD COLUMN "prior_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."exit_records" ADD COLUMN "balance_paise" bigint;--> statement-breakpoint
ALTER TABLE "ops"."exit_records" ADD COLUMN "material_status" text DEFAULT 'not_recorded' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."exit_records" ADD COLUMN "closing_notes" text;--> statement-breakpoint
ALTER TABLE "ops"."guardians" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "ops"."guardians" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."guardians" ADD COLUMN "is_emergency" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."report_exports" ADD COLUMN "audience" text DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."report_exports" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."report_exports" ADD COLUMN "snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "ops"."report_exports" ADD COLUMN "template_version" text;--> statement-breakpoint
ALTER TABLE "ops"."report_exports" ADD COLUMN "source_refs" jsonb;--> statement-breakpoint
ALTER TABLE "ops"."report_exports" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "ops"."report_exports" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."report_exports" ADD COLUMN "finalised_by" uuid;--> statement-breakpoint
ALTER TABLE "ops"."report_exports" ADD COLUMN "finalised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."appointment_participants" ADD COLUMN "name_snapshot" text;--> statement-breakpoint
ALTER TABLE "ops"."appointment_participants" ADD COLUMN "added_via" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."appointment_participants" ADD COLUMN "added_by" uuid;--> statement-breakpoint
ALTER TABLE "ops"."appointment_participants" ADD COLUMN "added_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."appointment_participants" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."appointment_participants" ADD COLUMN "removed_by" uuid;--> statement-breakpoint
ALTER TABLE "ops"."appointment_participants" ADD COLUMN "removed_reason" text;--> statement-breakpoint
ALTER TABLE "ops"."appointment_participants" ADD COLUMN "registration_status" text;--> statement-breakpoint
ALTER TABLE "ops"."appointment_participants" ADD COLUMN "attendance" text DEFAULT 'not_recorded' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."appointments" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "ops"."appointments" ADD COLUMN "online_link" text;--> statement-breakpoint
ALTER TABLE "ops"."appointments" ADD COLUMN "capacity" integer;--> statement-breakpoint
ALTER TABLE "ops"."appointments" ADD COLUMN "audience" jsonb;--> statement-breakpoint
ALTER TABLE "ops"."teacher_student_feedback" ADD COLUMN "scope" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."teacher_student_feedback" ADD COLUMN "demo_session_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."teacher_student_feedback" ADD COLUMN "enrolment_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."teacher_student_feedback" ADD COLUMN "visibility" text DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."fee_plans" ADD COLUMN "academic_year" text;--> statement-breakpoint
ALTER TABLE "ops"."fee_plans" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."fee_plans" ADD COLUMN "supersedes_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."fee_plans" ADD COLUMN "adjustment_reason" text;--> statement-breakpoint
ALTER TABLE "ops"."fee_records" ADD COLUMN "charge_category" text DEFAULT 'tuition' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."fee_records" ADD COLUMN "reverses_record_id" uuid;--> statement-breakpoint
-- Hand-written backfills (reviewed, 21 Oct 2026). Additive only: nothing is dropped or renamed.
-- Existing demo classes each were their own day, so day N = class N (D-038).
UPDATE "ops"."demo_sessions" SET "day_number" = "session_number";--> statement-breakpoint
ALTER TABLE "ops"."demo_sessions" ALTER COLUMN "day_number" SET NOT NULL;--> statement-breakpoint
UPDATE "ops"."demos" SET "planned_day_count" = LEAST("planned_session_count", 10);--> statement-breakpoint
-- The demo-days setting replaces the demo-classes setting; a stored value keeps its state and history.
UPDATE "ops"."settings" SET "key" = 'admissions.demo.day_count', "owner_decision" = 'D-038'
  WHERE "key" = 'admissions.demo.session_count'
    AND NOT EXISTS (SELECT 1 FROM "ops"."settings" WHERE "key" = 'admissions.demo.day_count');--> statement-breakpoint
-- A demo fee row is a demo charge; an adjustment that carried a demo fee into tuition stays tuition.
UPDATE "ops"."fee_records" SET "charge_category" = 'demo' WHERE "demo_id" IS NOT NULL AND "kind" <> 'adjustment';--> statement-breakpoint
UPDATE "ops"."leads" l SET "interested_programme_codes" = ARRAY[p."code"]
  FROM "core"."programmes" p WHERE p."id" = l."programme_id";--> statement-breakpoint
-- The first guardian recorded for a student came from the lead's main contact: make it primary.
UPDATE "ops"."guardians" g SET "is_primary" = true
  WHERE g."archived_at" IS NULL AND g."id" = (
    SELECT f."id" FROM "ops"."guardians" f
    WHERE f."student_id" = g."student_id" AND f."archived_at" IS NULL
    ORDER BY f."created_at", f."id" LIMIT 1);--> statement-breakpoint
UPDATE "ops"."appointment_participants" ap SET "added_at" = a."created_at"
  FROM "ops"."appointments" a WHERE a."id" = ap."appointment_id";--> statement-breakpoint
-- Reports exported before 0007 were final when printed; they carry no content snapshot.
UPDATE "ops"."report_exports" SET "status" = 'final', "snapshot" = '{"legacy": true}'::jsonb,
  "template_version" = 'legacy', "finalised_by" = "requested_by", "finalised_at" = "at";--> statement-breakpoint
-- Admitted before final confirmation existed: no approval, signed form or payment evidence on record.
UPDATE "ops"."admissions" SET "legacy_verification" = 'required'
  WHERE "admitted_at" IS NOT NULL OR "admission_number" IS NOT NULL;--> statement-breakpoint
-- Composite-FK targets on existing tables must exist before the FKs below (moved up by hand).
ALTER TABLE "ops"."admissions" ADD CONSTRAINT "admissions_id_number_key" UNIQUE("id","admission_number");--> statement-breakpoint
ALTER TABLE "ops"."guardians" ADD CONSTRAINT "guardians_id_student_key" UNIQUE("id","student_id");--> statement-breakpoint
ALTER TABLE "ops"."kyc_documents" ADD CONSTRAINT "kyc_documents_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "core"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."kyc_documents" ADD CONSTRAINT "kyc_documents_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."kyc_documents" ADD CONSTRAINT "kyc_documents_superseded_by_id_kyc_documents_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "ops"."kyc_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."kyc_documents" ADD CONSTRAINT "kyc_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."kyc_documents" ADD CONSTRAINT "kyc_documents_guardian_fk" FOREIGN KEY ("guardian_id","student_id") REFERENCES "ops"."guardians"("id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."student_siblings" ADD CONSTRAINT "student_siblings_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "core"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."student_siblings" ADD CONSTRAINT "student_siblings_sibling_student_id_students_id_fk" FOREIGN KEY ("sibling_student_id") REFERENCES "core"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."student_siblings" ADD CONSTRAINT "student_siblings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."event_messages" ADD CONSTRAINT "event_messages_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "ops"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."event_messages" ADD CONSTRAINT "event_messages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."event_messages" ADD CONSTRAINT "event_messages_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."admission_approvals" ADD CONSTRAINT "admission_approvals_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "ops"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."admission_approvals" ADD CONSTRAINT "admission_approvals_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."admission_approvals" ADD CONSTRAINT "admission_approvals_admission_number_fk" FOREIGN KEY ("admission_id","admission_number") REFERENCES "ops"."admissions"("id","admission_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."admission_approvals" ADD CONSTRAINT "admission_approvals_version_fk" FOREIGN KEY ("application_id","application_version") REFERENCES "ops"."application_versions"("application_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."application_forms" ADD CONSTRAINT "application_forms_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "ops"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."application_forms" ADD CONSTRAINT "application_forms_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."application_forms" ADD CONSTRAINT "application_forms_version_fk" FOREIGN KEY ("application_id","version") REFERENCES "ops"."application_versions"("application_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."application_versions" ADD CONSTRAINT "application_versions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "ops"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."application_versions" ADD CONSTRAINT "application_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."applications" ADD CONSTRAINT "applications_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "core"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."applications" ADD CONSTRAINT "applications_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "ops"."admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."applications" ADD CONSTRAINT "applications_demo_id_demos_id_fk" FOREIGN KEY ("demo_id") REFERENCES "ops"."demos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."applications" ADD CONSTRAINT "applications_previous_admission_id_admissions_id_fk" FOREIGN KEY ("previous_admission_id") REFERENCES "ops"."admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."applications" ADD CONSTRAINT "applications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."signature_confirmations" ADD CONSTRAINT "signature_confirmations_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "ops"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."signature_confirmations" ADD CONSTRAINT "signature_confirmations_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."signature_confirmations" ADD CONSTRAINT "signature_confirmations_invalidated_by_users_id_fk" FOREIGN KEY ("invalidated_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."signature_confirmations" ADD CONSTRAINT "signature_confirmations_form_fk" FOREIGN KEY ("form_id","application_id","version") REFERENCES "ops"."application_forms"("id","application_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."material_issues" ADD CONSTRAINT "material_issues_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "ops"."admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."material_issues" ADD CONSTRAINT "material_issues_item_id_onboarding_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "ops"."onboarding_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."material_issues" ADD CONSTRAINT "material_issues_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."onboarding_item_events" ADD CONSTRAINT "onboarding_item_events_item_id_onboarding_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "ops"."onboarding_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."onboarding_item_events" ADD CONSTRAINT "onboarding_item_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."onboarding_items" ADD CONSTRAINT "onboarding_items_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "ops"."admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."onboarding_items" ADD CONSTRAINT "onboarding_items_template_id_onboarding_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "ops"."onboarding_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."onboarding_items" ADD CONSTRAINT "onboarding_items_owner_staff_id_staff_members_id_fk" FOREIGN KEY ("owner_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."onboarding_items" ADD CONSTRAINT "onboarding_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."onboarding_templates" ADD CONSTRAINT "onboarding_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kyc_documents_student_idx" ON "ops"."kyc_documents" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "kyc_documents_guardian_idx" ON "ops"."kyc_documents" USING btree ("guardian_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kyc_documents_live_student_key" ON "ops"."kyc_documents" USING btree ("student_id","document_type") WHERE "ops"."kyc_documents"."guardian_id" IS NULL AND "ops"."kyc_documents"."superseded_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "kyc_documents_live_guardian_key" ON "ops"."kyc_documents" USING btree ("guardian_id","document_type") WHERE "ops"."kyc_documents"."guardian_id" IS NOT NULL AND "ops"."kyc_documents"."superseded_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "student_siblings_pair_key" ON "ops"."student_siblings" USING btree ("student_id","sibling_student_id");--> statement-breakpoint
CREATE INDEX "student_siblings_sibling_idx" ON "ops"."student_siblings" USING btree ("sibling_student_id");--> statement-breakpoint
CREATE INDEX "event_messages_appointment_idx" ON "ops"."event_messages" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admission_approvals_admission_key" ON "ops"."admission_approvals" USING btree ("admission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admission_approvals_number_key" ON "ops"."admission_approvals" USING btree ("admission_number");--> statement-breakpoint
CREATE INDEX "admission_approvals_application_idx" ON "ops"."admission_approvals" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "application_forms_application_idx" ON "ops"."application_forms" USING btree ("application_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_reference_key" ON "ops"."applications" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_admission_key" ON "ops"."applications" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "applications_student_idx" ON "ops"."applications" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "applications_status_idx" ON "ops"."applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "applications_demo_idx" ON "ops"."applications" USING btree ("demo_id");--> statement-breakpoint
CREATE INDEX "applications_previous_admission_idx" ON "ops"."applications" USING btree ("previous_admission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signature_confirmations_live_key" ON "ops"."signature_confirmations" USING btree ("application_id") WHERE "ops"."signature_confirmations"."invalidated_at" IS NULL;--> statement-breakpoint
CREATE INDEX "signature_confirmations_form_idx" ON "ops"."signature_confirmations" USING btree ("form_id");--> statement-breakpoint
CREATE INDEX "material_issues_admission_idx" ON "ops"."material_issues" USING btree ("admission_id","issued_on");--> statement-breakpoint
CREATE INDEX "material_issues_item_idx" ON "ops"."material_issues" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "onboarding_item_events_item_idx" ON "ops"."onboarding_item_events" USING btree ("item_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_items_admission_key" ON "ops"."onboarding_items" USING btree ("admission_id","item_key");--> statement-breakpoint
CREATE INDEX "onboarding_items_owner_idx" ON "ops"."onboarding_items" USING btree ("owner_staff_id","due_date");--> statement-breakpoint
CREATE INDEX "onboarding_items_template_idx" ON "ops"."onboarding_items" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_templates_code_version_key" ON "ops"."onboarding_templates" USING btree ("code","version");--> statement-breakpoint
ALTER TABLE "ops"."admissions" ADD CONSTRAINT "admissions_legacy_verified_by_users_id_fk" FOREIGN KEY ("legacy_verified_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."admissions" ADD CONSTRAINT "admissions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "ops"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."report_exports" ADD CONSTRAINT "report_exports_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."report_exports" ADD CONSTRAINT "report_exports_finalised_by_users_id_fk" FOREIGN KEY ("finalised_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."appointment_participants" ADD CONSTRAINT "appointment_participants_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."appointment_participants" ADD CONSTRAINT "appointment_participants_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."teacher_student_feedback" ADD CONSTRAINT "teacher_student_feedback_demo_session_id_demo_sessions_id_fk" FOREIGN KEY ("demo_session_id") REFERENCES "ops"."demo_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."fee_plans" ADD CONSTRAINT "fee_plans_supersedes_plan_id_fee_plans_id_fk" FOREIGN KEY ("supersedes_plan_id") REFERENCES "ops"."fee_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."fee_records" ADD CONSTRAINT "fee_records_reverses_record_id_fee_records_id_fk" FOREIGN KEY ("reverses_record_id") REFERENCES "ops"."fee_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."fee_records" ADD CONSTRAINT "fee_records_plan_id_fee_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "ops"."fee_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."fee_records" ADD CONSTRAINT "fee_records_instalment_id_fee_instalments_id_fk" FOREIGN KEY ("instalment_id") REFERENCES "ops"."fee_instalments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admissions_application_idx" ON "ops"."admissions" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admissions_one_open_without_programme" ON "ops"."admissions" USING btree ("lead_id") WHERE "ops"."admissions"."programme_id" IS NULL AND "ops"."admissions"."status" NOT IN ('enrolled', 'lost', 'withdrawn', 'completed', 'transferred', 'cancelled_before_enrolment', 'other_inactive');--> statement-breakpoint
CREATE INDEX "follow_ups_admission_idx" ON "ops"."follow_ups" USING btree ("admission_id","status");--> statement-breakpoint
CREATE INDEX "leads_merged_into_idx" ON "ops"."leads" USING btree ("merged_into_lead_id") WHERE "ops"."leads"."merged_into_lead_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "guardians_one_primary_per_student" ON "ops"."guardians" USING btree ("student_id") WHERE "ops"."guardians"."is_primary" AND "ops"."guardians"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "teacher_student_feedback_demo_session_idx" ON "ops"."teacher_student_feedback" USING btree ("demo_session_id");--> statement-breakpoint
CREATE INDEX "teacher_student_feedback_enrolment_idx" ON "ops"."teacher_student_feedback" USING btree ("enrolment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_plans_supersedes_key" ON "ops"."fee_plans" USING btree ("supersedes_plan_id") WHERE "ops"."fee_plans"."supersedes_plan_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "fee_records_instalment_idx" ON "ops"."fee_records" USING btree ("instalment_id");--> statement-breakpoint
CREATE INDEX "fee_records_reverses_idx" ON "ops"."fee_records" USING btree ("reverses_record_id");--> statement-breakpoint
ALTER TABLE "ops"."admissions" ADD CONSTRAINT "admissions_legacy_check" CHECK ("ops"."admissions"."legacy_verification" IS NULL OR "ops"."admissions"."legacy_verification" IN ('required', 'verified'));--> statement-breakpoint
ALTER TABLE "ops"."admissions" ADD CONSTRAINT "admissions_legacy_verified_check" CHECK (("ops"."admissions"."legacy_verification" IS NOT DISTINCT FROM 'verified') = ("ops"."admissions"."legacy_verified_by" IS NOT NULL AND "ops"."admissions"."legacy_verified_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "ops"."leads" ADD CONSTRAINT "leads_emergency_phone_e164" CHECK ("ops"."leads"."emergency_contact_phone" IS NULL OR "ops"."leads"."emergency_contact_phone" ~ '^\+[1-9][0-9]{7,14}$');--> statement-breakpoint
ALTER TABLE "ops"."leads" ADD CONSTRAINT "leads_interests_check" CHECK (cardinality("ops"."leads"."interested_programme_codes") <= 6);--> statement-breakpoint
ALTER TABLE "ops"."demo_sessions" ADD CONSTRAINT "demo_sessions_day_check" CHECK ("ops"."demo_sessions"."day_number" BETWEEN 1 AND 10);--> statement-breakpoint
ALTER TABLE "ops"."demo_sessions" ADD CONSTRAINT "demo_sessions_number_check" CHECK ("ops"."demo_sessions"."session_number" BETWEEN 1 AND 30);--> statement-breakpoint
ALTER TABLE "ops"."demo_sessions" ADD CONSTRAINT "demo_sessions_attendance_check" CHECK ("ops"."demo_sessions"."attendance" IN ('scheduled', 'present', 'absent', 'rescheduled', 'cancelled', 'not_recorded', 'late', 'excused'));--> statement-breakpoint
ALTER TABLE "ops"."demo_sessions" ADD CONSTRAINT "demo_sessions_recorded_has_actor" CHECK ("ops"."demo_sessions"."attendance" NOT IN ('present', 'absent', 'late', 'excused') OR ("ops"."demo_sessions"."recorded_at" IS NOT NULL AND "ops"."demo_sessions"."recorded_by" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD CONSTRAINT "demos_planned_days_check" CHECK ("ops"."demos"."planned_day_count" BETWEEN 1 AND 10);--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD CONSTRAINT "demos_outcome_check" CHECK ("ops"."demos"."outcome" IN ('open', 'converted', 'declined', 'withdrawn', 'not_converted', 'cancelled', 'no_show'));--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD CONSTRAINT "demos_planned_sessions_check" CHECK ("ops"."demos"."planned_session_count" BETWEEN 1 AND 30);--> statement-breakpoint
ALTER TABLE "ops"."exit_records" ADD CONSTRAINT "exit_records_reason_code_format" CHECK ("ops"."exit_records"."reason_code" IS NULL OR "ops"."exit_records"."reason_code" ~ '^[a-z][a-z0-9_]{1,39}$');--> statement-breakpoint
ALTER TABLE "ops"."exit_records" ADD CONSTRAINT "exit_records_material_check" CHECK ("ops"."exit_records"."material_status" IN ('not_recorded', 'returned', 'partly_returned', 'not_returned', 'not_applicable'));--> statement-breakpoint
ALTER TABLE "ops"."report_exports" ADD CONSTRAINT "report_exports_audience_check" CHECK ("ops"."report_exports"."audience" IN ('internal', 'guardian', 'student', 'admin_dossier'));--> statement-breakpoint
ALTER TABLE "ops"."report_exports" ADD CONSTRAINT "report_exports_status_check" CHECK ("ops"."report_exports"."status" IN ('draft', 'reviewed', 'final'));--> statement-breakpoint
ALTER TABLE "ops"."report_exports" ADD CONSTRAINT "report_exports_reviewed_pair" CHECK (("ops"."report_exports"."reviewed_by" IS NULL) = ("ops"."report_exports"."reviewed_at" IS NULL));--> statement-breakpoint
ALTER TABLE "ops"."report_exports" ADD CONSTRAINT "report_exports_second_reviewer" CHECK ("ops"."report_exports"."reviewed_by" IS NULL OR "ops"."report_exports"."reviewed_by" <> "ops"."report_exports"."requested_by");--> statement-breakpoint
ALTER TABLE "ops"."report_exports" ADD CONSTRAINT "report_exports_final_check" CHECK (("ops"."report_exports"."status" = 'final') = ("ops"."report_exports"."finalised_by" IS NOT NULL AND "ops"."report_exports"."finalised_at" IS NOT NULL AND "ops"."report_exports"."snapshot" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "ops"."appointment_participants" ADD CONSTRAINT "appointment_participants_added_via_check" CHECK ("ops"."appointment_participants"."added_via" IN ('audience_snapshot', 'manual'));--> statement-breakpoint
ALTER TABLE "ops"."appointment_participants" ADD CONSTRAINT "appointment_participants_registration_check" CHECK ("ops"."appointment_participants"."registration_status" IS NULL OR "ops"."appointment_participants"."registration_status" IN ('invited', 'registered', 'declined'));--> statement-breakpoint
ALTER TABLE "ops"."appointment_participants" ADD CONSTRAINT "appointment_participants_attendance_check" CHECK ("ops"."appointment_participants"."attendance" IN ('not_recorded', 'present', 'absent'));--> statement-breakpoint
ALTER TABLE "ops"."appointment_participants" ADD CONSTRAINT "appointment_participants_removed_check" CHECK (("ops"."appointment_participants"."removed_at" IS NULL) = ("ops"."appointment_participants"."removed_by" IS NULL) AND ("ops"."appointment_participants"."removed_at" IS NULL) = ("ops"."appointment_participants"."removed_reason" IS NULL));--> statement-breakpoint
ALTER TABLE "ops"."appointments" ADD CONSTRAINT "appointments_group_title" CHECK ("ops"."appointments"."type" NOT IN ('event', 'webinar') OR "ops"."appointments"."title" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "ops"."appointments" ADD CONSTRAINT "appointments_capacity_check" CHECK ("ops"."appointments"."capacity" IS NULL OR "ops"."appointments"."capacity" >= 1);--> statement-breakpoint
ALTER TABLE "ops"."appointments" ADD CONSTRAINT "appointments_type_check" CHECK ("ops"."appointments"."type" IN ('student_counselling', 'guardian_counselling', 'teacher_academic', 'parent_teacher_meeting', 'admission_follow_up', 'demo_review', 'event', 'webinar'));--> statement-breakpoint
ALTER TABLE "ops"."appointments" ADD CONSTRAINT "appointments_has_person" CHECK ("ops"."appointments"."type" IN ('event', 'webinar') OR "ops"."appointments"."student_id" IS NOT NULL OR "ops"."appointments"."lead_id" IS NOT NULL OR "ops"."appointments"."admission_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "ops"."teacher_student_feedback" ADD CONSTRAINT "teacher_student_feedback_scope_check" CHECK ("ops"."teacher_student_feedback"."scope" IN ('demo_session', 'enrolment', 'general'));--> statement-breakpoint
ALTER TABLE "ops"."teacher_student_feedback" ADD CONSTRAINT "teacher_student_feedback_scope_ref" CHECK (("ops"."teacher_student_feedback"."scope" = 'demo_session') = ("ops"."teacher_student_feedback"."demo_session_id" IS NOT NULL) AND ("ops"."teacher_student_feedback"."scope" = 'enrolment') = ("ops"."teacher_student_feedback"."enrolment_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "ops"."teacher_student_feedback" ADD CONSTRAINT "teacher_student_feedback_visibility_check" CHECK ("ops"."teacher_student_feedback"."visibility" IN ('internal', 'shareable'));--> statement-breakpoint
ALTER TABLE "ops"."fee_plans" ADD CONSTRAINT "fee_plans_version_check" CHECK ("ops"."fee_plans"."version" >= 1 AND ("ops"."fee_plans"."version" = 1) = ("ops"."fee_plans"."supersedes_plan_id" IS NULL) AND ("ops"."fee_plans"."version" = 1 OR length(trim(coalesce("ops"."fee_plans"."adjustment_reason", ''))) > 0));--> statement-breakpoint
ALTER TABLE "ops"."fee_plans" ADD CONSTRAINT "fee_plans_year_format" CHECK ("ops"."fee_plans"."academic_year" IS NULL OR "ops"."fee_plans"."academic_year" ~ '^[0-9]{4}-[0-9]{2}$');--> statement-breakpoint
ALTER TABLE "ops"."fee_records" ADD CONSTRAINT "fee_records_category_check" CHECK ("ops"."fee_records"."charge_category" IN ('tuition', 'registration', 'demo'));--> statement-breakpoint
ALTER TABLE "ops"."fee_records" ADD CONSTRAINT "fee_records_demo_link" CHECK ("ops"."fee_records"."charge_category" <> 'demo' OR "ops"."fee_records"."demo_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "ops"."fee_records" ADD CONSTRAINT "fee_records_not_self_reversal" CHECK ("ops"."fee_records"."reverses_record_id" IS NULL OR "ops"."fee_records"."reverses_record_id" <> "ops"."fee_records"."id");