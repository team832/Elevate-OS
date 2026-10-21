DROP TABLE "ops"."decisions" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."escalations" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."incidents" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."milestone_dependencies" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."milestones" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."onboarding_items" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."projects" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."responsibilities" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."risks" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."sop_checklist_items" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."sop_versions" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."sops" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."task_dependencies" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."tasks" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."work_items" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."asset_assignments" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."assets" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."compensation_records" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."department_heads" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."emergency_contacts" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."employee_documents" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."employee_identity_references" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."employee_private_details" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."employee_records" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."employment_history" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."candidates" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."interview_panelists" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."interviews" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."job_application_stages" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."job_applications" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."job_offers" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."lifecycle_cases" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."lifecycle_items" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."requisitions" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."attendance_breaks" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."attendance_corrections" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."attendance_imports" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."attendance_sessions" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."holidays" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."leave_ledger_entries" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."leave_requests" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."leave_types" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."shift_assignments" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."shift_templates" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."policies" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."policy_versions" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."risk_mitigations" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."sop_ack_requirements" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."sop_acknowledgements" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."sop_archives" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."sop_version_schedules" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."task_comments" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."task_references" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."task_reminders" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."task_review_requirements" CASCADE;--> statement-breakpoint
DROP TABLE "ops"."task_reviews" CASCADE;--> statement-breakpoint
-- Hand-written data clean-up for the HR and Operations removal (owner, 20 Oct 2026, D-032).
-- Roles that no longer exist (sign-in already ignores them; packages/authentication isRoleKey).
DELETE FROM "core"."user_roles" WHERE "role" IN ('hr_manager', 'hr_contributor', 'recruiter', 'department_manager', 'employee');--> statement-breakpoint
-- Ops setting overrides whose keys were removed (resolveSettings ignores unknown keys).
DELETE FROM "ops"."settings" WHERE "key" IN ('tasks.escalation', 'tasks.reminders', 'hr.candidate_retention', 'hr.onboarding_template', 'hr.offboarding_checklist', 'attendance.rules', 'shifts.rules', 'leave.rules', 'leave.entitlements', 'incidents.resolution_sla', 'registers.review_due', 'hr.document_retention', 'office.online_hours');--> statement-breakpoint
-- Pending core approvals for SOP and company-policy versions (their tables are dropped above).
DELETE FROM "core"."approvals" WHERE "status" = 'pending' AND "policy" IN ('ops.sop.approve', 'ops.policy.approve');--> statement-breakpoint
-- Undelivered ops.employee.separated events (the event type and its only consumer are removed).
-- Processed ones stay as history.
DELETE FROM "core"."event_deliveries" WHERE "status" <> 'processed' AND "event_id" IN (SELECT "id" FROM "core"."integration_events" WHERE "type" = 'ops.employee.separated');--> statement-breakpoint
DELETE FROM "core"."integration_events" e WHERE e."type" = 'ops.employee.separated' AND NOT EXISTS (SELECT 1 FROM "core"."event_deliveries" d WHERE d."event_id" = e."id");
