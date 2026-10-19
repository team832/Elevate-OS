/**
 * Leave (OPS-055…OPS-058): leave types (proposed until the owner decides,
 * OD-026), requests LVR-###### with half days, overlap detection, working-day
 * counting (shift weekdays, else the proposed default work week; holidays
 * excluded), approval within HR scope and never by the employee, cancellation
 * rules, the balance ledger (usage on approval, reversal on cancellation;
 * "not configured" without an allocation) and team availability.
 *
 * Permissions: read `ops:leave:read` · request/cancel own `ops:leave:request`
 * · decide `ops:leave:approve` · types, holidays, ledger `ops:leave:manage`.
 */
import { and, asc, desc, eq, gte, inArray, lte, ne, sql, type SQL } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  opsLeaveLedgerEntries,
  opsLeaveRequests,
  opsLeaveTypes,
  staffMembers,
  type Database,
  type OpsLeaveRequestId,
  type OpsLeaveTypeId,
} from '@elevate/database';
import { notify } from '@elevate/notifications';
import { recordAudit, withTransaction } from '@elevate/server-kit';
import { ConflictError, ForbiddenError, ValidationError } from '@elevate/shared-contracts';
import type { IsoDate, StaffMemberId } from '@elevate/shared-types';
import { daysBetween } from '../../domain/dates';
import { checkDecision } from '../../domain/hr/attendance';
import { eachDate, holidaysFor, weekday, zonedDate } from '../../domain/hr/calendar';
import {
  availabilityGrid,
  balanceFromLedger,
  checkLeaveCancel,
  countLeaveDays,
  overlappingLeave,
  validateLeaveSpan,
  type LeavePart,
  type LeaveSpan,
} from '../../domain/hr/leave';
import { nextCode, notFound, userIdsForStaff, type Actor } from '../context';
import { assertHrScope, assertNotSelf, hrCovers, hrScope, hrScopeIds } from '../hr-scope';
import {
  approverUserIds,
  decider,
  employeeSchedule,
  issuesError,
  loadEmployee,
  lockStaff,
  stripUndefined,
  throwCheck,
  loadEmployees,
  loadScheduleContext,
  PAGE_SIZE,
  timeSettings,
  type TimeEmployee,
} from './shifts';
import type {
  CreateLeaveInput,
  CreateLeaveTypeInput,
  LeaveListQuery,
  LedgerEntryInput,
  UpdateLeaveTypeInput,
} from './time-schemas';

export type LeaveRequestRow = typeof opsLeaveRequests.$inferSelect;

// --- leave types ------------------------------------------------------------------------------

export async function listLeaveTypes(db: Database, actor: Actor, includeRetired = false) {
  await hrScope(db, actor, 'ops:leave:read');
  return db
    .select()
    .from(opsLeaveTypes)
    .where(includeRetired ? undefined : ne(opsLeaveTypes.status, 'retired'))
    .orderBy(asc(opsLeaveTypes.code));
}

export async function createLeaveType(
  db: Database,
  actor: Actor,
  input: CreateLeaveTypeInput,
  requestId?: string,
) {
  await hrScope(db, actor, 'ops:leave:manage');
  return withTransaction(db, async (tx) => {
    const [clash] = await tx
      .select({ id: opsLeaveTypes.id })
      .from(opsLeaveTypes)
      .where(eq(opsLeaveTypes.code, input.code));
    if (clash) throw new ConflictError(`Leave type ${input.code} exists.`);
    const [row] = await tx
      .insert(opsLeaveTypes)
      .values({
        ...input,
        description: input.description ?? null,
        status: 'proposed',
        createdBy: actor.id,
      })
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'leave_type.created',
      entityType: 'leave_type',
      entityId: row!.id,
      after: row,
      requestId,
    });
    return row!;
  });
}

export async function updateLeaveType(
  db: Database,
  actor: Actor,
  id: string,
  input: UpdateLeaveTypeInput,
  requestId?: string,
) {
  await hrScope(db, actor, 'ops:leave:manage');
  return withTransaction(db, async (tx) => {
    const [before] = await tx
      .select()
      .from(opsLeaveTypes)
      .where(eq(opsLeaveTypes.id, id as OpsLeaveTypeId))
      .for('update');
    if (!before) notFound('Leave type');
    const patch = stripUndefined(input);
    if (Object.keys(patch).length === 0) throw new ValidationError('Nothing to change.');
    const [after] = await tx
      .update(opsLeaveTypes)
      .set(patch)
      .where(eq(opsLeaveTypes.id, before.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action:
        input.status && input.status !== before.status
          ? `leave_type.${input.status}`
          : 'leave_type.updated',
      entityType: 'leave_type',
      entityId: before.id,
      before,
      after,
      requestId,
    });
    return after!;
  });
}

// --- working days -----------------------------------------------------------------------------

/** Working-day test and holidays for one employee over a range. */
export async function workingDayContext(db: Database, e: TimeEmployee, from: IsoDate, to: IsoDate) {
  const settings = await timeSettings(db);
  const ctx = await loadScheduleContext(db, [e.staffId], from, to);
  const assignments = ctx.assignmentsByStaff.get(e.staffId) ?? [];
  const holidays = holidaysFor(ctx.holidays, e.workLocation, settings.countProposedHolidays);
  let usedDefault = false;
  const isWorkingDay = (date: IsoDate) => {
    const covering = assignments
      .filter((a) => a.fromDate <= date && (a.toDate === null || a.toDate >= date))
      .map((a) => ctx.templates.get(a.shiftTemplateId))
      .filter((t) => t && t.status !== 'retired');
    if (covering.length === 0) {
      usedDefault = true;
      return settings.defaultWorkingWeekdays.includes(weekday(date));
    }
    return covering.some((t) => t!.workingWeekdays.includes(weekday(date)));
  };
  return {
    isWorkingDay,
    holidays,
    /** Call after counting: whether any day fell back to the proposed default work week. */
    usedDefault: () => usedDefault,
    ctx,
    settings,
  };
}

function spanOf(
  r: Pick<LeaveRequestRow, 'startDate' | 'endDate' | 'startPart' | 'endPart'>,
): LeaveSpan {
  return { startDate: r.startDate, endDate: r.endDate, startPart: r.startPart, endPart: r.endPart };
}

/** Leave days counted per date for an employee's approved leave in a range. */
export async function approvedLeaveByDate(
  db: Database,
  e: TimeEmployee,
  from: IsoDate,
  to: IsoDate,
): Promise<Map<string, number>> {
  const rows = await db
    .select()
    .from(opsLeaveRequests)
    .where(
      and(
        eq(opsLeaveRequests.staffId, e.staffId),
        eq(opsLeaveRequests.status, 'approved'),
        lte(opsLeaveRequests.startDate, to),
        gte(opsLeaveRequests.endDate, from),
      ),
    );
  const out = new Map<string, number>();
  if (!rows.length) return out;
  const minStart = rows.reduce((m, r) => (r.startDate < m ? r.startDate : m), from as string);
  const maxEnd = rows.reduce((m, r) => (r.endDate > m ? r.endDate : m), to as string);
  const wd = await workingDayContext(db, e, minStart as IsoDate, maxEnd as IsoDate);
  for (const r of rows)
    for (const d of countLeaveDays(spanOf(r), wd.isWorkingDay, wd.holidays).perDate)
      if (d.date >= from && d.date <= to && d.fraction > 0)
        out.set(d.date, (out.get(d.date) ?? 0) + d.fraction);
  return out;
}

// --- requests ---------------------------------------------------------------------------------

export async function createLeaveRequest(
  db: Database,
  actor: Actor,
  input: CreateLeaveInput,
  requestId?: string,
) {
  const scope = await hrScope(db, actor, 'ops:leave:request');
  const staffId = input.staffId ?? scope.staffId;
  if (!staffId) throw new ForbiddenError('Your account is not linked to a staff record.');
  if (staffId !== scope.staffId && scope.scope !== 'all')
    throw new ForbiddenError('You can only request leave for yourself.');
  const e = await loadEmployee(db, staffId);
  const [type] = await db
    .select()
    .from(opsLeaveTypes)
    .where(eq(opsLeaveTypes.id, input.leaveTypeId as OpsLeaveTypeId));
  if (!type || type.status === 'retired')
    throw new ValidationError('Unknown or retired leave type.', {
      details: [{ location: 'body', path: ['leaveTypeId'], message: 'Unknown or retired' }],
    });
  const span: LeaveSpan = {
    startDate: input.startDate,
    endDate: input.endDate,
    startPart: input.startPart,
    endPart: (input.endPart ??
      (input.startDate === input.endDate ? input.startPart : 'full')) as LeavePart,
  };
  const issues = validateLeaveSpan(span, type.halfDayAllowed);
  if (type.requiresDocument && !input.documentRef?.trim())
    issues.push({
      path: 'documentRef',
      message: 'This leave type needs a supporting document reference.',
    });
  issuesError(issues);
  if (daysBetween(span.startDate as IsoDate, span.endDate as IsoDate) > 365)
    throw new ValidationError('Leave longer than a year is not accepted here.');
  const wd = await workingDayContext(db, e, span.startDate as IsoDate, span.endDate as IsoDate);
  const count = countLeaveDays(span, wd.isWorkingDay, wd.holidays);
  if (count.days === 0)
    throw new ValidationError('These dates contain no working days for this employee.', {
      details: [{ location: 'body', path: ['startDate'], message: 'No working days' }],
    });
  return withTransaction(db, async (tx) => {
    await lockStaff(tx, 'leave', staffId);
    const existing = await tx
      .select()
      .from(opsLeaveRequests)
      .where(
        and(
          eq(opsLeaveRequests.staffId, staffId as StaffMemberId),
          inArray(opsLeaveRequests.status, ['pending', 'approved']),
          lte(opsLeaveRequests.startDate, span.endDate),
          gte(opsLeaveRequests.endDate, span.startDate),
        ),
      );
    const clashes = overlappingLeave(span, existing);
    if (clashes.length)
      throw new ConflictError(
        `This overlaps leave already requested: ${clashes.map((c) => c.code).join(', ')}.`,
        {
          details: { overlaps: clashes.map((c) => ({ id: c.id, code: c.code, status: c.status })) },
        },
      );
    const code = await nextCode(tx, 'leaveRequest', 'ops.leave_requests');
    const [row] = await tx
      .insert(opsLeaveRequests)
      .values({
        code,
        staffId: staffId as StaffMemberId,
        leaveTypeId: type.id,
        startDate: span.startDate,
        endDate: span.endDate,
        startPart: span.startPart,
        endPart: span.endPart,
        workingDays: String(count.days),
        reason: input.reason ?? null,
        documentRef: input.documentRef ?? null,
        requestedBy: actor.id,
      })
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'leave_request.created',
      entityType: 'leave_request',
      entityId: row!.id,
      after: { ...row, basis: wd.usedDefault() ? 'default_work_week' : 'shift' },
      requestId,
    });
    const approvers = await approverUserIds(tx, e, actor.id);
    if (approvers.length)
      await notify(tx, {
        userIds: approvers,
        module: 'ops',
        kind: 'leave.requested',
        title: `Leave request ${code}: ${e.fullName}, ${span.startDate} – ${span.endDate}`,
        body: `${type.name}, ${count.days} working day(s).`,
        link: `/ops/hr/leave/${row!.id}`,
        entityType: 'leave_request',
        entityId: row!.id,
      });
    return {
      ...row!,
      perDate: count.perDate,
      countBasis: wd.usedDefault() ? 'default_work_week' : 'shift',
    };
  });
}

export async function decideLeaveRequest(
  db: Database,
  actor: Actor,
  id: string,
  input: { decision: 'approve' | 'reject'; note?: string | null },
  requestId?: string,
  now = new Date(),
) {
  const scope = await hrScope(db, actor, 'ops:leave:approve');
  return withTransaction(db, async (tx) => {
    const [r] = await tx
      .select()
      .from(opsLeaveRequests)
      .where(eq(opsLeaveRequests.id, id as OpsLeaveRequestId))
      .for('update');
    if (!r) notFound('Leave request');
    assertHrScope(scope, r.staffId, 'this leave request');
    const to = input.decision === 'approve' ? 'approved' : 'rejected';
    throwCheck(
      checkDecision({
        from: r.status,
        to,
        actorUserId: actor.id,
        requestedByUserId: r.requestedBy,
        actorStaffId: scope.staffId,
        subjectStaffId: r.staffId,
        note: input.note,
      }),
    );
    const [after] = await tx
      .update(opsLeaveRequests)
      .set({ status: to, decidedBy: actor.id, decidedAt: now, decisionNote: input.note ?? null })
      .where(eq(opsLeaveRequests.id, r.id))
      .returning();
    if (to === 'approved')
      await tx
        .insert(opsLeaveLedgerEntries)
        .values({
          staffId: r.staffId,
          leaveTypeId: r.leaveTypeId,
          entryType: 'usage',
          days: String(-Number(r.workingDays)),
          effectiveDate: r.startDate,
          leaveRequestId: r.id,
          note: `Approved ${r.code}`,
          createdBy: actor.id,
        })
        .onConflictDoNothing();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: `leave_request.${to}`,
      entityType: 'leave_request',
      entityId: r.id,
      before: { status: r.status },
      after: {
        status: to,
        note: input.note ?? null,
        usageDays: to === 'approved' ? -Number(r.workingDays) : null,
      },
      requestId,
    });
    const recipients = [
      ...new Set([r.requestedBy, ...(await userIdsForStaff(tx, [r.staffId]))]),
    ].filter((u) => u !== actor.id);
    if (recipients.length)
      await notify(tx, {
        userIds: recipients,
        module: 'ops',
        kind: `leave.${to}`,
        title: `Leave ${r.code} ${to}`,
        body: input.note ?? undefined,
        link: `/ops/hr/leave/${r.id}`,
        entityType: 'leave_request',
        entityId: r.id,
      });
    return after!;
  });
}

export async function cancelLeaveRequest(
  db: Database,
  actor: Actor,
  id: string,
  input: { reason?: string | null },
  requestId?: string,
  now = new Date(),
) {
  if (!can(actor, 'ops:leave:request') && !can(actor, 'ops:leave:approve'))
    throw new ForbiddenError('You cannot cancel leave.');
  const requestScope = can(actor, 'ops:leave:request')
    ? await hrScope(db, actor, 'ops:leave:request')
    : null;
  const approveScope = can(actor, 'ops:leave:approve')
    ? await hrScope(db, actor, 'ops:leave:approve')
    : null;
  const actorStaffId = requestScope?.staffId ?? approveScope?.staffId ?? null;
  return withTransaction(db, async (tx) => {
    const [r] = await tx
      .select()
      .from(opsLeaveRequests)
      .where(eq(opsLeaveRequests.id, id as OpsLeaveRequestId))
      .for('update');
    if (!r) notFound('Leave request');
    const isSubject = actorStaffId !== null && actorStaffId === r.staffId;
    const isRequester = r.requestedBy === actor.id;
    const canApprove = approveScope !== null && hrCovers(approveScope, r.staffId) && !isSubject;
    if (!isSubject && !isRequester && !canApprove)
      throw new ForbiddenError('You cannot cancel this leave request.');
    const e = await loadEmployee(tx, r.staffId);
    const check = checkLeaveCancel({
      status: r.status,
      startDate: r.startDate,
      today: zonedDate(now, e.timezone),
      actorIsRequesterOrSubject: isSubject || isRequester,
      actorCanApprove: canApprove,
      actorIsSubject: isSubject,
      reason: input.reason,
    });
    throwCheck(check, 'reason');
    const [after] = await tx
      .update(opsLeaveRequests)
      .set({
        status: 'cancelled',
        cancelledBy: actor.id,
        cancelledAt: now,
        cancelReason: input.reason ?? null,
      })
      .where(eq(opsLeaveRequests.id, r.id))
      .returning();
    let reversal: number | null = null;
    if (r.status === 'approved') {
      const [usage] = await tx
        .select()
        .from(opsLeaveLedgerEntries)
        .where(
          and(
            eq(opsLeaveLedgerEntries.leaveRequestId, r.id),
            eq(opsLeaveLedgerEntries.entryType, 'usage'),
          ),
        );
      if (usage) {
        reversal = -Number(usage.days);
        await tx
          .insert(opsLeaveLedgerEntries)
          .values({
            staffId: r.staffId,
            leaveTypeId: r.leaveTypeId,
            entryType: 'reversal',
            days: String(reversal),
            effectiveDate: zonedDate(now, e.timezone),
            leaveRequestId: r.id,
            note: `Cancelled ${r.code}${input.reason ? `: ${input.reason}` : ''}`,
            createdBy: actor.id,
          })
          .onConflictDoNothing();
      }
    }
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'leave_request.cancelled',
      entityType: 'leave_request',
      entityId: r.id,
      before: { status: r.status },
      after: { status: 'cancelled', reason: input.reason ?? null, reversalDays: reversal },
      requestId,
    });
    const recipients = [
      ...new Set([
        r.requestedBy,
        ...(await userIdsForStaff(tx, [r.staffId])),
        ...(r.decidedBy ? [r.decidedBy] : []),
      ]),
    ].filter((u) => u !== actor.id);
    if (recipients.length)
      await notify(tx, {
        userIds: recipients,
        module: 'ops',
        kind: 'leave.cancelled',
        title: `Leave ${r.code} cancelled`,
        body: input.reason ?? undefined,
        link: `/ops/hr/leave/${r.id}`,
        entityType: 'leave_request',
        entityId: r.id,
      });
    return after!;
  });
}

export async function listLeaveRequests(
  db: Database,
  actor: Actor,
  query: Partial<LeaveListQuery> = {},
) {
  const scope = await hrScope(db, actor, 'ops:leave:read');
  if (query.staffId) assertHrScope(scope, query.staffId);
  const ids = hrScopeIds(scope);
  const page = query.page ?? 1;
  const empty = { rows: [], page, pageSize: PAGE_SIZE, total: 0 };
  if (ids && ids.length === 0) return empty;
  const conds: SQL[] = [];
  if (ids) conds.push(inArray(opsLeaveRequests.staffId, ids));
  if (query.view === 'mine') {
    if (!scope.staffId) return empty;
    conds.push(eq(opsLeaveRequests.staffId, scope.staffId));
  }
  const approve = can(actor, 'ops:leave:approve')
    ? await hrScope(db, actor, 'ops:leave:approve')
    : null;
  const canDecide = await decider(db, actor, 'ops:leave:approve');
  if (query.view === 'to_decide') {
    if (!approve) return empty;
    conds.push(eq(opsLeaveRequests.status, 'pending'));
    conds.push(ne(opsLeaveRequests.requestedBy, actor.id));
    const approveIds = hrScopeIds(approve);
    if (approveIds)
      conds.push(
        inArray(
          opsLeaveRequests.staffId,
          approveIds.length
            ? approveIds
            : ['00000000-0000-0000-0000-000000000000' as StaffMemberId],
        ),
      );
    if (approve.staffId) conds.push(ne(opsLeaveRequests.staffId, approve.staffId));
  }
  if (query.staffId) conds.push(eq(opsLeaveRequests.staffId, query.staffId as StaffMemberId));
  if (query.status) conds.push(eq(opsLeaveRequests.status, query.status));
  if (query.from) conds.push(gte(opsLeaveRequests.endDate, query.from));
  if (query.to) conds.push(lte(opsLeaveRequests.startDate, query.to));
  const where = conds.length ? and(...conds) : undefined;
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(opsLeaveRequests)
    .where(where);
  const rows = await db
    .select({
      r: opsLeaveRequests,
      fullName: staffMembers.fullName,
      typeCode: opsLeaveTypes.code,
      typeName: opsLeaveTypes.name,
    })
    .from(opsLeaveRequests)
    .innerJoin(staffMembers, eq(staffMembers.id, opsLeaveRequests.staffId))
    .innerJoin(opsLeaveTypes, eq(opsLeaveTypes.id, opsLeaveRequests.leaveTypeId))
    .where(where)
    .orderBy(desc(opsLeaveRequests.startDate), desc(opsLeaveRequests.code))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  return {
    rows: rows.map((x) => ({
      ...x.r,
      workingDays: Number(x.r.workingDays),
      fullName: x.fullName,
      typeCode: x.typeCode,
      typeName: x.typeName,
      canDecide: x.r.status === 'pending' && canDecide(x.r.staffId, x.r.requestedBy),
    })),
    page,
    pageSize: PAGE_SIZE,
    total,
  };
}

export async function getLeaveRequest(db: Database, actor: Actor, id: string, now = new Date()) {
  const scope = await hrScope(db, actor, 'ops:leave:read');
  const [r] = await db
    .select({ r: opsLeaveRequests, type: opsLeaveTypes })
    .from(opsLeaveRequests)
    .innerJoin(opsLeaveTypes, eq(opsLeaveTypes.id, opsLeaveRequests.leaveTypeId))
    .where(eq(opsLeaveRequests.id, id as OpsLeaveRequestId));
  if (!r) notFound('Leave request');
  assertHrScope(scope, r.r.staffId, 'this leave request');
  const e = await loadEmployee(db, r.r.staffId);
  const wd = await workingDayContext(db, e, r.r.startDate as IsoDate, r.r.endDate as IsoDate);
  const count = countLeaveDays(spanOf(r.r), wd.isWorkingDay, wd.holidays);
  const ledger = await db
    .select()
    .from(opsLeaveLedgerEntries)
    .where(eq(opsLeaveLedgerEntries.leaveRequestId, r.r.id))
    .orderBy(asc(opsLeaveLedgerEntries.createdAt));
  const approve = can(actor, 'ops:leave:approve')
    ? await hrScope(db, actor, 'ops:leave:approve')
    : null;
  const isSubject = scope.staffId === r.r.staffId;
  const canApprove =
    approve !== null && hrCovers(approve, r.r.staffId) && approve.staffId !== r.r.staffId;
  const cancel = checkLeaveCancel({
    status: r.r.status,
    startDate: r.r.startDate,
    today: zonedDate(now, e.timezone),
    actorIsRequesterOrSubject:
      (isSubject && can(actor, 'ops:leave:request')) || r.r.requestedBy === actor.id,
    actorCanApprove: canApprove,
    actorIsSubject: isSubject,
    reason: 'check',
  });
  return {
    request: { ...r.r, workingDays: Number(r.r.workingDays) },
    type: r.type,
    employee: e,
    perDate: count.perDate,
    countBasis: wd.usedDefault() ? 'default_work_week' : 'shift',
    ledger: ledger.map((l) => ({ ...l, days: Number(l.days) })),
    canDecide: r.r.status === 'pending' && canApprove && r.r.requestedBy !== actor.id,
    canCancel: cancel.ok,
    cancelNeedsReason: r.r.status === 'approved' && r.r.startDate <= zonedDate(now, e.timezone),
  };
}

// --- balances ---------------------------------------------------------------------------------

export async function listLeaveBalances(
  db: Database,
  actor: Actor,
  query: { staffId?: string } = {},
) {
  const scope = await hrScope(db, actor, 'ops:leave:read');
  if (query.staffId) assertHrScope(scope, query.staffId);
  const ids = query.staffId ? [query.staffId] : hrScopeIds(scope);
  const employees = await loadEmployees(db, ids);
  const types = await db.select().from(opsLeaveTypes).orderBy(asc(opsLeaveTypes.code));
  const entries = employees.length
    ? await db
        .select()
        .from(opsLeaveLedgerEntries)
        .where(
          inArray(
            opsLeaveLedgerEntries.staffId,
            employees.map((e) => e.staffId),
          ),
        )
        .orderBy(asc(opsLeaveLedgerEntries.effectiveDate), asc(opsLeaveLedgerEntries.createdAt))
    : [];
  return employees.map((e) => ({
    staffId: e.staffId,
    fullName: e.fullName,
    employeeCode: e.employeeCode,
    balances: types
      .filter(
        (t) =>
          t.status !== 'retired' ||
          entries.some((x) => x.staffId === e.staffId && x.leaveTypeId === t.id),
      )
      .map((t) => ({
        leaveTypeId: t.id,
        code: t.code,
        name: t.name,
        typeStatus: t.status,
        balance: balanceFromLedger(
          entries.filter((x) => x.staffId === e.staffId && x.leaveTypeId === t.id),
        ),
      })),
  }));
}

export async function listLedger(db: Database, actor: Actor, staffId: string) {
  const scope = await hrScope(db, actor, 'ops:leave:read');
  assertHrScope(scope, staffId);
  const rows = await db
    .select({
      l: opsLeaveLedgerEntries,
      typeCode: opsLeaveTypes.code,
      requestCode: opsLeaveRequests.code,
    })
    .from(opsLeaveLedgerEntries)
    .innerJoin(opsLeaveTypes, eq(opsLeaveTypes.id, opsLeaveLedgerEntries.leaveTypeId))
    .leftJoin(opsLeaveRequests, eq(opsLeaveRequests.id, opsLeaveLedgerEntries.leaveRequestId))
    .where(eq(opsLeaveLedgerEntries.staffId, staffId as StaffMemberId))
    .orderBy(desc(opsLeaveLedgerEntries.effectiveDate), desc(opsLeaveLedgerEntries.createdAt));
  return rows.map((r) => ({
    ...r.l,
    days: Number(r.l.days),
    typeCode: r.typeCode,
    requestCode: r.requestCode,
  }));
}

export async function addLedgerEntry(
  db: Database,
  actor: Actor,
  input: LedgerEntryInput,
  requestId?: string,
) {
  const scope = await hrScope(db, actor, 'ops:leave:manage');
  assertHrScope(scope, input.staffId);
  assertNotSelf(scope.staffId, input.staffId, 'your own leave balance');
  if (input.entryType === 'allocation' && input.days < 0)
    throw new ValidationError('An allocation cannot be negative; use an adjustment.', {
      details: [{ location: 'body', path: ['days'], message: 'Negative allocation' }],
    });
  if (input.days === 0) throw new ValidationError('Days must not be 0.');
  await loadEmployee(db, input.staffId);
  const [type] = await db
    .select({ id: opsLeaveTypes.id })
    .from(opsLeaveTypes)
    .where(eq(opsLeaveTypes.id, input.leaveTypeId as OpsLeaveTypeId));
  if (!type) throw new ValidationError('Unknown leave type.');
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(opsLeaveLedgerEntries)
      .values({
        staffId: input.staffId as StaffMemberId,
        leaveTypeId: type.id,
        entryType: input.entryType,
        days: String(input.days),
        effectiveDate: input.effectiveDate,
        periodLabel: input.periodLabel ?? null,
        note: input.note,
        createdBy: actor.id,
      })
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: `leave_ledger.${input.entryType}`,
      entityType: 'leave_ledger_entry',
      entityId: row!.id,
      after: row,
      requestId,
    });
    return { ...row!, days: Number(row!.days) };
  });
}

// --- team availability ------------------------------------------------------------------------

export async function teamAvailability(
  db: Database,
  actor: Actor,
  query: { from: IsoDate; to: IsoDate; departmentId?: string },
) {
  const scope = await hrScope(db, actor, 'ops:leave:read');
  if (query.to < query.from) throw new ValidationError('"to" is before "from".');
  const dates = eachDate(query.from, query.to, 62);
  if (dates.length > 31) throw new ValidationError('Show at most 31 days at a time.');
  const employees = (await loadEmployees(db, hrScopeIds(scope), query.departmentId ?? null)).filter(
    (e) => e.staffStatus === 'active',
  );
  const settings = await timeSettings(db);
  const ctx = await loadScheduleContext(
    db,
    employees.map((e) => e.staffId),
    query.from,
    query.to,
  );
  const leave = employees.length
    ? await db
        .select()
        .from(opsLeaveRequests)
        .where(
          and(
            inArray(
              opsLeaveRequests.staffId,
              employees.map((e) => e.staffId),
            ),
            inArray(opsLeaveRequests.status, ['pending', 'approved']),
            lte(opsLeaveRequests.startDate, query.to),
            gte(opsLeaveRequests.endDate, query.from),
          ),
        )
    : [];
  const people = employees.map((e) => ({
    staffId: e.staffId,
    scheduledDates: new Set(
      employeeSchedule(e, ctx, query.from, query.to, settings.countProposedHolidays)
        .filter((d) => d.status === 'scheduled')
        .map((d) => d.date as string),
    ),
  }));
  const grid = availabilityGrid(dates, people, leave);
  return {
    dates,
    rows: grid.map((g) => {
      const e = employees.find((x) => x.staffId === g.staffId)!;
      return {
        staffId: e.staffId,
        fullName: e.fullName,
        departmentName: e.departmentName,
        cells: g.cells,
      };
    }),
    totals: dates.map((d, i) => ({
      date: d,
      onLeave: grid.filter((g) => g.cells[i]!.state === 'on_leave').length,
      scheduled: grid.filter((g) => g.cells[i]!.state === 'scheduled').length,
    })),
  };
}
