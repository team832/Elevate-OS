CREATE TABLE "core"."portal_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"guardian_id" uuid,
	"consent_guardian_id" uuid,
	"consent_text_version" text,
	"consent_given_at" timestamp with time zone,
	"consent_recorded_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_by" uuid,
	CONSTRAINT "portal_accounts_kind_check" CHECK ("core"."portal_accounts"."kind" IN ('student', 'guardian')),
	CONSTRAINT "portal_accounts_guardian_check" CHECK (("core"."portal_accounts"."kind" = 'guardian') = ("core"."portal_accounts"."guardian_id" IS NOT NULL)),
	CONSTRAINT "portal_accounts_consent_check" CHECK (num_nonnulls("core"."portal_accounts"."consent_guardian_id", "core"."portal_accounts"."consent_text_version", "core"."portal_accounts"."consent_given_at", "core"."portal_accounts"."consent_recorded_by") IN (0, 4) AND length(trim(coalesce("core"."portal_accounts"."consent_text_version", 'x'))) > 0),
	CONSTRAINT "portal_accounts_disabled_check" CHECK (("core"."portal_accounts"."disabled_at" IS NULL) = ("core"."portal_accounts"."disabled_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "core"."portal_setup_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_setup_codes_hash_check" CHECK ("core"."portal_setup_codes"."code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "portal_setup_codes_expiry_check" CHECK ("core"."portal_setup_codes"."expires_at" > "core"."portal_setup_codes"."created_at"),
	CONSTRAINT "portal_setup_codes_closed_check" CHECK (num_nonnulls("core"."portal_setup_codes"."used_at", "core"."portal_setup_codes"."revoked_at") <= 1)
);
--> statement-breakpoint
CREATE TABLE "academic"."homework" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"subject_id" uuid,
	"chapter_id" uuid,
	"class_record_id" uuid,
	"title" text NOT NULL,
	"instructions" text,
	"set_on" date NOT NULL,
	"due_on" date NOT NULL,
	"teacher_staff_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancel_reason" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "homework_title_check" CHECK (length(trim("academic"."homework"."title")) > 0),
	CONSTRAINT "homework_dates_order" CHECK ("academic"."homework"."due_on" >= "academic"."homework"."set_on"),
	CONSTRAINT "homework_cancel_check" CHECK (num_nonnulls("academic"."homework"."cancelled_at", "academic"."homework"."cancelled_by_user_id", "academic"."homework"."cancel_reason") IN (0, 3) AND length(trim(coalesce("academic"."homework"."cancel_reason", 'x'))) > 0)
);
--> statement-breakpoint
CREATE TABLE "academic"."homework_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"homework_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" text NOT NULL,
	"remark" text,
	"marked_by_user_id" uuid NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "homework_marks_status_check" CHECK ("academic"."homework_marks"."status" IN ('submitted', 'late', 'not_submitted', 'excused'))
);
--> statement-breakpoint
CREATE TABLE "ops"."absence_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"note" text,
	"called_at" timestamp with time zone DEFAULT now() NOT NULL,
	"called_by" uuid NOT NULL,
	CONSTRAINT "absence_calls_outcome_check" CHECK ("ops"."absence_calls"."outcome" IN ('reached', 'no_answer', 'wrong_number', 'will_attend'))
);
--> statement-breakpoint
CREATE TABLE "ops"."certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"certificate_type" text NOT NULL,
	"certificate_number" text NOT NULL,
	"financial_year" text NOT NULL,
	"sequence" integer NOT NULL,
	"student_id" uuid NOT NULL,
	"programme_id" uuid,
	"batch_id" uuid,
	"issue_date" date NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"issued_by" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"print_count" integer DEFAULT 0 NOT NULL,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	CONSTRAINT "certificates_type_format" CHECK ("ops"."certificates"."certificate_type" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "certificates_text_check" CHECK (length(trim(coalesce("ops"."certificates"."certificate_number", ''))) > 0 AND length(trim(coalesce("ops"."certificates"."body", ''))) > 0),
	CONSTRAINT "certificates_year_format" CHECK ("ops"."certificates"."financial_year" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "certificates_counts_check" CHECK ("ops"."certificates"."sequence" >= 1 AND "ops"."certificates"."print_count" >= 0),
	CONSTRAINT "certificates_status_check" CHECK ("ops"."certificates"."status" IN ('issued', 'revoked')),
	CONSTRAINT "certificates_revoked_check" CHECK (("ops"."certificates"."status" = 'revoked') = ("ops"."certificates"."revoked_at" IS NOT NULL) AND ("ops"."certificates"."revoked_at" IS NULL) = ("ops"."certificates"."revoked_by" IS NULL) AND ("ops"."certificates"."status" <> 'revoked' OR length(trim(coalesce("ops"."certificates"."revoke_reason", ''))) > 0))
);
--> statement-breakpoint
CREATE TABLE "ops"."document_counters" (
	"series" text PRIMARY KEY NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_counters_next_check" CHECK ("ops"."document_counters"."next_value" >= 1),
	CONSTRAINT "document_counters_series_format" CHECK ("ops"."document_counters"."series" ~ '^[a-z][a-z0-9_.]{1,59}/[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "ops"."fee_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fee_record_id" uuid NOT NULL,
	"receipt_number" text NOT NULL,
	"financial_year" text NOT NULL,
	"sequence" integer NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" uuid NOT NULL,
	"print_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "fee_receipts_number_check" CHECK (length(trim("ops"."fee_receipts"."receipt_number")) > 0),
	CONSTRAINT "fee_receipts_year_format" CHECK ("ops"."fee_receipts"."financial_year" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "fee_receipts_sequence_check" CHECK ("ops"."fee_receipts"."sequence" >= 1),
	CONSTRAINT "fee_receipts_print_count_check" CHECK ("ops"."fee_receipts"."print_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."leave_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"leave_type" text NOT NULL,
	"year_start" date NOT NULL,
	"kind" text NOT NULL,
	"days" numeric(5, 1) NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_adjustments_kind_check" CHECK ("ops"."leave_adjustments"."kind" IN ('carry_forward', 'adjustment')),
	CONSTRAINT "leave_adjustments_text_check" CHECK (length(trim(coalesce("ops"."leave_adjustments"."leave_type", ''))) > 0 AND length(trim(coalesce("ops"."leave_adjustments"."reason", ''))) > 0),
	CONSTRAINT "leave_adjustments_days_check" CHECK ("ops"."leave_adjustments"."days" <> 0 AND abs("ops"."leave_adjustments"."days") <= 366 AND "ops"."leave_adjustments"."days" * 2 = trunc("ops"."leave_adjustments"."days" * 2) AND ("ops"."leave_adjustments"."kind" <> 'carry_forward' OR "ops"."leave_adjustments"."days" > 0))
);
--> statement-breakpoint
CREATE TABLE "ops"."leave_allowances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"leave_type" text NOT NULL,
	"year_start" date NOT NULL,
	"days" numeric(5, 1) NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_allowances_type_check" CHECK (length(trim(coalesce("ops"."leave_allowances"."leave_type", ''))) > 0),
	CONSTRAINT "leave_allowances_days_check" CHECK ("ops"."leave_allowances"."days" BETWEEN 0 AND 366 AND "ops"."leave_allowances"."days" * 2 = trunc("ops"."leave_allowances"."days" * 2))
);
--> statement-breakpoint
CREATE TABLE "ops"."lead_assignment_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"programme_id" uuid,
	"mode" text DEFAULT 'round_robin' NOT NULL,
	"counsellor_staff_ids" uuid[] NOT NULL,
	"daily_cap" integer,
	"last_assigned_staff_id" uuid,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_assignment_rules_programme_key" UNIQUE NULLS NOT DISTINCT("programme_id"),
	CONSTRAINT "lead_assignment_rules_mode_check" CHECK ("ops"."lead_assignment_rules"."mode" IN ('round_robin', 'fewest_open')),
	CONSTRAINT "lead_assignment_rules_counsellors_check" CHECK (cardinality("ops"."lead_assignment_rules"."counsellor_staff_ids") BETWEEN 1 AND 50 AND array_position("ops"."lead_assignment_rules"."counsellor_staff_ids", NULL) IS NULL),
	CONSTRAINT "lead_assignment_rules_cap_check" CHECK ("ops"."lead_assignment_rules"."daily_cap" IS NULL OR "ops"."lead_assignment_rules"."daily_cap" >= 1)
);
--> statement-breakpoint
CREATE TABLE "ops"."approval_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"approver_user_id" uuid NOT NULL,
	"cover_user_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_delegations_not_self" CHECK ("ops"."approval_delegations"."approver_user_id" <> "ops"."approval_delegations"."cover_user_id"),
	CONSTRAINT "approval_delegations_dates_check" CHECK ("ops"."approval_delegations"."to_date" >= "ops"."approval_delegations"."from_date"),
	CONSTRAINT "approval_delegations_revoked_check" CHECK (("ops"."approval_delegations"."revoked_at" IS NULL) = ("ops"."approval_delegations"."revoked_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."staff_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_type" text NOT NULL,
	"tag" text,
	"description" text,
	"staff_id" uuid NOT NULL,
	"issued_on" date NOT NULL,
	"issued_by" uuid NOT NULL,
	"returned_on" date,
	"returned_by" uuid,
	"condition_note" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_assets_text_check" CHECK (length(trim(coalesce("ops"."staff_assets"."asset_type", ''))) > 0 AND ("ops"."staff_assets"."tag" IS NULL OR length(trim(coalesce("ops"."staff_assets"."tag", ''))) > 0)),
	CONSTRAINT "staff_assets_returned_check" CHECK (("ops"."staff_assets"."returned_on" IS NULL) = ("ops"."staff_assets"."returned_by" IS NULL) AND ("ops"."staff_assets"."returned_on" IS NULL OR "ops"."staff_assets"."returned_on" >= "ops"."staff_assets"."issued_on"))
);
--> statement-breakpoint
CREATE TABLE "ops"."staff_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checklist_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"done_by" uuid,
	"done_at" timestamp with time zone,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_checklist_items_key_format" CHECK ("ops"."staff_checklist_items"."item_key" ~ '^[a-z][a-z0-9_]{1,59}$'),
	CONSTRAINT "staff_checklist_items_label_check" CHECK (length(trim(coalesce("ops"."staff_checklist_items"."label", ''))) > 0),
	CONSTRAINT "staff_checklist_items_status_check" CHECK ("ops"."staff_checklist_items"."status" IN ('pending', 'done', 'not_applicable')),
	CONSTRAINT "staff_checklist_items_done_check" CHECK (("ops"."staff_checklist_items"."status" = 'pending') = ("ops"."staff_checklist_items"."done_at" IS NULL) AND ("ops"."staff_checklist_items"."done_at" IS NULL) = ("ops"."staff_checklist_items"."done_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."staff_checklist_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" text NOT NULL,
	"version" integer NOT NULL,
	"items" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_checklist_templates_event_check" CHECK ("ops"."staff_checklist_templates"."event" IN ('joining', 'leaving')),
	CONSTRAINT "staff_checklist_templates_version_check" CHECK ("ops"."staff_checklist_templates"."version" >= 1),
	CONSTRAINT "staff_checklist_templates_items_check" CHECK (jsonb_typeof("ops"."staff_checklist_templates"."items") = 'array'),
	CONSTRAINT "staff_checklist_templates_status_check" CHECK ("ops"."staff_checklist_templates"."status" IN ('draft', 'active', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "ops"."staff_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"event" text NOT NULL,
	"template_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_checklists_event_check" CHECK ("ops"."staff_checklists"."event" IN ('joining', 'leaving'))
);
--> statement-breakpoint
CREATE TABLE "ops"."payroll_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_components_code_format" CHECK ("ops"."payroll_components"."code" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "payroll_components_name_check" CHECK (length(trim(coalesce("ops"."payroll_components"."name", ''))) > 0),
	CONSTRAINT "payroll_components_kind_check" CHECK ("ops"."payroll_components"."kind" IN ('earning', 'deduction')),
	CONSTRAINT "payroll_components_status_check" CHECK ("ops"."payroll_components"."status" IN ('active', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "ops"."payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_runs_month_check" CHECK (extract(day FROM "ops"."payroll_runs"."month") = 1),
	CONSTRAINT "payroll_runs_status_check" CHECK ("ops"."payroll_runs"."status" IN ('draft', 'submitted', 'approved')),
	CONSTRAINT "payroll_runs_stage_check" CHECK (("ops"."payroll_runs"."status" = 'draft') = ("ops"."payroll_runs"."submitted_at" IS NULL) AND ("ops"."payroll_runs"."submitted_at" IS NULL) = ("ops"."payroll_runs"."submitted_by" IS NULL) AND ("ops"."payroll_runs"."status" = 'approved') = ("ops"."payroll_runs"."approved_at" IS NOT NULL) AND ("ops"."payroll_runs"."approved_at" IS NULL) = ("ops"."payroll_runs"."approved_by" IS NULL)),
	CONSTRAINT "payroll_runs_approver_check" CHECK ("ops"."payroll_runs"."approved_by" IS NULL OR ("ops"."payroll_runs"."approved_by" <> "ops"."payroll_runs"."created_by" AND "ops"."payroll_runs"."approved_by" <> "ops"."payroll_runs"."submitted_by"))
);
--> statement-breakpoint
CREATE TABLE "ops"."payslip_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payslip_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"component_id" uuid,
	"advance_id" uuid,
	"label" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payslip_lines_kind_check" CHECK ("ops"."payslip_lines"."kind" IN ('earning', 'deduction')),
	CONSTRAINT "payslip_lines_source_check" CHECK ("ops"."payslip_lines"."source" IN ('structure', 'loss_of_pay', 'advance_recovery', 'one_off', 'adjustment')),
	CONSTRAINT "payslip_lines_amount_positive" CHECK ("ops"."payslip_lines"."amount_paise" > 0),
	CONSTRAINT "payslip_lines_label_check" CHECK (length(trim(coalesce("ops"."payslip_lines"."label", ''))) > 0),
	CONSTRAINT "payslip_lines_shape_check" CHECK (("ops"."payslip_lines"."source" <> 'structure' OR "ops"."payslip_lines"."component_id" IS NOT NULL) AND ("ops"."payslip_lines"."source" = 'advance_recovery') = ("ops"."payslip_lines"."advance_id" IS NOT NULL) AND ("ops"."payslip_lines"."source" NOT IN ('loss_of_pay', 'advance_recovery') OR "ops"."payslip_lines"."kind" = 'deduction') AND ("ops"."payslip_lines"."source" NOT IN ('one_off', 'adjustment') OR length(trim(coalesce("ops"."payslip_lines"."note", ''))) > 0))
);
--> statement-breakpoint
CREATE TABLE "ops"."payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"structure_id" uuid,
	"days_in_month" integer NOT NULL,
	"loss_of_pay_days" numeric(5, 1) DEFAULT 0 NOT NULL,
	"paid_on" date,
	"paid_mode" text,
	"paid_reference" text,
	"paid_by" uuid,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payslips_days_check" CHECK ("ops"."payslips"."days_in_month" BETWEEN 28 AND 31),
	CONSTRAINT "payslips_loss_of_pay_check" CHECK ("ops"."payslips"."loss_of_pay_days" >= 0 AND "ops"."payslips"."loss_of_pay_days" <= "ops"."payslips"."days_in_month" AND "ops"."payslips"."loss_of_pay_days" * 2 = trunc("ops"."payslips"."loss_of_pay_days" * 2)),
	CONSTRAINT "payslips_paid_check" CHECK (num_nonnulls("ops"."payslips"."paid_on", "ops"."payslips"."paid_mode", "ops"."payslips"."paid_by", "ops"."payslips"."paid_at") IN (0, 4) AND ("ops"."payslips"."paid_mode" IS NULL OR "ops"."payslips"."paid_mode" IN ('bank_transfer', 'upi', 'cash', 'cheque', 'other')) AND ("ops"."payslips"."paid_reference" IS NULL OR "ops"."payslips"."paid_on" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."salary_advances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"monthly_instalment_paise" bigint NOT NULL,
	"given_on" date NOT NULL,
	"recover_from" date NOT NULL,
	"reason" text NOT NULL,
	"reference" text,
	"created_by" uuid NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_advances_amount_check" CHECK ("ops"."salary_advances"."amount_paise" > 0 AND "ops"."salary_advances"."monthly_instalment_paise" > 0 AND "ops"."salary_advances"."monthly_instalment_paise" <= "ops"."salary_advances"."amount_paise"),
	CONSTRAINT "salary_advances_recover_check" CHECK (extract(day FROM "ops"."salary_advances"."recover_from") = 1),
	CONSTRAINT "salary_advances_reason_check" CHECK (length(trim(coalesce("ops"."salary_advances"."reason", ''))) > 0),
	CONSTRAINT "salary_advances_cancel_check" CHECK (num_nonnulls("ops"."salary_advances"."cancelled_at", "ops"."salary_advances"."cancelled_by", "ops"."salary_advances"."cancel_reason") IN (0, 3) AND length(trim(coalesce("ops"."salary_advances"."cancel_reason", 'x'))) > 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."salary_structure_lines" (
	"structure_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"monthly_amount_paise" bigint NOT NULL,
	CONSTRAINT "salary_structure_lines_pkey" PRIMARY KEY("structure_id","component_id"),
	CONSTRAINT "salary_structure_lines_amount_positive" CHECK ("ops"."salary_structure_lines"."monthly_amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."salary_structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."users" DROP CONSTRAINT "users_email_domain";--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" DROP CONSTRAINT "eod_reports_status_check";--> statement-breakpoint
ALTER TABLE "ops"."eod_review_events" DROP CONSTRAINT "eod_review_events_kind_check";--> statement-breakpoint
ALTER TABLE "ops"."eod_review_events" DROP CONSTRAINT "eod_review_events_text_check";--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD COLUMN "venue_room_id" uuid;--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD COLUMN "venue_online" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD COLUMN "admit_card_instructions" text;--> statement-breakpoint
ALTER TABLE "academic"."assessment_roster" ADD COLUMN "roll_number" integer;--> statement-breakpoint
ALTER TABLE "ops"."enquiries" ADD COLUMN "consent_text_version" text;--> statement-breakpoint
ALTER TABLE "ops"."enquiries" ADD COLUMN "consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."fee_records" ADD COLUMN "on_behalf_of" uuid;--> statement-breakpoint
ALTER TABLE "ops"."leave_applications" ADD COLUMN "day_part" text;--> statement-breakpoint
ALTER TABLE "ops"."leave_applications" ADD COLUMN "on_behalf_of" uuid;--> statement-breakpoint
ALTER TABLE "ops"."leave_records" ADD COLUMN "day_part" text;--> statement-breakpoint
ALTER TABLE "ops"."hr_request_events" ADD COLUMN "on_behalf_of" uuid;--> statement-breakpoint
ALTER TABLE "core"."portal_accounts" ADD CONSTRAINT "portal_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."portal_accounts" ADD CONSTRAINT "portal_accounts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "core"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."portal_accounts" ADD CONSTRAINT "portal_accounts_consent_recorded_by_users_id_fk" FOREIGN KEY ("consent_recorded_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."portal_accounts" ADD CONSTRAINT "portal_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."portal_accounts" ADD CONSTRAINT "portal_accounts_disabled_by_users_id_fk" FOREIGN KEY ("disabled_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."portal_setup_codes" ADD CONSTRAINT "portal_setup_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."portal_setup_codes" ADD CONSTRAINT "portal_setup_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."homework" ADD CONSTRAINT "homework_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "academic"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."homework" ADD CONSTRAINT "homework_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "academic"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."homework" ADD CONSTRAINT "homework_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "academic"."chapters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."homework" ADD CONSTRAINT "homework_class_record_id_class_records_id_fk" FOREIGN KEY ("class_record_id") REFERENCES "academic"."class_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."homework" ADD CONSTRAINT "homework_teacher_staff_id_staff_members_id_fk" FOREIGN KEY ("teacher_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."homework" ADD CONSTRAINT "homework_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."homework" ADD CONSTRAINT "homework_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."homework_marks" ADD CONSTRAINT "homework_marks_homework_id_homework_id_fk" FOREIGN KEY ("homework_id") REFERENCES "academic"."homework"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."homework_marks" ADD CONSTRAINT "homework_marks_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "academic"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."homework_marks" ADD CONSTRAINT "homework_marks_marked_by_user_id_users_id_fk" FOREIGN KEY ("marked_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."absence_calls" ADD CONSTRAINT "absence_calls_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "core"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."absence_calls" ADD CONSTRAINT "absence_calls_called_by_users_id_fk" FOREIGN KEY ("called_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."certificates" ADD CONSTRAINT "certificates_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "core"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."certificates" ADD CONSTRAINT "certificates_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "core"."programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."certificates" ADD CONSTRAINT "certificates_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."certificates" ADD CONSTRAINT "certificates_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."fee_receipts" ADD CONSTRAINT "fee_receipts_fee_record_id_fee_records_id_fk" FOREIGN KEY ("fee_record_id") REFERENCES "ops"."fee_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."fee_receipts" ADD CONSTRAINT "fee_receipts_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_adjustments" ADD CONSTRAINT "leave_adjustments_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_adjustments" ADD CONSTRAINT "leave_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_allowances" ADD CONSTRAINT "leave_allowances_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_allowances" ADD CONSTRAINT "leave_allowances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_allowances" ADD CONSTRAINT "leave_allowances_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lead_assignment_rules" ADD CONSTRAINT "lead_assignment_rules_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "core"."programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lead_assignment_rules" ADD CONSTRAINT "lead_assignment_rules_last_assigned_staff_id_staff_members_id_fk" FOREIGN KEY ("last_assigned_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lead_assignment_rules" ADD CONSTRAINT "lead_assignment_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lead_assignment_rules" ADD CONSTRAINT "lead_assignment_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."approval_delegations" ADD CONSTRAINT "approval_delegations_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."approval_delegations" ADD CONSTRAINT "approval_delegations_cover_user_id_users_id_fk" FOREIGN KEY ("cover_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."approval_delegations" ADD CONSTRAINT "approval_delegations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."approval_delegations" ADD CONSTRAINT "approval_delegations_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_assets" ADD CONSTRAINT "staff_assets_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_assets" ADD CONSTRAINT "staff_assets_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_assets" ADD CONSTRAINT "staff_assets_returned_by_users_id_fk" FOREIGN KEY ("returned_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_checklist_items" ADD CONSTRAINT "staff_checklist_items_checklist_id_staff_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "ops"."staff_checklists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_checklist_items" ADD CONSTRAINT "staff_checklist_items_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_checklist_templates" ADD CONSTRAINT "staff_checklist_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_checklists" ADD CONSTRAINT "staff_checklists_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_checklists" ADD CONSTRAINT "staff_checklists_template_id_staff_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "ops"."staff_checklist_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_checklists" ADD CONSTRAINT "staff_checklists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."payroll_components" ADD CONSTRAINT "payroll_components_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."payroll_runs" ADD CONSTRAINT "payroll_runs_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."payslip_lines" ADD CONSTRAINT "payslip_lines_payslip_id_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "ops"."payslips"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."payslip_lines" ADD CONSTRAINT "payslip_lines_component_id_payroll_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "ops"."payroll_components"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."payslip_lines" ADD CONSTRAINT "payslip_lines_advance_id_salary_advances_id_fk" FOREIGN KEY ("advance_id") REFERENCES "ops"."salary_advances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."payslip_lines" ADD CONSTRAINT "payslip_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."payslips" ADD CONSTRAINT "payslips_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "ops"."payroll_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."payslips" ADD CONSTRAINT "payslips_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."payslips" ADD CONSTRAINT "payslips_structure_id_salary_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "ops"."salary_structures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."payslips" ADD CONSTRAINT "payslips_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."salary_advances" ADD CONSTRAINT "salary_advances_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."salary_advances" ADD CONSTRAINT "salary_advances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."salary_advances" ADD CONSTRAINT "salary_advances_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."salary_structure_lines" ADD CONSTRAINT "salary_structure_lines_structure_id_salary_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "ops"."salary_structures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."salary_structure_lines" ADD CONSTRAINT "salary_structure_lines_component_id_payroll_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "ops"."payroll_components"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."salary_structures" ADD CONSTRAINT "salary_structures_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."salary_structures" ADD CONSTRAINT "salary_structures_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_accounts_user_student_key" ON "core"."portal_accounts" USING btree ("user_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_accounts_one_student_user_key" ON "core"."portal_accounts" USING btree ("user_id") WHERE "core"."portal_accounts"."kind" = 'student';--> statement-breakpoint
CREATE UNIQUE INDEX "portal_accounts_live_student_key" ON "core"."portal_accounts" USING btree ("student_id") WHERE "core"."portal_accounts"."kind" = 'student' AND "core"."portal_accounts"."disabled_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_accounts_live_guardian_key" ON "core"."portal_accounts" USING btree ("guardian_id") WHERE "core"."portal_accounts"."guardian_id" IS NOT NULL AND "core"."portal_accounts"."disabled_at" IS NULL;--> statement-breakpoint
CREATE INDEX "portal_accounts_student_idx" ON "core"."portal_accounts" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_setup_codes_hash_key" ON "core"."portal_setup_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_setup_codes_one_live_key" ON "core"."portal_setup_codes" USING btree ("user_id") WHERE "core"."portal_setup_codes"."used_at" IS NULL AND "core"."portal_setup_codes"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "homework_batch_due_idx" ON "academic"."homework" USING btree ("batch_id","due_on");--> statement-breakpoint
CREATE INDEX "homework_teacher_due_idx" ON "academic"."homework" USING btree ("teacher_staff_id","due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "homework_marks_student_key" ON "academic"."homework_marks" USING btree ("homework_id","student_id");--> statement-breakpoint
CREATE INDEX "homework_marks_student_idx" ON "academic"."homework_marks" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "absence_calls_student_idx" ON "ops"."absence_calls" USING btree ("student_id","called_at");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_number_key" ON "ops"."certificates" USING btree ("certificate_number");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_sequence_key" ON "ops"."certificates" USING btree ("certificate_type","financial_year","sequence");--> statement-breakpoint
CREATE INDEX "certificates_student_idx" ON "ops"."certificates" USING btree ("student_id","issue_date");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_receipts_fee_record_key" ON "ops"."fee_receipts" USING btree ("fee_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_receipts_number_key" ON "ops"."fee_receipts" USING btree ("receipt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_receipts_sequence_key" ON "ops"."fee_receipts" USING btree ("financial_year","sequence");--> statement-breakpoint
CREATE INDEX "leave_adjustments_year_idx" ON "ops"."leave_adjustments" USING btree ("staff_id","year_start");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_adjustments_one_carry_key" ON "ops"."leave_adjustments" USING btree ("staff_id","leave_type","year_start") WHERE "ops"."leave_adjustments"."kind" = 'carry_forward';--> statement-breakpoint
CREATE UNIQUE INDEX "leave_allowances_year_key" ON "ops"."leave_allowances" USING btree ("staff_id","leave_type","year_start");--> statement-breakpoint
CREATE INDEX "approval_delegations_cover_idx" ON "ops"."approval_delegations" USING btree ("cover_user_id","to_date");--> statement-breakpoint
CREATE INDEX "approval_delegations_approver_idx" ON "ops"."approval_delegations" USING btree ("approver_user_id","to_date");--> statement-breakpoint
CREATE INDEX "staff_assets_staff_idx" ON "ops"."staff_assets" USING btree ("staff_id","returned_on");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_assets_tag_out_key" ON "ops"."staff_assets" USING btree ("tag") WHERE "ops"."staff_assets"."tag" IS NOT NULL AND "ops"."staff_assets"."returned_on" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_checklist_items_key" ON "ops"."staff_checklist_items" USING btree ("checklist_id","item_key");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_checklist_templates_version_key" ON "ops"."staff_checklist_templates" USING btree ("event","version");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_checklist_templates_one_active_key" ON "ops"."staff_checklist_templates" USING btree ("event") WHERE "ops"."staff_checklist_templates"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "staff_checklists_staff_event_key" ON "ops"."staff_checklists" USING btree ("staff_id","event");--> statement-breakpoint
CREATE INDEX "staff_checklists_template_idx" ON "ops"."staff_checklists" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_components_code_key" ON "ops"."payroll_components" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_month_key" ON "ops"."payroll_runs" USING btree ("month");--> statement-breakpoint
CREATE INDEX "payslip_lines_payslip_idx" ON "ops"."payslip_lines" USING btree ("payslip_id");--> statement-breakpoint
CREATE INDEX "payslip_lines_advance_idx" ON "ops"."payslip_lines" USING btree ("advance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_lines_structure_key" ON "ops"."payslip_lines" USING btree ("payslip_id","component_id") WHERE "ops"."payslip_lines"."source" = 'structure';--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_lines_loss_of_pay_key" ON "ops"."payslip_lines" USING btree ("payslip_id") WHERE "ops"."payslip_lines"."source" = 'loss_of_pay';--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_lines_recovery_key" ON "ops"."payslip_lines" USING btree ("payslip_id","advance_id") WHERE "ops"."payslip_lines"."advance_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_run_staff_key" ON "ops"."payslips" USING btree ("run_id","staff_id");--> statement-breakpoint
CREATE INDEX "payslips_staff_idx" ON "ops"."payslips" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "salary_advances_staff_idx" ON "ops"."salary_advances" USING btree ("staff_id","given_on");--> statement-breakpoint
CREATE INDEX "salary_structure_lines_component_idx" ON "ops"."salary_structure_lines" USING btree ("component_id");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_structures_staff_from_key" ON "ops"."salary_structures" USING btree ("staff_id","effective_from");--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD CONSTRAINT "assessments_venue_room_id_rooms_id_fk" FOREIGN KEY ("venue_room_id") REFERENCES "academic"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."fee_records" ADD CONSTRAINT "fee_records_on_behalf_of_users_id_fk" FOREIGN KEY ("on_behalf_of") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_applications" ADD CONSTRAINT "leave_applications_on_behalf_of_users_id_fk" FOREIGN KEY ("on_behalf_of") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."hr_request_events" ADD CONSTRAINT "hr_request_events_on_behalf_of_users_id_fk" FOREIGN KEY ("on_behalf_of") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_roster_roll_number_key" ON "academic"."assessment_roster" USING btree ("assessment_id","roll_number") WHERE "academic"."assessment_roster"."roll_number" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "fee_instalments_due_idx" ON "ops"."fee_instalments" USING btree ("due_date");--> statement-breakpoint
ALTER TABLE "core"."users" ADD CONSTRAINT "users_email_domain" CHECK ("core"."users"."email" ~ '^[^@[:space:]]+@(elevateeducation\.in|example\.test|portal\.invalid)$');--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD CONSTRAINT "assessments_venue_check" CHECK (NOT ("academic"."assessments"."venue_online" AND "academic"."assessments"."venue_room_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "academic"."assessment_roster" ADD CONSTRAINT "assessment_roster_roll_number_check" CHECK ("academic"."assessment_roster"."roll_number" IS NULL OR "academic"."assessment_roster"."roll_number" >= 1);--> statement-breakpoint
ALTER TABLE "ops"."enquiries" ADD CONSTRAINT "enquiries_consent_check" CHECK (("ops"."enquiries"."consent_text_version" IS NULL) = ("ops"."enquiries"."consent_at" IS NULL) AND length(trim(coalesce("ops"."enquiries"."consent_text_version", 'x'))) > 0);--> statement-breakpoint
ALTER TABLE "ops"."fee_records" ADD CONSTRAINT "fee_records_on_behalf_check" CHECK ("ops"."fee_records"."on_behalf_of" IS NULL OR "ops"."fee_records"."on_behalf_of" <> "ops"."fee_records"."recorded_by");--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ADD CONSTRAINT "eod_reports_status_check" CHECK ("ops"."eod_reports"."status" IN ('draft', 'submitted', 'revision_requested', 'acknowledged', 'more_detail_requested'));--> statement-breakpoint
ALTER TABLE "ops"."eod_review_events" ADD CONSTRAINT "eod_review_events_kind_check" CHECK ("ops"."eod_review_events"."kind" IN ('viewed', 'comment', 'clarification_requested', 'revision_requested', 'acknowledged', 'follow_up_task_created', 'more_detail_requested'));--> statement-breakpoint
ALTER TABLE "ops"."eod_review_events" ADD CONSTRAINT "eod_review_events_text_check" CHECK ("ops"."eod_review_events"."kind" NOT IN ('comment', 'clarification_requested', 'revision_requested', 'more_detail_requested') OR length(trim(coalesce("ops"."eod_review_events"."text", ''))) > 0);--> statement-breakpoint
ALTER TABLE "ops"."leave_applications" ADD CONSTRAINT "leave_applications_day_part_check" CHECK ("ops"."leave_applications"."day_part" IS NULL OR ("ops"."leave_applications"."day_part" IN ('first_half', 'second_half') AND "ops"."leave_applications"."from_date" = "ops"."leave_applications"."to_date"));--> statement-breakpoint
ALTER TABLE "ops"."leave_applications" ADD CONSTRAINT "leave_applications_on_behalf_check" CHECK ("ops"."leave_applications"."on_behalf_of" IS NULL OR ("ops"."leave_applications"."decided_by" IS NOT NULL AND "ops"."leave_applications"."on_behalf_of" <> "ops"."leave_applications"."decided_by"));--> statement-breakpoint
ALTER TABLE "ops"."leave_records" ADD CONSTRAINT "leave_records_day_part_check" CHECK ("ops"."leave_records"."day_part" IS NULL OR ("ops"."leave_records"."day_part" IN ('first_half', 'second_half') AND "ops"."leave_records"."from_date" = "ops"."leave_records"."to_date"));--> statement-breakpoint
ALTER TABLE "ops"."hr_request_events" ADD CONSTRAINT "hr_request_events_on_behalf_check" CHECK ("ops"."hr_request_events"."on_behalf_of" IS NULL OR "ops"."hr_request_events"."on_behalf_of" <> "ops"."hr_request_events"."actor_user_id");