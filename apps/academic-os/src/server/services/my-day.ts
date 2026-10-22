/**
 * Role home figures (brief §4). Teacher "My day": next class first, then outstanding work.
 * Coordinator: planned vs delivered vs cancelled vs not-yet-recorded, uncovered classes,
 * conflicts, missing attendance/logs, awaiting-batch enrolments, pending marking. Every
 * figure carries the date range it counts; missing is never zero; delivery ≠ attendance ≠
 * log (R12). HR attendance has no source (R2), so it is always "HR attendance unavailable".
 */
import { and, count, eq, gte, inArray, isNull, notExists, or } from 'drizzle-orm';
import {
  academicAssessments,
  academicAttendance,
  academicBatchPlacements,
  academicClassRecords,
  academicEnrolments,
  academicInterventions,
  academicSessionDemoAttendees,
  academicStudents,
  academicTeacherReviews,
  type Database,
} from '@elevate/database';
import { can } from '@elevate/authorization';
import { addDays, type BatchId, type IsoDate } from '@elevate/shared-types';
import { parseClock } from '../../domain';
import { resolveScope, todayIst, type Actor } from '../context';
import { listBatches } from './batches';
import { getBatchCoverage } from './curriculum';
import { listInterventions } from './progress';
import { checkTimetableFor, listSessions, weekRange, type SessionListRow } from './timetable';
import { uncoveredSessions } from './unavailability';

export const HR_UNAVAILABLE = 'HR attendance unavailable';
export const LOOKBACK_DAYS = 13;

/** Minutes after midnight now, Asia/Kolkata. */
export function istMinutes(now: Date): number {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(':').map(Number);
  return h! * 60 + m!;
}

const isLive = (s: { status: string }) => s.status === 'scheduled' || s.status === 'held';
const hasEnded = (s: { date: string; startTime: string; durationMinutes: number }, today: string, nowMin: number) => s.date < today || (s.date === today && (parseClock(s.startTime) ?? 0) + s.durationMinutes <= nowMin);

/** Per session: placed students without a mark, and whether a submitted/verified class record exists. */
export async function sessionWork(db: Database, sessions: readonly Pick<SessionListRow, 'id' | 'batchId' | 'date'>[]) {
  if (sessions.length === 0) return new Map<string, { attendanceMissing: number; logSubmitted: boolean }>();
  const ids = sessions.map((s) => s.id);
  const placements = await db
    .select({ studentId: academicEnrolments.studentId, batchId: academicBatchPlacements.batchId, from: academicBatchPlacements.startDate, to: academicBatchPlacements.endDate })
    .from(academicBatchPlacements)
    .innerJoin(academicEnrolments, eq(academicEnrolments.id, academicBatchPlacements.enrolmentId))
    .where(inArray(academicBatchPlacements.batchId, [...new Set(sessions.map((s) => s.batchId))] as BatchId[]));
  const marks = await db.select({ sessionId: academicAttendance.sessionId, studentId: academicAttendance.studentId }).from(academicAttendance).where(inArray(academicAttendance.sessionId, ids));
  const logged = new Set((await db.selectDistinct({ sessionId: academicClassRecords.sessionId }).from(academicClassRecords).where(and(inArray(academicClassRecords.sessionId, ids), inArray(academicClassRecords.state, ['submitted', 'verified'])))).map((r) => r.sessionId as string));
  return new Map(
    sessions.map((s) => {
      const marked = new Set(marks.filter((m) => m.sessionId === s.id).map((m) => m.studentId as string));
      const placed = placements.filter((p) => p.batchId === s.batchId && p.from <= s.date && (p.to === null || p.to >= s.date));
      return [s.id as string, { attendanceMissing: placed.filter((p) => !marked.has(p.studentId)).length, logSubmitted: logged.has(s.id) }];
    }),
  );
}

export async function teacherDay(db: Database, actor: Actor, now = new Date()) {
  const scope = await resolveScope(db, actor, 'academic:timetable:read');
  const today = todayIst(now);
  const window = { from: addDays(today as IsoDate, -LOOKBACK_DAYS) as string, to: today };
  if (scope.kind !== 'own' || !scope.staffId) return { kind: 'no_staff' as const, today, window };
  const staffId = scope.staffId;
  const nowMin = istMinutes(now);
  const sessions = await listSessions(db, actor, window);
  const todays = sessions.filter((s) => s.date === today && s.status !== 'rescheduled');
  const next = todays.find((s) => s.status === 'scheduled' && !hasEnded(s, today, nowMin)) ?? null;
  const past = sessions.filter((s) => isLive(s) && hasEnded(s, today, nowMin));
  const work = await sessionWork(db, past);
  const demoRows = past.length
    ? await db
        .select()
        .from(academicSessionDemoAttendees)
        .where(and(inArray(academicSessionDemoAttendees.sessionId, past.map((s) => s.id)), inArray(academicSessionDemoAttendees.status, ['present', 'late'])))
    : [];
  const ownReviews = await db
    .select({ id: academicTeacherReviews.opsDemoSessionId, status: academicTeacherReviews.status })
    .from(academicTeacherReviews)
    .where(and(eq(academicTeacherReviews.authorStaffId, staffId), inArray(academicTeacherReviews.status, ['submitted', 'draft'])));
  const reviewed = new Set(ownReviews.filter((r) => r.status === 'submitted').map((r) => r.id));
  const assessments = scope.batchIds.length
    ? await db.select().from(academicAssessments).where(and(inArray(academicAssessments.batchId, scope.batchIds), eq(academicAssessments.status, 'conducted')))
    : [];
  const support = await db
    .select({ intervention: academicInterventions, studentName: academicStudents.fullName })
    .from(academicInterventions)
    .innerJoin(academicStudents, eq(academicStudents.id, academicInterventions.studentId))
    .where(and(eq(academicInterventions.responsibleStaffId, staffId), inArray(academicInterventions.status, ['open', 'in_progress'])));
  return {
    kind: 'teacher' as const,
    staffId,
    today,
    window,
    next,
    batches: can(actor.user, 'academic:batches:read') ? await listBatches(db, actor) : [],
    draftReviews: ownReviews.filter((r) => r.status === 'draft').length,
    todays: todays.filter((s) => s.id !== next?.id),
    attendanceMissing: past.filter((s) => (work.get(s.id)?.attendanceMissing ?? 0) > 0).map((s) => ({ ...s, missing: work.get(s.id)!.attendanceMissing })),
    logsMissing: past.filter((s) => !work.get(s.id)?.logSubmitted),
    demoAwaitingFeedback: demoRows.filter((d) => !reviewed.has(d.opsDemoSessionId)).map((d) => ({ ...d, session: past.find((s) => s.id === d.sessionId)! })),
    assessmentsToMark: assessments,
    support: support.map((r) => ({ ...r.intervention, studentName: r.studentName, due: r.intervention.dueDate !== null && r.intervention.dueDate <= today })),
    hrAttendance: HR_UNAVAILABLE,
  };
}

/** Student class-attendance worklist (not staff attendance): classes in scope from the last two weeks to today, newest first. */
export async function attendanceWorklist(db: Database, actor: Actor, now = new Date()) {
  const today = todayIst(now);
  const window = { from: addDays(today as IsoDate, -LOOKBACK_DAYS) as string, to: today };
  const nowMin = istMinutes(now);
  const sessions = (await listSessions(db, actor, window)).filter(isLive).reverse();
  const work = await sessionWork(db, sessions);
  return { today, window, rows: sessions.map((s) => ({ ...s, ended: hasEnded(s, today, nowMin), unmarked: work.get(s.id)!.attendanceMissing })) };
}

export async function coordinatorOverview(db: Database, actor: Actor, now = new Date()) {
  await resolveScope(db, actor, 'academic:timetable:read');
  const today = todayIst(now);
  const nowMin = istMinutes(now);
  const week = weekRange({ from: today, to: today });
  const sessions = await listSessions(db, actor, week);
  const figures = (range: { from: string; to: string }) => {
    const list = sessions.filter((s) => s.date >= range.from && s.date <= range.to);
    return {
      range,
      planned: list.filter(isLive).length,
      delivered: list.filter((s) => s.status === 'held').length,
      cancelled: list.filter((s) => s.status === 'cancelled').length,
      notRecorded: list.filter((s) => s.status === 'scheduled' && hasEnded(s, today, nowMin)).length,
    };
  };
  const past = sessions.filter((s) => isLive(s) && hasEnded(s, today, nowMin));
  const work = await sessionWork(db, past);
  const horizon = { from: today, to: addDays(today as IsoDate, LOOKBACK_DAYS) as string };
  const conflicts = await checkTimetableFor(db, actor, { from: week.from, to: week.to, candidates: [] });
  const [{ awaiting } = { awaiting: 0 }] = await db
    .select({ awaiting: count() })
    .from(academicEnrolments)
    .where(
      and(
        eq(academicEnrolments.status, 'active'),
        notExists(db.select({ id: academicBatchPlacements.id }).from(academicBatchPlacements).where(and(eq(academicBatchPlacements.enrolmentId, academicEnrolments.id), or(isNull(academicBatchPlacements.endDate), gte(academicBatchPlacements.endDate, today))))),
      ),
    );
  const [{ marking } = { marking: 0 }] = await db.select({ marking: count() }).from(academicAssessments).where(eq(academicAssessments.status, 'conducted'));
  // Planned vs taught chapters per active batch (A3's coverage read: first-teaching logs only, never mastery).
  const coverage = [];
  for (const b of (await listBatches(db, actor)).filter((x) => x.status === 'active')) {
    const c = await getBatchCoverage(db, actor, b.id, today);
    coverage.push({ batchId: b.id, code: b.code, hasPlan: c.plan !== null, chaptersPlanned: c.coverage.course.chaptersPlanned, chaptersTaught: c.coverage.course.chaptersTaught });
  }
  const openSupport = (await listInterventions(db, actor)).filter((i) => i.status === 'open' || i.status === 'in_progress').length;
  return {
    today,
    week,
    todayFigures: figures({ from: today, to: today }),
    weekFigures: figures(week),
    uncovered: { range: horizon, sessions: await uncoveredSessions(db, actor, horizon) },
    conflicts: { range: week, hard: conflicts.hard.length },
    attendanceMissing: { range: { from: week.from, to: today }, count: past.filter((s) => (work.get(s.id)?.attendanceMissing ?? 0) > 0).length },
    // Same definition as the teaching-log exceptions list: delivered, no submitted log.
    logsMissing: { range: { from: week.from, to: today }, count: past.filter((s) => s.status === 'held' && !work.get(s.id)?.logSubmitted).length },
    awaitingBatch: Number(awaiting),
    pendingMarking: Number(marking),
    coverage,
    openSupport,
  };
}

