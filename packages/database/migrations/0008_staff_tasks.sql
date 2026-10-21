CREATE TABLE "ops"."eod_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"report_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"summary" text,
	"submitted_at" timestamp with time zone,
	"submitted_to_staff_id" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eod_reports_status_check" CHECK ("ops"."eod_reports"."status" IN ('draft', 'submitted')),
	CONSTRAINT "eod_reports_submitted_check" CHECK (("ops"."eod_reports"."status" = 'submitted') = ("ops"."eod_reports"."submitted_at" IS NOT NULL)),
	CONSTRAINT "eod_reports_reviewed_check" CHECK (("ops"."eod_reports"."reviewed_by" IS NULL) = ("ops"."eod_reports"."reviewed_at" IS NULL) AND ("ops"."eod_reports"."reviewed_at" IS NULL OR "ops"."eod_reports"."status" = 'submitted'))
);
--> statement-breakpoint
CREATE TABLE "ops"."staff_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"title" text NOT NULL,
	"details" text,
	"assigned_by_staff_id" uuid,
	"lead_id" uuid,
	"admission_id" uuid,
	"student_id" uuid,
	"priority" text DEFAULT 'medium' NOT NULL,
	"due_on" date NOT NULL,
	"due_time" time,
	"status" text DEFAULT 'pending' NOT NULL,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"recurrence" text DEFAULT 'none' NOT NULL,
	"recurrence_parent_id" uuid,
	"completed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_tasks_title_check" CHECK (length(trim("ops"."staff_tasks"."title")) > 0),
	CONSTRAINT "staff_tasks_status_check" CHECK ("ops"."staff_tasks"."status" IN ('pending', 'in_progress', 'done', 'blocked', 'on_hold')),
	CONSTRAINT "staff_tasks_priority_check" CHECK ("ops"."staff_tasks"."priority" IN ('high', 'medium', 'low')),
	CONSTRAINT "staff_tasks_recurrence_check" CHECK ("ops"."staff_tasks"."recurrence" IN ('none', 'daily', 'weekly', 'monthly')),
	CONSTRAINT "staff_tasks_progress_check" CHECK ("ops"."staff_tasks"."progress_percent" BETWEEN 0 AND 100),
	CONSTRAINT "staff_tasks_done_check" CHECK (("ops"."staff_tasks"."status" = 'done') = ("ops"."staff_tasks"."completed_at" IS NOT NULL) AND ("ops"."staff_tasks"."status" <> 'done' OR "ops"."staff_tasks"."progress_percent" = 100)),
	CONSTRAINT "staff_tasks_reason_check" CHECK ("ops"."staff_tasks"."status" NOT IN ('blocked', 'on_hold') OR length(trim(coalesce("ops"."staff_tasks"."reason", ''))) > 0),
	CONSTRAINT "staff_tasks_one_related" CHECK (num_nonnulls("ops"."staff_tasks"."lead_id", "ops"."staff_tasks"."admission_id", "ops"."staff_tasks"."student_id") <= 1)
);
--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ADD CONSTRAINT "eod_reports_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ADD CONSTRAINT "eod_reports_submitted_to_staff_id_staff_members_id_fk" FOREIGN KEY ("submitted_to_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ADD CONSTRAINT "eod_reports_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."eod_reports" ADD CONSTRAINT "eod_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_assigned_by_staff_id_staff_members_id_fk" FOREIGN KEY ("assigned_by_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "ops"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "ops"."admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "core"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_recurrence_parent_id_staff_tasks_id_fk" FOREIGN KEY ("recurrence_parent_id") REFERENCES "ops"."staff_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_tasks" ADD CONSTRAINT "staff_tasks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eod_reports_staff_date_key" ON "ops"."eod_reports" USING btree ("staff_id","report_date");--> statement-breakpoint
CREATE INDEX "eod_reports_date_idx" ON "ops"."eod_reports" USING btree ("report_date");--> statement-breakpoint
CREATE INDEX "staff_tasks_staff_due_idx" ON "ops"."staff_tasks" USING btree ("staff_id","due_on");--> statement-breakpoint
CREATE INDEX "staff_tasks_status_idx" ON "ops"."staff_tasks" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_tasks_recurrence_parent_key" ON "ops"."staff_tasks" USING btree ("recurrence_parent_id") WHERE "ops"."staff_tasks"."recurrence_parent_id" IS NOT NULL;