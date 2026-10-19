/**
 * Teaching operations (ACD-007, ACD-014): class records (teaching log) with
 * coordinator verification and audited corrections, and attendance.
 *
 * Own scope: a teacher logs and reads ONLY sessions whose teacher is their own
 * staff record. Corrections never overwrite: the original row is kept (state
 * `superseded`) and a new verified row references it with a reason.
 */
import { and, asc, desc, eq, inArray, isNull, lte, or, gte } from 'drizzle-orm';
import {
  academicAttendance,
  academicBatches,
  academicChapters,
  academicClassRecords,
  academicClassSessions,
  academicEnrolments,
  academicStudents,
  staffMembers,
  type AcademicClassRecordId,
  type AcademicSessionId,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, InvalidStateTransitionError, NotFoundError, ValidationError } from '@elevate/shared-contracts';
import type { BatchId } from '@elevate/shared-types';
import type { z } from 'zod';
import { assertSessionInScope, audit, resolveScope, todayIst, type Actor } from '../context';
import type { attendanceBody, correctClassBody, recordClassBody } from '../schemas';

async function lockSession(tx: Database, sessionId: string) {
  const [session] = await tx.select().from(academicClassSessions).where(eq(academicClassSessions.id, sessionId as AcademicSessionId)).for('update');
  if (!session) throw new NotFoundError('Session not found.');
  return session;
}

function assertLoggable(session: { status: string; date: string }, today: string) {
  if (session.status === 'cancelled' || session.status === 'rescheduled') {
    throw new InvalidStateTransitionError(`The session was ${session.status}; record the replacement session instead.`);
  }
  if (session.date > today) throw new ValidationError('A session cannot be logged before it happens.');
}

export async function recordClass(db: Database, actor: Actor, input: z.output<typeof recordClassBody>, now = new Date()) {
  const scope = await resolveScope(db, actor, 'academic:classes:record');
  return withTransaction(db, async (tx) => {
    const session = await lockSession(tx, input.sessionId);
    assertSessionInScope(scope, session);
    assertLoggable(session, todayIst(now));
    if (!session.teacherStaffId) throw new ValidationError('Assign a teacher to the session before logging it.');
    const [chapter] = await tx.select().from(academicChapters).where(eq(academicChapters.id, input.chapterId as never));
    const [batch] = await tx.select().from(academicBatches).where(eq(academicBatches.id, session.batchId));
    if (!chapter || chapter.courseId !== batch!.courseId) throw new ValidationError('The chapter is not part of the batch’s course.');
    if (chapter.status !== 'active') throw new ValidationError('Retired or moved chapters cannot be logged; use their alias.');
    const [existing] = await tx
      .select({ id: academicClassRecords.id })
      .from(academicClassRecords)
      .where(and(eq(academicClassRecords.sessionId, session.id), eq(academicClassRecords.chapterId, chapter.id), inArray(academicClassRecords.state, ['submitted', 'verified'])));
    if (existing) throw new ConflictError('This chapter is already logged for the session; ask the coordinator for a correction.');
    const [record] = await tx
      .insert(academicClassRecords)
      .values({
        sessionId: session.id,
        batchId: session.batchId,
        chapterId: chapter.id,
        teacherStaffId: session.teacherStaffId,
        activity: input.activity,
        completion: input.completion,
        actualMinutes: input.actualMinutes,
        notes: input.notes ?? null,
        evidence: input.evidence ?? null,
        recordedByUserId: actor.user.id,
      })
      .returning();
    if (session.status === 'scheduled') {
      await tx.update(academicClassSessions).set({ status: 'held' }).where(eq(academicClassSessions.id, session.id));
      await audit(tx, actor, { action: 'class_session.held', entityType: 'class_session', entityId: session.id, before: { status: session.status }, after: { status: 'held' } });
    }
    await audit(tx, actor, { action: 'class_record.submitted', entityType: 'class_record', entityId: record!.id, after: record });
    return record!;
  });
}

export async function listClassRecords(db: Database, actor: Actor, filter: { batchId?: string; state?: 'submitted' | 'verified' | 'superseded' }) {
  const scope = await resolveScope(db, actor, 'academic:classes:read');
  if (scope.kind === 'own' && !scope.staffId) return [];
  const conditions = [];
  if (filter.batchId) conditions.push(eq(academicClassRecords.batchId, filter.batchId as BatchId));
  if (filter.state) conditions.push(eq(academicClassRecords.state, filter.state));
  if (scope.kind === 'own') conditions.push(eq(academicClassSessions.teacherStaffId, scope.staffId!));
  const rows = await db
    .select({
      record: academicClassRecords,
      sessionDate: academicClassSessions.date,
      sessionStart: academicClassSessions.startTime,
      plannedMinutes: academicClassSessions.durationMinutes,
      batchCode: academicBatches.code,
      chapterCode: academicChapters.code,
      chapterTitle: academicChapters.title,
      teacherName: staffMembers.fullName,
    })
    .from(academicClassRecords)
    .innerJoin(academicClassSessions, eq(academicClassSessions.id, academicClassRecords.sessionId))
    .innerJoin(academicBatches, eq(academicBatches.id, academicClassRecords.batchId))
    .innerJoin(academicChapters, eq(academicChapters.id, academicClassRecords.chapterId))
    .innerJoin(staffMembers, eq(staffMembers.id, academicClassRecords.teacherStaffId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(academicClassSessions.date), asc(academicClassRecords.recordedAt))
    .limit(500);
  return rows.map((r) => ({ ...r.record, sessionDate: r.sessionDate, sessionStart: r.sessionStart, plannedMinutes: r.plannedMinutes, batchCode: r.batchCode, chapterCode: r.chapterCode, chapterTitle: r.chapterTitle, teacherName: r.teacherName }));
}

/** Coordinator verifies a submitted record; verified-by/at are fixed once set. */
export async function verifyClassRecord(db: Database, actor: Actor, recordId: string) {
  return withTransaction(db, async (tx) => {
    const [record] = await tx.select().from(academicClassRecords).where(eq(academicClassRecords.id, recordId as AcademicClassRecordId)).for('update');
    if (!record) throw new NotFoundError('Class record not found.');
    if (record.state !== 'submitted') throw new InvalidStateTransitionError(`Only a submitted record can be verified (it is ${record.state}).`);
    const [row] = await tx
      .update(academicClassRecords)
      .set({ state: 'verified', verifiedByUserId: actor.user.id, verifiedAt: new Date() })
      .where(and(eq(academicClassRecords.id, record.id), eq(academicClassRecords.state, 'submitted')))
      .returning();
    await audit(tx, actor, { action: 'class_record.verified', entityType: 'class_record', entityId: record.id, before: record, after: row });
    return row!;
  });
}

/**
 * Coordinator correction: the original keeps its content and becomes `superseded`;
 * a new `verified` record (corrects_record_id, correction_reason) replaces it.
 */
export async function correctClassRecord(db: Database, actor: Actor, recordId: string, input: z.output<typeof correctClassBody>) {
  return withTransaction(db, async (tx) => {
    const [original] = await tx.select().from(academicClassRecords).where(eq(academicClassRecords.id, recordId as AcademicClassRecordId)).for('update');
    if (!original) throw new NotFoundError('Class record not found.');
    if (original.state === 'superseded') throw new InvalidStateTransitionError('This record was already corrected; correct the current version.');
    if (input.chapterId && input.chapterId !== original.chapterId) {
      const [chapter] = await tx.select().from(academicChapters).where(eq(academicChapters.id, input.chapterId as never));
      const [batch] = await tx.select().from(academicBatches).where(eq(academicBatches.id, original.batchId));
      if (!chapter || chapter.courseId !== batch!.courseId || chapter.status !== 'active') throw new ValidationError('The corrected chapter must be an active chapter of the batch’s course.');
    }
    const now = new Date();
    const [superseded] = await tx.update(academicClassRecords).set({ state: 'superseded', supersededAt: now }).where(eq(academicClassRecords.id, original.id)).returning();
    const [corrected] = await tx
      .insert(academicClassRecords)
      .values({
        sessionId: original.sessionId,
        batchId: original.batchId,
        chapterId: (input.chapterId as never) ?? original.chapterId,
        teacherStaffId: original.teacherStaffId,
        activity: input.activity ?? original.activity,
        completion: input.completion ?? original.completion,
        actualMinutes: input.actualMinutes ?? original.actualMinutes,
        notes: input.notes ?? original.notes,
        evidence: original.evidence,
        state: 'verified',
        correctsRecordId: original.id,
        correctionReason: input.reason,
        recordedByUserId: actor.user.id,
        verifiedByUserId: actor.user.id,
        verifiedAt: now,
      })
      .returning();
    await audit(tx, actor, { action: 'class_record.corrected', entityType: 'class_record', entityId: original.id, before: original, after: corrected, metadata: { reason: input.reason, supersededAt: superseded!.supersededAt, correctionId: corrected!.id } });
    return { original: superseded!, correction: corrected! };
  });
}

// --- attendance ------------------------------------------------------------------------------------

/** Students expected in a session: active enrolment in the batch that had started by the session date. */
async function rosterFor(db: Database, session: { batchId: string; date: string }) {
  return db
    .select({ studentId: academicStudents.id, code: academicStudents.code, fullName: academicStudents.fullName, enrolmentId: academicEnrolments.id })
    .from(academicEnrolments)
    .innerJoin(academicStudents, eq(academicStudents.id, academicEnrolments.studentId))
    .where(
      and(
        eq(academicEnrolments.batchId, session.batchId as BatchId),
        eq(academicEnrolments.status, 'active'),
        or(isNull(academicEnrolments.startDate), lte(academicEnrolments.startDate, session.date)),
      ),
    )
    .orderBy(asc(academicStudents.fullName));
}

export async function getSessionAttendance(db: Database, actor: Actor, sessionId: string) {
  const scope = await resolveScope(db, actor, 'academic:attendance:read');
  const [session] = await db.select().from(academicClassSessions).where(eq(academicClassSessions.id, sessionId as AcademicSessionId));
  if (!session) throw new NotFoundError('Session not found.');
  assertSessionInScope(scope, session);
  const roster = await rosterFor(db, session);
  const marks = await db.select().from(academicAttendance).where(eq(academicAttendance.sessionId, session.id));
  const byStudent = new Map(marks.map((m) => [m.studentId, m]));
  return {
    session,
    roster: roster.map((r) => ({ ...r, mark: byStudent.get(r.studentId) ?? null })),
    recorded: marks.length,
    notRecorded: roster.filter((r) => !byStudent.has(r.studentId)).length,
  };
}

export async function recordAttendance(db: Database, actor: Actor, sessionId: string, input: z.output<typeof attendanceBody>, now = new Date()) {
  const scope = await resolveScope(db, actor, 'academic:attendance:record');
  return withTransaction(db, async (tx) => {
    const session = await lockSession(tx, sessionId);
    assertSessionInScope(scope, session);
    assertLoggable(session, todayIst(now));
    const roster = new Set((await rosterFor(tx, session)).map((r) => r.studentId as string));
    const ids = input.marks.map((m) => m.studentId);
    if (new Set(ids).size !== ids.length) throw new ValidationError('A student appears twice in the attendance list.');
    const outsiders = ids.filter((id) => !roster.has(id));
    if (outsiders.length > 0) throw new ValidationError('Some students are not enrolled in this batch for the session date.', { details: { studentIds: outsiders } });
    const before = await tx.select().from(academicAttendance).where(eq(academicAttendance.sessionId, session.id));
    for (const m of input.marks) {
      await tx
        .insert(academicAttendance)
        .values({ sessionId: session.id, studentId: m.studentId as never, status: m.status, minutesPresent: m.minutesPresent ?? null, note: m.note ?? null, recordedByUserId: actor.user.id })
        .onConflictDoUpdate({
          target: [academicAttendance.sessionId, academicAttendance.studentId],
          set: { status: m.status, minutesPresent: m.minutesPresent ?? null, note: m.note ?? null, recordedByUserId: actor.user.id },
        });
    }
    if (session.status === 'scheduled') {
      await tx.update(academicClassSessions).set({ status: 'held' }).where(eq(academicClassSessions.id, session.id));
    }
    const after = await tx.select().from(academicAttendance).where(eq(academicAttendance.sessionId, session.id));
    await audit(tx, actor, { action: before.length > 0 ? 'attendance.corrected' : 'attendance.recorded', entityType: 'class_session', entityId: session.id, before: before.map(({ studentId, status, minutesPresent }) => ({ studentId, status, minutesPresent })), after: after.map(({ studentId, status, minutesPresent }) => ({ studentId, status, minutesPresent })) });
    return { sessionId: session.id, recorded: after.length, rosterSize: roster.size };
  });
}

/** Attendance rows for held sessions in a window (summary, progress). */
export async function attendanceBetween(db: Database, from: string, to: string) {
  return db
    .select({ sessionId: academicAttendance.sessionId, studentId: academicAttendance.studentId, status: academicAttendance.status, batchId: academicClassSessions.batchId })
    .from(academicAttendance)
    .innerJoin(academicClassSessions, eq(academicClassSessions.id, academicAttendance.sessionId))
    .where(and(gte(academicClassSessions.date, from), lte(academicClassSessions.date, to)));
}
