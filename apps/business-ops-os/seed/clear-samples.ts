/**
 * Remove every SAMPLE record before real use (`npm run db:clear-samples`, D-036).
 * Sample = `ops.leads.is_sample`, `core.students.is_sample`, `ops.fee_structures.is_sample`,
 * `is_sample` tasks, EOD reports and import batches, Academic `is_sample` batches (with their
 * sessions, logs and teachers), students, placements, demo attendees and reviews, or a staff
 * member whose `ops.staff_profiles.is_sample` is set and who has no login. Everything
 * that hangs off those rows is deleted with them (including Academic's student and enrolment
 * created by the sample enrolment handoff), children first, in ONE transaction: either all of it
 * goes or nothing does. Kept on purpose: the sample login accounts (other modules'
 * records point at them; production refuses @example.test sign-in, D-030) and their
 * in-app notifications, the audit trail and the integration-event outbox (append-only
 * history; unfinished enrolment handoffs of removed admissions are only closed), and the
 * owner-supplied staff. Real rows (is_sample = false) are never touched.
 */
import { sql } from 'drizzle-orm';
import type { Database } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';

/** Temporary id sets, built once: [name, SELECT]. */
const SETS: readonly [string, string][] = [
  ['s_leads', `SELECT id FROM ops.leads WHERE is_sample`],
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
       OR demo_id IN (SELECT id FROM s_demos)`,
  ],
  [
    's_plans',
    `SELECT id FROM ops.fee_plans WHERE admission_id IN (SELECT id FROM s_admissions) OR student_id IN (SELECT id FROM s_students)`,
  ],
  [
    's_academic_students',
    `SELECT id FROM academic.students WHERE source_admission_id IN (SELECT id FROM s_admissions) OR is_sample`,
  ],
  ['s_academic_batches', `SELECT id FROM academic.batches WHERE is_sample`],
  [
    's_academic_sessions',
    `SELECT id FROM academic.class_sessions WHERE batch_id IN (SELECT id FROM s_academic_batches)`,
  ],
  ['s_import_batches', `SELECT id FROM ops.task_import_batches WHERE is_sample`],
  [
    's_tasks',
    `SELECT id FROM ops.staff_tasks WHERE is_sample OR import_batch_id IN (SELECT id FROM s_import_batches)`,
  ],
  ['s_eods', `SELECT id FROM ops.eod_reports WHERE is_sample`],
  [
    's_staff',
    `SELECT p.staff_id AS id FROM ops.staff_profiles p JOIN core.staff_members m ON m.id = p.staff_id
     WHERE p.is_sample AND m.user_id IS NULL`,
  ],
];

const IN = (set: string) => `IN (SELECT id FROM ${set})`;

/** Deletes in foreign-key-safe order: [label, statement]. */
const DELETES: readonly [string, string][] = [
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
  ...(['task_updates', 'task_events'] as const).map((t): [string, string] => [
    `ops.${t}`,
    `DELETE FROM ops.${t} WHERE task_id ${IN('s_tasks')}`,
  ]),
  ['ops.staff_tasks', `DELETE FROM ops.staff_tasks WHERE id ${IN('s_tasks')}`],
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
  [
    'ops.fee_records',
    `DELETE FROM ops.fee_records WHERE admission_id ${IN('s_admissions')} OR lead_id ${IN('s_leads')} OR plan_id ${IN('s_plans')}`,
  ],
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
  ['ops.contact_preferences', `DELETE FROM ops.contact_preferences WHERE lead_id ${IN('s_leads')}`],
  ['ops.lead_activities', `DELETE FROM ops.lead_activities WHERE lead_id ${IN('s_leads')}`],
  [
    'ops.duplicate_flags',
    `DELETE FROM ops.duplicate_flags WHERE lead_id ${IN('s_leads')} OR matched_lead_id ${IN('s_leads')}`,
  ],
  ['ops.enquiries', `DELETE FROM ops.enquiries WHERE lead_id ${IN('s_leads')}`],
  // Academic sample teaching (apps/academic-os/seed/samples.ts). A real student's row in a
  // sample session or batch is not deleted: its foreign key rolls the whole command back.
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
                  ('academic.enrolment.rejected', 'ops.enrolment-replies')) c(type, consumer)
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
    'ops.student_teacher_feedback',
    `DELETE FROM ops.student_teacher_feedback WHERE student_id ${IN('s_students')} OR teacher_staff_id ${IN('s_staff')}`,
  ],
  ['core.students', `DELETE FROM core.students WHERE id ${IN('s_students')}`],
  ['ops.leads', `DELETE FROM ops.leads WHERE id ${IN('s_leads')}`],
  [
    'ops.staff_subject_capabilities',
    `DELETE FROM ops.staff_subject_capabilities WHERE staff_id ${IN('s_staff')}`,
  ],
  ['core.staff_members', `DELETE FROM core.staff_members WHERE id ${IN('s_staff')}`],
  ['ops.fee_structures', `DELETE FROM ops.fee_structures WHERE is_sample`],
  // With no numbered admission left, real numbering starts again at 1 (row re-created on use).
  [
    'ops.admission_number_counters',
    `DELETE FROM ops.admission_number_counters WHERE NOT EXISTS (SELECT 1 FROM ops.admissions WHERE admission_number IS NOT NULL)`,
  ],
];

/** Self-references that would block a delete inside the same set. */
const UNLINK = [
  `UPDATE ops.staff_tasks SET recurrence_parent_id = NULL WHERE id ${IN('s_tasks')}`,
  `UPDATE ops.task_updates SET corrects_update_id = NULL WHERE task_id ${IN('s_tasks')}`,
  `UPDATE ops.eod_review_events SET version_id = NULL WHERE report_id ${IN('s_eods')}`,
  `UPDATE ops.eod_report_versions SET revision_request_event_id = NULL WHERE report_id ${IN('s_eods')}`,
  `UPDATE academic.class_sessions SET rescheduled_from_session_id = NULL, makeup_for_session_id = NULL WHERE id ${IN('s_academic_sessions')}`,
  `UPDATE academic.class_records SET corrects_record_id = NULL WHERE session_id ${IN('s_academic_sessions')}`,
  `UPDATE academic.teacher_reviews SET supersedes_id = NULL WHERE is_sample`,
  `UPDATE academic.batch_placements SET transfer_from_placement_id = NULL WHERE is_sample`,
  `UPDATE ops.leads SET merged_into_lead_id = NULL WHERE id ${IN('s_leads')}`,
  `UPDATE ops.teacher_student_feedback SET supersedes_id = NULL WHERE student_id ${IN('s_students')} OR teacher_staff_id ${IN('s_staff')}`,
  `UPDATE ops.kyc_documents SET superseded_by_id = NULL, superseded_at = NULL WHERE student_id ${IN('s_students')}`,
  `UPDATE ops.fee_plans SET supersedes_plan_id = NULL, version = 1 WHERE id ${IN('s_plans')}`,
  `UPDATE ops.admissions SET application_id = NULL WHERE id ${IN('s_admissions')}`,
  `UPDATE ops.fee_records SET reverses_record_id = NULL WHERE admission_id ${IN('s_admissions')} OR lead_id ${IN('s_leads')}`,
];

const affected = (r: unknown) =>
  Number(
    (r as { rowCount?: number; affectedRows?: number }).rowCount ??
      (r as { affectedRows?: number }).affectedRows ??
      0,
  );

/** Delete all sample rows; returns rows deleted per table (tables with 0 left out). */
export function clearSamples(db: Database): Promise<Record<string, number>> {
  return withTransaction(db, async (tx) => {
    for (const [name, select] of SETS)
      await tx.execute(sql.raw(`CREATE TEMP TABLE ${name} ON COMMIT DROP AS ${select}`));
    for (const statement of UNLINK) await tx.execute(sql.raw(statement));
    const counts: Record<string, number> = {};
    for (const [table, statement] of DELETES) {
      const n = affected(await tx.execute(sql.raw(statement)));
      if (n) counts[table] = n;
    }
    return counts;
  });
}
