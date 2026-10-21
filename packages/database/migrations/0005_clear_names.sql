-- 0005_clear_names (D-036): clearer names, legacy demo columns removed, sample flags.
-- Hand-written because drizzle-kit asks interactively about renames; the snapshot
-- (meta/0005_snapshot.json) matches the schema files and `npm run db:generate` reports
-- no changes after it. Renames keep every row; the only data dropped is the legacy demo
-- summary (subjects/day_dates/status, rebuilt from ops.demo_sessions on read) and
-- ops.demo_teachers (teachers are on each session).
-- Rollback: restore the logical backup taken before applying (.data/backup-before-0005-*).

-- 1. ops.counselling_sessions -> ops.appointments (it holds every appointment type).
ALTER TABLE "ops"."counselling_sessions" RENAME TO "appointments";--> statement-breakpoint
ALTER TABLE "ops"."appointments" RENAME COLUMN "scheduled_at" TO "starts_at";--> statement-breakpoint
ALTER TABLE "ops"."appointments" RENAME COLUMN "counsellor_staff_id" TO "staff_id";--> statement-breakpoint
-- `attendees` is superseded by ops.appointment_participants and was never read.
ALTER TABLE "ops"."appointments" DROP COLUMN "attendees";--> statement-breakpoint
ALTER TABLE "ops"."appointments" RENAME CONSTRAINT "counselling_sessions_pkey" TO "appointments_pkey";--> statement-breakpoint
ALTER TABLE "ops"."appointments" RENAME CONSTRAINT "counselling_sessions_admission_id_admissions_id_fk" TO "appointments_admission_id_admissions_id_fk";--> statement-breakpoint
ALTER TABLE "ops"."appointments" RENAME CONSTRAINT "counselling_sessions_lead_id_leads_id_fk" TO "appointments_lead_id_leads_id_fk";--> statement-breakpoint
ALTER TABLE "ops"."appointments" RENAME CONSTRAINT "counselling_sessions_student_id_students_id_fk" TO "appointments_student_id_students_id_fk";--> statement-breakpoint
ALTER TABLE "ops"."appointments" RENAME CONSTRAINT "counselling_sessions_demo_id_demos_id_fk" TO "appointments_demo_id_demos_id_fk";--> statement-breakpoint
ALTER TABLE "ops"."appointments" RENAME CONSTRAINT "counselling_sessions_organiser_staff_id_staff_members_id_fk" TO "appointments_organiser_staff_id_staff_members_id_fk";--> statement-breakpoint
ALTER TABLE "ops"."appointments" RENAME CONSTRAINT "counselling_sessions_counsellor_staff_id_staff_members_id_fk" TO "appointments_staff_id_staff_members_id_fk";--> statement-breakpoint
ALTER TABLE "ops"."appointments" RENAME CONSTRAINT "counselling_sessions_programme_id_programmes_id_fk" TO "appointments_programme_id_programmes_id_fk";--> statement-breakpoint
ALTER TABLE "ops"."appointments" RENAME CONSTRAINT "counselling_sessions_recommended_programme_id_programmes_id_fk" TO "appointments_recommended_programme_id_programmes_id_fk";--> statement-breakpoint
ALTER TABLE "ops"."appointments" RENAME CONSTRAINT "counselling_sessions_created_by_users_id_fk" TO "appointments_created_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "ops"."appointments" RENAME CONSTRAINT "counselling_sessions_type_check" TO "appointments_type_check";--> statement-breakpoint
ALTER TABLE "ops"."appointments" RENAME CONSTRAINT "counselling_sessions_status_check" TO "appointments_status_check";--> statement-breakpoint
ALTER TABLE "ops"."appointments" RENAME CONSTRAINT "counselling_sessions_mode_check" TO "appointments_mode_check";--> statement-breakpoint
ALTER TABLE "ops"."appointments" RENAME CONSTRAINT "counselling_sessions_reminder_check" TO "appointments_reminder_check";--> statement-breakpoint
ALTER TABLE "ops"."appointments" RENAME CONSTRAINT "counselling_sessions_ends_after_start" TO "appointments_ends_after_start";--> statement-breakpoint
ALTER TABLE "ops"."appointments" RENAME CONSTRAINT "counselling_sessions_has_subject" TO "appointments_has_person";--> statement-breakpoint
ALTER TABLE "ops"."appointments" RENAME CONSTRAINT "counselling_sessions_cancel_reason" TO "appointments_cancel_reason";--> statement-breakpoint
ALTER INDEX "ops"."counselling_sessions_scheduled_idx" RENAME TO "appointments_starts_idx";--> statement-breakpoint
ALTER INDEX "ops"."counselling_sessions_admission_idx" RENAME TO "appointments_admission_idx";--> statement-breakpoint
ALTER INDEX "ops"."counselling_sessions_staff_time_idx" RENAME TO "appointments_staff_time_idx";--> statement-breakpoint
ALTER INDEX "ops"."counselling_sessions_student_idx" RENAME TO "appointments_student_idx";--> statement-breakpoint
ALTER TABLE "ops"."appointment_changes" RENAME CONSTRAINT "appointment_changes_appointment_id_counselling_sessions_id_fk" TO "appointment_changes_appointment_id_appointments_id_fk";--> statement-breakpoint
ALTER TABLE "ops"."appointment_participants" RENAME CONSTRAINT "appointment_participants_appointment_id_counselling_sessions_id_fk" TO "appointment_participants_appointment_id_appointments_id_fk";--> statement-breakpoint

-- 2. Participants: guardian_ref (plain uuid) -> guardian_id with a real foreign key.
ALTER TABLE "ops"."appointment_participants" RENAME COLUMN "guardian_ref" TO "guardian_id";--> statement-breakpoint
ALTER TABLE "ops"."appointment_participants" ADD CONSTRAINT "appointment_participants_guardian_id_guardians_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "ops"."guardians"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- 3. Students: `student_id` always means core.students; Academic's id gets its own name.
--    Order matters: free the name first (constraints follow the column, not the name).
ALTER TABLE "ops"."admissions" RENAME COLUMN "student_id" TO "academic_student_id";--> statement-breakpoint
ALTER TABLE "ops"."admissions" RENAME COLUMN "student_identity_id" TO "student_id";--> statement-breakpoint
ALTER TABLE "ops"."admissions" RENAME CONSTRAINT "admissions_student_identity_id_students_id_fk" TO "admissions_student_id_students_id_fk";--> statement-breakpoint
ALTER INDEX "ops"."admissions_student_identity_idx" RENAME TO "admissions_student_idx";--> statement-breakpoint
ALTER TABLE "ops"."guardians" RENAME COLUMN "student_identity_id" TO "student_id";--> statement-breakpoint
ALTER TABLE "ops"."guardians" RENAME CONSTRAINT "guardians_student_identity_id_students_id_fk" TO "guardians_student_id_students_id_fk";--> statement-breakpoint
ALTER TABLE "ops"."report_exports" RENAME COLUMN "student_identity_id" TO "student_id";--> statement-breakpoint
ALTER TABLE "ops"."report_exports" RENAME CONSTRAINT "report_exports_student_identity_id_students_id_fk" TO "report_exports_student_id_students_id_fk";--> statement-breakpoint

-- PostgreSQL 18 names NOT NULL constraints after the column; follow the renames above
-- (no-op on versions without named NOT NULL constraints).
DO $$
DECLARE r record; renamed text;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
    WHERE contype = 'n' AND conrelid IN ('ops.appointments'::regclass, 'ops.guardians'::regclass, 'ops.report_exports'::regclass)
  LOOP
    renamed := replace(replace(replace(replace(r.conname, 'counselling_sessions_', 'appointments_'),
      'counsellor_staff_id', 'staff_id'), 'scheduled_at', 'starts_at'), 'student_identity_id', 'student_id');
    IF renamed <> r.conname THEN
      EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', r.tbl, r.conname, renamed);
    END IF;
  END LOOP;
END $$;--> statement-breakpoint

-- 4. Sample flags. A lead is sample when its demo was flagged, or when it uses the
--    reserved fictional domain @example.test (D-030: never a real address).
ALTER TABLE "ops"."leads" ADD COLUMN "is_sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "ops"."leads" l SET "is_sample" = true
  WHERE EXISTS (SELECT 1 FROM "ops"."demos" d WHERE d."lead_id" = l."id" AND d."is_sample")
     OR l."student_email" LIKE '%@example.test' OR l."guardian_email" LIKE '%@example.test';--> statement-breakpoint
ALTER TABLE "ops"."staff_profiles" ADD COLUMN "is_sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "ops"."staff_profiles" p SET "is_sample" = true FROM "core"."staff_members" m
  LEFT JOIN "core"."users" u ON u."id" = m."user_id"
  WHERE m."id" = p."staff_id" AND (m."full_name" LIKE '%(fictional)' OR u."email" LIKE '%@example.test');--> statement-breakpoint
ALTER TABLE "ops"."staff_profiles" RENAME COLUMN "staff_ref" TO "staff_code";--> statement-breakpoint
ALTER INDEX "ops"."staff_profiles_staff_ref_key" RENAME TO "staff_profiles_staff_code_key";--> statement-breakpoint

-- 5. Demos: sessions are the only source of dates, subjects, teachers and attendance;
--    the sample flag follows the lead; the fee is integer paise like every other amount.
ALTER TABLE "ops"."demos" DROP CONSTRAINT "demos_status_check";--> statement-breakpoint
ALTER TABLE "ops"."demos" DROP CONSTRAINT "demos_has_subjects";--> statement-breakpoint
ALTER TABLE "ops"."demos" DROP CONSTRAINT "demos_has_days";--> statement-breakpoint
ALTER TABLE "ops"."demos" DROP COLUMN "subjects";--> statement-breakpoint
ALTER TABLE "ops"."demos" DROP COLUMN "day_dates";--> statement-breakpoint
ALTER TABLE "ops"."demos" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "ops"."demos" DROP COLUMN "is_sample";--> statement-breakpoint
ALTER TABLE "ops"."demos" ALTER COLUMN "fee_amount_inr" SET DATA TYPE bigint USING round("fee_amount_inr" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "ops"."demos" RENAME COLUMN "fee_amount_inr" TO "fee_amount_paise";--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD CONSTRAINT "demos_fee_positive" CHECK ("ops"."demos"."fee_amount_paise" IS NULL OR "ops"."demos"."fee_amount_paise" >= 0);--> statement-breakpoint
DROP TABLE "ops"."demo_teachers";
