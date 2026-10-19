/**
 * Student progress (ACD-020..022): attendance summary, assessment trend,
 * missed classes, catch-up tasks (prioritised) and interventions.
 * Teachers (own scope) see only students in their assigned batches.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  academicAssessments,
  academicAttendance,
  academicCatchupTasks,
  academicChapters,
  academicClassSessions,
  academicEnrolments,
  academicInterventions,
  academicResultRuns,
  academicResults,
  academicStudents,
  staffMembers,
  type AcademicCatchupTaskId,
  type AcademicInterventionId,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { NotFoundError, ValidationError } from '@elevate/shared-contracts';
import { addDays, type BatchId, type IsoDate, type StaffMemberId, type StudentId } from '@elevate/shared-types';
import type { z } from 'zod';
import { assessmentTrend, findMissedClasses, parseMarks, prioritiseCatchup, summariseAttendance } from '../../domain';
import { assertBatchInScope, assertStudentInScope, audit, getBatchOrThrow, resolveScope, studentIdsInScope, todayIst, type Actor } from '../context';
import type { catchupUpdateBody, createInterventionBody, updateInterventionBody } from '../schemas';
import { assessmentsBetween } from './results';
import { getSetting } from './settings';

async function heldSessionsOf(db: Database, batchId: string) {
  return db
    .select({ id: academicClassSessions.id, date: academicClassSessions.date, chapterId: academicClassSessions.plannedChapterId })
    .from(academicClassSessions)
    .where(and(eq(academicClassSessions.batchId, batchId as BatchId), eq(academicClassSessions.status, 'held')));
}

export async function getStudentProgress(db: Database, actor: Actor, studentId: string) {
  const scope = await resolveScope(db, actor, 'academic:progress:read');
  await assertStudentInScope(db, scope, studentId);
  const [student] = await db.select({ id: academicStudents.id, code: academicStudents.code, fullName: academicStudents.fullName }).from(academicStudents).where(eq(academicStudents.id, studentId as StudentId));
  if (!student) throw new NotFoundError('Student not found.');
  const enrolments = await db.select().from(academicEnrolments).where(and(eq(academicEnrolments.studentId, student.id), eq(academicEnrolments.status, 'active')));
  const trendOptions = (await getSetting(db, 'progress.trend')).value;
  const batches = [];
  for (const e of enrolments) {
    if (!e.batchId) continue;
    if (scope.kind === 'own' && !scope.batchIds.includes(e.batchId)) continue;
    const held = await heldSessionsOf(db, e.batchId);
    const marks = held.length
      ? await db.select({ sessionId: academicAttendance.sessionId, status: academicAttendance.status }).from(academicAttendance).where(and(eq(academicAttendance.studentId, student.id), inArray(academicAttendance.sessionId, held.map((h) => h.id))))
      : [];
    const attendanceSessions = held.filter((h) => !e.startDate || h.date >= e.startDate);
    const results = await db
      .select({ code: academicAssessments.code, date: academicAssessments.scheduledDate, total: academicResults.totalScore, max: academicResults.maxScore, absent: academicResults.absent, percentile: academicResults.percentile })
      .from(academicResults)
      .innerJoin(academicResultRuns, and(eq(academicResultRuns.id, academicResults.runId), eq(academicResultRuns.status, 'final')))
      .innerJoin(academicAssessments, eq(academicAssessments.id, academicResults.assessmentId))
      .where(and(eq(academicResults.studentId, student.id), eq(academicAssessments.batchId, e.batchId)))
      .orderBy(asc(academicAssessments.scheduledDate));
    const points = results
      .filter((r) => !r.absent && r.total !== null && r.date && parseMarks(r.max)! > 0)
      .map((r) => ({ date: r.date!, percent: (parseMarks(r.total)! / parseMarks(r.max)!) * 100 }));
    batches.push({
      batchId: e.batchId,
      enrolmentId: e.id,
      lateJoiner: e.lateJoiner,
      attendance: summariseAttendance(attendanceSessions.map((h) => h.id), marks),
      missed: findMissedClasses(e.startDate, held, marks),
      results,
      trend: assessmentTrend(points, trendOptions),
    });
  }
  const tasks = await db.select().from(academicCatchupTasks).where(eq(academicCatchupTasks.studentId, student.id)).orderBy(desc(academicCatchupTasks.createdAt));
  const interventions = await listInterventions(db, actor, { studentId: student.id });
  return { student, batches, catchupTasks: tasks, interventions, trendOptions };
}

/** Create a catch-up task for every missed class of every active enrolment in the batch (idempotent). */
export async function generateCatchupTasks(db: Database, actor: Actor, batchId: string) {
  return withTransaction(db, async (tx) => {
    const batch = await getBatchOrThrow(tx, batchId);
    const held = await heldSessionsOf(tx, batch.id);
    const enrolments = await tx.select().from(academicEnrolments).where(and(eq(academicEnrolments.batchId, batch.id), eq(academicEnrolments.status, 'active')));
    let created = 0;
    for (const e of enrolments) {
      const marks = held.length
        ? await tx.select({ sessionId: academicAttendance.sessionId, status: academicAttendance.status }).from(academicAttendance).where(and(eq(academicAttendance.studentId, e.studentId), inArray(academicAttendance.sessionId, held.map((h) => h.id))))
        : [];
      const { missed } = findMissedClasses(e.startDate, held, marks);
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

export async function listInterventions(db: Database, actor: Actor, filter: { studentId?: string } = {}) {
  const scope = await resolveScope(db, actor, 'academic:progress:read');
  const visible = await studentIdsInScope(db, scope);
  if (visible && visible.length === 0) return [];
  const conditions = [];
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
      .values({ studentId: student.id, batchId: (input.batchId as BatchId | undefined) ?? null, trigger: input.trigger, description: input.description, responsibleStaffId: staff.id, action: input.action, dueDate: input.dueDate ?? null, createdByUserId: actor.user.id })
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
    const [row] = await tx
      .update(academicInterventions)
      .set({ status, outcome, parentContactStatus: input.parentContactStatus ?? current.parentContactStatus, action: input.action ?? current.action, resolvedAt: status === 'resolved' || status === 'closed' ? (current.resolvedAt ?? new Date()) : null })
      .where(eq(academicInterventions.id, current.id))
      .returning();
    await audit(tx, actor, { action: 'intervention.updated', entityType: 'intervention', entityId: current.id, before: current, after: row });
    return row!;
  });
}
