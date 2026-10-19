/**
 * Timetable (ACD-011..013): scheduled class sessions, conflict checks,
 * cancellation and rescheduling. Hard conflicts block a write (409 with the
 * conflicts); preferences are returned as warnings. Nothing is auto-fixed.
 */
import { and, asc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import {
  academicBatches,
  academicCalendarExclusions,
  academicChapters,
  academicClassSessions,
  academicCourses,
  academicRooms,
  academicSubjects,
  staffMembers,
  type AcademicSessionId,
  type Database,
} from '@elevate/database';
import { notify } from '@elevate/notifications';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, InvalidStateTransitionError, NotFoundError, ValidationError } from '@elevate/shared-contracts';
import type { BatchId, StaffMemberId } from '@elevate/shared-types';
import type { z } from 'zod';
import { checkTimetable, type ClassLength, type TimetableCheckResult, type TimetableSession } from '../../domain';
import { assertBatchInScope, assertSessionInScope, audit, resolveScope, type Actor } from '../context';
import type { checkTimetableBody, rescheduleSessionBody, sessionInput } from '../schemas';
import { classLengthOf } from './batches';
import { getSetting } from './settings';

type SessionRow = typeof academicClassSessions.$inferSelect;

function toTimetableSession(s: Pick<SessionRow, 'id' | 'batchId' | 'teacherStaffId' | 'roomId' | 'date' | 'startTime' | 'durationMinutes' | 'status' | 'sessionType'>): TimetableSession {
  return { id: s.id, batchId: s.batchId, teacherStaffId: s.teacherStaffId, roomId: s.roomId, date: s.date, startTime: s.startTime, durationMinutes: s.durationMinutes, status: s.status, sessionType: s.sessionType };
}

export async function listSessions(db: Database, actor: Actor, filter: { batchId?: string; from?: string; to?: string }) {
  const scope = await resolveScope(db, actor, 'academic:timetable:read');
  if (scope.kind === 'own' && !scope.staffId) return [];
  const conditions = [];
  if (filter.batchId) conditions.push(eq(academicClassSessions.batchId, filter.batchId as BatchId));
  if (filter.from) conditions.push(gte(academicClassSessions.date, filter.from));
  if (filter.to) conditions.push(lte(academicClassSessions.date, filter.to));
  if (scope.kind === 'own') conditions.push(eq(academicClassSessions.teacherStaffId, scope.staffId!));
  const rows = await db
    .select({
      session: academicClassSessions,
      batchCode: academicBatches.code,
      subjectCode: academicSubjects.code,
      chapterCode: academicChapters.code,
      chapterTitle: academicChapters.title,
      teacherName: staffMembers.fullName,
      roomCode: academicRooms.code,
    })
    .from(academicClassSessions)
    .innerJoin(academicBatches, eq(academicBatches.id, academicClassSessions.batchId))
    .leftJoin(academicSubjects, eq(academicSubjects.id, academicClassSessions.subjectId))
    .leftJoin(academicChapters, eq(academicChapters.id, academicClassSessions.plannedChapterId))
    .leftJoin(staffMembers, eq(staffMembers.id, academicClassSessions.teacherStaffId))
    .leftJoin(academicRooms, eq(academicRooms.id, academicClassSessions.roomId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(academicClassSessions.date), asc(academicClassSessions.startTime))
    .limit(1000);
  return rows.map((r) => ({ ...r.session, batchCode: r.batchCode, subjectCode: r.subjectCode, chapterCode: r.chapterCode, chapterTitle: r.chapterTitle, teacherName: r.teacherName, roomCode: r.roomCode }));
}

export async function getSessionOrThrow(db: Database, sessionId: string) {
  const [row] = await db.select().from(academicClassSessions).where(eq(academicClassSessions.id, sessionId as AcademicSessionId));
  if (!row) throw new NotFoundError('Session not found.');
  return row;
}

/** Load everything the conflict check needs for a date range (all batches: teachers and rooms are shared). */
async function conflictContext(db: Database, from: string, to: string) {
  const existing = await db
    .select()
    .from(academicClassSessions)
    .where(and(gte(academicClassSessions.date, from), lte(academicClassSessions.date, to), inArray(academicClassSessions.status, ['scheduled', 'held'])));
  const exclusions = await db
    .select()
    .from(academicCalendarExclusions)
    .where(and(gte(academicCalendarExclusions.date, from), lte(academicCalendarExclusions.date, to)));
  const batches = await db
    .select({ batch: academicBatches, course: academicCourses })
    .from(academicBatches)
    .innerJoin(academicCourses, eq(academicCourses.id, academicBatches.courseId));
  const classLengthByBatch: Record<string, ClassLength> = {};
  for (const { batch, course } of batches) {
    const l = classLengthOf(batch, course);
    classLengthByBatch[batch.id] = { minutes: l.minutes, status: l.status };
  }
  const cap = await getSetting(db, 'timetable.teacher_workload_cap');
  return {
    existing,
    exclusions: exclusions.map((x) => ({ date: x.date!, batchId: x.batchId, kind: x.kind, label: x.label, status: x.status })),
    classLengthByBatch,
    workloadCap: cap.value,
  };
}

function rangeOf(dates: string[]): { from: string; to: string } {
  const sorted = [...dates].sort();
  return { from: sorted[0]!, to: sorted.at(-1)! };
}

/** Widen to whole Monday–Sunday weeks so weekly workload sees every session of the week. */
function weekRange(range: { from: string; to: string }): { from: string; to: string } {
  const shift = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const dow = (date: string) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  return { from: shift(range.from, 1 - dow(range.from)), to: shift(range.to, 7 - dow(range.to)) };
}

export async function checkTimetableFor(db: Database, actor: Actor, input: z.output<typeof checkTimetableBody>): Promise<TimetableCheckResult> {
  const scope = await resolveScope(db, actor, 'academic:timetable:read');
  if (input.batchId) assertBatchInScope(scope, input.batchId);
  const range = weekRange({ from: input.from, to: input.to });
  const ctx = await conflictContext(db, range.from, range.to);
  const candidates = input.candidates.map((c, i) => ({ ...c, id: `candidate-${i + 1}` }));
  const relevant = input.batchId
    ? ctx.existing.filter((s) => s.date >= input.from && s.date <= input.to && s.batchId === input.batchId)
    : ctx.existing.filter((s) => s.date >= input.from && s.date <= input.to);
  const focus = candidates.length > 0 ? candidates.map((c) => c.id) : relevant.map((s) => s.id);
  if (scope.kind === 'own' && candidates.length === 0) {
    // Teachers see conflicts on their own sessions only.
    const own = new Set(relevant.filter((s) => s.teacherStaffId === scope.staffId).map((s) => s.id));
    focus.splice(0, focus.length, ...[...own]);
  }
  return checkTimetable({
    sessions: [
      ...ctx.existing.map(toTimetableSession),
      ...candidates.map((c) => ({ id: c.id, batchId: c.batchId, teacherStaffId: c.teacherStaffId ?? null, roomId: c.roomId ?? null, date: c.date, startTime: c.startTime, durationMinutes: c.durationMinutes, status: 'scheduled' as const, sessionType: c.sessionType })),
    ],
    exclusions: ctx.exclusions,
    classLengthByBatch: ctx.classLengthByBatch,
    workloadCap: ctx.workloadCap,
    onlyInvolving: focus,
  });
}

async function validateRefs(tx: Database, s: z.output<typeof sessionInput>) {
  const [batch] = await tx.select().from(academicBatches).where(eq(academicBatches.id, s.batchId as BatchId));
  if (!batch) throw new ValidationError('Batch not found.');
  if (batch.status === 'completed' || batch.status === 'cancelled') throw new ValidationError(`Batch ${batch.code} is ${batch.status}.`);
  if (s.subjectId) {
    const [subject] = await tx.select().from(academicSubjects).where(eq(academicSubjects.id, s.subjectId as never));
    if (!subject || subject.courseId !== batch.courseId) throw new ValidationError('The subject is not part of the batch’s course.');
  }
  if (s.plannedChapterId) {
    const [chapter] = await tx.select().from(academicChapters).where(eq(academicChapters.id, s.plannedChapterId as never));
    if (!chapter || chapter.courseId !== batch.courseId) throw new ValidationError('The chapter is not part of the batch’s course.');
  }
  if (s.teacherStaffId) {
    const [staff] = await tx.select().from(staffMembers).where(eq(staffMembers.id, s.teacherStaffId as StaffMemberId));
    if (!staff) throw new ValidationError('Teacher (staff member) not found.');
  }
  if (s.roomId) {
    const [room] = await tx.select().from(academicRooms).where(eq(academicRooms.id, s.roomId as never));
    if (!room || room.status !== 'active') throw new ValidationError('Room not found or inactive.');
  }
}

/** Schedule sessions. Refuses (409) when any hard conflict involves the new sessions. */
export async function createSessions(db: Database, actor: Actor, inputs: z.output<typeof sessionInput>[]) {
  return withTransaction(db, async (tx) => {
    for (const s of inputs) await validateRefs(tx, s);
    const range = weekRange(rangeOf(inputs.map((s) => s.date)));
    const ctx = await conflictContext(tx, range.from, range.to);
    const candidates = inputs.map((s, i) => ({ id: `new-${i + 1}`, batchId: s.batchId, teacherStaffId: s.teacherStaffId ?? null, roomId: s.roomId ?? null, date: s.date, startTime: s.startTime, durationMinutes: s.durationMinutes, status: 'scheduled' as const, sessionType: s.sessionType }));
    const check = checkTimetable({ sessions: [...ctx.existing.map(toTimetableSession), ...candidates], exclusions: ctx.exclusions, classLengthByBatch: ctx.classLengthByBatch, workloadCap: ctx.workloadCap, onlyInvolving: candidates.map((c) => c.id) });
    if (check.verdict === 'infeasible') {
      throw new ConflictError('The sessions conflict with the timetable; nothing was scheduled.', { details: { hard: check.hard, preferences: check.preferences } });
    }
    const rows = await tx
      .insert(academicClassSessions)
      .values(inputs.map((s) => ({
        batchId: s.batchId as BatchId,
        subjectId: (s.subjectId as never) ?? null,
        plannedChapterId: (s.plannedChapterId as never) ?? null,
        teacherStaffId: (s.teacherStaffId as StaffMemberId | undefined) ?? null,
        roomId: (s.roomId as never) ?? null,
        sessionType: s.sessionType,
        date: s.date,
        startTime: s.startTime,
        durationMinutes: s.durationMinutes,
        onlineLink: s.onlineLink ?? null,
        createdByUserId: actor.user.id,
      })))
      .returning();
    for (const row of rows) await audit(tx, actor, { action: 'class_session.scheduled', entityType: 'class_session', entityId: row.id, after: row });
    return { sessions: rows, warnings: check.preferences, notes: check.notes };
  });
}

async function teacherUserId(tx: Database, staffId: string | null) {
  if (!staffId) return null;
  const [row] = await tx.select({ userId: staffMembers.userId }).from(staffMembers).where(eq(staffMembers.id, staffId as StaffMemberId));
  return row?.userId ?? null;
}

export async function cancelSession(db: Database, actor: Actor, sessionId: string, reason: string) {
  return withTransaction(db, async (tx) => {
    const [session] = await tx.select().from(academicClassSessions).where(eq(academicClassSessions.id, sessionId as AcademicSessionId)).for('update');
    if (!session) throw new NotFoundError('Session not found.');
    if (session.status !== 'scheduled') throw new InvalidStateTransitionError(`Only a scheduled session can be cancelled (it is ${session.status}).`);
    const [row] = await tx.update(academicClassSessions).set({ status: 'cancelled', statusReason: reason }).where(eq(academicClassSessions.id, session.id)).returning();
    await audit(tx, actor, { action: 'class_session.cancelled', entityType: 'class_session', entityId: session.id, before: session, after: row, metadata: { reason } });
    const teacher = await teacherUserId(tx, session.teacherStaffId);
    if (teacher) {
      await notify(tx, { userIds: [teacher], module: 'academic', kind: 'class_session.cancelled', title: `Class on ${session.date} at ${session.startTime} cancelled`, body: reason, link: '/academic/timetable', entityType: 'class_session', entityId: session.id });
    }
    return row!;
  });
}

/** Reschedule: the original becomes `rescheduled` (kept) and a linked replacement is scheduled. */
export async function rescheduleSession(db: Database, actor: Actor, sessionId: string, input: z.output<typeof rescheduleSessionBody>) {
  return withTransaction(db, async (tx) => {
    const [session] = await tx.select().from(academicClassSessions).where(eq(academicClassSessions.id, sessionId as AcademicSessionId)).for('update');
    if (!session) throw new NotFoundError('Session not found.');
    if (session.status !== 'scheduled') throw new InvalidStateTransitionError(`Only a scheduled session can be rescheduled (it is ${session.status}).`);
    const replacement = {
      batchId: session.batchId,
      subjectId: session.subjectId,
      plannedChapterId: session.plannedChapterId,
      teacherStaffId: (input.teacherStaffId as StaffMemberId | undefined) ?? session.teacherStaffId,
      roomId: input.roomId === undefined ? session.roomId : (input.roomId as never),
      sessionType: session.sessionType,
      date: input.date,
      startTime: input.startTime,
      durationMinutes: input.durationMinutes ?? session.durationMinutes,
      onlineLink: session.onlineLink,
    };
    await validateRefs(tx, { ...replacement, teacherStaffId: replacement.teacherStaffId ?? undefined, roomId: replacement.roomId ?? undefined, subjectId: replacement.subjectId ?? undefined, plannedChapterId: replacement.plannedChapterId ?? undefined, onlineLink: undefined });
    const [updated] = await tx.update(academicClassSessions).set({ status: 'rescheduled', statusReason: input.reason }).where(eq(academicClassSessions.id, session.id)).returning();
    const range = weekRange({ from: input.date, to: input.date });
    const ctx = await conflictContext(tx, range.from, range.to);
    const candidate = { id: 'replacement', ...replacement, status: 'scheduled' as const };
    const check = checkTimetable({ sessions: [...ctx.existing.map(toTimetableSession), toTimetableSession(candidate as never)], exclusions: ctx.exclusions, classLengthByBatch: ctx.classLengthByBatch, workloadCap: ctx.workloadCap, onlyInvolving: ['replacement'] });
    if (check.verdict === 'infeasible') {
      throw new ConflictError('The new slot conflicts with the timetable; nothing was changed.', { details: { hard: check.hard, preferences: check.preferences } });
    }
    const [created] = await tx.insert(academicClassSessions).values({ ...replacement, rescheduledFromSessionId: session.id, createdByUserId: actor.user.id }).returning();
    await audit(tx, actor, { action: 'class_session.rescheduled', entityType: 'class_session', entityId: session.id, before: session, after: updated, metadata: { replacementId: created!.id, reason: input.reason } });
    await audit(tx, actor, { action: 'class_session.scheduled', entityType: 'class_session', entityId: created!.id, after: created, metadata: { rescheduledFrom: session.id } });
    const teachers = [await teacherUserId(tx, session.teacherStaffId), await teacherUserId(tx, created!.teacherStaffId)].filter((u): u is NonNullable<typeof u> => Boolean(u));
    if (teachers.length > 0) {
      await notify(tx, { userIds: teachers, module: 'academic', kind: 'class_session.rescheduled', title: `Class moved from ${session.date} ${session.startTime} to ${input.date} ${input.startTime}`, body: input.reason, link: '/academic/timetable', entityType: 'class_session', entityId: created!.id });
    }
    return { original: updated!, replacement: created!, warnings: check.preferences };
  });
}

/** Sessions of a batch on given dates (for assessment clash checks). */
export async function batchClassesBetween(db: Database, batchId: string, from: string, to: string) {
  return db
    .select()
    .from(academicClassSessions)
    .where(and(eq(academicClassSessions.batchId, batchId as BatchId), gte(academicClassSessions.date, from), lte(academicClassSessions.date, to), inArray(academicClassSessions.status, ['scheduled', 'held'])));
}

export async function datedExclusionsFor(db: Database, batchId: string) {
  return db
    .select()
    .from(academicCalendarExclusions)
    .where(or(eq(academicCalendarExclusions.batchId, batchId as BatchId), isNull(academicCalendarExclusions.batchId)));
}

export { assertSessionInScope };
