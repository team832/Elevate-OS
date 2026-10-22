/**
 * Teachers (brief §6): directory and profile built from core staff + academic assignments, the
 * timetable and session participation, plus the `academic.teacher_activity` v1 contract for
 * Business Ops. Planned, delivered, cancelled and substituted are separate operational counts
 * (not payroll, not HR attendance); a class taught by two teachers counts once for each
 * teacher's workload, labelled as participation. No ratings or rankings.
 */
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import {
  academicAssessments,
  academicBatches,
  academicSessionTeachers,
  academicSubjects,
  academicTeacherAssignments,
  academicTeacherReviews,
  academicTeacherUnavailability,
  staffMembers,
  type Database,
} from '@elevate/database';
import { NotFoundError, academicTeacherActivityV1Schema, metric, type AcademicTeacherActivityV1 } from '@elevate/shared-contracts';
import { addDays, type IsoDate, type StaffMemberId } from '@elevate/shared-types';
import { assignmentPhase } from '../../domain/placements';
import { resolveScope, todayIst, type Actor } from '../context';
import { HR_UNAVAILABLE, LOOKBACK_DAYS, sessionWork } from './my-day';
import { sessionRows, teachersBySession, type SessionListRow } from './timetable';

async function assignmentsOf(db: Database, staffIds?: readonly string[]) {
  return db
    .select({ assignment: academicTeacherAssignments, batchCode: academicBatches.code, subjectName: academicSubjects.name })
    .from(academicTeacherAssignments)
    .innerJoin(academicBatches, eq(academicBatches.id, academicTeacherAssignments.batchId))
    .innerJoin(academicSubjects, eq(academicSubjects.id, academicTeacherAssignments.subjectId))
    .where(staffIds ? inArray(academicTeacherAssignments.staffMemberId, staffIds as StaffMemberId[]) : undefined)
    .orderBy(asc(academicBatches.code), asc(academicSubjects.name))
    .then((rows) => rows.map((r) => ({ ...r.assignment, batchCode: r.batchCode, subjectName: r.subjectName })));
}

/**
 * One teacher's sessions in a window with their part in each: planned (scheduled, not
 * replaced), delivered (an actual teacher of a delivered class), substituted (another teacher
 * covers or covered it), cancelled (cancelled or moved).
 */
async function participation(db: Database, staffId: string, window: { from: string; to: string }) {
  const sessions = await sessionRows(db, { ...window, teacherId: staffId });
  const planned = await teachersBySession(db, sessions);
  const rows = sessions.length
    ? await db.select().from(academicSessionTeachers).where(and(inArray(academicSessionTeachers.sessionId, sessions.map((s) => s.id)), eq(academicSessionTeachers.staffId, staffId as StaffMemberId), isNull(academicSessionTeachers.removedAt)))
    : [];
  const part = (s: SessionListRow) => {
    if (s.status === 'held') return rows.some((r) => r.sessionId === s.id && r.participation === 'actual') ? 'delivered' : 'substituted';
    if (s.status === 'cancelled' || s.status === 'rescheduled') return 'cancelled';
    return planned.get(s.id)?.includes(staffId) ? 'planned' : 'substituted';
  };
  return sessions.map((s) => ({ ...s, part: part(s) }));
}

const minutes = (list: { durationMinutes: number }[]) => list.reduce((n, s) => n + s.durationMinutes, 0);

export async function listTeachers(db: Database, actor: Actor, now = new Date()) {
  const scope = await resolveScope(db, actor, 'academic:assignments:read');
  if (scope.kind === 'own' && !scope.staffId) return [];
  const today = todayIst(now);
  const recent = { from: addDays(today as IsoDate, -LOOKBACK_DAYS) as string, to: today };
  const assignments = await assignmentsOf(db, scope.kind === 'own' ? [scope.staffId!] : undefined);
  const staffIds = [...new Set(assignments.map((a) => a.staffMemberId as string))];
  const staff = staffIds.length ? await db.select().from(staffMembers).where(inArray(staffMembers.id, staffIds as StaffMemberId[])).orderBy(asc(staffMembers.fullName)) : [];
  const out = [];
  for (const s of staff) {
    const mine = assignments.filter((a) => a.staffMemberId === s.id && assignmentPhase(a.startDate, a.endDate, today) === 'current');
    const sessions = await participation(db, s.id, recent);
    const work = await sessionWork(db, sessions.filter((p) => p.part === 'delivered'));
    out.push({
      staffId: s.id,
      name: s.fullName,
      subjects: [...new Set(mine.map((a) => a.subjectName))],
      batches: [...new Set(mine.map((a) => a.batchCode))],
      todayClasses: sessions.filter((p) => p.date === today && (p.part === 'planned' || p.part === 'delivered')).length,
      pendingLogs: [...work.values()].filter((w) => !w.logSubmitted).length,
      pendingLogsRange: recent,
    });
  }
  return out;
}

export async function teacherProfile(db: Database, actor: Actor, staffId: string, window: { from: string; to: string }) {
  const scope = await resolveScope(db, actor, 'academic:assignments:read');
  if (scope.kind === 'own' && scope.staffId !== staffId) throw new NotFoundError('Teacher not found.');
  const [staff] = await db.select().from(staffMembers).where(eq(staffMembers.id, staffId as StaffMemberId));
  if (!staff) throw new NotFoundError('Teacher not found.');
  const sessions = await participation(db, staffId, window);
  const by = (part: string) => sessions.filter((s) => s.part === part);
  return {
    staff: { id: staff.id, name: staff.fullName, title: staff.title, status: staff.status },
    window,
    assignments: await assignmentsOf(db, [staffId]),
    sessions,
    hours: { plannedMinutes: minutes(by('planned')), deliveredMinutes: minutes(by('delivered')), cancelledMinutes: minutes(by('cancelled')), substitutedMinutes: minutes(by('substituted')) },
    unavailability: await db.select().from(academicTeacherUnavailability).where(eq(academicTeacherUnavailability.staffId, staffId as StaffMemberId)).orderBy(asc(academicTeacherUnavailability.fromDate)),
    hrAttendance: HR_UNAVAILABLE,
  };
}

/** Contract `academic.teacher_activity` v1 (internal route for Ops). */
export async function teacherActivity(db: Database, staffId: string, window: { from: string; to: string }, now = new Date()): Promise<AcademicTeacherActivityV1> {
  const [staff] = await db.select({ id: staffMembers.id }).from(staffMembers).where(eq(staffMembers.id, staffId as StaffMemberId));
  if (!staff) throw new NotFoundError('Teacher not found.');
  const sessions = await participation(db, staffId, window);
  const by = (part: string) => sessions.filter((s) => s.part === part);
  const today = todayIst(now);
  const work = await sessionWork(db, sessions.filter((s) => s.part === 'delivered' || (s.part === 'planned' && s.date <= today)));
  const assignments = await assignmentsOf(db, [staffId]);
  const activeBatchIds = [...new Set(assignments.filter((a) => assignmentPhase(a.startDate, a.endDate, today) === 'current').map((a) => a.batchId))];
  const marking = activeBatchIds.length ? (await db.select({ id: academicAssessments.id }).from(academicAssessments).where(and(inArray(academicAssessments.batchId, activeBatchIds), eq(academicAssessments.status, 'conducted')))).length : 0;
  const reviews = await db.select({ status: academicTeacherReviews.status, submittedAt: academicTeacherReviews.submittedAt }).from(academicTeacherReviews).where(eq(academicTeacherReviews.authorStaffId, staffId as StaffMemberId));
  const inWindow = (d: Date | null) => d !== null && d.toISOString().slice(0, 10) >= window.from && d.toISOString().slice(0, 10) <= window.to;
  const m = (value: number, definition: string) => metric.ok(value, { definition, window, unit: 'count' });
  const unavailability = await db
    .select({ from: academicTeacherUnavailability.fromDate, to: academicTeacherUnavailability.toDate })
    .from(academicTeacherUnavailability)
    .where(and(eq(academicTeacherUnavailability.staffId, staffId as StaffMemberId), isNull(academicTeacherUnavailability.cancelledAt), lte(academicTeacherUnavailability.fromDate, window.to), gte(academicTeacherUnavailability.toDate, window.from)));
  return academicTeacherActivityV1Schema.parse({
    contract: 'academic.teacher_activity',
    version: 1,
    generatedAt: now.toISOString(),
    staffId: staff.id,
    window,
    assignments: assignments.map((a) => ({ batchCode: a.batchCode, subjectName: a.subjectName, role: a.role, startDate: a.startDate, endDate: a.endDate })),
    sessions: {
      planned: m(by('planned').length, 'Scheduled classes this teacher is planned to teach (not yet delivered, not replaced).'),
      delivered: m(by('delivered').length, 'Classes marked delivered with this teacher recorded as an actual teacher.'),
      cancelled: m(by('cancelled').length, 'Classes this teacher was planned for that were cancelled or moved.'),
      substituted: m(by('substituted').length, 'Classes this teacher was planned for that another teacher covers or covered.'),
    },
    logsPending: m([...work.values()].filter((w) => !w.logSubmitted).length, 'Delivered or past classes of this teacher without a submitted class record.'),
    attendancePending: m([...work.values()].filter((w) => w.attendanceMissing > 0).length, 'Delivered or past classes with at least one placed student not marked.'),
    markingPending: m(marking, 'Assessments conducted but not yet finalised in batches this teacher is assigned to (current, not windowed).'),
    reviews: {
      submitted: m(reviews.filter((r) => r.status === 'submitted' && inWindow(r.submittedAt)).length, 'Teacher reviews submitted in the window.'),
      draft: m(reviews.filter((r) => r.status === 'draft').length, 'Teacher reviews still in draft now (private to the author).'),
    },
    unavailability,
  });
}
