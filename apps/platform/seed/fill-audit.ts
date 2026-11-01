/**
 * Owner, 31 Oct 2026: the audit screens must read as a history. Rows the fill wrote directly (a
 * service would need a password, a live call or a day that has passed) get the audit row the real act
 * writes, dated when the act happened and signed by who did it. Sample records only; db:clear-samples
 * keeps audit rows, as it always has (D-036). Run again it adds nothing.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '@elevate/database';

const SAMPLE_STAFF = sql.raw(`(SELECT staff_id FROM ops.staff_profiles WHERE is_sample)`);
const hr = sql.raw(`(SELECT id FROM core.users WHERE email = 'hr-manager@example.test')`);
const manager = sql.raw(`(SELECT id FROM core.users WHERE email = 'academic-manager@example.test')`);

/** [module, action, entity type, SELECT at, actor, id (text), metadata]. */
const HISTORY: readonly [string, string, string, SQL][] = [
  // The HR record of every sample person.
  ['ops', 'staff.profile_updated', 'staff_member', sql`
    SELECT (p.joined_on + 1)::timestamptz + interval '11 hours', ${hr}, p.staff_id::text, '{"fields":["employmentType","branch","joinedOn"]}'::jsonb
    FROM ops.staff_profiles p WHERE p.is_sample`],
  ['ops', 'staff.private_details_updated', 'staff_member', sql`
    SELECT (p.joined_on + 2)::timestamptz + interval '12 hours', ${hr}, p.staff_id::text, '{"fields":["address","emergencyContactName","emergencyContactPhone"]}'::jsonb
    FROM ops.staff_profiles p JOIN ops.staff_private_details d ON d.staff_id = p.staff_id WHERE p.is_sample`],
  ['ops', 'staff.department_changed', 'staff_member', sql`
    SELECT d.from_date::timestamptz + interval '10 hours', ${hr}, d.staff_id::text, NULL::jsonb
    FROM ops.staff_departments d JOIN ops.staff_profiles p ON p.staff_id = d.staff_id WHERE p.is_sample AND d.from_date IS NOT NULL`],
  ['ops', 'staff.manager_changed', 'staff_member', sql`
    SELECT h.to_date::timestamptz + interval '34 hours', ${hr}, h.staff_id::text, jsonb_build_object('reason', h.reason)
    FROM ops.staff_manager_history h JOIN ops.staff_profiles p ON p.staff_id = h.staff_id WHERE p.is_sample AND h.to_date IS NOT NULL`],
  ['ops', 'staff.employment_ended', 'staff_member', sql`
    SELECT p.left_on::timestamptz + interval '17 hours', ${hr}, p.staff_id::text, '{"reason":"Moved to another city."}'::jsonb
    FROM ops.staff_profiles p WHERE p.is_sample AND p.employment_status = 'exited'`],
  ['ops', 'teacher.updated', 'teacher', sql`
    SELECT (p.joined_on + 5)::timestamptz + interval '15 hours', ${hr}, p.staff_id::text, '{"fields":["subjects"]}'::jsonb
    FROM ops.staff_profiles p WHERE p.is_sample AND EXISTS (SELECT 1 FROM ops.staff_subject_capabilities c WHERE c.staff_id = p.staff_id)`],
  // Attendance HR decided and the file it imported.
  ['ops', 'attendance.day_decided', 'attendance', sql`
    SELECT (d.work_date + 1)::timestamptz + interval '11 hours', d.decided_by_user_id, d.id::text, jsonb_build_object('status', d.status, 'note', d.note)
    FROM ops.daily_attendance d WHERE d.is_sample AND d.basis = 'hr_decision'`],
  ['ops', 'attendance.import_committed', 'attendance_import', sql`
    SELECT i.committed_at, i.committed_by, i.id::text, jsonb_build_object('rows', i.rows_total)
    FROM ops.attendance_imports i WHERE i.is_sample AND i.committed_at IS NOT NULL`],
  // Tasks: what the lifecycle events say happened.
  ['ops', 'task.assigned', 'staff_task', sql`
    SELECT e.occurred_at, e.actor_user_id, e.task_id::text, NULL::jsonb
    FROM ops.task_events e JOIN ops.staff_tasks t ON t.id = e.task_id WHERE t.is_sample AND e.kind = 'created'`],
  ['ops', 'task.submitted', 'staff_task', sql`
    SELECT max(e.occurred_at), max(e.actor_user_id::text)::uuid, e.task_id::text, NULL::jsonb
    FROM ops.task_events e JOIN ops.staff_tasks t ON t.id = e.task_id WHERE t.is_sample AND e.kind = 'submitted_for_review' GROUP BY e.task_id`],
  ['ops', 'task.approved', 'staff_task', sql`
    SELECT e.occurred_at, e.actor_user_id, e.task_id::text, NULL::jsonb
    FROM ops.task_events e JOIN ops.staff_tasks t ON t.id = e.task_id WHERE t.is_sample AND e.kind = 'review_approved'`],
  ['ops', 'task.changes_requested', 'staff_task', sql`
    SELECT max(e.occurred_at), max(e.actor_user_id::text)::uuid, e.task_id::text, jsonb_build_object('reason', max(e.reason))
    FROM ops.task_events e JOIN ops.staff_tasks t ON t.id = e.task_id WHERE t.is_sample AND e.kind = 'changes_requested' GROUP BY e.task_id`],
  ['ops', 'task.reopened', 'staff_task', sql`
    SELECT e.occurred_at, e.actor_user_id, e.task_id::text, jsonb_build_object('reason', e.reason)
    FROM ops.task_events e JOIN ops.staff_tasks t ON t.id = e.task_id WHERE t.is_sample AND e.kind = 'reopened'`],
  // Work reports.
  ['ops', 'eod.submitted', 'eod_report', sql`
    SELECT r.submitted_at, r.created_by, r.id::text, jsonb_build_object('kind', r.period_kind)
    FROM ops.eod_reports r WHERE r.is_sample AND r.submitted_at IS NOT NULL`],
  ['ops', 'eod.reviewed', 'eod_report', sql`
    SELECT e.created_at, e.actor_user_id, e.report_id::text, jsonb_build_object('kind', e.kind)
    FROM ops.eod_review_events e JOIN ops.eod_reports r ON r.id = e.report_id WHERE r.is_sample`],
  // Student feedback HR moderated, and the file it came from.
  ['ops', 'student_feedback.moderated', 'student_teacher_feedback', sql`
    SELECT f.moderated_at, f.moderated_by, f.id::text, jsonb_build_object('status', f.moderation_status)
    FROM ops.student_teacher_feedback f WHERE f.is_sample AND f.moderated_at IS NOT NULL`],
  ['ops', 'feedback_import.committed', 'teacher_feedback_import', sql`
    SELECT i.committed_at, i.created_by, i.id::text, jsonb_build_object('rows', i.rows_total)
    FROM ops.teacher_feedback_imports i WHERE i.is_sample AND i.committed_at IS NOT NULL`],
  // Academic.
  ['academic', 'batch.updated', 'batch', sql`
    SELECT b.start_date::timestamptz - interval '2 days', ${manager}, b.id::text, '{"fields":["capacity","mode","route","campus"]}'::jsonb
    FROM academic.batches b WHERE b.is_sample`],
  ['academic', 'assignment.created', 'teacher_assignment', sql`
    SELECT b.start_date::timestamptz - interval '1 day', ${manager}, a.id::text, NULL::jsonb
    FROM academic.teacher_assignments a JOIN academic.batches b ON b.id = a.batch_id WHERE b.is_sample`],
  ['academic', 'assignment.ended', 'teacher_assignment', sql`
    SELECT a.end_date::timestamptz + interval '18 hours', ${manager}, a.id::text, NULL::jsonb
    FROM academic.teacher_assignments a JOIN academic.batches b ON b.id = a.batch_id WHERE b.is_sample AND a.status = 'ended'`],
  ['academic', 'timetable_pattern.published', 'timetable_pattern', sql`
    SELECT p.published_at, p.published_by_user_id, p.id::text, NULL::jsonb
    FROM academic.timetable_patterns p JOIN academic.batches b ON b.id = p.batch_id WHERE b.is_sample AND p.published_at IS NOT NULL`],
  ['academic', 'class_session.substitute_assigned', 'class_session', sql`
    SELECT s.date::timestamptz + interval '7 hours', t.authorised_by_user_id, t.session_id::text, jsonb_build_object('reason', t.reason)
    FROM academic.session_teachers t JOIN academic.class_sessions s ON s.id = t.session_id JOIN academic.batches b ON b.id = s.batch_id
    WHERE b.is_sample AND t.replaces_staff_id IS NOT NULL`],
  ['academic', 'catchup.updated', 'catchup_task', sql`
    SELECT coalesce(c.completed_at, c.created_at), c.created_by_user_id, c.id::text, jsonb_build_object('status', c.status)
    FROM academic.catchup_tasks c JOIN academic.batches b ON b.id = c.batch_id WHERE b.is_sample`],
  ['academic', 'intervention.created', 'intervention', sql`
    SELECT i.created_at, i.created_by_user_id, i.id::text, jsonb_build_object('status', i.status, 'trigger', i.trigger)
    FROM academic.interventions i JOIN academic.batches b ON b.id = i.batch_id WHERE b.is_sample`],
  ['academic', 'teacher_unavailability.recorded', 'teacher_unavailability', sql`
    SELECT u.created_at, u.entered_by_user_id, u.id::text, jsonb_build_object('reason', u.reason)
    FROM academic.teacher_unavailability u WHERE u.staff_id IN ${SAMPLE_STAFF}`],
];

export async function seedFillAudit(db: Database, log: (m: string) => void = () => {}) {
  let added = 0;
  for (const [module, action, entityType, rows] of HISTORY) {
    const r = await db.execute(sql`
      INSERT INTO core.audit_events (at, actor_type, actor_user_id, module, action, entity_type, entity_id, metadata)
      SELECT x.at, 'user', x.actor, ${module}, ${action}, ${entityType}, x.id, x.meta
      FROM (${rows}) AS x(at, actor, id, meta)
      WHERE x.actor IS NOT NULL AND x.at IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM core.audit_events e WHERE e.entity_type = ${entityType} AND e.entity_id = x.id AND e.action = ${action})`);
    added += (r as unknown as { rowCount?: number }).rowCount ?? 0;
  }
  // Notifications: most of the older ones have been read.
  await db.execute(sql`UPDATE core.notifications n SET read_at = n.created_at + interval '3 hours'
    WHERE n.read_at IS NULL AND n.created_at < now() - interval '1 minute'
      AND abs(hashtext(n.id::text)) % 3 > 0
      AND n.user_id IN (SELECT user_id FROM core.staff_members WHERE id IN ${SAMPLE_STAFF})`);
  log(`platform.fill-audit: ${added} audit row(s) for records the fill wrote directly`);
}
