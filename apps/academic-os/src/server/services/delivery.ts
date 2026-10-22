/**
 * Session delivery and substitution (brief §9, §11, R12). "Mark delivered" is the only way a
 * session becomes `held`; it records who actually taught (session_teachers, participation
 * `actual`). Delivery is not HR attendance and never writes HR or payroll data — there is no
 * HR module (R2). Reopening a delivered session is a coordinator correction with a reason.
 * A substitute is an extra planned row naming the replaced teacher; the original stays.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { academicClassSessions, academicSessionTeachers, staffMembers, type Database } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, ForbiddenError, InvalidStateTransitionError, ValidationError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import type { z } from 'zod';
import { audit, resolveScope, todayIst, type Actor } from '../context';
import type { deliverBody, substituteBody } from '../schemas-sessions';
import { assertLoggable, assertSessionAccess, lockSession } from './session-guards';
import { getSetting } from './settings';
import { checkAgainst, conflictContext, lockTimetable, refuseConflicts, teachersBySession, toTimetableSession } from './timetable';

const activeRows = (tx: Database, sessionId: string, participation: 'planned' | 'actual') =>
  tx
    .select()
    .from(academicSessionTeachers)
    .where(and(eq(academicSessionTeachers.sessionId, sessionId as never), eq(academicSessionTeachers.participation, participation), isNull(academicSessionTeachers.removedAt)));

export async function markDelivered(db: Database, actor: Actor, sessionId: string, input: z.output<typeof deliverBody>, now = new Date()) {
  const scope = await resolveScope(db, actor, 'academic:classes:record');
  return withTransaction(db, async (tx) => {
    const session = await lockSession(tx, sessionId);
    await assertSessionAccess(tx, scope, session);
    assertLoggable(session, todayIst(now));
    if (session.status !== 'scheduled') throw new InvalidStateTransitionError(`Only a scheduled session can be marked delivered (it is ${session.status}).`);
    if (input.version !== undefined && input.version !== session.version) throw new ConflictError('Someone changed this session since you opened it. Reload and try again.');
    const planned = await activeRows(tx, session.id, 'planned');
    const actual = [...new Set(input.actualStaffIds ?? (await teachersBySession(tx, [session])).get(session.id) ?? [])];
    if (actual.length === 0) throw new ValidationError('Name the teacher who taught this class.');
    if (scope.kind === 'own' && !actual.includes(scope.staffId!)) throw new ValidationError('You can mark delivered only a class you taught.');
    const known = new Set((await tx.select({ id: staffMembers.id }).from(staffMembers).where(inArray(staffMembers.id, actual as StaffMemberId[]))).map((k) => k.id as string));
    const unknown = actual.filter((id) => !known.has(id));
    if (unknown.length) throw new ValidationError('Teacher (staff member) not found.', { details: { staffIds: unknown } });
    for (const staffId of actual) {
      const plan = planned.find((p) => p.staffId === staffId);
      await tx.insert(academicSessionTeachers).values({
        sessionId: session.id,
        staffId: staffId as StaffMemberId,
        participation: 'actual',
        role: plan?.role ?? (staffId === session.teacherStaffId ? 'primary' : 'co_teacher'),
        replacesStaffId: plan?.replacesStaffId ?? null,
        reason: plan?.reason ?? null,
        authorisedByUserId: plan?.authorisedByUserId ?? null,
      });
    }
    const [row] = await tx
      .update(academicClassSessions)
      .set({ status: 'held', deliveredAt: now, deliveredByUserId: actor.user.id, deliveryNote: input.note ?? null, version: session.version + 1 })
      .where(eq(academicClassSessions.id, session.id))
      .returning();
    await audit(tx, actor, { action: 'class_session.delivered', entityType: 'class_session', entityId: session.id, before: { status: session.status }, after: { status: 'held', deliveredAt: now }, metadata: { actualStaffIds: actual, note: input.note ?? null } });
    return { session: row!, actualStaffIds: actual };
  });
}

/** Coordinator correction: a delivered session goes back to scheduled; actual-teacher rows are kept but marked removed. */
export async function reopenSession(db: Database, actor: Actor, sessionId: string, reason: string, now = new Date()) {
  await resolveScope(db, actor, 'academic:timetable:write');
  return withTransaction(db, async (tx) => {
    const session = await lockSession(tx, sessionId);
    if (session.status !== 'held') throw new InvalidStateTransitionError(`Only a delivered session can be reopened (it is ${session.status}).`);
    await tx
      .update(academicSessionTeachers)
      .set({ removedAt: now })
      .where(and(eq(academicSessionTeachers.sessionId, session.id), eq(academicSessionTeachers.participation, 'actual'), isNull(academicSessionTeachers.removedAt)));
    const [row] = await tx
      .update(academicClassSessions)
      .set({ status: 'scheduled', deliveredAt: null, deliveredByUserId: null, deliveryNote: null, version: session.version + 1 })
      .where(eq(academicClassSessions.id, session.id))
      .returning();
    await audit(tx, actor, { action: 'class_session.reopened', entityType: 'class_session', entityId: session.id, before: { status: session.status, deliveredAt: session.deliveredAt, deliveredByUserId: session.deliveredByUserId }, after: { status: 'scheduled' }, metadata: { reason } });
    return row!;
  });
}

/** Authorise a substitute (role from the proposed `timetable.substitute_authoriser` setting). Never automatic. */
export async function assignSubstitute(db: Database, actor: Actor, sessionId: string, input: z.output<typeof substituteBody>) {
  await resolveScope(db, actor, 'academic:timetable:publish');
  const authoriser = await getSetting(db, 'timetable.substitute_authoriser');
  if (!actor.user.roles.includes(authoriser.value.role)) throw new ForbiddenError(`Only the ${authoriser.value.role.replace(/_/g, ' ')} may authorise a substitute.`);
  return withTransaction(db, async (tx) => {
    await lockTimetable(tx); // always before row locks (same order as every timetable write)
    const session = await lockSession(tx, sessionId);
    if (session.status !== 'scheduled') throw new InvalidStateTransitionError(`A substitute can be assigned only to a scheduled session (it is ${session.status}).`);
    if (!session.teacherStaffId) throw new ValidationError('The session has no planned teacher to replace; set its teacher instead.');
    if (input.staffId === session.teacherStaffId) throw new ValidationError('The substitute must be a different teacher.');
    const [staff] = await tx.select({ id: staffMembers.id }).from(staffMembers).where(eq(staffMembers.id, input.staffId as StaffMemberId));
    if (!staff) throw new ValidationError('Teacher (staff member) not found.');
    const planned = await activeRows(tx, session.id, 'planned');
    if (planned.some((p) => p.staffId === input.staffId)) throw new ConflictError('That teacher is already on this session.');
    const ctx = await conflictContext(tx, session.date, session.date);
    const others = planned.filter((p) => p.replacesStaffId !== session.teacherStaffId && p.staffId !== session.teacherStaffId).map((p) => p.staffId as string);
    refuseConflicts(checkAgainst(ctx, [toTimetableSession(session, [input.staffId, ...others])]), 'The substitute is not free at this time; nothing was changed.');
    // Earlier substitutes for the same teacher stop being planned (kept, marked removed).
    const now = new Date();
    for (const p of planned.filter((p) => p.replacesStaffId === session.teacherStaffId)) {
      await tx.update(academicSessionTeachers).set({ removedAt: now }).where(eq(academicSessionTeachers.id, p.id));
    }
    if (!planned.some((p) => p.staffId === session.teacherStaffId)) {
      await tx.insert(academicSessionTeachers).values({ sessionId: session.id, staffId: session.teacherStaffId, participation: 'planned', role: 'primary' });
    }
    const [row] = await tx
      .insert(academicSessionTeachers)
      .values({ sessionId: session.id, staffId: input.staffId as StaffMemberId, participation: 'planned', role: 'substitute', replacesStaffId: session.teacherStaffId, reason: input.reason, authorisedByUserId: actor.user.id })
      .returning();
    await tx.update(academicClassSessions).set({ version: session.version + 1 }).where(eq(academicClassSessions.id, session.id));
    await audit(tx, actor, { action: 'class_session.substitute_assigned', entityType: 'class_session', entityId: session.id, after: row, metadata: { reason: input.reason, replacesStaffId: session.teacherStaffId, substituteStaffId: input.staffId } });
    return row!;
  });
}

/** Planned and actual teachers of a session with names (for the class page). */
export async function sessionTeachers(db: Database, sessionId: string) {
  return db
    .select({ row: academicSessionTeachers, name: staffMembers.fullName })
    .from(academicSessionTeachers)
    .innerJoin(staffMembers, eq(staffMembers.id, academicSessionTeachers.staffId))
    .where(eq(academicSessionTeachers.sessionId, sessionId as never))
    .then((rows) => rows.map((r) => ({ ...r.row, name: r.name })));
}
