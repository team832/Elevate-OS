/**
 * Teachers (brief §6): directory and profile built from core staff + academic assignments, the
 * timetable and session participation, plus the `academic.teacher_activity` v1 contract for
 * Business Ops. Planned, delivered, cancelled and substituted are separate operational counts
 * (not payroll, not HR attendance); a class taught by two teachers counts once for each
 * teacher's workload, labelled as participation. No ratings or rankings.
 */
import { and, asc, countDistinct, eq, gte, inArray, isNull, lt, lte } from 'drizzle-orm';
import {
  academicAssessments,
  academicAttempts,
  academicBatches,
  academicChapters,
  academicClassRecords,
  academicClassSessions,
  academicSessionTeachers,
  academicSubjects,
  academicTeacherReviews,
  academicTeacherUnavailability,
  staffMembers,
  type Database,
} from '@elevate/database';
import { NotFoundError, academicTeacherActivityV1Schema, metric, type AcademicTeacherActivityV1 } from '@elevate/shared-contracts';
import { addDays, type IsoDate, type StaffMemberId } from '@elevate/shared-types';
import { assignmentPhase } from '../../domain/placements';
import { resolveScope, todayIst, type Actor } from '../context';
import { listAssignmentsFor, type AssignmentRow } from './assignments';
import { LOOKBACK_DAYS, sessionWork } from './my-day';
import { sessionRows, teachersBySession, type SessionListRow } from './timetable';

/** Every assignment row of these teachers (history and pending included). */
const assignmentsOf = (db: Database, staffIds?: readonly string[]) => listAssignmentsFor(db, { staffIds, history: true });
const isCurrent = (a: AssignmentRow, today: string) => a.status !== 'pending' && assignmentPhase(a.startDate, a.endDate, today) === 'current';

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
    const own = assignments.filter((a) => a.staffMemberId === s.id);
    const mine = own.filter((a) => isCurrent(a, today));
    const sessions = await participation(db, s.id, recent);
    const work = await sessionWork(db, sessions.filter((p) => p.part === 'delivered'));
    out.push({
      staffId: s.id,
      name: s.fullName,
      subjects: [...new Set(mine.map((a) => a.subjectName))],
      batches: [...new Set(mine.map((a) => a.batchCode!))],
      /** Recorded without a batch yet: opens nothing (R9). */
      pendingSubjects: own.filter((a) => a.status === 'pending').map((a) => `${a.subjectName} (${a.courseCode})`),
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
  };
}

/** Contract `academic.teacher_activity` v1 (internal route for Ops). */
export async function teacherActivity(db: Database, staffId: string, window: { from: string; to: string }, now = new Date()): Promise<AcademicTeacherActivityV1> {
  const [staff] = await db.select({ id: staffMembers.id, userId: staffMembers.userId }).from(staffMembers).where(eq(staffMembers.id, staffId as StaffMemberId));
  if (!staff) throw new NotFoundError('Teacher not found.');
  const sessions = await participation(db, staffId, window);
  const by = (part: string) => sessions.filter((s) => s.part === part);
  const today = todayIst(now);
  const work = await sessionWork(db, sessions.filter((s) => s.part === 'delivered' || (s.part === 'planned' && s.date <= today)));
  const assignments = (await assignmentsOf(db, [staffId])).filter((a) => a.status !== 'pending'); // pending rows have no batch and no work yet
  const activeBatchIds = [...new Set(assignments.filter((a) => isCurrent(a, today)).map((a) => a.batchId!))];
  const marking = activeBatchIds.length ? (await db.select({ id: academicAssessments.id }).from(academicAssessments).where(and(inArray(academicAssessments.batchId, activeBatchIds), eq(academicAssessments.status, 'conducted')))).length : 0;
  const reviews = await db.select({ status: academicTeacherReviews.status, submittedAt: academicTeacherReviews.submittedAt }).from(academicTeacherReviews).where(eq(academicTeacherReviews.authorStaffId, staffId as StaffMemberId));
  const inWindow = (d: Date | null) => d !== null && d.toISOString().slice(0, 10) >= window.from && d.toISOString().slice(0, 10) <= window.to;
  // Non-teaching staff (an Ops EOD reader): nothing was there to measure, so the figures are missing, never 0.
  const teaching = sessions.length > 0 || assignments.some((a) => (a.startDate ?? '') <= window.to && (a.endDate ?? '9999') >= window.from);
  const meta = (definition: string) => ({ definition, window, unit: 'count' as const });
  const m = (value: number, definition: string, measured = teaching) => (measured ? metric.ok(value, meta(definition)) : metric.missing('No teaching assignments', meta(definition)));
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
    assignments: assignments.map((a) => ({ batchCode: a.batchCode!, subjectName: a.subjectName, role: a.role, startDate: a.startDate, endDate: a.endDate, batchId: a.batchId!, subjectId: a.subjectId })),
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
      submitted: m(reviews.filter((r) => r.status === 'submitted' && inWindow(r.submittedAt)).length, 'Teacher reviews submitted in the window.', true),
      draft: m(reviews.filter((r) => r.status === 'draft').length, 'Teacher reviews still in draft now (private to the author).', true),
    },
    unavailability,
    topicsCovered: await topicsCovered(db, staffId, window),
    assessments: await assessmentWork(db, staff.userId, window, teaching),
  });
}

/** Chapters of this teacher's verified class records whose class date is in the window, with the number of classes. */
async function topicsCovered(db: Database, staffId: string, window: { from: string; to: string }) {
  const r = academicClassRecords;
  return db
    .select({ batchCode: academicBatches.code, subjectName: academicSubjects.name, chapterTitle: academicChapters.title, classes: countDistinct(r.sessionId) })
    .from(r)
    .innerJoin(academicClassSessions, eq(academicClassSessions.id, r.sessionId))
    .innerJoin(academicBatches, eq(academicBatches.id, r.batchId))
    .innerJoin(academicChapters, eq(academicChapters.id, r.chapterId))
    .innerJoin(academicSubjects, eq(academicSubjects.id, academicChapters.subjectId))
    .where(and(eq(r.teacherStaffId, staffId as StaffMemberId), eq(r.state, 'verified'), gte(academicClassSessions.date, window.from), lte(academicClassSessions.date, window.to)))
    .groupBy(academicBatches.id, academicSubjects.id, academicChapters.id)
    .orderBy(asc(academicBatches.code), asc(academicSubjects.name), asc(academicChapters.sortOrder));
}

/** Assessments created / with marks entered by the teacher's sign-in, timestamps in the IST window. No sign-in or no teaching = missing, never 0. */
async function assessmentWork(db: Database, userId: string | null, window: { from: string; to: string }, teaching: boolean) {
  const meta = (definition: string) => ({ definition, window, unit: 'count' as const });
  const prepared = meta('Assessments created by this teacher’s sign-in in the window (drafted, not necessarily held).');
  const marked = meta('Assessments in which this teacher’s sign-in entered or changed marks in the window.');
  const reason = !userId ? 'No sign-in linked to this staff record' : !teaching ? 'No teaching assignments' : null;
  if (reason) return { prepared: metric.missing(reason, prepared), marked: metric.missing(reason, marked) };
  const from = new Date(`${window.from}T00:00:00+05:30`);
  const to = new Date(`${addDays(window.to as IsoDate, 1)}T00:00:00+05:30`);
  const a = academicAssessments;
  const at = academicAttempts;
  const [made] = await db.select({ n: countDistinct(a.id) }).from(a).where(and(eq(a.createdByUserId, userId as never), gte(a.createdAt, from), lt(a.createdAt, to)));
  const [entered] = await db.select({ n: countDistinct(at.assessmentId) }).from(at).where(and(eq(at.enteredByUserId, userId as never), gte(at.updatedAt, from), lt(at.updatedAt, to)));
  return { prepared: metric.ok(made!.n, prepared), marked: metric.ok(entered!.n, marked) };
}
