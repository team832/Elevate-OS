/**
 * Teacher unavailability (R2): an availability record entered by a coordinator ("Academic
 * availability record — not HR leave"), or made from a teacher's approved HR leave that Business
 * Ops sends (D-134). Either flags the teacher's future classes in the range as coordinator work
 * (uncovered until a substitute is authorised). It never assigns a substitute.
 */
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { academicClassSessions, academicSessionTeachers, academicTeacherAssignments, academicTeacherUnavailability, staffMembers, type AcademicUnavailabilityId, type Database } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { InvalidStateTransitionError, NotFoundError, ValidationError, type academicHrLeaveBody, type AcademicHrLeaveV1 } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import type { z } from 'zod';
import { audit, resolveScope, todayIst, type Actor } from '../context';
import type { unavailabilityBody } from '../schemas-sessions';
import { listSessions, sessionRows, teachersBySession } from './timetable';

export const UNAVAILABILITY_LABEL = 'Academic availability record — not HR leave';
export const HR_LEAVE_LABEL = 'Approved HR leave, from Business Ops OS';
export const unavailabilityLabel = (source: string) => (source === 'hr_leave' ? HR_LEAVE_LABEL : UNAVAILABILITY_LABEL);

type Range = { from: string; to: string; staffId?: string };

/**
 * Scheduled classes from `from` to `to` where anyone teaching them (planned teacher not
 * replaced, co-teacher or substitute) has an active unavailability record on the date, or has
 * left (HR ended their employment, core.staff_members inactive). Nothing here reassigns them.
 */
export const uncoveredSessions = (db: Database, actor: Actor, range: Range) => uncovered(db, range, (f) => listSessions(db, actor, f));

async function uncovered(db: Database, range: Range, load: (f: { from: string; to: string; status: 'scheduled' }) => ReturnType<typeof sessionRows>) {
  const records = await db
    .select()
    .from(academicTeacherUnavailability)
    .where(and(isNull(academicTeacherUnavailability.cancelledAt), lte(academicTeacherUnavailability.fromDate, range.to), gte(academicTeacherUnavailability.toDate, range.from), range.staffId ? eq(academicTeacherUnavailability.staffId, range.staffId as StaffMemberId) : undefined));
  const ended = new Set((await db.select({ id: staffMembers.id }).from(staffMembers).where(and(eq(staffMembers.status, 'inactive'), range.staffId ? eq(staffMembers.id, range.staffId as StaffMemberId) : undefined))).map((r) => r.id as string));
  if (records.length === 0 && ended.size === 0) return [];
  const sessions = await load({ from: range.from, to: range.to, status: 'scheduled' });
  const teachers = await teachersBySession(db, sessions);
  const away = (s: (typeof sessions)[number]) => (teachers.get(s.id) ?? []).filter((t) => ended.has(t) || records.some((r) => r.staffId === t && s.date >= r.fromDate && s.date <= r.toDate));
  const flagged = sessions.filter((s) => away(s).length > 0);
  const ids = [...new Set(flagged.flatMap(away))];
  const names = new Map(ids.length ? (await db.select({ id: staffMembers.id, name: staffMembers.fullName }).from(staffMembers).where(inArray(staffMembers.id, ids as StaffMemberId[]))).map((r) => [r.id as string, r.name]) : []);
  return flagged.map((s) => ({ ...s, unavailableStaffIds: away(s), unavailableNames: away(s).map((id) => `${names.get(id) ?? 'Unknown staff member'}${ended.has(id) ? ' (left)' : ''}`) }));
}

export async function listUnavailability(db: Database, actor: Actor, filter: { staffId?: string } = {}) {
  const scope = await resolveScope(db, actor, 'academic:assignments:read');
  if (scope.kind === 'own') {
    if (!scope.staffId) return [];
    filter = { staffId: scope.staffId }; // teachers see only their own records
  }
  return db
    .select({ record: academicTeacherUnavailability, staffName: staffMembers.fullName })
    .from(academicTeacherUnavailability)
    .innerJoin(staffMembers, eq(staffMembers.id, academicTeacherUnavailability.staffId))
    .where(filter.staffId ? eq(academicTeacherUnavailability.staffId, filter.staffId as StaffMemberId) : undefined)
    .orderBy(asc(academicTeacherUnavailability.fromDate))
    .then((rows) => rows.map((r) => ({ ...r.record, staffName: r.staffName, label: unavailabilityLabel(r.record.source) })));
}

export async function createUnavailability(db: Database, actor: Actor, input: z.output<typeof unavailabilityBody>, now = new Date()) {
  await resolveScope(db, actor, 'academic:timetable:write');
  const record = await withTransaction(db, async (tx) => {
    const [staff] = await tx.select({ id: staffMembers.id }).from(staffMembers).where(eq(staffMembers.id, input.staffId as StaffMemberId));
    if (!staff) throw new ValidationError('Teacher (staff member) not found.');
    const [row] = await tx
      .insert(academicTeacherUnavailability)
      .values({ staffId: staff.id, fromDate: input.fromDate, toDate: input.toDate, reason: input.reason, enteredByUserId: actor.user.id })
      .returning();
    await audit(tx, actor, { action: 'teacher_unavailability.recorded', entityType: 'teacher_unavailability', entityId: row!.id, after: row, metadata: { label: UNAVAILABILITY_LABEL } });
    return row!;
  });
  const from = input.fromDate > todayIst(now) ? input.fromDate : todayIst(now);
  const affected = from <= input.toDate ? await uncoveredSessions(db, actor, { from, to: input.toDate, staffId: input.staffId }) : [];
  return { record: { ...record, label: UNAVAILABILITY_LABEL }, affectedSessions: affected };
}

/**
 * A teacher's approved HR leave from Business Ops (D-134, internal route, `actor` = the HR person):
 * one record per Ops leave record, flagging their classes in those dates as needing cover; a
 * cancel withdraws it. Ops never re-approves cancelled leave, so a cancelled record stays
 * cancelled and a retried or late call changes nothing; a cancel that comes first is stored
 * already cancelled, so the approval behind it changes nothing either. Ops sends every leave: a
 * new record is made only for someone with assignments or classes here. Neither the leave type
 * nor the reason reaches Academic. Classes are counted without a scope check: the HR person
 * holds no Academic role.
 */
export async function syncHrLeave(db: Database, actor: Actor, input: z.output<typeof academicHrLeaveBody>, now = new Date()): Promise<AcademicHrLeaveV1> {
  const T = academicTeacherUnavailability;
  const from = input.fromDate > todayIst(now) ? input.fromDate : todayIst(now);
  const flagged = async () => (from > input.toDate ? [] : (await uncovered(db, { from, to: input.toDate, staffId: input.staffId }, (f) => sessionRows(db, f))).map((s) => s.id as string));
  const approve = input.status === 'approved';
  const before = approve ? [] : await flagged();
  const { row, withdrawn } = await withTransaction(db, async (tx) => {
    const [made] = (await teachesHere(tx, input.staffId))
      ? await tx
          .insert(T)
          .values({
            staffId: input.staffId,
            fromDate: input.fromDate,
            toDate: input.toDate,
            reason: 'Approved HR leave',
            enteredByUserId: actor.user.id,
            source: 'hr_leave',
            opsLeaveRecordId: input.opsLeaveRecordId,
            ...(approve ? {} : { cancelledAt: now, cancelledByUserId: actor.user.id }),
          })
          .onConflictDoNothing({ target: T.opsLeaveRecordId, where: sql`${T.opsLeaveRecordId} IS NOT NULL` })
          .returning()
      : [];
    if (made) {
      await audit(tx, actor, { action: approve ? 'teacher_unavailability.recorded' : 'teacher_unavailability.withdrawn', entityType: 'teacher_unavailability', entityId: made.id, after: made, metadata: { label: HR_LEAVE_LABEL } });
      return { row: made, withdrawn: false };
    }
    const [found] = await tx.select().from(T).where(eq(T.opsLeaveRecordId, input.opsLeaveRecordId)).for('update');
    if (!found || found.cancelledAt || approve) return { row: found ?? null, withdrawn: false };
    const [updated] = await tx.update(T).set({ cancelledAt: now, cancelledByUserId: actor.user.id }).where(eq(T.id, found.id)).returning();
    await audit(tx, actor, { action: 'teacher_unavailability.withdrawn', entityType: 'teacher_unavailability', entityId: found.id, before: found, after: updated, metadata: { reason: 'HR cancelled the leave' } });
    return { row: updated!, withdrawn: true };
  });
  const active = Boolean(row && !row.cancelledAt);
  // On a cancel, only the classes no other active record still flags are back with the teacher.
  const still = new Set(withdrawn ? await flagged() : before);
  return { recordId: row?.id ?? null, active, classes: active ? (await flagged()).length : before.filter((id) => !still.has(id)).length };
}

/** Assignments or classes here (planned, co-teacher or substitute): someone Academic plans classes for. */
async function teachesHere(db: Database, staffId: string) {
  const id = staffId as StaffMemberId;
  return (
    (await db.$count(academicTeacherAssignments, eq(academicTeacherAssignments.staffMemberId, id))) > 0 ||
    (await db.$count(academicClassSessions, eq(academicClassSessions.teacherStaffId, id))) > 0 ||
    (await db.$count(academicSessionTeachers, eq(academicSessionTeachers.staffId, id))) > 0
  );
}

export async function cancelUnavailability(db: Database, actor: Actor, id: string, reason: string) {
  await resolveScope(db, actor, 'academic:timetable:write');
  return withTransaction(db, async (tx) => {
    const [row] = await tx.select().from(academicTeacherUnavailability).where(eq(academicTeacherUnavailability.id, id as AcademicUnavailabilityId)).for('update');
    if (!row) throw new NotFoundError('Availability record not found.');
    if (row.cancelledAt) throw new InvalidStateTransitionError('This availability record is already withdrawn.');
    if (row.source === 'hr_leave')
      throw new InvalidStateTransitionError('This record comes from approved HR leave: HR cancels the leave in Business Ops OS. To cover a class, authorise a substitute.');
    const [updated] = await tx.update(academicTeacherUnavailability).set({ cancelledAt: new Date(), cancelledByUserId: actor.user.id }).where(eq(academicTeacherUnavailability.id, row.id)).returning();
    await audit(tx, actor, { action: 'teacher_unavailability.withdrawn', entityType: 'teacher_unavailability', entityId: row.id, before: row, after: updated, metadata: { reason } });
    return updated!;
  });
}

/** Staff ids with an active record covering `date` (for directory badges). */
export async function unavailableOn(db: Database, staffIds: readonly string[], date: string) {
  if (staffIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ staffId: academicTeacherUnavailability.staffId })
    .from(academicTeacherUnavailability)
    .where(and(inArray(academicTeacherUnavailability.staffId, staffIds as StaffMemberId[]), isNull(academicTeacherUnavailability.cancelledAt), lte(academicTeacherUnavailability.fromDate, date), gte(academicTeacherUnavailability.toDate, date)));
  return new Set(rows.map((r) => r.staffId as string));
}
