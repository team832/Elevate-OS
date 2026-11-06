/**
 * Remove every SAMPLE record before real use (`npm run db:clear-samples`, D-036). Brief 23 Oct 2026
 * §25 adds: requests through HR, staged score imports, sample tests (roster, results,
 * publications), lead stage history, task reminders and the Marketing samples (campaigns and
 * members, ideas, calendar items, SEO/AIO/GEO items and observations, targets). Reference data
 * (lead stages, SEO/AIO/GEO categories) is not sample and stays.
 * Tables with no is_sample column (schedules, holidays, rooms, branches, events, metric imports) are
 * known by the record the seed left (markSampleRows, seed/sample-people.ts). Older seeds left no such
 * record: their rows are known by OLD_ROWS below, exact names no real row carries.
 * Sample = `ops.leads.is_sample`, `core.students.is_sample`, `ops.fee_structures.is_sample`,
 * `is_sample` tasks, EOD reports and import batches, Academic `is_sample` batches (with their
 * sessions, logs and teachers), students, placements, demo attendees and reviews, `is_sample`
 * attachments and those on any sample record (rows, and bytes kept in the database; shortcut: files
 * in the development folder stay, as a rolled-back clear could not bring them back), leave and leave applications, attendance punches/imports/days/corrections,
 * student feedback about teachers with its imports, summaries and development actions, or a staff
 * member whose `ops.staff_profiles.is_sample` is set and who has no login. Everything
 * that hangs off those rows is deleted with them (including Academic's student and enrolment
 * created by the sample enrolment handoff), children first, in ONE transaction: either all of it
 * goes or nothing does. Kept on purpose: the sample login accounts (other modules'
 * records point at them; production refuses @example.test sign-in, D-030) and their
 * in-app notifications, the audit trail and the integration-event outbox (append-only
 * history; unfinished enrolment handoffs of removed admissions are only closed), and the
 * owner-supplied staff. A real record is never deleted (R-SEED): its optional link to a sample
 * record is emptied (logged and audited), and a real record that needs a sample one stops the
 * command before anything changes (./clear-samples-guards.ts). Rows deleted are sample records and
 * the rows that belong to them (their history, members, roster, placements).
 * Wave 4 (6 Nov 2026): receipts and certificates go with their sample payment or student, and their
 * sample.* number series with them (real series are never reset); homework, absence calls, portal access (its
 * logins switched off), payroll, leave allowances, checklists and assets go when flagged or under a
 * sample parent (for staff: a made-up one without a login; a demo login's real rows stay), approval
 * cover only when flagged. Payroll components, checklist templates, the website-form user and the
 * WEBSITE_FORM lead source are reference data and stay.
 */
import { sql } from 'drizzle-orm';
import type { Database } from '@elevate/database';
import { sampleRowsSql } from '@elevate/database/seed';
import { withTransaction } from '@elevate/server-kit';
import {
  BY_SAMPLE_STAFF,
  RELATED_SET,
  refuseRequiredLinks,
  SAMPLE_PAYSLIPS,
  unlinkRealRows,
} from './clear-samples-guards';

export { ClearSamplesRefused } from './clear-samples-guards';

const BY_SAMPLE_LOGIN = (column: string) =>
  `${column} IN (SELECT id FROM core.users WHERE email LIKE '%@example.test')`;
const OLD_ADDRESS = `'%.sample@example.test'`;
const OLD_STUDENT = `'% Sample Student'`;
/**
 * Rows the seeds up to 31 Oct 2026 made in tables with no flag: the exact names they wrote, and where
 * the table records its author, written by a sample login too. A person's "Sample room" stays.
 */
const OLD_ROWS = {
  events: `type IN ('event', 'webinar') AND title IN ('Sample IPMAT parents’ webinar (fictional)', 'Sample CLAT open house (fictional)') AND ${BY_SAMPLE_LOGIN('created_by')}`,
  schedules: `name IN ('Sample schedule: teaching days (fictional)', 'Sample schedule: office days (fictional)', 'Sample schedule: weekend classes (fictional)') AND ${BY_SAMPLE_LOGIN('created_by')}`,
  holidays: `name IN ('Sample holiday: centre foundation day (fictional)', 'Sample holiday: staff training day (fictional)', 'Sample holiday: local festival, to be confirmed (fictional)') AND ${BY_SAMPLE_LOGIN('created_by')}`,
  rooms: `(code, name) IN (('SAMPLE-R1', 'Sample Room 1 (fictional)'), ('SAMPLE-R2', 'Sample Room 2 (fictional)'), ('SAMPLE-HALL', 'Sample seminar hall (fictional)'))`,
  branches: `code = 'SAMPLE_BRANCH' AND name = 'Sample branch (fictional)'`,
  metrics: `file_name = 'Sample metrics export (fictional).csv' AND ${BY_SAMPLE_LOGIN('imported_by')}`,
};

/** Temporary id sets, built once: [name, SELECT]. */
const SETS: readonly [string, string][] = [
  // Every made-up staff member, with or without a login (demo logins and their staff stay; s_staff
  // below are the ones deleted). Only for rows that are about the person, never for a real record.
  ['s_sample_staff', `SELECT staff_id AS id FROM ops.staff_profiles WHERE is_sample`],
  [
    's_leads',
    `SELECT id FROM ops.leads WHERE is_sample
       OR (student_email LIKE ${OLD_ADDRESS} AND (student_name LIKE ${OLD_STUDENT} OR student_name = 'Tanisha Demo Student'))`,
  ],
  ['s_admissions', `SELECT id FROM ops.admissions WHERE lead_id IN (SELECT id FROM s_leads)`],
  [
    's_students',
    `SELECT id FROM core.students WHERE is_sample
     UNION SELECT student_id FROM ops.admissions WHERE id IN (SELECT id FROM s_admissions) AND student_id IS NOT NULL`,
  ],
  ['s_demos', `SELECT id FROM ops.demos WHERE lead_id IN (SELECT id FROM s_leads)`],
  [
    's_applications',
    `SELECT id FROM ops.applications WHERE admission_id IN (SELECT id FROM s_admissions)`,
  ],

  [
    's_appointments',
    `SELECT id FROM ops.appointments WHERE lead_id IN (SELECT id FROM s_leads)
       OR admission_id IN (SELECT id FROM s_admissions) OR student_id IN (SELECT id FROM s_students)
       OR demo_id IN (SELECT id FROM s_demos)
       OR id IN (${sampleRowsSql('ops.appointments')})
       OR ${OLD_ROWS.events}`,
  ],
  [
    's_plans',
    `SELECT id FROM ops.fee_plans WHERE admission_id IN (SELECT id FROM s_admissions) OR student_id IN (SELECT id FROM s_students)`,
  ],
  [
    's_fee_records',
    `SELECT id FROM ops.fee_records WHERE admission_id IN (SELECT id FROM s_admissions)
       OR lead_id IN (SELECT id FROM s_leads) OR plan_id IN (SELECT id FROM s_plans)`,
  ],
  // Portal logins of sample students (a guardian login keeps its other children's accounts).
  [
    's_portal_users',
    `SELECT DISTINCT user_id AS id FROM core.portal_accounts WHERE student_id IN (SELECT id FROM s_students)`,
  ],
  [
    's_academic_students',
    `SELECT id FROM academic.students WHERE source_admission_id IN (SELECT id FROM s_admissions) OR is_sample
       OR (email LIKE ${OLD_ADDRESS} AND full_name LIKE ${OLD_STUDENT})`,
  ],
  ['s_academic_batches', `SELECT id FROM academic.batches WHERE is_sample`],
  [
    's_academic_sessions',
    `SELECT id FROM academic.class_sessions WHERE batch_id IN (SELECT id FROM s_academic_batches)`,
  ],
  [
    's_assessments',
    // Only tests marked sample; a test mixing real and sample batches stops the clear (guards).
    `SELECT id FROM academic.assessments WHERE is_sample`,
  ],
  ['s_score_imports', `SELECT id FROM ops.score_imports WHERE is_sample`],
  ['s_import_batches', `SELECT id FROM ops.task_import_batches WHERE is_sample`],
  [
    's_tasks',
    `SELECT id FROM ops.staff_tasks WHERE is_sample OR import_batch_id IN (SELECT id FROM s_import_batches)`,
  ],
  ['s_eods', `SELECT id FROM ops.eod_reports WHERE is_sample`],
  ['s_feedback_imports', `SELECT id FROM ops.teacher_feedback_imports WHERE is_sample`],
  [
    's_staff',
    `SELECT p.staff_id AS id FROM ops.staff_profiles p JOIN core.staff_members m ON m.id = p.staff_id
     WHERE p.is_sample AND m.user_id IS NULL`,
  ],
  ['s_hr_requests', `SELECT id FROM ops.hr_requests WHERE is_sample`],
  [
    's_homework',
    // A real homework on a sample batch stops the clear (guards).
    `SELECT id FROM academic.homework WHERE is_sample OR teacher_staff_id IN (SELECT id FROM s_staff)`,
  ],
  [
    's_schedules',
    `${sampleRowsSql('ops.work_schedules')} UNION SELECT id FROM ops.work_schedules WHERE ${OLD_ROWS.schedules}`,
  ],
  [
    's_holidays',
    `${sampleRowsSql('ops.holidays')} UNION SELECT id FROM ops.holidays WHERE ${OLD_ROWS.holidays}`,
  ],
  [
    's_rooms',
    `${sampleRowsSql('academic.rooms')} UNION SELECT id FROM academic.rooms WHERE ${OLD_ROWS.rooms}`,
  ],
  [
    's_branches',
    `${sampleRowsSql('core.branches')} UNION SELECT id FROM core.branches WHERE ${OLD_ROWS.branches}`,
  ],
  [
    's_metric_imports',
    `${sampleRowsSql('marketing.metric_imports')} UNION SELECT id FROM marketing.metric_imports WHERE ${OLD_ROWS.metrics}`,
  ],
  ['s_campaigns', `SELECT id FROM marketing.campaigns WHERE is_sample`],
  ['s_ideas', `SELECT id FROM marketing.ideas WHERE is_sample`],
  ['s_opt_items', `SELECT id FROM marketing.optimisation_items WHERE is_sample`],
  ['s_content', sampleRowsSql('marketing.content_items')],
  ['s_placements', sampleRowsSql('marketing.placements')],
  ['s_groups', sampleRowsSql('marketing.placement_groups')],
  ['s_preferences', sampleRowsSql('core.user_preferences')],
  [
    's_plans_academic',
    `SELECT id FROM academic.curriculum_plans WHERE batch_id IN (SELECT id FROM s_academic_batches)`,
  ],
  RELATED_SET,
];

const IN = (set: string) => `IN (SELECT id FROM ${set})`;
/** A sample student's portal logins left with no live account (accounts of real children keep theirs). */
const PORTAL_LEFT = (userId: string) =>
  `${userId} ${IN('s_portal_users')} AND NOT EXISTS (SELECT 1 FROM core.portal_accounts a WHERE a.user_id = ${userId} AND a.disabled_at IS NULL)`;

/** Files on sample records: flagged, or on a sample parent of any owner kind (one condition for rows and bytes). */
const SAMPLE_FILES = `is_sample
       OR (owner_kind = 'task' AND owner_id ${IN('s_tasks')})
       OR (owner_kind = 'task_submission' AND owner_id IN (SELECT id FROM ops.task_submissions WHERE task_id ${IN('s_tasks')}))
       OR (owner_kind = 'task_update' AND owner_id IN (SELECT id FROM ops.task_updates WHERE task_id ${IN('s_tasks')}))
       OR (owner_kind = 'attendance_correction' AND owner_id IN (SELECT id FROM ops.attendance_corrections WHERE is_sample OR staff_id ${IN('s_staff')}))
       OR (owner_kind = 'leave_application' AND owner_id IN (SELECT id FROM ops.leave_applications WHERE is_sample OR staff_id ${IN('s_staff')}))
       OR (owner_kind = 'work_report' AND owner_id ${IN('s_eods')})
       OR (owner_kind = 'hr_request' AND owner_id ${IN('s_hr_requests')})
       OR (owner_kind = 'feedback_import' AND owner_id ${IN('s_feedback_imports')})
       OR (owner_kind = 'feedback_evidence' AND owner_id IN (SELECT id FROM ops.student_teacher_feedback WHERE is_sample OR student_id ${IN('s_students')} OR teacher_staff_id ${IN('s_staff')} OR import_id ${IN('s_feedback_imports')}))
       OR (owner_kind = 'staff_private' AND owner_id ${IN('s_sample_staff')})
       OR (owner_kind IN ('assessment_paper', 'assessment_key', 'score_import') AND owner_id ${IN('s_assessments')})`;

/** Deletes in foreign-key-safe order: [label, statement]. */
const DELETES: readonly [string, string][] = [
  // HR samples (brief 23 Oct 2026): attachments, attendance and leave, and a sample staff
  // member's own department/manager history and task collaborations.
  // The bytes first (D-135, kept in the database in production): they are found through the rows.
  [
    'ops.attachment_files',
    `DELETE FROM ops.attachment_files WHERE key::text IN (SELECT storage_key FROM ops.attachments WHERE ${SAMPLE_FILES})`,
  ],
  ['ops.attachments', `DELETE FROM ops.attachments WHERE ${SAMPLE_FILES}`],
  // Requests through HR (brief 23 Oct 2026 §6): events first; before tasks (linked_task_id).
  [
    'ops.hr_request_events',
    `DELETE FROM ops.hr_request_events WHERE request_id ${IN('s_hr_requests')}`,
  ],
  ['ops.hr_requests', `DELETE FROM ops.hr_requests WHERE id ${IN('s_hr_requests')}`],
  // Score imports staged for sample tests (rows go with the import).
  [
    'ops.score_import_rows',
    `DELETE FROM ops.score_import_rows WHERE import_id ${IN('s_score_imports')}`,
  ],
  ['ops.score_imports', `DELETE FROM ops.score_imports WHERE id ${IN('s_score_imports')}`],
  // Marketing samples (brief 23 Oct 2026 §12–§15): children first.
  [
    'marketing.optimisation_observations',
    `DELETE FROM marketing.optimisation_observations WHERE item_id ${IN('s_opt_items')}`,
  ],
  [
    'marketing.optimisation_items',
    `DELETE FROM marketing.optimisation_items WHERE id ${IN('s_opt_items')}`,
  ],
  ['marketing.targets', `DELETE FROM marketing.targets WHERE is_sample`],
  ['marketing.calendar_items', `DELETE FROM marketing.calendar_items WHERE is_sample`],
  // Sample content (seed fill-content.ts), children first; legacy items are never in these sets.
  [
    'marketing.metric_values',
    `DELETE FROM marketing.metric_values WHERE snapshot_id IN (SELECT id FROM marketing.metric_snapshots WHERE import_id ${IN('s_metric_imports')} OR placement_id ${IN('s_placements')})`,
  ],
  [
    'marketing.metric_snapshots',
    `DELETE FROM marketing.metric_snapshots WHERE import_id ${IN('s_metric_imports')} OR placement_id ${IN('s_placements')}`,
  ],
  [
    'marketing.metric_imports',
    `DELETE FROM marketing.metric_imports WHERE id ${IN('s_metric_imports')}`,
  ],
  [
    'marketing.publishing_attempts',
    `DELETE FROM marketing.publishing_attempts WHERE record_id IN (SELECT id FROM marketing.publishing_records WHERE placement_id ${IN('s_placements')})`,
  ],
  [
    'marketing.publishing_records',
    `DELETE FROM marketing.publishing_records WHERE placement_id ${IN('s_placements')}`,
  ],
  ['marketing.placements', `DELETE FROM marketing.placements WHERE id ${IN('s_placements')}`],
  [
    'marketing.placement_groups',
    `DELETE FROM marketing.placement_groups WHERE id ${IN('s_groups')}`,
  ],
  [
    'marketing.content_comments',
    `DELETE FROM marketing.content_comments WHERE content_item_id ${IN('s_content')}`,
  ],
  [
    'marketing.content_assets',
    `DELETE FROM marketing.content_assets WHERE version_id IN (SELECT id FROM marketing.content_versions WHERE content_item_id ${IN('s_content')})`,
  ],
  [
    'marketing.content_reviews',
    `DELETE FROM marketing.content_reviews WHERE content_item_id ${IN('s_content')}`,
  ],
  [
    'core.approvals (content)',
    `DELETE FROM core.approvals WHERE subject_module = 'marketing' AND subject_id ${IN('s_content')}`,
  ],
  [
    'marketing.content_assignments',
    `DELETE FROM marketing.content_assignments WHERE content_item_id ${IN('s_content')}`,
  ],
  [
    'marketing.content_versions',
    `DELETE FROM marketing.content_versions WHERE content_item_id ${IN('s_content')}`,
  ],
  ['marketing.content_items', `DELETE FROM marketing.content_items WHERE id ${IN('s_content')}`],
  ['marketing.ideas', `DELETE FROM marketing.ideas WHERE id ${IN('s_ideas')}`],
  [
    'marketing.campaign_members',
    `DELETE FROM marketing.campaign_members WHERE campaign_id ${IN('s_campaigns')}`,
  ],
  ['marketing.campaigns', `DELETE FROM marketing.campaigns WHERE id ${IN('s_campaigns')}`],
  ...(
    [
      'attendance_corrections',
      'daily_attendance',
      'attendance_punches',
      'leave_applications', // before leave_records: an approved one points at its record
      'leave_records',
    ] as const
  ).map((t): [string, string] => [
    `ops.${t}`,
    `DELETE FROM ops.${t} WHERE is_sample OR staff_id ${IN('s_staff')}`,
  ]),
  // Payroll (F4-14): flagged rows and those of deleted staff, then sample runs; a real payslip using a
  // sample structure or advance stops the clear (guards). Payroll components are reference data.
  [
    'ops.payslip_lines',
    `DELETE FROM ops.payslip_lines WHERE payslip_id IN (SELECT id FROM ops.payslips WHERE ${SAMPLE_PAYSLIPS})`,
  ],
  ['ops.payslips', `DELETE FROM ops.payslips WHERE ${SAMPLE_PAYSLIPS}`],
  [
    'ops.salary_structure_lines',
    `DELETE FROM ops.salary_structure_lines WHERE structure_id IN (SELECT id FROM ops.salary_structures WHERE ${BY_SAMPLE_STAFF})`,
  ],
  [
    'ops.staff_checklist_items',
    `DELETE FROM ops.staff_checklist_items WHERE checklist_id IN (SELECT id FROM ops.staff_checklists WHERE ${BY_SAMPLE_STAFF})`,
  ],
  // Checklist templates stay (reference data, F4-09).
  ...(
    [
      'salary_structures',
      'salary_advances',
      'staff_checklists',
      'staff_assets',
      'leave_allowances',
      'leave_adjustments',
    ] as const
  ).map((t): [string, string] => [`ops.${t}`, `DELETE FROM ops.${t} WHERE ${BY_SAMPLE_STAFF}`]),
  ['ops.payroll_runs', `DELETE FROM ops.payroll_runs WHERE is_sample`],
  // Logins are never deleted, so a real cover naming a demo login stays.
  ['ops.approval_delegations', `DELETE FROM ops.approval_delegations WHERE is_sample`],
  // Real rules lost their sample counsellors in clear-samples-guards.ts.
  ['ops.lead_assignment_rules', `DELETE FROM ops.lead_assignment_rules WHERE is_sample`],
  [
    'ops.attendance_punches (import)',
    `DELETE FROM ops.attendance_punches WHERE import_id IN (SELECT id FROM ops.attendance_imports WHERE is_sample)`,
  ],
  ['ops.attendance_imports', `DELETE FROM ops.attendance_imports WHERE is_sample`],
  [
    'ops.teacher_development_actions',
    `DELETE FROM ops.teacher_development_actions WHERE is_sample OR teacher_staff_id ${IN('s_staff')} OR summary_id IN (SELECT id FROM ops.teacher_feedback_summaries WHERE is_sample OR teacher_staff_id ${IN('s_staff')})`,
  ],
  [
    'ops.teacher_feedback_summaries',
    `DELETE FROM ops.teacher_feedback_summaries WHERE is_sample OR teacher_staff_id ${IN('s_staff')}`,
  ],
  ['ops.task_collaborators', `DELETE FROM ops.task_collaborators WHERE staff_id ${IN('s_staff')}`],
  ['ops.holidays', `DELETE FROM ops.holidays WHERE id ${IN('s_holidays')}`],
  [
    'ops.staff_private_details',
    `DELETE FROM ops.staff_private_details WHERE staff_id ${IN('s_sample_staff')}`,
  ],
  // The made-up Schar leaves the setting (only they: another person chosen on screen stays).
  [
    'ops.settings (Schar)',
    `DELETE FROM ops.settings WHERE key = 'hr.request_recipients'
       AND (SELECT count(*) FROM jsonb_object_keys(value)) = 1
       AND value->>'schar' IN (SELECT id::text FROM s_sample_staff)`,
  ],
  [
    'ops.settings (Schar unset)',
    `UPDATE ops.settings SET value = jsonb_set(value, '{schar}', 'null')
     WHERE key = 'hr.request_recipients' AND value->>'schar' IN (SELECT id::text FROM s_sample_staff)`,
  ],
  // Sample task-tracker work (seed/sample-work.ts) and fixture imports.
  [
    'ops.task_import_rows',
    `DELETE FROM ops.task_import_rows WHERE batch_id ${IN('s_import_batches')} OR task_id ${IN('s_tasks')} OR eod_report_id ${IN('s_eods')}`,
  ],
  ['ops.review_acknowledgements', `DELETE FROM ops.review_acknowledgements WHERE is_sample`],
  ['ops.eod_review_events', `DELETE FROM ops.eod_review_events WHERE report_id ${IN('s_eods')}`],
  [
    'ops.eod_report_versions',
    `DELETE FROM ops.eod_report_versions WHERE report_id ${IN('s_eods')}`,
  ],
  ['ops.eod_reports', `DELETE FROM ops.eod_reports WHERE id ${IN('s_eods')}`],
  [
    'ops.task_dependencies',
    // Only a sample task's own links: a real task waiting on a sample one blocks the clear.
    `DELETE FROM ops.task_dependencies WHERE task_id ${IN('s_tasks')}`,
  ],
  ...(['task_updates', 'task_events', 'task_reminders'] as const).map((t): [string, string] => [
    `ops.${t}`,
    `DELETE FROM ops.${t} WHERE task_id ${IN('s_tasks')}`,
  ]),
  ['ops.staff_tasks', `DELETE FROM ops.staff_tasks WHERE id ${IN('s_tasks')}`],
  [
    'core.user_preferences',
    `DELETE FROM core.user_preferences WHERE user_id ${IN('s_preferences')}`,
  ],
  // Only values the seed stored and nobody has changed since (a real login's change stays).
  [
    'academic.settings',
    `DELETE FROM academic.settings WHERE key IN (SELECT entity_id FROM core.audit_events WHERE action = 'sample.row_created' AND entity_type = 'academic.settings')
       AND updated_by_user_id IN (SELECT id FROM core.users WHERE email = 'academic-manager@example.test')`,
  ],
  [
    'ops.task_import_batches',
    `DELETE FROM ops.task_import_batches WHERE id ${IN('s_import_batches')}`,
  ],
  [
    'ops.appointment_changes',
    `DELETE FROM ops.appointment_changes WHERE appointment_id ${IN('s_appointments')}`,
  ],
  [
    'ops.appointment_participants',
    `DELETE FROM ops.appointment_participants WHERE appointment_id ${IN('s_appointments')} OR student_id ${IN('s_students')}`,
  ],
  [
    'ops.event_messages',
    `DELETE FROM ops.event_messages WHERE appointment_id ${IN('s_appointments')}`,
  ],
  ['ops.appointments', `DELETE FROM ops.appointments WHERE id ${IN('s_appointments')}`],
  [
    'ops.teacher_student_feedback',
    `DELETE FROM ops.teacher_student_feedback WHERE demo_session_id IN (SELECT id FROM ops.demo_sessions WHERE demo_id ${IN('s_demos')})`,
  ],
  [
    'ops.demo_session_changes',
    `DELETE FROM ops.demo_session_changes WHERE session_id IN (SELECT id FROM ops.demo_sessions WHERE demo_id ${IN('s_demos')})`,
  ],
  ['ops.demo_sessions', `DELETE FROM ops.demo_sessions WHERE demo_id ${IN('s_demos')}`],
  [
    'ops.checklist_entries',
    `DELETE FROM ops.checklist_entries WHERE subject_id ${IN('s_demos')} OR subject_id ${IN('s_admissions')}`,
  ],
  ['ops.fee_receipts', `DELETE FROM ops.fee_receipts WHERE fee_record_id ${IN('s_fee_records')}`],
  ['ops.fee_records', `DELETE FROM ops.fee_records WHERE id ${IN('s_fee_records')}`],
  ['ops.fee_instalments', `DELETE FROM ops.fee_instalments WHERE plan_id ${IN('s_plans')}`],
  ['ops.fee_plans', `DELETE FROM ops.fee_plans WHERE id ${IN('s_plans')}`],
  [
    'core.approvals',
    `DELETE FROM core.approvals WHERE subject_module = 'ops' AND (subject_id ${IN('s_admissions')} OR subject_id ${IN('s_plans')})`,
  ],
  [
    'ops.admission_approvals',
    `DELETE FROM ops.admission_approvals WHERE admission_id ${IN('s_admissions')}`,
  ],
  ...(['signature_confirmations', 'application_forms', 'application_versions'] as const).map(
    (t): [string, string] => [
      `ops.${t}`,
      `DELETE FROM ops.${t} WHERE application_id ${IN('s_applications')}`,
    ],
  ),
  ['ops.applications', `DELETE FROM ops.applications WHERE id ${IN('s_applications')}`],
  ['ops.demos', `DELETE FROM ops.demos WHERE id ${IN('s_demos')}`],
  [
    'ops.onboarding_item_events',
    `DELETE FROM ops.onboarding_item_events WHERE item_id IN (SELECT id FROM ops.onboarding_items WHERE admission_id ${IN('s_admissions')})`,
  ],
  [
    'ops.material_issues',
    `DELETE FROM ops.material_issues WHERE admission_id ${IN('s_admissions')}`,
  ],
  [
    'ops.onboarding_items',
    `DELETE FROM ops.onboarding_items WHERE admission_id ${IN('s_admissions')}`,
  ],
  ['ops.follow_ups', `DELETE FROM ops.follow_ups WHERE lead_id ${IN('s_leads')}`],
  [
    'ops.admission_checks',
    `DELETE FROM ops.admission_checks WHERE admission_id ${IN('s_admissions')}`,
  ],
  [
    'ops.admission_transitions',
    `DELETE FROM ops.admission_transitions WHERE admission_id ${IN('s_admissions')}`,
  ],
  [
    'ops.enrolment_attempts',
    `DELETE FROM ops.enrolment_attempts WHERE admission_id ${IN('s_admissions')}`,
  ],
  [
    'ops.admission_number_changes',
    `DELETE FROM ops.admission_number_changes WHERE admission_id ${IN('s_admissions')}`,
  ],
  ['ops.exit_records', `DELETE FROM ops.exit_records WHERE admission_id ${IN('s_admissions')}`],
  [
    'ops.lead_handoff_receipts',
    `DELETE FROM ops.lead_handoff_receipts WHERE lead_id ${IN('s_leads')}`,
  ],
  ['ops.kyc_documents', `DELETE FROM ops.kyc_documents WHERE student_id ${IN('s_students')}`],
  [
    'ops.student_siblings',
    `DELETE FROM ops.student_siblings WHERE student_id ${IN('s_students')} OR sibling_student_id ${IN('s_students')}`,
  ],
  [
    'ops.guardians',
    `DELETE FROM ops.guardians WHERE student_id ${IN('s_students')} OR lead_id ${IN('s_leads')}`,
  ],
  ['ops.report_exports', `DELETE FROM ops.report_exports WHERE student_id ${IN('s_students')}`],
  [
    'ops.teacher_report_exports',
    `DELETE FROM ops.teacher_report_exports WHERE id IN (${sampleRowsSql('ops.teacher_report_exports')})`,
  ],
  ['ops.contact_preferences', `DELETE FROM ops.contact_preferences WHERE lead_id ${IN('s_leads')}`],
  ['ops.lead_activities', `DELETE FROM ops.lead_activities WHERE lead_id ${IN('s_leads')}`],
  ['ops.lead_stage_history', `DELETE FROM ops.lead_stage_history WHERE lead_id ${IN('s_leads')}`],
  [
    'ops.duplicate_flags',
    `DELETE FROM ops.duplicate_flags WHERE lead_id ${IN('s_leads')} OR matched_lead_id ${IN('s_leads')}`,
  ],
  ['ops.enquiries', `DELETE FROM ops.enquiries WHERE lead_id ${IN('s_leads')}`],
  // Sample tests (apps/academic-os/seed/sample-tests.ts), results before their runs and attempts;
  // sections, answer keys and eligible batches go with the assessment (ON DELETE CASCADE).
  ...(
    [
      ['results', 'assessment_id'],
      ['result_publications', 'assessment_id'],
      ['result_runs', 'assessment_id'],
      ['attempts', 'assessment_id'],
      ['assessment_roster', 'assessment_id'],
      ['assessments', 'id'],
    ] as const
  ).map(([t, col]): [string, string] => [
    `academic.${t}`,
    `DELETE FROM academic.${t} WHERE ${col} ${IN('s_assessments')}`,
  ]),
  // Academic sample teaching (apps/academic-os/seed/samples.ts, fill-teaching.ts). A real student's
  // row in a sample session or batch is not deleted: its foreign key rolls the whole command back.
  [
    'academic.homework_marks',
    `DELETE FROM academic.homework_marks WHERE homework_id ${IN('s_homework')} OR student_id ${IN('s_academic_students')}`,
  ],
  ['academic.homework', `DELETE FROM academic.homework WHERE id ${IN('s_homework')}`],
  ...(['catchup_tasks', 'interventions'] as const).map((t): [string, string] => [
    `academic.${t}`,
    `DELETE FROM academic.${t} WHERE student_id ${IN('s_academic_students')}`,
  ]),
  [
    'academic.teacher_unavailability',
    `DELETE FROM academic.teacher_unavailability WHERE staff_id ${IN('s_sample_staff')}`,
  ],
  [
    'academic.teacher_reviews',
    `DELETE FROM academic.teacher_reviews WHERE is_sample OR academic_student_id ${IN('s_academic_students')} OR core_student_id ${IN('s_students')}`,
  ],
  [
    'academic.session_demo_attendees',
    `DELETE FROM academic.session_demo_attendees WHERE is_sample`,
  ],
  [
    'academic.attendance',
    `DELETE FROM academic.attendance WHERE student_id ${IN('s_academic_students')}`,
  ],
  ...(['class_records', 'session_teachers'] as const).map((t): [string, string] => [
    `academic.${t}`,
    `DELETE FROM academic.${t} WHERE session_id ${IN('s_academic_sessions')}`,
  ]),
  [
    'academic.class_sessions',
    `DELETE FROM academic.class_sessions WHERE id ${IN('s_academic_sessions')}`,
  ],
  // Batch-scoped plans carry no foreign key to the batch (the service checks it); items cascade.
  [
    'core.approvals (plans)',
    `DELETE FROM core.approvals WHERE subject_module = 'academic' AND subject_type = 'curriculum_plan' AND subject_id ${IN('s_plans_academic')}`,
  ],
  [
    'academic.curriculum_plans',
    `DELETE FROM academic.curriculum_plans WHERE id ${IN('s_plans_academic')}`,
  ],
  [
    'academic.timetable_patterns',
    `DELETE FROM academic.timetable_patterns WHERE batch_id ${IN('s_academic_batches')}`,
  ],
  [
    'academic.batch_placements',
    `DELETE FROM academic.batch_placements WHERE is_sample OR enrolment_id IN (SELECT id FROM academic.enrolments WHERE student_id ${IN('s_academic_students')} OR source_admission_id ${IN('s_admissions')})`,
  ],
  // Academic's copies made by the enrolment handoff of sample admissions (platform seed).
  [
    'academic.enrolment_intake_log',
    `DELETE FROM academic.enrolment_intake_log WHERE admission_id ${IN('s_admissions')}`,
  ],
  [
    'academic.enrolments',
    `DELETE FROM academic.enrolments WHERE source_admission_id ${IN('s_admissions')} OR student_id ${IN('s_academic_students')}`,
  ],
  ['academic.students', `DELETE FROM academic.students WHERE id ${IN('s_academic_students')}`],
  ['academic.rooms', `DELETE FROM academic.rooms WHERE id ${IN('s_rooms')}`],
  // A sample teacher's assignment on a real batch (older seeds gave teacher@example.test one) is
  // sample data even though the login stays; assignments of sample batches cascade below.
  [
    'academic.teacher_assignments',
    `DELETE FROM academic.teacher_assignments WHERE staff_member_id ${IN('s_sample_staff')}`,
  ],
  // Teacher assignments and calendar rules of a batch go with it (ON DELETE CASCADE).
  ['academic.batches', `DELETE FROM academic.batches WHERE id ${IN('s_academic_batches')}`],
  ['ops.admissions', `DELETE FROM ops.admissions WHERE id ${IN('s_admissions')}`],
  // Not a delete: enrolment handoff events whose admission no longer exists (removed now or by an
  // earlier clear) and that a consumer has not finished are closed (`dead`), so Academic never
  // enrols, and Ops never retries a reply into, a removed admission.
  [
    'core.event_deliveries (closed)',
    `INSERT INTO core.event_deliveries (event_id, consumer, status, last_error)
     SELECT e.id, c.consumer, 'dead', 'Admission removed by db:clear-samples'
     FROM core.integration_events e
     JOIN (VALUES ('ops.admission.enrolment_requested', 'academic.enrolment-intake'),
                  ('academic.enrolment.confirmed', 'ops.enrolment-replies'),
                  ('academic.enrolment.rejected', 'ops.enrolment-replies'),
                  ('ops.enrolment.closed', 'academic.enrolment-exit')) c(type, consumer)
       ON c.type = e.type
     WHERE NOT EXISTS (SELECT 1 FROM ops.admissions a WHERE a.id = (e.payload->>'admissionId')::uuid)
     ON CONFLICT (event_id, consumer) DO UPDATE SET status = 'dead', last_error = EXCLUDED.last_error
       WHERE core.event_deliveries.status = 'failed'`,
  ],
  [
    'ops.teacher_student_feedback',
    `DELETE FROM ops.teacher_student_feedback WHERE student_id ${IN('s_students')} OR teacher_staff_id ${IN('s_staff')}`,
  ],
  [
    'ops.teacher_feedback_import_rows',
    `DELETE FROM ops.teacher_feedback_import_rows WHERE import_id ${IN('s_feedback_imports')} OR feedback_id IN (SELECT id FROM ops.student_teacher_feedback WHERE is_sample OR student_id ${IN('s_students')} OR teacher_staff_id ${IN('s_staff')})`,
  ],
  [
    'ops.student_teacher_feedback',
    `DELETE FROM ops.student_teacher_feedback WHERE is_sample OR student_id ${IN('s_students')} OR teacher_staff_id ${IN('s_staff')} OR import_id ${IN('s_feedback_imports')}`,
  ],
  [
    'ops.teacher_feedback_imports',
    `DELETE FROM ops.teacher_feedback_imports WHERE id ${IN('s_feedback_imports')}`,
  ],
  ...(['absence_calls', 'certificates'] as const).map((t): [string, string] => [
    `ops.${t}`,
    `DELETE FROM ops.${t} WHERE student_id ${IN('s_students')}`,
  ]),
  // Portal access (F4-13): a sample student's accounts; a login left with no live account loses its
  // setup codes and sessions and is switched off (kept, like other sample logins).
  ['core.portal_accounts', `DELETE FROM core.portal_accounts WHERE student_id ${IN('s_students')}`],
  [
    'core.portal_setup_codes',
    `DELETE FROM core.portal_setup_codes c WHERE ${PORTAL_LEFT('c.user_id')}`,
  ],
  [
    'core.sessions (portal, ended)',
    `UPDATE core.sessions s SET revoked_at = now() WHERE s.revoked_at IS NULL AND ${PORTAL_LEFT('s.user_id')}`,
  ],
  [
    'core.users (portal, switched off)',
    `UPDATE core.users u SET status = 'disabled' WHERE u.status <> 'disabled' AND ${PORTAL_LEFT('u.id')}`,
  ],
  ['core.students', `DELETE FROM core.students WHERE id ${IN('s_students')}`],
  ['ops.leads', `DELETE FROM ops.leads WHERE id ${IN('s_leads')}`],
  [
    'ops.staff_subject_capabilities',
    `DELETE FROM ops.staff_subject_capabilities WHERE staff_id ${IN('s_staff')}`,
  ],
  ['ops.staff_departments', `DELETE FROM ops.staff_departments WHERE staff_id ${IN('s_staff')}`],
  [
    'ops.staff_manager_history',
    `DELETE FROM ops.staff_manager_history WHERE staff_id ${IN('s_staff')} OR manager_staff_id ${IN('s_staff')}`,
  ],
  ['core.staff_members', `DELETE FROM core.staff_members WHERE id ${IN('s_staff')}`],
  ['ops.fee_structures', `DELETE FROM ops.fee_structures WHERE is_sample`],
  ['ops.work_schedules', `DELETE FROM ops.work_schedules WHERE id ${IN('s_schedules')}`],
  ['core.branches', `DELETE FROM core.branches WHERE id ${IN('s_branches')}`],
  // With no numbered admission left, real numbering starts again at 1 (row re-created on use).
  [
    'ops.admission_number_counters',
    `DELETE FROM ops.admission_number_counters WHERE NOT EXISTS (SELECT 1 FROM ops.admissions WHERE admission_number IS NOT NULL)`,
  ],
  // Sample receipts and certificates are numbered in their own series (FX-DOCS); real series hold only
  // real documents and are never reset.
  ['ops.document_counters', `DELETE FROM ops.document_counters WHERE series LIKE 'sample.%'`],
];

/** Self-references that would block a delete inside the same set. */
const UNLINK = [
  `UPDATE ops.staff_profiles SET work_schedule_id = NULL WHERE work_schedule_id ${IN('s_schedules')}`,
  `UPDATE ops.staff_profiles SET branch_id = NULL WHERE branch_id ${IN('s_branches')}`,
  `UPDATE ops.staff_tasks SET recurrence_parent_id = NULL, parent_task_id = NULL WHERE id ${IN('s_tasks')}`,
  `UPDATE ops.task_updates SET corrects_update_id = NULL WHERE task_id ${IN('s_tasks')}`,
  `UPDATE ops.eod_review_events SET version_id = NULL WHERE report_id ${IN('s_eods')}`,
  `UPDATE ops.eod_report_versions SET revision_request_event_id = NULL WHERE report_id ${IN('s_eods')}`,
  `UPDATE academic.class_sessions SET rescheduled_from_session_id = NULL, makeup_for_session_id = NULL WHERE id ${IN('s_academic_sessions')}`,
  `UPDATE academic.class_records SET corrects_record_id = NULL WHERE session_id ${IN('s_academic_sessions')}`,
  `UPDATE academic.curriculum_plans SET supersedes_plan_id = NULL WHERE id ${IN('s_plans_academic')}`,
  `UPDATE marketing.content_items SET current_version_id = NULL, approved_version_id = NULL, approval_id = NULL WHERE id ${IN('s_content')}`,
  `UPDATE marketing.placements SET placement_group_id = NULL WHERE id ${IN('s_placements')}`,
  `UPDATE academic.teacher_reviews SET supersedes_id = NULL WHERE is_sample`,
  `UPDATE academic.batch_placements SET transfer_from_placement_id = NULL WHERE is_sample`,
  `UPDATE ops.leads SET merged_into_lead_id = NULL WHERE id ${IN('s_leads')}`,
  `UPDATE ops.teacher_student_feedback SET supersedes_id = NULL WHERE student_id ${IN('s_students')} OR teacher_staff_id ${IN('s_staff')}`,
  // Pointing at itself, not empty: an old version must stay marked superseded (one live document per kind).
  `UPDATE ops.kyc_documents SET superseded_by_id = id WHERE superseded_by_id IS NOT NULL AND student_id ${IN('s_students')}`,
  `UPDATE ops.fee_plans SET supersedes_plan_id = NULL, version = 1 WHERE id ${IN('s_plans')}`,
  `UPDATE ops.admissions SET application_id = NULL WHERE id ${IN('s_admissions')}`,
  `UPDATE ops.fee_records SET reverses_record_id = NULL WHERE id ${IN('s_fee_records')}`,
];

const affected = (r: unknown) =>
  Number(
    (r as { rowCount?: number; affectedRows?: number }).rowCount ??
      (r as { affectedRows?: number }).affectedRows ??
      0,
  );

/**
 * Delete all sample rows; returns rows deleted per table (tables with 0 left out). Refuses
 * (ClearSamplesRefused, nothing changed) when a real record needs a sample one; real rows that only
 * point at a sample row are unlinked first and each table's line goes to `log`.
 */
export function clearSamples(
  db: Database,
  log: (line: string) => void = () => {},
): Promise<Record<string, number>> {
  return withTransaction(db, async (tx) => {
    for (const [name, select] of SETS)
      await tx.execute(sql.raw(`CREATE TEMP TABLE ${name} ON COMMIT DROP AS ${select}`));
    await refuseRequiredLinks(tx);
    for (const line of await unlinkRealRows(tx)) log(line);
    for (const statement of UNLINK) await tx.execute(sql.raw(statement));
    const counts: Record<string, number> = {};
    for (const [table, statement] of DELETES) {
      const n = affected(await tx.execute(sql.raw(statement)));
      if (n) counts[table] = n;
    }
    return counts;
  });
}
