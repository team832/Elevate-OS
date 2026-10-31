CREATE TABLE "ops"."leave_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"applied_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"leave_record_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_applications_status_check" CHECK ("ops"."leave_applications"."status" IN ('pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "leave_applications_dates_check" CHECK ("ops"."leave_applications"."to_date" >= "ops"."leave_applications"."from_date"),
	CONSTRAINT "leave_applications_kind_check" CHECK (length(trim(coalesce("ops"."leave_applications"."kind", ''))) > 0),
	CONSTRAINT "leave_applications_reason_check" CHECK (length(trim(coalesce("ops"."leave_applications"."reason", ''))) > 0),
	CONSTRAINT "leave_applications_version_check" CHECK ("ops"."leave_applications"."version" >= 1),
	CONSTRAINT "leave_applications_decided_check" CHECK (("ops"."leave_applications"."decided_at" IS NULL) = ("ops"."leave_applications"."decided_by" IS NULL) AND ("ops"."leave_applications"."status" <> 'pending' OR "ops"."leave_applications"."decided_at" IS NULL) AND ("ops"."leave_applications"."status" NOT IN ('approved', 'rejected') OR "ops"."leave_applications"."decided_at" IS NOT NULL) AND ("ops"."leave_applications"."status" <> 'rejected' OR length(trim(coalesce("ops"."leave_applications"."decision_note", ''))) > 0)),
	CONSTRAINT "leave_applications_cancelled_check" CHECK (("ops"."leave_applications"."status" = 'cancelled') = ("ops"."leave_applications"."cancelled_at" IS NOT NULL) AND ("ops"."leave_applications"."cancelled_at" IS NULL) = ("ops"."leave_applications"."cancelled_by" IS NULL) AND ("ops"."leave_applications"."status" <> 'cancelled' OR "ops"."leave_applications"."leave_record_id" IS NULL OR length(trim(coalesce("ops"."leave_applications"."cancel_reason", ''))) > 0)),
	CONSTRAINT "leave_applications_record_check" CHECK (("ops"."leave_applications"."status" <> 'approved' OR "ops"."leave_applications"."leave_record_id" IS NOT NULL) AND ("ops"."leave_applications"."status" NOT IN ('pending', 'rejected') OR "ops"."leave_applications"."leave_record_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "ops"."leave_applications" ADD CONSTRAINT "leave_applications_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_applications" ADD CONSTRAINT "leave_applications_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_applications" ADD CONSTRAINT "leave_applications_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_applications" ADD CONSTRAINT "leave_applications_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_applications" ADD CONSTRAINT "leave_applications_leave_record_id_leave_records_id_fk" FOREIGN KEY ("leave_record_id") REFERENCES "ops"."leave_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_applications_staff_from_idx" ON "ops"."leave_applications" USING btree ("staff_id","from_date");--> statement-breakpoint
CREATE INDEX "leave_applications_status_from_idx" ON "ops"."leave_applications" USING btree ("status","from_date");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_applications_leave_record_key" ON "ops"."leave_applications" USING btree ("leave_record_id");--> statement-breakpoint
CREATE INDEX "lead_activities_kind_occurred_idx" ON "ops"."lead_activities" USING btree ("kind","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "fee_records_payment_code_idx" ON "ops"."fee_records" USING btree ("payment_date" DESC NULLS FIRST,"code" DESC NULLS FIRST);