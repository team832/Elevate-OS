/**
 * Student progress (ACD-020..022, brief 14–15): four progress dimensions, missed classes,
 * catch-up tasks (prioritised; completing one never changes attendance) and support plans
 * (interventions: evidence → goal → action → responsible → due → review → outcome).
 * Teachers (own scope) see only students in their assigned batches.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  academicAssessments,
  academicAttendance,
  academicBatchPlacements,
  academicBatches,
  academicTeacherReviews,
  academicCatchupTasks,
  academicChapters,
  academicClassSessions,
  academicEnrolments,
  academicInterventions,
  academicResultRuns,
  academicResults,
  academicStudents,
  academicSubjects,
  staffMembers,
  type AcademicCatchupTaskId,
  type AcademicInterventionId,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ForbiddenError, NotFoundError, ValidationError } from '@elevate/shared-contracts';
import { addDays, type BatchId, type IsoDate, type StaffMemberId, type StudentId } from '@elevate/shared-types';
import type { z } from 'zod';
import { assessmentTrend, attendanceDefinition, findMissedClasses, formatMarks, parseMarks, prioritiseCatchup, summariseAttendance, supportSignals, type AttendanceStatus } from '../../domain';
import { assertBatchInScope, assertStudentInScope, audit, getBatchOrThrow, resolveScope, staffIdForUser, studentIdsInScope, todayIst, type Actor } from '../context';
import type { catchupUpdateBody, createInterventionBody, updateInterventionBody } from '../schemas';
import { getBatchCoverage } from './curriculum';
import { assessmentsBetween, rankVisible } from './results';
import { getSetting } from './settings';

type Window = { batchId: string; startDate: string; endDate: string | null };

/** Batch placements of enrolments (R13: placements are the only record of batch membership). */
export async function placementsOf(db: Database, enrolmentIds: readonly string[]) {
  return enrolmentIds.length ? db.select().from(academicBatchPlacements).where(inArray(academicBatchPlacements.enrolmentId, enrolmentIds as never[])) : [];
}

/** True when `date` falls inside one of the placement windows. */
export const inPlacement = (date: string, windows: readonly Omit<Window, 'batchId'>[]) => windows.some((w) => date >= w.startDate && (!w.endDate || date <= w.endDate));

/** Shown instead of 0 for an enrolment with no placement rows (closed before migration 0009 recorded batch history). */
export const NO_BATCH_HISTORY = 'Not recorded — no batch history before 21 Oct 2026';

/** Missed classes in one batch: before the first placement start = late joiner; gaps between placements and after the last end are not the student's classes. */
function missedIn(windows: readonly Window[], held: Awaited<ReturnType<typeof heldSessionsOf>>, marks: readonly { sessionId: string; status: AttendanceStatus }[]) {
  const start = windows.map((w) => w.startDate).sort()[0] ?? null;
  return findMissedClasses(start, held.filter((h) => (start !== null && h.date < start) || inPlacement(h.date, windows)), marks);
}

async function heldSessionsOf(db: Database, batchId: string) {
  return db
    .select({ id: academicClassSessions.id, date: academicClassSessions.date, chapterId: academicClassSessions.plannedChapterId })
    .from(academicClassSessions)
    .where(and(eq(academicClassSessions.batchId, batchId as BatchId), eq(academicClassSessions.status, 'held')));
}

/**
 * Four separate progress dimensions (brief 14), each with its own definition and no combined score:
 * attendance (setting attendance.denominator; delivered sessions within the placement dates, no
 * future or cancelled ones; unmarked = not recorded), batch curriculum coverage (exposure, never
 * mastery), published assessment results (trend only across the same kind, subject and maximum), and
 * teacher observations and support. Support signals are raw facts (supportSignals).
 */
export async function getStudentProgress(db: Database, actor: Actor, studentId: string, now = new Date()) {
  const scope = await resolveScope(db, actor, 'academic:progress:read');
  await assertStudentInScope(db, scope, studentId);
  const [student] = await db.select({ id: academicStudents.id, code: academicStudents.code, fullName: academicStudents.fullName }).from(academicStudents).where(eq(academicStudents.id, studentId as StudentId));
  if (!student) throw new NotFoundError('Student not found.');
  const asOf = todayIst(now);
  const enrolments = await db.select().from(academicEnrolments).where(and(eq(academicEnrolments.studentId, student.id), eq(academicEnrolments.status, 'active')));
  const trendSetting = await getSetting(db, 'progress.trend');
  const trendOptions = trendSetting.value;
  const rule = await getSetting(db, 'attendance.denominator');
  const showRank = await rankVisible(db);
  const placements = await placementsOf(db, enrolments.map((e) => e.id));
  const batches = [];
  const delivered: { date: string; status: AttendanceStatus | null }[] = [];
  for (const e of enrolments) {
    const windows = placements.filter((p) => p.enrolmentId === e.id);
    for (const batchId of [...new Set(windows.map((w) => w.batchId))]) {
      const mine = windows.filter((w) => w.batchId === batchId);
      if (scope.kind === 'own' && !scope.batchIds.includes(batchId)) continue;
      const [batch] = await db.select({ code: academicBatches.code }).from(academicBatches).where(eq(academicBatches.id, batchId));
      const held = (await heldSessionsOf(db, batchId)).filter((h) => h.date <= asOf);
      const placed = held.filter((h) => inPlacement(h.date, mine));
      const marks = held.length
        ? await db.select({ sessionId: academicAttendance.sessionId, status: academicAttendance.status }).from(academicAttendance).where(and(eq(academicAttendance.studentId, student.id), inArray(academicAttendance.sessionId, held.map((h) => h.id))))
        : [];
      const markOf = new Map(marks.map((m) => [m.sessionId as string, m.status]));
      delivered.push(...placed.map((h) => ({ date: h.date, status: markOf.get(h.id) ?? null })));
      const finals = await db
        .select({ r: academicResults, run: academicResultRuns, a: academicAssessments, subject: academicSubjects.name })
        .from(academicResults)
        .innerJoin(academicResultRuns, and(eq(academicResultRuns.id, academicResults.runId), eq(academicResultRuns.status, 'final')))
        .innerJoin(academicAssessments, eq(academicAssessments.id, academicResults.assessmentId))
        .leftJoin(academicSubjects, eq(academicSubjects.id, academicAssessments.subjectId))
        .where(and(eq(academicResults.studentId, student.id), eq(academicAssessments.batchId, batchId)))
        .orderBy(asc(academicAssessments.scheduledDate));
      const results = finals.map(({ r, run, a, subject }) => ({
        assessmentId: a.id,
        code: a.code,
        kind: a.kind,
        subjectId: a.subjectId,
        subject,
        date: a.scheduledDate,
        published: a.publishedAt !== null,
        state: r.state,
        total: r.totalScore,
        max: r.maxScore,
        absent: r.absent,
        resultVersion: run.version,
        rank: showRank ? r.rank : null,
        percentile: showRank ? r.percentile : null,
      }));
      const groups = new Map<string, { label: string; points: { date: string; percent: number }[] }>();
      for (const r of results) {
        const max = parseMarks(r.max)!;
        if (!r.published || r.total === null || !r.date || max <= 0) continue;
        const k = `${r.kind}|${r.subjectId ?? ''}|${r.max}`;
        const g = groups.get(k) ?? { label: `${r.subject ?? 'All subjects'} ${r.kind.replace(/_/g, ' ')} out of ${formatMarks(max)}`, points: [] };
        g.points.push({ date: r.date, percent: (parseMarks(r.total)! / max) * 100 });
        groups.set(k, g);
      }
      const trends = [...groups.values()].map((g) => ({ label: g.label, trend: assessmentTrend(g.points, trendOptions) }));
      let coverage: { completionPercent: number | null; verifiedHours: number; plannedHours: number; note: string } | null = null;
      try {
        const c = await getBatchCoverage(db, actor, batchId, asOf);
        coverage = { completionPercent: c.coverage.course.completionPercent, verifiedHours: c.coverage.course.verifiedHours, plannedHours: c.coverage.course.plannedHours, note: c.note };
      } catch (error) {
        if (!(error instanceof ForbiddenError)) throw error;
      }
      batches.push({
        batchId,
        batchCode: batch?.code ?? null,
        enrolmentId: e.id,
        lateJoiner: e.lateJoiner,
        placements: mine.map((w) => ({ startDate: w.startDate, endDate: w.endDate })),
        attendance: summariseAttendance(placed.map((h) => h.id), marks, rule.value),
        missed: missedIn(mine, held, marks),
        results,
        unpublished: results.filter((r) => !r.published).length,
        trends,
        trend: [...trends].sort((x, y) => y.trend.pointsUsed - x.trend.pointsUsed)[0]?.trend ?? assessmentTrend([], trendOptions),
        coverage,
      });
    }
  }
  const tasks = await db.select().from(academicCatchupTasks).where(eq(academicCatchupTasks.studentId, student.id)).orderBy(desc(academicCatchupTasks.createdAt));
  const interventions = await listInterventions(db, actor, { studentId: student.id });
  const reviews = await db
    .select({ key: academicTeacherReviews.reviewKey, status: academicTeacherReviews.status, submittedAt: academicTeacherReviews.submittedAt })
    .from(academicTeacherReviews)
    .where(and(eq(academicTeacherReviews.academicStudentId, student.id), inArray(academicTeacherReviews.status, ['submitted', 'withdrawn'])));
  const withdrawn = new Set(reviews.filter((r) => r.status === 'withdrawn').map((r) => r.key));
  const submitted = reviews.filter((r) => r.status === 'submitted' && !withdrawn.has(r.key));
  const attendanceNotRecorded = enrolments
    .filter((e) => e.batchId && !placements.some((p) => p.enrolmentId === e.id))
    .map((e) => ({ enrolmentId: e.id, batchId: e.batchId, reason: NO_BATCH_HISTORY }));
  const declining = batches.flatMap((b) => b.trends).find((t) => t.trend.status === 'ok' && t.trend.direction === 'declining');
  return {
    student,
    asOf,
    attendanceRule: { ...rule.value, status: rule.status, definition: attendanceDefinition(rule.value) },
    batches,
    attendanceNotRecorded,
    catchupTasks: tasks,
    interventions,
    observations: { submittedReviews: new Set(submitted.map((r) => r.key)).size, lastSubmittedAt: submitted.map((r) => r.submittedAt!).sort((a, b) => b.getTime() - a.getTime())[0] ?? null },
    signals: supportSignals({
      delivered,
      overdueCatchup: tasks.filter((t) => (t.status === 'open' || t.status === 'in_progress') && t.dueDate !== null && t.dueDate < asOf).length,
      declining: declining && declining.trend.status === 'ok' ? { label: declining.label, slope: declining.trend.slope, pointsUsed: declining.trend.pointsUsed } : null,
    }),
    trendOptions,
    trendStatus: trendSetting.status,
    showRank,
  };
}

/** Create a catch-up task for every missed class of every active enrolment placed in the batch (idempotent; windows by placement). */
export async function generateCatchupTasks(db: Database, actor: Actor, batchId: string) {
  return withTransaction(db, async (tx) => {
    const batch = await getBatchOrThrow(tx, batchId);
    const held = await heldSessionsOf(tx, batch.id);
    const placed = await tx
      .select({ p: academicBatchPlacements, studentId: academicEnrolments.studentId })
      .from(academicBatchPlacements)
      .innerJoin(academicEnrolments, eq(academicEnrolments.id, academicBatchPlacements.enrolmentId))
      .where(and(eq(academicBatchPlacements.batchId, batch.id), eq(academicEnrolments.status, 'active')));
    const enrolments = [...new Map(placed.map((x) => [x.p.enrolmentId as string, { id: x.p.enrolmentId, studentId: x.studentId }])).values()];
    let created = 0;
    for (const e of enrolments) {
      const marks = held.length
        ? await tx.select({ sessionId: academicAttendance.sessionId, status: academicAttendance.status }).from(academicAttendance).where(and(eq(academicAttendance.studentId, e.studentId), inArray(academicAttendance.sessionId, held.map((h) => h.id))))
        : [];
      const { missed } = missedIn(placed.filter((x) => x.p.enrolmentId === e.id).map((x) => x.p), held, marks);
      if (missed.length === 0) continue;
      const rows = await tx
        .insert(academicCatchupTasks)
        .values(missed.map((m) => ({ studentId: e.studentId, enrolmentId: e.id, batchId: batch.id, sessionId: m.sessionId as never, chapterId: (m.chapterId as never) ?? null, reason: m.reason, createdByUserId: actor.user.id })))
        .onConflictDoNothing({ target: [academicCatchupTasks.enrolmentId, academicCatchupTasks.sessionId] })
        .returning({ id: academicCatchupTasks.id });
      created += rows.length;
    }
    await audit(tx, actor, { action: 'catchup.generated', entityType: 'batch', entityId: batch.id, after: { created } });
    return { created };
  });
}

/** Prioritised catch-up list for a batch (deterministic; every factor explained). */
export async function listCatchup(db: Database, actor: Actor, batchId: string, now = new Date()) {
  const scope = await resolveScope(db, actor, 'academic:progress:read');
  assertBatchInScope(scope, batchId);
  const asOf = todayIst(now);
  const weights = (await getSetting(db, 'catchup.weights')).value;
  const rows = await db
    .select({ task: academicCatchupTasks, sessionDate: academicClassSessions.date, chapterCode: academicChapters.code, chapterWeight: academicChapters.weight, studentName: academicStudents.fullName, studentCode: academicStudents.code })
    .from(academicCatchupTasks)
    .innerJoin(academicClassSessions, eq(academicClassSessions.id, academicCatchupTasks.sessionId))
    .innerJoin(academicStudents, eq(academicStudents.id, academicCatchupTasks.studentId))
    .leftJoin(academicChapters, eq(academicChapters.id, academicCatchupTasks.chapterId))
    .where(eq(academicCatchupTasks.batchId, batchId as BatchId));
  const upcoming = await assessmentsBetween(db, [batchId], asOf, addDays(asOf as IsoDate, weights.horizonDays));
  const ranked = prioritiseCatchup(
    rows.map((r) => ({ id: r.task.id, studentId: r.task.studentId, sessionDate: r.sessionDate, chapterId: r.task.chapterId, chapterWeight: r.chapterWeight, status: r.task.status })),
    upcoming.map((a) => ({ id: a.id, label: a.code, date: a.scheduledDate!, chapterIds: a.chapterIds })),
    asOf,
    weights,
  );
  const byId = new Map(rows.map((r) => [r.task.id as string, r]));
  return {
    asOf,
    weights,
    ranked: ranked.map((r) => {
      const row = byId.get(r.taskId)!;
      return { ...r, task: row.task, sessionDate: row.sessionDate, chapterCode: row.chapterCode, studentName: row.studentName, studentCode: row.studentCode };
    }),
    closed: rows.filter((r) => r.task.status === 'done' || r.task.status === 'cancelled').length,
  };
}

export async function updateCatchupTask(db: Database, actor: Actor, taskId: string, input: z.output<typeof catchupUpdateBody>) {
  return withTransaction(db, async (tx) => {
    const [task] = await tx.select().from(academicCatchupTasks).where(eq(academicCatchupTasks.id, taskId as AcademicCatchupTaskId)).for('update');
    if (!task) throw new NotFoundError('Catch-up task not found.');
    const [row] = await tx
      .update(academicCatchupTasks)
      .set({
        ...(input.status ? { status: input.status, completedAt: input.status === 'done' ? new Date() : null } : {}),
        ...(input.assignedStaffId !== undefined ? { assignedStaffId: input.assignedStaffId as StaffMemberId | null } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      })
      .where(eq(academicCatchupTasks.id, task.id))
      .returning();
    await audit(tx, actor, { action: 'catchup.updated', entityType: 'catchup_task', entityId: task.id, before: task, after: row });
    return row!;
  });
}

// --- interventions -------------------------------------------------------------------------------

/** Support plans; `responsible: 'me'` = the items the signed-in staff member must act on next. */
export async function listInterventions(db: Database, actor: Actor, filter: { studentId?: string; responsible?: 'me' } = {}) {
  const scope = await resolveScope(db, actor, 'academic:progress:read');
  const visible = await studentIdsInScope(db, scope);
  if (visible && visible.length === 0) return [];
  const conditions = [];
  if (filter.responsible === 'me') {
    const me = await staffIdForUser(db, actor.user.id);
    if (!me) return [];
    conditions.push(eq(academicInterventions.responsibleStaffId, me));
  }
  if (visible) conditions.push(inArray(academicInterventions.studentId, visible));
  if (filter.studentId) conditions.push(eq(academicInterventions.studentId, filter.studentId as StudentId));
  const rows = await db
    .select({ i: academicInterventions, studentName: academicStudents.fullName, studentCode: academicStudents.code, responsibleName: staffMembers.fullName })
    .from(academicInterventions)
    .innerJoin(academicStudents, eq(academicStudents.id, academicInterventions.studentId))
    .innerJoin(staffMembers, eq(staffMembers.id, academicInterventions.responsibleStaffId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(academicInterventions.status), asc(academicInterventions.dueDate));
  return rows.map((r) => ({ ...r.i, studentName: r.studentName, studentCode: r.studentCode, responsibleName: r.responsibleName }));
}

export async function createIntervention(db: Database, actor: Actor, input: z.output<typeof createInterventionBody>) {
  return withTransaction(db, async (tx) => {
    const [student] = await tx.select({ id: academicStudents.id }).from(academicStudents).where(eq(academicStudents.id, input.studentId as StudentId));
    if (!student) throw new ValidationError('Student not found.');
    const [staff] = await tx.select().from(staffMembers).where(eq(staffMembers.id, input.responsibleStaffId as StaffMemberId));
    if (!staff || staff.status === 'inactive') throw new ValidationError('The responsible staff member does not exist or is inactive.');
    if (input.batchId) await getBatchOrThrow(tx, input.batchId);
    const [row] = await tx
      .insert(academicInterventions)
      .values({ studentId: student.id, batchId: (input.batchId as BatchId | undefined) ?? null, trigger: input.trigger, description: input.description, evidence: input.evidence ?? null, goal: input.goal ?? null, responsibleStaffId: staff.id, action: input.action, dueDate: input.dueDate ?? null, reviewOn: input.reviewOn ?? null, createdByUserId: actor.user.id })
      .returning();
    await audit(tx, actor, { action: 'intervention.created', entityType: 'intervention', entityId: row!.id, after: row });
    return row!;
  });
}

export async function updateIntervention(db: Database, actor: Actor, id: string, input: z.output<typeof updateInterventionBody>) {
  return withTransaction(db, async (tx) => {
    const [current] = await tx.select().from(academicInterventions).where(eq(academicInterventions.id, id as AcademicInterventionId)).for('update');
    if (!current) throw new NotFoundError('Intervention not found.');
    const status = input.status ?? current.status;
    const outcome = input.outcome ?? current.outcome;
    if ((status === 'resolved' || status === 'closed') && !outcome) throw new ValidationError('Record the outcome before resolving or closing an intervention.');
    if (input.responsibleStaffId) {
      const [staff] = await tx.select({ status: staffMembers.status }).from(staffMembers).where(eq(staffMembers.id, input.responsibleStaffId as StaffMemberId));
      if (!staff || staff.status === 'inactive') throw new ValidationError('The responsible staff member does not exist or is inactive.');
    }
    const { status: _s, outcome: _o, ...plan } = input;
    const [row] = await tx
      .update(academicInterventions)
      .set({ ...plan, responsibleStaffId: (input.responsibleStaffId as StaffMemberId | undefined) ?? current.responsibleStaffId, status, outcome, resolvedAt: status === 'resolved' || status === 'closed' ? (current.resolvedAt ?? new Date()) : null })
      .where(eq(academicInterventions.id, current.id))
      .returning();
    await audit(tx, actor, { action: 'intervention.updated', entityType: 'intervention', entityId: current.id, before: current, after: row });
    return row!;
  });
}
