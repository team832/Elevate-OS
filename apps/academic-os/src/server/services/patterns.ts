/**
 * Timetable patterns (brief §9): draft → validate/preview → publish. Publishing generates the
 * dated sessions (one per weekday date, closures skipped) idempotently — unique
 * (pattern_id, date) — after the same server-side conflict check as one-off sessions (teacher
 * incl. co-teachers/substitutes and unavailability, room, batch, students placed in two
 * batches; cancelled sessions ignored). Editing a published series takes an effective date:
 * the old pattern ends the day before, its later undelivered occurrences are cancelled with the
 * reason, a new published pattern takes over. Delivered history is never touched.
 */
import { and, asc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import {
  academicBatches,
  academicCalendarExclusions,
  academicClassSessions,
  academicRooms,
  academicSubjects,
  academicTimetablePatterns,
  staffMembers,
  type AcademicPatternId,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, InvalidStateTransitionError, NotFoundError, ValidationError } from '@elevate/shared-contracts';
import { addDays, type BatchId, type IsoDate, type StaffMemberId } from '@elevate/shared-types';
import type { z } from 'zod';
import { eachDate, patternDates } from '../../domain';
import { audit, resolveScope, todayIst, type Actor } from '../context';
import type { patternBody, patternUpdateBody, seriesEditBody } from '../schemas-sessions';
import { checkAgainst, conflictContext, lockTimetable, recordCancellation, refuseConflicts, toTimetableSession, weekRange } from './timetable';

type Pattern = typeof academicTimetablePatterns.$inferSelect;
const MAX_DAYS = 400;

async function validatePatternRefs(tx: Database, p: { batchId: string; subjectId: string; staffId: string; roomId?: string | null; effectiveFrom: string; effectiveTo: string }) {
  const [batch] = await tx.select().from(academicBatches).where(eq(academicBatches.id, p.batchId as BatchId));
  if (!batch) throw new ValidationError('Batch not found.');
  if (batch.status === 'completed' || batch.status === 'cancelled') throw new ValidationError(`Batch ${batch.code} is ${batch.status}.`);
  const [subject] = await tx.select().from(academicSubjects).where(eq(academicSubjects.id, p.subjectId as never));
  if (!subject || subject.courseId !== batch.courseId) throw new ValidationError('The subject is not part of the batch’s course.');
  const [staff] = await tx.select({ id: staffMembers.id }).from(staffMembers).where(eq(staffMembers.id, p.staffId as StaffMemberId));
  if (!staff) throw new ValidationError('Teacher (staff member) not found.');
  if (p.roomId) {
    const [room] = await tx.select().from(academicRooms).where(eq(academicRooms.id, p.roomId as never));
    if (!room || room.status !== 'active') throw new ValidationError('Room not found or inactive.');
  }
  if (eachDate(p.effectiveFrom, p.effectiveTo).length > MAX_DAYS) throw new ValidationError(`A pattern may span at most ${MAX_DAYS} days; publish a second pattern for later dates.`);
}

export async function createPattern(db: Database, actor: Actor, input: z.output<typeof patternBody>) {
  await resolveScope(db, actor, 'academic:timetable:write');
  return withTransaction(db, async (tx) => {
    await validatePatternRefs(tx, input);
    const [row] = await tx
      .insert(academicTimetablePatterns)
      .values({ ...input, batchId: input.batchId as BatchId, subjectId: input.subjectId as never, staffId: input.staffId as StaffMemberId, roomId: (input.roomId as never) ?? null, onlineLink: input.onlineLink ?? null, createdByUserId: actor.user.id })
      .returning();
    await audit(tx, actor, { action: 'timetable_pattern.created', entityType: 'timetable_pattern', entityId: row!.id, after: row });
    return row!;
  });
}

export async function listPatterns(db: Database, actor: Actor, filter: { batchId?: string } = {}) {
  const scope = await resolveScope(db, actor, 'academic:timetable:read');
  if (scope.kind === 'own' && !scope.staffId) return [];
  const conditions = [
    filter.batchId ? eq(academicTimetablePatterns.batchId, filter.batchId as BatchId) : undefined,
    scope.kind === 'own' ? eq(academicTimetablePatterns.staffId, scope.staffId!) : undefined,
  ];
  const rows = await db
    .select({ pattern: academicTimetablePatterns, batchCode: academicBatches.code, subjectName: academicSubjects.name, teacherName: staffMembers.fullName, roomCode: academicRooms.code })
    .from(academicTimetablePatterns)
    .innerJoin(academicBatches, eq(academicBatches.id, academicTimetablePatterns.batchId))
    .innerJoin(academicSubjects, eq(academicSubjects.id, academicTimetablePatterns.subjectId))
    .innerJoin(staffMembers, eq(staffMembers.id, academicTimetablePatterns.staffId))
    .leftJoin(academicRooms, eq(academicRooms.id, academicTimetablePatterns.roomId))
    .where(and(...conditions))
    .orderBy(asc(academicBatches.code), asc(academicTimetablePatterns.weekday), asc(academicTimetablePatterns.startTime));
  return rows.map((r) => ({ ...r.pattern, batchCode: r.batchCode, subjectName: r.subjectName, teacherName: r.teacherName, roomCode: r.roomCode }));
}

async function loadPattern(db: Database, id: string, lock = false) {
  const query = db.select().from(academicTimetablePatterns).where(eq(academicTimetablePatterns.id, id as AcademicPatternId));
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw new NotFoundError('Pattern not found.');
  return row;
}

/** Occurrences of a pattern: existing session per date, closure skips, and the conflicts of each date still to be generated. */
async function planOccurrences(db: Database, p: Pattern) {
  const to = p.effectiveTo!;
  const exclusions = await db
    .select()
    .from(academicCalendarExclusions)
    .where(and(gte(academicCalendarExclusions.date, p.effectiveFrom), lte(academicCalendarExclusions.date, to), or(isNull(academicCalendarExclusions.batchId), eq(academicCalendarExclusions.batchId, p.batchId))));
  const existing = new Map((await db.select({ id: academicClassSessions.id, date: academicClassSessions.date }).from(academicClassSessions).where(eq(academicClassSessions.patternId, p.id))).map((s) => [s.date, s.id as string]));
  const dates = patternDates({ weekday: p.weekday, from: p.effectiveFrom, to, batchId: p.batchId }, exclusions.map((x) => ({ date: x.date!, batchId: x.batchId, kind: x.kind, label: x.label, status: x.status })));
  const range = weekRange({ from: p.effectiveFrom, to });
  const ctx = await conflictContext(db, range.from, range.to);
  const pending = dates.filter((d) => !d.skipped && !existing.has(d.date));
  const candidates = pending.map((d) => toTimetableSession({ id: `occ-${d.date}` as never, batchId: p.batchId, teacherStaffId: p.staffId, roomId: p.roomId, date: d.date, startTime: p.startTime, durationMinutes: p.durationMinutes, status: 'scheduled', sessionType: 'teaching' }));
  const check = checkAgainst(ctx, candidates);
  return {
    toCreate: pending.map((d) => d.date),
    check,
    occurrences: dates.map((d) => ({
      date: d.date,
      sessionId: existing.get(d.date) ?? null,
      skipped: d.skipped,
      conflicts: check.hard.filter((c) => c.sessionIds.includes(`occ-${d.date}`)).map((c) => c.message),
    })),
  };
}

export async function previewPattern(db: Database, actor: Actor, id: string) {
  const scope = await resolveScope(db, actor, 'academic:timetable:read');
  const pattern = await loadPattern(db, id);
  if (scope.kind === 'own' && pattern.staffId !== scope.staffId) throw new NotFoundError('Pattern not found.');
  const plan = await planOccurrences(db, pattern);
  return { pattern, ...plan };
}

async function generate(tx: Database, actor: Actor, p: Pattern) {
  const plan = await planOccurrences(tx, p);
  refuseConflicts(plan.check, 'The pattern conflicts with the timetable; nothing was published.');
  if (plan.toCreate.length === 0) return [];
  const rows = await tx
    .insert(academicClassSessions)
    .values(plan.toCreate.map((date) => ({ batchId: p.batchId, subjectId: p.subjectId, teacherStaffId: p.staffId, roomId: p.roomId, onlineLink: p.onlineLink, sessionType: 'teaching' as const, date, startTime: p.startTime, durationMinutes: p.durationMinutes, patternId: p.id, createdByUserId: actor.user.id })))
    .returning();
  for (const row of rows) await audit(tx, actor, { action: 'class_session.scheduled', entityType: 'class_session', entityId: row.id, after: row, metadata: { patternId: p.id } });
  return rows;
}

async function lockDraft(tx: Database, id: string, version: number) {
  const pattern = await loadPattern(tx, id, true);
  if (pattern.status !== 'draft') throw new InvalidStateTransitionError('Only a draft can be edited or deleted; change a published series from a date instead.');
  if (pattern.version !== version) throw new ConflictError('The draft changed since you opened it. Reload and try again.');
  return pattern;
}

export async function updateDraftPattern(db: Database, actor: Actor, id: string, input: z.output<typeof patternUpdateBody>) {
  await resolveScope(db, actor, 'academic:timetable:write');
  return withTransaction(db, async (tx) => {
    const { version, ...changes } = input;
    const before = await lockDraft(tx, id, version);
    const next = { ...before, ...changes };
    if (next.effectiveFrom > next.effectiveTo!) throw new ValidationError('effectiveFrom must not be after effectiveTo.');
    await validatePatternRefs(tx, { ...next, effectiveTo: next.effectiveTo! });
    const [row] = await tx
      .update(academicTimetablePatterns)
      .set({ ...(changes as Partial<Pattern>), version: before.version + 1 })
      .where(eq(academicTimetablePatterns.id, before.id))
      .returning();
    await audit(tx, actor, { action: 'timetable_pattern.updated', entityType: 'timetable_pattern', entityId: before.id, before, after: row });
    return row!;
  });
}

/** A draft generated nothing, so deleting it loses no history (the audit keeps its content). */
export async function deleteDraftPattern(db: Database, actor: Actor, id: string, version: number) {
  await resolveScope(db, actor, 'academic:timetable:write');
  return withTransaction(db, async (tx) => {
    const draft = await lockDraft(tx, id, version);
    await tx.delete(academicTimetablePatterns).where(eq(academicTimetablePatterns.id, draft.id));
    await audit(tx, actor, { action: 'timetable_pattern.deleted', entityType: 'timetable_pattern', entityId: draft.id, before: draft });
    return { id: draft.id, deleted: true };
  });
}

/** Publish (or re-publish) a pattern: generates the missing occurrences only. */
export async function publishPattern(db: Database, actor: Actor, id: string, version: number, now = new Date()) {
  await resolveScope(db, actor, 'academic:timetable:publish');
  return withTransaction(db, async (tx) => {
    await lockTimetable(tx);
    const pattern = await loadPattern(tx, id, true);
    if (pattern.version !== version) throw new ConflictError('The pattern changed since you previewed it. Preview it again before publishing.');
    if (pattern.status === 'retired') throw new InvalidStateTransitionError('A retired pattern cannot be published.');
    const created = await generate(tx, actor, pattern);
    const [row] = await tx
      .update(academicTimetablePatterns)
      .set({ status: 'published', publishedAt: pattern.publishedAt ?? now, publishedByUserId: pattern.publishedByUserId ?? actor.user.id, version: pattern.version + 1 })
      .where(eq(academicTimetablePatterns.id, pattern.id))
      .returning();
    await audit(tx, actor, { action: 'timetable_pattern.published', entityType: 'timetable_pattern', entityId: pattern.id, before: { status: pattern.status }, after: { status: 'published' }, metadata: { created: created.length } });
    return { pattern: row!, created };
  });
}

/**
 * Change a published series from `effectiveDate`, which must be after today: a class can only be
 * delivered on or before today, so no delivered occurrence is ever changed, and earlier ones stay.
 */
export async function editSeries(db: Database, actor: Actor, id: string, input: z.output<typeof seriesEditBody>, now = new Date()) {
  await resolveScope(db, actor, 'academic:timetable:publish');
  return withTransaction(db, async (tx) => {
    await lockTimetable(tx);
    const old = await loadPattern(tx, id, true);
    if (old.status !== 'published') throw new InvalidStateTransitionError('Only a published series can be changed from a date; edit a draft on its own page.');
    if (old.version !== input.version) throw new ConflictError('The series changed since you opened it. Reload and try again.');
    if (input.effectiveDate <= todayIst(now)) throw new ValidationError('Series changes start tomorrow at the earliest; change today’s class on its own.');
    if (input.effectiveDate < old.effectiveFrom || input.effectiveDate > old.effectiveTo!) throw new ValidationError(`The effective date must fall between ${old.effectiveFrom} and ${old.effectiveTo}.`);
    const next = { batchId: old.batchId, subjectId: old.subjectId, onlineLink: old.onlineLink, staffId: (input.staffId as StaffMemberId | undefined) ?? old.staffId, roomId: input.roomId === undefined ? old.roomId : (input.roomId as never), weekday: input.weekday ?? old.weekday, startTime: input.startTime ?? old.startTime, durationMinutes: input.durationMinutes ?? old.durationMinutes, effectiveFrom: input.effectiveDate, effectiveTo: old.effectiveTo! };
    await validatePatternRefs(tx, next);
    const later = await tx.select().from(academicClassSessions).where(and(eq(academicClassSessions.patternId, old.id), gte(academicClassSessions.date, input.effectiveDate)));
    const statusReason = `Series changed from ${input.effectiveDate}: ${input.reason}`;
    const cancelled = [];
    for (const s of later.filter((s) => s.status === 'scheduled')) {
      const [row] = await tx.update(academicClassSessions).set({ status: 'cancelled', statusReason, version: s.version + 1 }).where(eq(academicClassSessions.id, s.id)).returning();
      await recordCancellation(tx, actor, s, row!, statusReason);
      cancelled.push(row!);
    }
    const ended = input.effectiveDate > old.effectiveFrom ? { effectiveTo: addDays(input.effectiveDate as IsoDate, -1) } : { status: 'retired' as const };
    await tx.update(academicTimetablePatterns).set({ ...ended, version: old.version + 1 }).where(eq(academicTimetablePatterns.id, old.id));
    const [created] = await tx.insert(academicTimetablePatterns).values({ ...next, status: 'published', publishedAt: now, publishedByUserId: actor.user.id, createdByUserId: actor.user.id }).returning();
    const sessions = await generate(tx, actor, created!);
    await audit(tx, actor, { action: 'timetable_pattern.series_edited', entityType: 'timetable_pattern', entityId: old.id, before: old, after: { ...ended, nextPatternId: created!.id }, metadata: { reason: input.reason, effectiveDate: input.effectiveDate, cancelledSessionIds: cancelled.map((c) => c.id) } });
    await audit(tx, actor, { action: 'timetable_pattern.published', entityType: 'timetable_pattern', entityId: created!.id, after: created, metadata: { created: sessions.length, replaces: old.id } });
    return { previousId: old.id, pattern: created!, cancelled, created: sessions };
  });
}
