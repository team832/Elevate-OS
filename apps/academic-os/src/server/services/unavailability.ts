/**
 * Teacher unavailability (R2): an ACADEMIC availability record entered by a coordinator —
 * "Academic availability record — not HR leave". It flags the teacher's future classes in the
 * range as coordinator work (uncovered until a substitute is authorised). It never assigns a
 * substitute and never claims HR status.
 */
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { academicTeacherUnavailability, staffMembers, type AcademicUnavailabilityId, type Database } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { InvalidStateTransitionError, NotFoundError, ValidationError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import type { z } from 'zod';
import { audit, resolveScope, todayIst, type Actor } from '../context';
import type { unavailabilityBody } from '../schemas-sessions';
import { listSessions, teachersBySession } from './timetable';

export const UNAVAILABILITY_LABEL = 'Academic availability record — not HR leave';

/**
 * Scheduled classes from `from` to `to` where anyone teaching them (planned teacher not
 * replaced, co-teacher or substitute) has an active unavailability record on the date.
 */
export async function uncoveredSessions(db: Database, actor: Actor, range: { from: string; to: string; staffId?: string }) {
  const records = await db
    .select()
    .from(academicTeacherUnavailability)
    .where(and(isNull(academicTeacherUnavailability.cancelledAt), lte(academicTeacherUnavailability.fromDate, range.to), gte(academicTeacherUnavailability.toDate, range.from), range.staffId ? eq(academicTeacherUnavailability.staffId, range.staffId as StaffMemberId) : undefined));
  if (records.length === 0) return [];
  const sessions = await listSessions(db, actor, { from: range.from, to: range.to, status: 'scheduled' });
  const teachers = await teachersBySession(db, sessions);
  const away = (s: (typeof sessions)[number]) => (teachers.get(s.id) ?? []).filter((t) => records.some((r) => r.staffId === t && s.date >= r.fromDate && s.date <= r.toDate));
  const flagged = sessions.filter((s) => away(s).length > 0);
  const ids = [...new Set(flagged.flatMap(away))];
  const names = new Map(ids.length ? (await db.select({ id: staffMembers.id, name: staffMembers.fullName }).from(staffMembers).where(inArray(staffMembers.id, ids as StaffMemberId[]))).map((r) => [r.id as string, r.name]) : []);
  return flagged.map((s) => ({ ...s, unavailableStaffIds: away(s), unavailableNames: away(s).map((id) => names.get(id) ?? 'Unknown staff member') }));
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
    .then((rows) => rows.map((r) => ({ ...r.record, staffName: r.staffName, label: UNAVAILABILITY_LABEL })));
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

export async function cancelUnavailability(db: Database, actor: Actor, id: string, reason: string) {
  await resolveScope(db, actor, 'academic:timetable:write');
  return withTransaction(db, async (tx) => {
    const [row] = await tx.select().from(academicTeacherUnavailability).where(eq(academicTeacherUnavailability.id, id as AcademicUnavailabilityId)).for('update');
    if (!row) throw new NotFoundError('Availability record not found.');
    if (row.cancelledAt) throw new InvalidStateTransitionError('This availability record is already withdrawn.');
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
