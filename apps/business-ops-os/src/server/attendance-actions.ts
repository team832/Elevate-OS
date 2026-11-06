/**
 * HR attendance records (owner brief 23 Oct 2026 §12; ops:attendance:manage): manual punches, HR
 * day decisions, approved leave, holidays, work schedules and who follows which schedule. Every
 * change is audited. Nobody records or decides their own attendance.
 */
import { and, eq, gte, lte, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  opsAttendancePunches,
  opsDailyAttendance,
  opsHolidays,
  opsLeaveApplications,
  opsLeaveRecords,
  opsStaffProfiles,
  opsWorkSchedules,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
} from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import { istToday } from '../domain/dates';
import {
  LEAVE_NOT_APPROVER,
  leaveAudit,
  leaveRange,
  mayApproveLeave,
  type LeaveDayPart,
} from '../domain/leave';
import { hrAttendanceStaff } from './attendance';
import type {
  assignScheduleBody,
  cancelLeaveBody,
  decisionBody,
  holidayBody,
  leaveBody,
  punchBody,
  scheduleBody,
} from './attendance-schemas';
import { accessScope, notFound, staffIdForUser, userIdsForStaff, type Actor } from './context';
import { refuseOverBalance } from './leave-balances';
import { fieldError, opsAudit, rowById } from './ops-common';
import { loadSettings } from './settings';
import { notifyHosted } from './task-links';

const audit = opsAudit('attendance');

/**
 * HR access to one person's attendance: inside HR's department scope (else 404), and never your
 * own record (nobody records their own attendance).
 */
export const OWN_RECORD = 'Another HR person must record this.';

export async function manage(db: Database, actor: Actor, staffId?: string) {
  await accessScope(db, actor, 'ops:attendance:manage');
  if (!staffId) return;
  if (!(await hrAttendanceStaff(db, actor, { ids: [staffId] })).length) notFound('Staff member');
  if ((await staffIdForUser(db, actor.id)) === staffId) throw new ForbiddenError(OWN_RECORD);
}

export async function recordPunch(
  db: Database,
  actor: Actor,
  body: z.output<typeof punchBody>,
  requestId?: string,
) {
  await manage(db, actor, body.staffId);
  if (body.at > new Date()) throw fieldError('at', 'A punch cannot be in the future');
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(opsAttendancePunches)
      .values({
        staffId: body.staffId as StaffMemberId,
        punchedAt: body.at,
        direction: body.direction,
        source: 'manual',
        sourceRef: body.note ?? 'Entered by HR',
        enteredBy: actor.id,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictError('This check-in or check-out is already recorded.');
    await audit(tx, actor, row.id, 'attendance.punch_recorded', { after: row }, requestId);
    return row;
  });
}

/** HR's status for a day (basis hr_decision): kept over every later recomputation. */
export async function decideDay(
  db: Database,
  actor: Actor,
  body: z.output<typeof decisionBody>,
  requestId?: string,
) {
  await manage(db, actor, body.staffId);
  if (body.workDate > istToday(new Date()))
    throw fieldError('workDate', 'Decide a day once it has happened; record leave in advance');
  return withTransaction(db, (tx) => saveDecision(tx, actor, body, requestId));
}

/** Upsert an HR decision row (also used when a correction is approved). */
export async function saveDecision(
  tx: Database,
  actor: Actor,
  d: {
    staffId: string;
    workDate: string;
    status: (typeof opsDailyAttendance.$inferInsert)['status'];
    note: string;
  },
  requestId?: string,
) {
  if (d.status === 'absent' && (await approvedLeaveOver(tx, d.staffId, d.workDate, d.workDate)))
    throw new ConflictError(
      'This day is on approved leave, so it already counts as leave. Cancel the leave first to mark it absent.',
    );
  const values = {
    status: d.status,
    basis: 'hr_decision' as const,
    decidedByUserId: actor.id,
    note: d.note,
    updatedAt: new Date(),
  };
  const [before] = await tx
    .select()
    .from(opsDailyAttendance)
    .where(
      and(
        eq(opsDailyAttendance.staffId, d.staffId as StaffMemberId),
        eq(opsDailyAttendance.workDate, d.workDate),
      ),
    );
  const [row] = await tx
    .insert(opsDailyAttendance)
    .values({ staffId: d.staffId as StaffMemberId, workDate: d.workDate, ...values })
    .onConflictDoUpdate({
      target: [opsDailyAttendance.staffId, opsDailyAttendance.workDate],
      set: values,
    })
    .returning();
  await audit(tx, actor, row!.id, 'attendance.day_decided', { before, after: row }, requestId);
  return row!;
}

const approvedLeaveOver = async (tx: Database, staffId: string, from: string, to: string) =>
  (
    await tx
      .select({ fromDate: opsLeaveRecords.fromDate, toDate: opsLeaveRecords.toDate })
      .from(opsLeaveRecords)
      .where(
        and(
          eq(opsLeaveRecords.staffId, staffId as StaffMemberId),
          eq(opsLeaveRecords.status, 'approved'),
          lte(opsLeaveRecords.fromDate, to),
          gte(opsLeaveRecords.toDate, from),
        ),
      )
      .limit(1)
  )[0];

/**
 * Locks one person's leave dates for this transaction (applying, recording and approving all take
 * it, so the second of two at once sees the first), then refuses approved leave over them.
 */
export async function holdLeaveDates(tx: Database, staffId: string, from: string, to: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`ops.leave_applications:${staffId}`}))`,
  );
  const clash = await approvedLeaveOver(tx, staffId, from, to);
  if (clash)
    throw new ConflictError(
      `Approved leave is already recorded for ${leaveRange(clash.fromDate, clash.toDate)}. Choose other dates, or have that leave cancelled first.`,
    );
}

type LeaveInput = Omit<z.output<typeof leaveBody>, 'dayPart'> & {
  dayPart?: LeaveDayPart | null;
  isSample?: boolean;
};

/**
 * HR records approved leave directly: within setting hr.leave_approver and HR's scope, never your
 * own, of a type in hr.leave_types (so balances and unpaid days see it, as for an application).
 */
export async function recordLeave(
  db: Database,
  actor: Actor,
  body: LeaveInput,
  requestId?: string,
) {
  await manage(db, actor, body.staffId);
  const settings = await loadSettings(db);
  if (!mayApproveLeave(actor.roles, settings['hr.leave_approver'].value.who))
    throw new ForbiddenError(LEAVE_NOT_APPROVER);
  if (!settings['hr.leave_types'].value.types.includes(body.kind))
    throw fieldError('kind', 'Choose a leave type from the list');
  return withTransaction(db, (tx) => writeLeave(tx, actor, body, requestId));
}

/**
 * The leave record, for a caller that has checked who may approve it: recordLeave, or decideLeave
 * naming the application in `applicationId`. Never over approved leave, a pending application or
 * (under "Leave balances: refuse") the balance.
 */
export async function writeLeave(
  tx: Database,
  actor: Actor,
  { applicationId, ...body }: LeaveInput & { applicationId?: string },
  requestId?: string,
) {
  await holdLeaveDates(tx, body.staffId, body.fromDate, body.toDate);
  // Recorded over a waiting application, that application could never be approved.
  const [pending] = await tx
    .select({ fromDate: opsLeaveApplications.fromDate, toDate: opsLeaveApplications.toDate })
    .from(opsLeaveApplications)
    .where(
      and(
        eq(opsLeaveApplications.staffId, body.staffId as StaffMemberId),
        eq(opsLeaveApplications.status, 'pending'),
        lte(opsLeaveApplications.fromDate, body.toDate),
        gte(opsLeaveApplications.toDate, body.fromDate),
        applicationId ? ne(opsLeaveApplications.id, applicationId) : undefined,
      ),
    )
    .limit(1);
  if (pending)
    throw new ConflictError(
      `There is a pending leave application for ${leaveRange(pending.fromDate, pending.toDate)}. Decide it instead, on the Leave applications tab.`,
    );
  await refuseOverBalance(tx, body);
  const [row] = await tx
    .insert(opsLeaveRecords)
    .values({ ...body, staffId: body.staffId as StaffMemberId, approvedBy: actor.id })
    .returning();
  await audit(tx, actor, row!.id, 'attendance.leave_recorded', leaveAudit({ after: row }), requestId);
  return row!;
}

/** Cancel approved leave (the days are worked out again without it) and any application it came from. Not your own. */
export async function cancelLeave(
  db: Database,
  actor: Actor,
  id: string,
  body: z.output<typeof cancelLeaveBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:attendance:manage');
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, opsLeaveRecords, id, 'Leave', true);
    await manage(tx, actor, before.staffId);
    if (before.status === 'cancelled')
      throw new InvalidStateTransitionError('This leave is already cancelled.');
    const [row] = await tx
      .update(opsLeaveRecords)
      .set({
        status: 'cancelled',
        // Not in the audit trail (words about leave): the record keeps them, for the same few readers.
        reason: sql`concat_ws('. ', ${opsLeaveRecords.reason}, ${`Cancelled: ${body.reason}`}::text)`,
        updatedAt: new Date(),
      })
      .where(eq(opsLeaveRecords.id, id))
      .returning();
    await audit(tx, actor, id, 'attendance.leave_cancelled', leaveAudit({ before, after: row }), requestId);
    const [application] = await tx
      .update(opsLeaveApplications)
      .set({
        status: 'cancelled',
        cancelledBy: actor.id,
        cancelledAt: new Date(),
        cancelReason: body.reason,
        version: sql`${opsLeaveApplications.version} + 1`,
      })
      .where(
        and(eq(opsLeaveApplications.leaveRecordId, id), eq(opsLeaveApplications.status, 'approved')),
      )
      .returning();
    if (application) {
      // Inside the transaction: throwing here undoes both updates above.
      if (!mayApproveLeave(actor.roles, (await loadSettings(tx))['hr.leave_approver'].value.who))
        throw new ForbiddenError(LEAVE_NOT_APPROVER);
      await opsAudit('leave_application')(
        tx,
        actor,
        application.id,
        'leave.cancelled',
        leaveAudit({ after: application }),
        requestId,
      );
      await notifyHosted(
        tx,
        actor,
        await userIdsForStaff(tx, [application.staffId]),
        'work',
        '/my-attendance?view=leave',
        {
          kind: 'leave.cancelled',
          title: `Your ${application.kind} leave for ${leaveRange(application.fromDate, application.toDate)} was cancelled by HR`,
          body: body.reason,
          entityType: 'leave_application',
          entityId: application.id,
        },
      );
    }
    return row!;
  });
}

/** Approve a proposed holiday (only then does it change the day) or remove it; a locked one stays. */
export async function decideHoliday(
  db: Database,
  actor: Actor,
  id: string,
  action: 'approve' | 'remove',
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:hr_settings:manage');
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, opsHolidays, id, 'Holiday', true);
    if (before.decisionState === 'locked')
      throw new InvalidStateTransitionError('This holiday is locked; it cannot be changed here.');
    const where = eq(opsHolidays.id, id);
    const [row] =
      action === 'approve'
        ? await tx.update(opsHolidays).set({ decisionState: 'approved' }).where(where).returning()
        : await tx.delete(opsHolidays).where(where).returning();
    const verb = action === 'approve' ? 'approved' : 'removed';
    await audit(tx, actor, id, `attendance.holiday_${verb}`, { before, after: row }, requestId);
    return row!;
  });
}

export async function addHoliday(
  db: Database,
  actor: Actor,
  body: z.output<typeof holidayBody>,
  requestId?: string,
) {
  await manage(db, actor);
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(opsHolidays)
      .values({ ...body, branchId: (body.branchId ?? null) as never, createdBy: actor.id })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictError('A holiday is already recorded on that day.');
    await audit(tx, actor, row.id, 'attendance.holiday_added', { after: row }, requestId);
    return row;
  });
}

/** Create (no id) or replace a schedule; a new default schedule takes over from the old one. */
export async function saveSchedule(
  db: Database,
  actor: Actor,
  body: z.output<typeof scheduleBody>,
  id?: string,
  requestId?: string,
) {
  await manage(db, actor);
  return withTransaction(db, async (tx) => {
    const before = id ? await rowById(tx, opsWorkSchedules, id, 'Schedule', true) : undefined;
    const [clash] = await tx
      .select({ id: opsWorkSchedules.id })
      .from(opsWorkSchedules)
      .where(
        and(eq(opsWorkSchedules.name, body.name), id ? ne(opsWorkSchedules.id, id) : undefined),
      );
    if (clash) throw fieldError('name', 'Another schedule has this name');
    if (body.isDefault)
      await tx
        .update(opsWorkSchedules)
        .set({ isDefault: false })
        .where(eq(opsWorkSchedules.isDefault, true));
    const [row] = id
      ? await tx
          .update(opsWorkSchedules)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(opsWorkSchedules.id, id))
          .returning()
      : await tx
          .insert(opsWorkSchedules)
          .values({ ...body, createdBy: actor.id })
          .returning();
    await audit(
      tx,
      actor,
      row!.id,
      id ? 'attendance.schedule_changed' : 'attendance.schedule_created',
      { before, after: row },
      requestId,
    );
    return row!;
  });
}

/** Who follows which schedule (staff_profiles.work_schedule_id; null = the default one). */
export async function assignSchedule(
  db: Database,
  actor: Actor,
  body: z.output<typeof assignScheduleBody>,
  requestId?: string,
) {
  await manage(db, actor, body.staffId);
  return withTransaction(db, async (tx) => {
    if (body.scheduleId) await rowById(tx, opsWorkSchedules, body.scheduleId, 'Schedule');
    const set = { workScheduleId: body.scheduleId, updatedBy: actor.id, updatedAt: new Date() };
    const [before] = await tx
      .select({ workScheduleId: opsStaffProfiles.workScheduleId })
      .from(opsStaffProfiles)
      .where(eq(opsStaffProfiles.staffId, body.staffId as StaffMemberId));
    await tx
      .insert(opsStaffProfiles)
      .values({ staffId: body.staffId as StaffMemberId, ...set })
      .onConflictDoUpdate({ target: opsStaffProfiles.staffId, set });
    await audit(
      tx,
      actor,
      body.staffId,
      'attendance.schedule_assigned',
      { before, after: { workScheduleId: body.scheduleId } },
      requestId,
    );
    return { staffId: body.staffId, scheduleId: body.scheduleId };
  });
}
