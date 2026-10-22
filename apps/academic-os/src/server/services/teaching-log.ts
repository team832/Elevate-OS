/**
 * Teaching log (ACD-007, brief §12): one current record per session + chapter.
 *
 * draft → submitted → verified, plus two coordinator paths that never overwrite:
 * - request correction: the record becomes `superseded` and a new draft (corrects_record_id,
 *   reason) goes back to the teacher, who edits and resubmits it;
 * - correct: the record becomes `superseded` and a new `verified` record replaces it.
 * Saving or submitting a log never changes the session (R12: "Mark delivered" is separate),
 * never touches HR attendance or payroll, and a log can be submitted only for a session that
 * was already marked delivered. Drafts are private to their author. Writers send the
 * `version` they opened; a stale version is refused.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  academicBatches,
  academicChapters,
  academicClassRecords,
  academicClassSessions,
  academicSessionTeachers,
  staffMembers,
  users,
  type AcademicClassRecordId,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, InvalidStateTransitionError, NotFoundError, ValidationError } from '@elevate/shared-contracts';
import { addDays, type BatchId, type IsoDate, type StaffMemberId } from '@elevate/shared-types';
import type { z } from 'zod';
import { audit, resolveScope, staffIdForUser, todayIst, type Actor } from '../context';
import type { classRecordsQuery, correctClassBody, logExceptionsQuery, recordClassBody, requestCorrectionBody, updateClassBody } from '../schemas-teaching';
import { assertLoggable, assertSessionAccess, lockSession, taughtBy } from './session-guards';
import { getSetting } from './settings';
import { listSessions } from './timetable';

type ClassRecord = typeof academicClassRecords.$inferSelect;
type LogContent = Omit<z.output<typeof updateClassBody>, 'version' | 'submit'>;

const NOT_DELIVERED = 'Mark the class delivered before submitting its log. Your draft is kept.';

/** The log's teacher: the actor when they are on the session (substitute, co-teacher), else the planned teacher. */
async function loggingTeacher(tx: Database, actor: Actor, session: { id: string; teacherStaffId: StaffMemberId | null }) {
  const staffId = await staffIdForUser(tx, actor.user.id);
  if (!staffId || staffId === session.teacherStaffId) return session.teacherStaffId;
  const [onSession] = await tx
    .select({ id: academicSessionTeachers.id })
    .from(academicSessionTeachers)
    .where(and(eq(academicSessionTeachers.sessionId, session.id as never), eq(academicSessionTeachers.staffId, staffId), isNull(academicSessionTeachers.removedAt)));
  return onSession ? staffId : session.teacherStaffId;
}

async function activeChapterOfBatch(tx: Database, chapterId: string, batchId: BatchId) {
  const [chapter] = await tx.select().from(academicChapters).where(eq(academicChapters.id, chapterId as never));
  const [batch] = await tx.select().from(academicBatches).where(eq(academicBatches.id, batchId));
  if (!chapter || chapter.courseId !== batch!.courseId) throw new ValidationError('The chapter is not part of the batch’s course.');
  if (chapter.status !== 'active') throw new ValidationError('Retired or moved chapters cannot be logged; use their alias.');
  return chapter;
}

const contentOf = (input: LogContent) => ({
  chapterId: input.chapterId as never,
  activity: input.activity,
  completion: input.completion,
  actualMinutes: input.actualMinutes,
  materials: input.materials ?? null,
  homework: input.homework ?? null,
  homeworkDueOn: input.homeworkDueOn ?? null,
  difficulties: input.difficulties ?? null,
  nextPlan: input.nextPlan ?? null,
  catchUpNeeded: input.catchUpNeeded ?? null,
  notes: input.notes ?? null,
  evidence: input.evidence ?? null,
});

async function assertNoOtherCurrent(tx: Database, sessionId: string, chapterId: string, exceptId?: string) {
  const conditions = [eq(academicClassRecords.sessionId, sessionId as never), eq(academicClassRecords.chapterId, chapterId as never), ne(academicClassRecords.state, 'superseded')];
  if (exceptId) conditions.push(ne(academicClassRecords.id, exceptId as AcademicClassRecordId));
  const [existing] = await tx.select({ state: academicClassRecords.state }).from(academicClassRecords).where(and(...conditions));
  if (existing?.state === 'draft') throw new ConflictError('A draft log for this chapter already exists for the session; open and finish it.');
  if (existing) throw new ConflictError('This chapter is already logged for the session; ask the coordinator for a correction.');
}

/** Create a log for a session: a draft, or submitted at once when `submit` is true. */
export async function recordClass(db: Database, actor: Actor, input: z.output<typeof recordClassBody>, now = new Date()) {
  const scope = await resolveScope(db, actor, 'academic:classes:record');
  return withTransaction(db, async (tx) => {
    const session = await lockSession(tx, input.sessionId);
    await assertSessionAccess(tx, scope, session);
    assertLoggable(session, todayIst(now));
    const teacherStaffId = await loggingTeacher(tx, actor, session);
    if (!teacherStaffId) throw new ValidationError('Assign a teacher to the session before logging it.');
    if (input.submit && session.status !== 'held') throw new ValidationError(NOT_DELIVERED);
    const chapter = await activeChapterOfBatch(tx, input.chapterId, session.batchId);
    await assertNoOtherCurrent(tx, session.id, chapter.id);
    const [record] = await tx
      .insert(academicClassRecords)
      .values({
        ...contentOf(input),
        sessionId: session.id,
        batchId: session.batchId,
        teacherStaffId,
        state: input.submit ? 'submitted' : 'draft',
        submittedAt: input.submit ? now : null,
        recordedByUserId: actor.user.id,
      })
      .returning();
    await audit(tx, actor, { action: input.submit ? 'class_record.submitted' : 'class_record.draft_saved', entityType: 'class_record', entityId: record!.id, after: record });
    return record!;
  });
}

/** The author edits their draft (and may submit it). A stale `version` is refused. */
export async function updateClassRecord(db: Database, actor: Actor, recordId: string, input: z.output<typeof updateClassBody>, now = new Date()) {
  const scope = await resolveScope(db, actor, 'academic:classes:record');
  return withTransaction(db, async (tx) => {
    const [draft] = await tx.select().from(academicClassRecords).where(eq(academicClassRecords.id, recordId as AcademicClassRecordId)).for('update');
    if (!draft || (draft.state === 'draft' && draft.recordedByUserId !== actor.user.id)) throw new NotFoundError('Class record not found.');
    const session = await lockSession(tx, draft.sessionId);
    await assertSessionAccess(tx, scope, session);
    if (draft.state !== 'draft') throw new InvalidStateTransitionError(`Only a draft can be edited (this log is ${draft.state}); ask the coordinator for a correction.`);
    if (draft.version !== input.version) throw new ConflictError('This log changed since you opened it. Reload the page to see the latest version.');
    if (input.submit) {
      assertLoggable(session, todayIst(now));
      if (session.status !== 'held') throw new ValidationError(NOT_DELIVERED);
    }
    if (input.chapterId !== draft.chapterId) {
      await activeChapterOfBatch(tx, input.chapterId, draft.batchId);
      await assertNoOtherCurrent(tx, draft.sessionId, input.chapterId, draft.id);
    }
    const [row] = await tx
      .update(academicClassRecords)
      .set({ ...contentOf(input), version: draft.version + 1, ...(input.submit ? { state: 'submitted' as const, submittedAt: now } : {}) })
      .where(and(eq(academicClassRecords.id, draft.id), eq(academicClassRecords.version, draft.version)))
      .returning();
    await audit(tx, actor, { action: input.submit ? 'class_record.submitted' : 'class_record.draft_saved', entityType: 'class_record', entityId: draft.id, before: draft, after: row });
    return row!;
  });
}

export async function listClassRecords(db: Database, actor: Actor, filter: Partial<z.output<typeof classRecordsQuery>>) {
  const scope = await resolveScope(db, actor, 'academic:classes:read');
  if (scope.kind === 'own' && !scope.staffId) return [];
  const conditions: SQL[] = [];
  if (filter.batchId) conditions.push(eq(academicClassRecords.batchId, filter.batchId as BatchId));
  if (filter.teacherStaffId) conditions.push(eq(academicClassRecords.teacherStaffId, filter.teacherStaffId as StaffMemberId));
  if (filter.state) conditions.push(eq(academicClassRecords.state, filter.state));
  if (filter.from) conditions.push(gte(academicClassSessions.date, filter.from));
  if (filter.to) conditions.push(lte(academicClassSessions.date, filter.to));
  if (scope.kind === 'own') conditions.push(or(taughtBy(db, scope.staffId!), eq(academicClassRecords.teacherStaffId, scope.staffId!))!);
  // Others' drafts never leave the database; `replacedBy` still reveals "correction requested".
  conditions.push(or(ne(academicClassRecords.state, 'draft'), eq(academicClassRecords.recordedByUserId, actor.user.id))!);
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
      recordedByName: users.displayName,
      replacedBy: sql<Exclude<ClassRecord['state'], 'superseded'> | null>`(select r2.state from academic.class_records r2 where r2.corrects_record_id = ${academicClassRecords.id} limit 1)`,
    })
    .from(academicClassRecords)
    .innerJoin(academicClassSessions, eq(academicClassSessions.id, academicClassRecords.sessionId))
    .innerJoin(academicBatches, eq(academicBatches.id, academicClassRecords.batchId))
    .innerJoin(academicChapters, eq(academicChapters.id, academicClassRecords.chapterId))
    .innerJoin(staffMembers, eq(staffMembers.id, academicClassRecords.teacherStaffId))
    .innerJoin(users, eq(users.id, academicClassRecords.recordedByUserId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(academicClassSessions.date), asc(academicClassRecords.recordedAt))
    .limit(500);
  return rows.map(({ record, ...joined }) => ({ ...record, ...joined }));
}

/** Coordinator verifies a submitted record; verified-by/at are fixed once set. */
export async function verifyClassRecord(db: Database, actor: Actor, recordId: string) {
  await resolveScope(db, actor, 'academic:classes:verify');
  return withTransaction(db, async (tx) => {
    const record = await lockRecord(tx, recordId);
    if (record.state !== 'submitted') throw new InvalidStateTransitionError(`Only a submitted record can be verified (it is ${record.state}).`);
    const [row] = await tx
      .update(academicClassRecords)
      .set({ state: 'verified', verifiedByUserId: actor.user.id, verifiedAt: new Date(), version: record.version + 1 })
      .where(and(eq(academicClassRecords.id, record.id), eq(academicClassRecords.state, 'submitted')))
      .returning();
    await audit(tx, actor, { action: 'class_record.verified', entityType: 'class_record', entityId: record.id, before: record, after: row });
    return row!;
  });
}

async function lockRecord(tx: Database, recordId: string): Promise<ClassRecord> {
  const [record] = await tx.select().from(academicClassRecords).where(eq(academicClassRecords.id, recordId as AcademicClassRecordId)).for('update');
  if (!record || record.state === 'draft') throw new NotFoundError('Class record not found.');
  return record;
}

/** Supersede a current submitted/verified record (content unchanged) and insert its successor. */
async function supersede(tx: Database, original: ClassRecord, successor: Partial<typeof academicClassRecords.$inferInsert>) {
  if (original.state === 'superseded') throw new InvalidStateTransitionError('This record was already corrected; correct the current version.');
  const now = new Date();
  const [superseded] = await tx.update(academicClassRecords).set({ state: 'superseded', supersededAt: now }).where(eq(academicClassRecords.id, original.id)).returning();
  const { id: _id, recordedAt: _r, verifiedByUserId: _v, verifiedAt: _va, supersededAt: _s, submittedAt: _sa, version: _ver, ...content } = original;
  const [next] = await tx.insert(academicClassRecords).values({ ...content, correctsRecordId: original.id, ...successor }).returning();
  return { superseded: superseded!, next: next!, now };
}

/** Coordinator sends a log back: a new draft for the teacher to fix and resubmit. */
export async function requestClassCorrection(db: Database, actor: Actor, recordId: string, input: z.output<typeof requestCorrectionBody>) {
  await resolveScope(db, actor, 'academic:classes:verify');
  return withTransaction(db, async (tx) => {
    const original = await lockRecord(tx, recordId);
    // The draft goes to the log's teacher (if they can sign in); the request is audited under the coordinator.
    const [teacher] = await tx.select({ userId: staffMembers.userId }).from(staffMembers).where(eq(staffMembers.id, original.teacherStaffId));
    const { superseded, next } = await supersede(tx, original, { state: 'draft', correctionReason: input.reason, recordedByUserId: teacher?.userId ?? original.recordedByUserId });
    await audit(tx, actor, { action: 'class_record.correction_requested', entityType: 'class_record', entityId: original.id, before: original, after: next, metadata: { reason: input.reason, supersededAt: superseded.supersededAt, draftId: next.id } });
    return { original: superseded, draft: next };
  });
}

/** Coordinator correction: the original keeps its content and becomes `superseded`; a new `verified` record replaces it. */
export async function correctClassRecord(db: Database, actor: Actor, recordId: string, input: z.output<typeof correctClassBody>) {
  await resolveScope(db, actor, 'academic:classes:verify');
  return withTransaction(db, async (tx) => {
    const original = await lockRecord(tx, recordId);
    if (input.chapterId && input.chapterId !== original.chapterId) await activeChapterOfBatch(tx, input.chapterId, original.batchId);
    const { superseded, next, now } = await supersede(tx, original, {
      chapterId: (input.chapterId as never) ?? original.chapterId,
      activity: input.activity ?? original.activity,
      completion: input.completion ?? original.completion,
      actualMinutes: input.actualMinutes ?? original.actualMinutes,
      notes: input.notes ?? original.notes,
      state: 'verified',
      correctionReason: input.reason,
      recordedByUserId: actor.user.id,
      submittedAt: original.submittedAt ?? new Date(),
      verifiedByUserId: actor.user.id,
      verifiedAt: new Date(),
    });
    await audit(tx, actor, { action: 'class_record.corrected', entityType: 'class_record', entityId: original.id, before: original, after: next, metadata: { reason: input.reason, supersededAt: now, correctionId: next.id } });
    return { original: superseded, correction: next };
  });
}

/**
 * Exceptions for the coordinator (and a teacher's own sessions), over delivered sessions in a
 * window (default: the last 30 days, IST):
 * - delivered without a submitted log (drafts do not count);
 * - coverage discrepancies: the planned chapter is not among the chapters logged.
 */
export async function getLogExceptions(db: Database, actor: Actor, filter: Partial<z.output<typeof logExceptionsQuery>>) {
  await resolveScope(db, actor, 'academic:classes:read');
  const to = filter.to ?? todayIst();
  const from = filter.from ?? addDays(to as IsoDate, -29);
  const delivered = (await listSessions(db, actor, { batchId: filter.batchId, from, to })).filter(
    (s) => s.status === 'held' && (!filter.teacherStaffId || s.teacherStaffId === filter.teacherStaffId),
  );
  const records = delivered.length
    ? await db
        .select({ sessionId: academicClassRecords.sessionId, chapterId: academicClassRecords.chapterId, chapterCode: academicChapters.code })
        .from(academicClassRecords)
        .innerJoin(academicChapters, eq(academicChapters.id, academicClassRecords.chapterId))
        .where(and(inArray(academicClassRecords.sessionId, delivered.map((s) => s.id)), inArray(academicClassRecords.state, ['submitted', 'verified'])))
    : [];
  const logged = new Map<string, typeof records>();
  for (const r of records) logged.set(r.sessionId, [...(logged.get(r.sessionId) ?? []), r]);
  return {
    window: { from, to },
    missingLogs: delivered.filter((s) => !logged.has(s.id)),
    discrepancies: delivered
      .filter((s) => s.plannedChapterId && logged.has(s.id) && !logged.get(s.id)!.some((r) => r.chapterId === s.plannedChapterId))
      .map((s) => ({ ...s, loggedChapters: logged.get(s.id)!.map((r) => r.chapterCode) })),
  };
}

/** Everything the teacher's log page needs for one session. */
export async function getSessionLog(db: Database, actor: Actor, sessionId: string) {
  const scope = await resolveScope(db, actor, 'academic:classes:read');
  const [row] = await db
    .select({ session: academicClassSessions, batchCode: academicBatches.code, courseId: academicBatches.courseId, plannedChapterCode: academicChapters.code, plannedChapterTitle: academicChapters.title })
    .from(academicClassSessions)
    .innerJoin(academicBatches, eq(academicBatches.id, academicClassSessions.batchId))
    .leftJoin(academicChapters, eq(academicChapters.id, academicClassSessions.plannedChapterId))
    .where(eq(academicClassSessions.id, sessionId as never));
  if (!row) throw new NotFoundError('Session not found.');
  await assertSessionAccess(db, scope, row.session);
  const chapters = await db
    .select({ id: academicChapters.id, code: academicChapters.code, title: academicChapters.title })
    .from(academicChapters)
    .where(and(eq(academicChapters.courseId, row.courseId), eq(academicChapters.status, 'active'), row.session.subjectId ? eq(academicChapters.subjectId, row.session.subjectId) : undefined))
    .orderBy(asc(academicChapters.sortOrder), asc(academicChapters.code));
  const records = (await db.select().from(academicClassRecords).where(and(eq(academicClassRecords.sessionId, row.session.id), ne(academicClassRecords.state, 'superseded')))).filter(
    (r) => r.state !== 'draft' || r.recordedByUserId === actor.user.id,
  );
  const deadline = await getSetting(db, 'teaching_log.deadline_hours');
  return { ...row, chapters, records, delivered: row.session.status === 'held', deadlineHours: deadline.value.hours };
}
