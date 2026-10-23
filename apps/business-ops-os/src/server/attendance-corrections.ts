/**
 * Attendance correction requests (owner brief 23 Oct 2026 §12): staff ask about their own days
 * (reason required, one pending request per day); HR approves or rejects (a rejection needs a
 * note). Approval applies the change — punches as HR entries, a status as an HR decision — and the
 * day is derived again from them. Nobody decides their own request. All audited.
 */
import { and, count, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import { z } from 'zod';
import { can, grantsForRole } from '@elevate/authorization';
import {
  isUniqueViolation,
  opsAttendanceCorrections,
  opsAttendancePunches,
  opsDailyAttendance,
  opsStaffProfiles,
  staffMembers,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, InvalidStateTransitionError } from '@elevate/shared-contracts';
import { ROLE_KEYS, type StaffMemberId, type UserId } from '@elevate/shared-types';
import { addDays, istToday, toIsoDate } from '../domain/dates';
import { hrAttendanceStaff } from './attendance';
import { hrReachWhere, hrScopeFor } from './organisation';
import { manage, saveDecision } from './attendance-actions';
import type {
  correctionBody,
  correctionDecisionBody,
  correctionListQuery,
} from './attendance-schemas';
import {
  accessScope,
  notFound,
  staffIdForUser,
  userIdsForStaff,
  userIdsWithRole,
  type Actor,
} from './context';
import { fieldError, opsAudit, rowById } from './ops-common';
import { notifyHosted } from './task-links';

const audit = opsAudit('attendance_correction');
export const CORRECTIONS_PAGE_SIZE = 25;

export async function requestCorrection(
  db: Database,
  actor: Actor,
  body: z.output<typeof correctionBody>,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:attendance:request');
  const own = access.scope === 'own' ? access.staffId : await staffIdForUser(db, actor.id);
  if (access.scope === 'own' && body.staffId && body.staffId !== own) notFound('Staff member');
  const staffId = ((access.scope === 'all' && body.staffId) ||
    own ||
    notFound('Staff member')) as StaffMemberId;
  if (staffId !== own && !(await hrAttendanceStaff(db, actor, { ids: [staffId] })).length)
    notFound('Staff member');
  if (body.workDate > istToday(new Date()))
    throw fieldError('workDate', 'You can ask about a day once it has happened');
  const nextDay = addDays(body.workDate, 1);
  if (body.requestedIn && toIsoDate(body.requestedIn) !== body.workDate)
    throw fieldError('requestedIn', 'The check-in must be on the day you are correcting');
  if (body.requestedOut && ![body.workDate, nextDay].includes(toIsoDate(body.requestedOut)))
    throw fieldError('requestedOut', 'The check-out must be on that day (or after midnight)');
  if (body.requestedIn && body.requestedOut && body.requestedOut <= body.requestedIn)
    throw fieldError('requestedOut', 'The check-out must be after the check-in');
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(opsAttendanceCorrections)
      .values({
        staffId,
        workDate: body.workDate,
        requestedStatus: body.requestedStatus ?? null,
        requestedIn: body.requestedIn ?? null,
        requestedOut: body.requestedOut ?? null,
        reason: body.reason,
        requestedByUserId: actor.id,
      })
      .returning()
      .catch((e: unknown) => {
        if (isUniqueViolation(e))
          throw new ConflictError('A request for this day is already waiting for HR.');
        throw e;
      });
    await audit(tx, actor, row!.id, 'attendance.correction_requested', { after: row }, requestId);
    await notifyHosted(
      tx,
      actor,
      await attendanceManagers(tx),
      'work',
      '/hr/attendance?tab=corrections',
      {
        kind: 'attendance.correction_requested',
        title: `Attendance correction requested for ${body.workDate}`,
      },
    );
    return row!;
  });
}

export async function decideCorrection(
  db: Database,
  actor: Actor,
  id: string,
  body: z.output<typeof correctionDecisionBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:attendance:manage');
  return withTransaction(db, async (tx) => {
    const c = await rowById(tx, opsAttendanceCorrections, id, 'Correction request', true);
    await manage(tx, actor, c.staffId); // HR's scope first (404), and never your own request
    if (c.status !== 'pending')
      throw new InvalidStateTransitionError('This request has already been decided.');
    const [decided] = await tx
      .select({ id: opsDailyAttendance.id })
      .from(opsDailyAttendance)
      .where(
        and(
          eq(opsDailyAttendance.staffId, c.staffId),
          eq(opsDailyAttendance.workDate, c.workDate),
          eq(opsDailyAttendance.basis, 'hr_decision'),
        ),
      );
    // Times alone never overturn an earlier HR decision for the day: say so instead.
    const decisionKept = body.decision === 'approved' && !c.requestedStatus && Boolean(decided);
    if (body.decision === 'approved') {
      for (const [at, direction] of [
        [c.requestedIn, 'in'],
        [c.requestedOut, 'out'],
      ] as const)
        if (at)
          await tx
            .insert(opsAttendancePunches)
            .values({
              staffId: c.staffId,
              punchedAt: at,
              direction,
              source: 'manual',
              sourceRef: 'Correction approved',
              enteredBy: actor.id,
            })
            .onConflictDoNothing();
      if (c.requestedStatus)
        await saveDecision(
          tx,
          actor,
          {
            staffId: c.staffId,
            workDate: c.workDate,
            status: c.requestedStatus,
            note: `Correction approved: ${body.note ?? c.reason}`,
          },
          requestId,
        );
    }
    const [row] = await tx
      .update(opsAttendanceCorrections)
      .set({
        status: body.decision,
        decidedBy: actor.id,
        decidedAt: new Date(),
        decisionNote: body.note ?? null,
      })
      .where(eq(opsAttendanceCorrections.id, id))
      .returning();
    await audit(
      tx,
      actor,
      id,
      `attendance.correction_${body.decision}`,
      { before: c, after: row },
      requestId,
    );
    await notifyHosted(
      tx,
      actor,
      await userIdsForStaff(tx, [c.staffId]),
      'work',
      '/my-attendance',
      {
        kind: `attendance.correction_${body.decision}`,
        title: `Your attendance correction for ${c.workDate} was ${body.decision}`,
        body: [body.note, decisionKept && KEPT].filter(Boolean).join(' ') || undefined,
      },
    );
    return { ...row!, decisionKept };
  });
}

const KEPT = 'The times were added; the status HR decided earlier for this day still stands.';

/** Everyone who may decide requests (holders of ops:attendance:manage), for notifications. */
async function attendanceManagers(db: Database): Promise<UserId[]> {
  const roles = ROLE_KEYS.filter((r) => grantsForRole(r).has('ops:attendance:manage'));
  const ids: UserId[] = [];
  for (const r of roles) ids.push(...(await userIdsWithRole(db, r)));
  return [...new Set(ids)];
}

/** Correction requests, newest first; own scope = your own; HR sees its department scope. */
export async function listCorrections(
  db: Database,
  actor: Actor,
  query: z.input<typeof correctionListQuery>,
) {
  const access = await accessScope(db, actor, 'ops:attendance:read');
  if (access.scope === 'own' && query.staffId && query.staffId !== access.staffId)
    notFound('Staff member');
  const staffId = access.scope === 'own' ? access.staffId : query.staffId;
  if (access.scope === 'own' && !staffId)
    return { items: [], total: 0, page: 1, pageSize: CORRECTIONS_PAGE_SIZE };
  const where = and(
    staffId ? eq(opsAttendanceCorrections.staffId, staffId as StaffMemberId) : undefined,
    query.status ? eq(opsAttendanceCorrections.status, query.status) : undefined,
    access.scope === 'all' ? hrReachWhere(actor, await hrScopeFor(db, actor)) : undefined,
  );
  const page = Number(query.page ?? 1);
  const [items, [total]] = await Promise.all([
    db
      .select({
        ...getTableColumns(opsAttendanceCorrections),
        staffName: sql<string>`coalesce(${opsStaffProfiles.displayName}, ${staffMembers.fullName})`,
      })
      .from(opsAttendanceCorrections)
      .innerJoin(staffMembers, eq(staffMembers.id, opsAttendanceCorrections.staffId))
      .leftJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
      .where(where)
      .orderBy(desc(opsAttendanceCorrections.createdAt))
      .limit(CORRECTIONS_PAGE_SIZE)
      .offset((page - 1) * CORRECTIONS_PAGE_SIZE),
    db
      .select({ n: count() })
      .from(opsAttendanceCorrections)
      .innerJoin(staffMembers, eq(staffMembers.id, opsAttendanceCorrections.staffId))
      .where(where),
  ]);
  return { items, total: total?.n ?? 0, page, pageSize: CORRECTIONS_PAGE_SIZE };
}

/**
 * Access to one correction request (for its attachments): read = HR/all readers or the person it
 * is about; write = the requester while it is pending, or HR (ops:attendance:manage). Both false
 * when the request does not exist or is not visible (callers answer 404).
 */
export async function correctionAccess(db: Database, user: Actor, correctionId: string) {
  const none = { canRead: false, canWrite: false };
  if (!can(user, 'ops:attendance:read') || !z.uuid().safeParse(correctionId).success) return none;
  const [c] = await db
    .select()
    .from(opsAttendanceCorrections)
    .where(eq(opsAttendanceCorrections.id, correctionId));
  if (!c) return none;
  const access = await accessScope(db, user, 'ops:attendance:read');
  if (access.scope === 'own' && access.staffId !== c.staffId) return none;
  if (access.scope === 'all' && !(await hrAttendanceStaff(db, user, { ids: [c.staffId] })).length)
    return none;
  return {
    canRead: true,
    canWrite:
      can(user, 'ops:attendance:manage') ||
      (c.status === 'pending' && c.requestedByUserId === user.id),
  };
}
