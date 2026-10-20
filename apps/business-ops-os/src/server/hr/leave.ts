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
import { and, asc, desc, eq, gte, inArray, lte, ne, type SQL } from 'drizzle-orm';
import { can, type Permission } from '@elevate/authorization';
import {
  opsLeaveLedgerEntries,
  opsLeaveRequests,
  opsLeaveTypes,
  staffMembers,
  type Database,
  type OpsLeaveRequestId,
  type OpsLeaveTypeId,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, ForbiddenError, ValidationError } from '@elevate/shared-contracts';
import type { IsoDate, StaffMemberId, UserId } from '@elevate/shared-types';
import { daysBetween } from '../../domain/dates';
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
import { coveringTemplates } from '../../domain/hr/shifts';
import { nextCode, notFound, userIdsForStaff, type Actor } from '../context';
import { assertHrScope, assertNotSelf, hrCovers, hrScope, hrScopeIds } from '../hr-scope';
import { defined, notifyOthers, opsAudit, rowById } from '../ops-common';
import {
  approverUserIds,
  checkedDecision,
  decider,
  emptyPage,
  employeeSchedule,
  issuesError,
  loadEmployee,
  loadEmployees,
  loadScheduleContext,
  lockStaff,
  paginate,
  throwCheck,
  timeSettings,
  type TimeEmployee,
} from './shifts';
import type {
  CreateLeaveInput,
  CreateLeaveTypeInput,
  DecisionInput,
  LeaveListQuery,
  LedgerEntryInput,
  UpdateLeaveTypeInput,
} from './time-schemas';

const auditLeaveType = opsAudit('leave_type');
const auditRequest = opsAudit('leave_request');
const auditLedger = opsAudit('leave_ledger_entry');

type LeaveRequestRow = typeof opsLeaveRequests.$inferSelect;

/** Scope for a permission the actor holds, else null. */
const scopeIfHeld = (db: Database, actor: Actor, permission: Permission) =>
  can(actor, permission) ? hrScope(db, actor, permission) : null;

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
    await auditLeaveType(tx, actor, row!.id, 'leave_type.created', { after: row }, requestId);
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
    const before = await rowById(tx, opsLeaveTypes, id, 'Leave type', true);
    const patch = defined(input);
    if (Object.keys(patch).length === 0) throw new ValidationError('Nothing to change.');
    const [after] = await tx
      .update(opsLeaveTypes)
      .set(patch)
      .where(eq(opsLeaveTypes.id, before.id))
      .returning();
    const action =
      input.status && input.status !== before.status
        ? `leave_type.${input.status}`
        : 'leave_type.updated';
    await auditLeaveType(tx, actor, before.id, action, { before, after }, requestId);
    return after!;
  });
}

// --- working days -----------------------------------------------------------------------------

/** Working-day test and holidays for one employee over a range. */
async function workingDayContext(db: Database, e: TimeEmployee, from: IsoDate, to: IsoDate) {
  const settings = await timeSettings(db);
  const ctx = await loadScheduleContext(db, [e.staffId], from, to);
  const assignments = ctx.assignmentsByStaff.get(e.staffId) ?? [];
  let usedDefault = false;
  const isWorkingDay = (date: IsoDate) => {
    const covering = coveringTemplates(date, assignments, ctx.templates);
    if (covering.length === 0) {
      usedDefault = true;
      return settings.defaultWorkingWeekdays.includes(weekday(date));
    }
    return covering.some((t) => t.workingWeekdays.includes(weekday(date)));
  };
  return {
    isWorkingDay,
    holidays: holidaysFor(ctx.holidays, e.workLocation, settings.countProposedHolidays),
    /** Call after counting: whether any day fell back to the proposed default work week. */
    countBasis: () => (usedDefault ? ('default_work_week' as const) : ('shift' as const)),
  };
}

/** Working days of one span for an employee, and what the count was based on. */
async function countSpan(db: Database, e: TimeEmployee, span: LeaveSpan) {
  const wd = await workingDayContext(db, e, span.startDate as IsoDate, span.endDate as IsoDate);
  const count = countLeaveDays(span, wd.isWorkingDay, wd.holidays);
  return { ...count, countBasis: wd.countBasis() };
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
  const count = await countSpan(db, e, span);
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
        ...span,
        workingDays: String(count.days),
        reason: input.reason ?? null,
        documentRef: input.documentRef ?? null,
        requestedBy: actor.id,
      })
      .returning();
    const change = { after: { ...row, basis: count.countBasis } };
    await auditRequest(tx, actor, row!.id, 'leave_request.created', change, requestId);
    await notifyOthers(tx, actor, await approverUserIds(tx, e, actor.id), {
      kind: 'leave.requested',
      title: `Leave request ${code}: ${e.fullName}, ${span.startDate} – ${span.endDate}`,
      body: `${type.name}, ${count.days} working day(s).`,
      link: `/ops/hr/leave/${row!.id}`,
      entityType: 'leave_request',
      entityId: row!.id,
    });
    return { ...row!, perDate: count.perDate, countBasis: count.countBasis };
  });
}

/** Tell the requester, the employee and `also` about a decided or cancelled request (never the actor). */
async function notifyLeave(
  tx: Database,
  actor: Actor,
  r: LeaveRequestRow,
  to: string,
  body: string | null | undefined,
  also: UserId[] = [],
) {
  const userIds = [r.requestedBy, ...(await userIdsForStaff(tx, [r.staffId])), ...also];
  await notifyOthers(tx, actor, userIds, {
    kind: `leave.${to}`,
    title: `Leave ${r.code} ${to}`,
    body: body ?? undefined,
    link: `/ops/hr/leave/${r.id}`,
    entityType: 'leave_request',
    entityId: r.id,
  });
}

/** A usage or reversal row of the leave ledger for a request (idempotent per request + type). */
const ledgerFor = (
  r: LeaveRequestRow,
  actor: Actor,
  entryType: 'usage' | 'reversal',
  days: number,
  effectiveDate: string,
  note: string,
) => ({
  staffId: r.staffId,
  leaveTypeId: r.leaveTypeId,
  entryType,
  days: String(days),
  effectiveDate,
  leaveRequestId: r.id,
  note,
  createdBy: actor.id,
});

export async function decideLeaveRequest(
  db: Database,
  actor: Actor,
  id: string,
  input: DecisionInput,
  requestId?: string,
  now = new Date(),
) {
  const scope = await hrScope(db, actor, 'ops:leave:approve');
  return withTransaction(db, async (tx) => {
    const r = await rowById(tx, opsLeaveRequests, id, 'Leave request', true);
    assertHrScope(scope, r.staffId, 'this leave request');
    const to = checkedDecision(actor, scope, r, input);
    const [after] = await tx
      .update(opsLeaveRequests)
      .set({ status: to, decidedBy: actor.id, decidedAt: now, decisionNote: input.note ?? null })
      .where(eq(opsLeaveRequests.id, r.id))
      .returning();
    const usageDays = to === 'approved' ? -Number(r.workingDays) : null;
    if (usageDays !== null)
      await tx
        .insert(opsLeaveLedgerEntries)
        .values(ledgerFor(r, actor, 'usage', usageDays, r.startDate, `Approved ${r.code}`))
        .onConflictDoNothing();
    const change = {
      before: { status: r.status },
      after: { status: to, note: input.note ?? null, usageDays },
    };
    await auditRequest(tx, actor, r.id, `leave_request.${to}`, change, requestId);
    await notifyLeave(tx, actor, r, to, input.note);
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
  const requestScope = await scopeIfHeld(db, actor, 'ops:leave:request');
  const approveScope = await scopeIfHeld(db, actor, 'ops:leave:approve');
  const actorStaffId = requestScope?.staffId ?? approveScope?.staffId ?? null;
  return withTransaction(db, async (tx) => {
    const r = await rowById(tx, opsLeaveRequests, id, 'Leave request', true);
    const isSubject = actorStaffId !== null && actorStaffId === r.staffId;
    const isRequester = r.requestedBy === actor.id;
    const canApprove = approveScope !== null && hrCovers(approveScope, r.staffId) && !isSubject;
    if (!isSubject && !isRequester && !canApprove)
      throw new ForbiddenError('You cannot cancel this leave request.');
    const e = await loadEmployee(tx, r.staffId);
    const today = zonedDate(now, e.timezone);
    const check = checkLeaveCancel({
      status: r.status,
      startDate: r.startDate,
      today,
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
        const note = `Cancelled ${r.code}${input.reason ? `: ${input.reason}` : ''}`;
        await tx
          .insert(opsLeaveLedgerEntries)
          .values(ledgerFor(r, actor, 'reversal', reversal, today, note))
          .onConflictDoNothing();
      }
    }
    const change = {
      before: { status: r.status },
      after: { status: 'cancelled', reason: input.reason ?? null, reversalDays: reversal },
    };
    await auditRequest(tx, actor, r.id, 'leave_request.cancelled', change, requestId);
    const deciderIds = r.decidedBy ? [r.decidedBy] : [];
    await notifyLeave(tx, actor, r, 'cancelled', input.reason, deciderIds);
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
  if (ids?.length === 0) return emptyPage(page);
  const lr = opsLeaveRequests;
  const conds: (SQL | undefined)[] = [ids ? inArray(lr.staffId, ids) : undefined];
  if (query.view === 'mine') {
    if (!scope.staffId) return emptyPage(page);
    conds.push(eq(lr.staffId, scope.staffId));
  }
  const approve = await scopeIfHeld(db, actor, 'ops:leave:approve');
  const canDecide = await decider(db, actor, 'ops:leave:approve');
  if (query.view === 'to_decide') {
    if (!approve) return emptyPage(page);
    const approveIds = hrScopeIds(approve);
    const noOne = '00000000-0000-0000-0000-000000000000' as StaffMemberId;
    conds.push(
      eq(lr.status, 'pending'),
      ne(lr.requestedBy, actor.id),
      approveIds ? inArray(lr.staffId, approveIds.length ? approveIds : [noOne]) : undefined,
      approve.staffId ? ne(lr.staffId, approve.staffId) : undefined,
    );
  }
  const where = and(
    ...conds,
    query.staffId ? eq(lr.staffId, query.staffId as StaffMemberId) : undefined,
    query.status ? eq(lr.status, query.status) : undefined,
    query.from ? gte(lr.endDate, query.from) : undefined,
    query.to ? lte(lr.startDate, query.to) : undefined,
  );
  return paginate(db, lr, where, page, async (limit, offset) => {
    const rows = await db
      .select({
        r: lr,
        fullName: staffMembers.fullName,
        typeCode: opsLeaveTypes.code,
        typeName: opsLeaveTypes.name,
      })
      .from(lr)
      .innerJoin(staffMembers, eq(staffMembers.id, lr.staffId))
      .innerJoin(opsLeaveTypes, eq(opsLeaveTypes.id, lr.leaveTypeId))
      .where(where)
      .orderBy(desc(lr.startDate), desc(lr.code))
      .limit(limit)
      .offset(offset);
    return rows.map(({ r, ...rest }) => ({
      ...r,
      workingDays: Number(r.workingDays),
      ...rest,
      canDecide: r.status === 'pending' && canDecide(r.staffId, r.requestedBy),
    }));
  });
}

export async function getLeaveRequest(db: Database, actor: Actor, id: string, now = new Date()) {
  const scope = await hrScope(db, actor, 'ops:leave:read');
  const [row] = await db
    .select({ r: opsLeaveRequests, type: opsLeaveTypes })
    .from(opsLeaveRequests)
    .innerJoin(opsLeaveTypes, eq(opsLeaveTypes.id, opsLeaveRequests.leaveTypeId))
    .where(eq(opsLeaveRequests.id, id as OpsLeaveRequestId));
  if (!row) notFound('Leave request');
  const { r, type } = row;
  assertHrScope(scope, r.staffId, 'this leave request');
  const e = await loadEmployee(db, r.staffId);
  const count = await countSpan(db, e, spanOf(r));
  const ledger = await db
    .select()
    .from(opsLeaveLedgerEntries)
    .where(eq(opsLeaveLedgerEntries.leaveRequestId, r.id))
    .orderBy(asc(opsLeaveLedgerEntries.createdAt));
  const approve = await scopeIfHeld(db, actor, 'ops:leave:approve');
  const isSubject = scope.staffId === r.staffId;
  const canApprove =
    approve !== null && hrCovers(approve, r.staffId) && approve.staffId !== r.staffId;
  const today = zonedDate(now, e.timezone);
  const cancel = checkLeaveCancel({
    status: r.status,
    startDate: r.startDate,
    today,
    actorIsRequesterOrSubject:
      (isSubject && can(actor, 'ops:leave:request')) || r.requestedBy === actor.id,
    actorCanApprove: canApprove,
    actorIsSubject: isSubject,
    reason: 'check',
  });
  return {
    request: { ...r, workingDays: Number(r.workingDays) },
    type,
    employee: e,
    perDate: count.perDate,
    countBasis: count.countBasis,
    ledger: ledger.map((l) => ({ ...l, days: Number(l.days) })),
    canDecide: r.status === 'pending' && canApprove && r.requestedBy !== actor.id,
    canCancel: cancel.ok,
    cancelNeedsReason: r.status === 'approved' && r.startDate <= today,
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
  const employees = await loadEmployees(db, query.staffId ? [query.staffId] : hrScopeIds(scope));
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
      .map((t) => ({
        t,
        own: entries.filter((x) => x.staffId === e.staffId && x.leaveTypeId === t.id),
      }))
      .filter(({ t, own }) => t.status !== 'retired' || own.length > 0)
      .map(({ t, own }) => ({
        leaveTypeId: t.id,
        code: t.code,
        name: t.name,
        typeStatus: t.status,
        balance: balanceFromLedger(own),
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
  return rows.map(({ l, ...rest }) => ({ ...l, days: Number(l.days), ...rest }));
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
        ...input,
        staffId: input.staffId as StaffMemberId,
        leaveTypeId: type.id,
        days: String(input.days),
        periodLabel: input.periodLabel ?? null,
        createdBy: actor.id,
      })
      .returning();
    const action = `leave_ledger.${input.entryType}`;
    await auditLedger(tx, actor, row!.id, action, { after: row }, requestId);
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
  const staffIds = employees.map((e) => e.staffId);
  const settings = await timeSettings(db);
  const ctx = await loadScheduleContext(db, staffIds, query.from, query.to);
  const leave = employees.length
    ? await db
        .select()
        .from(opsLeaveRequests)
        .where(
          and(
            inArray(opsLeaveRequests.staffId, staffIds),
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
  const byId = new Map(employees.map((e) => [e.staffId as string, e]));
  return {
    dates,
    rows: grid.map((g) => {
      const e = byId.get(g.staffId)!;
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
