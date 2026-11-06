/**
 * Leave balances (F4-12, every rule Proposed; rules in domain/leave-balance.ts). HR sets allowances
 * (one person or everyone with a role), carry-forwards and adjustments with ops:attendance:manage,
 * inside HR's staff scope and never for themselves; all audited. A balance is read wherever that
 * person's leave is read. No allowance row = "No allowance set": nothing shown or enforced.
 */
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { z } from 'zod';
import {
  opsLeaveAdjustments,
  opsLeaveAllowances,
  opsLeaveRecords,
  staffMembers,
  userRoles,
  type Database,
} from '@elevate/database';
import { withTransaction, type CsvCell } from '@elevate/server-kit';
import { ConflictError, ValidationError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import { addDays, istToday } from '../domain/dates';
import { leaveAudit, type LeaveDayPart } from '../domain/leave';
import {
  balanceText,
  carryProblem,
  daysText,
  leaveBalance,
  leaveDaysIn,
  leaveYear,
  leaveYearsOf,
  NO_ALLOWANCE,
  overBalanceBy,
  type LeaveBalance,
} from '../domain/leave-balance';
import { hrAttendanceStaff, readableStaff } from './attendance';
import { manage } from './attendance-actions';
import { allowanceListQuery, type adjustmentBody, type allowanceBody } from './attendance-schemas';
import { accessScope, notFound, staffIdForUser, type Actor } from './context';
import { fieldError, inOrder, opsAudit } from './ops-common';
import { loadSettings } from './settings';

const audit = opsAudit('leave_allowance');

export async function leaveRules(db: Database) {
  const s = await loadSettings(db);
  return {
    ...s['hr.leave_balances'].value,
    types: s['hr.leave_types'].value.types,
    unpaid: s['hr.leave_unpaid_types'].value.types as readonly string[],
  };
}
type Rules = Awaited<ReturnType<typeof leaveRules>>;

/** Each person's balance per leave type for the year starting `yearStart`. No permission check. */
export async function balancesFor(
  db: Database,
  staffIds: readonly string[],
  yearStart: string,
  r: Rules,
): Promise<Map<string, Map<string, LeaveBalance>>> {
  const ids = [...new Set(staffIds)] as StaffMemberId[];
  if (!ids.length) return new Map();
  const year = leaveYear(yearStart, r.yearStartMonth);
  const inYear = <T extends typeof opsLeaveAllowances | typeof opsLeaveAdjustments>(t: T) =>
    and(inArray(t.staffId, ids), eq(t.yearStart, year.start));
  const [allowances, adjustments, taken] = await inOrder([
    db.select().from(opsLeaveAllowances).where(inYear(opsLeaveAllowances)),
    db.select().from(opsLeaveAdjustments).where(inYear(opsLeaveAdjustments)),
    db
      .select()
      .from(opsLeaveRecords)
      .where(
        and(
          inArray(opsLeaveRecords.staffId, ids),
          eq(opsLeaveRecords.status, 'approved'),
          lte(opsLeaveRecords.fromDate, year.end),
          gte(opsLeaveRecords.toDate, year.start),
        ),
      ),
  ] as const);
  const of = <T extends { staffId: string }>(rows: T[], id: string, match: (x: T) => boolean) =>
    rows.filter((x) => x.staffId === id && match(x));
  return new Map(
    ids.map((id) => [
      id,
      new Map(
        r.types.map((type) => [
          type,
          leaveBalance({
            unpaid: r.unpaid.includes(type),
            allowance: of(allowances, id, (a) => a.leaveType === type)[0]?.days ?? null,
            adjustments: of(adjustments, id, (a) => a.leaveType === type),
            taken: of(taken, id, (l) => l.kind === type).reduce(
              (sum, l) => sum + leaveDaysIn(l, year.start, year.end),
              0,
            ),
          }),
        ]),
      ),
    ]),
  );
}

type Asked = {
  id?: string;
  staffId: string;
  kind: string;
  fromDate: string;
  toDate: string;
  dayPart?: LeaveDayPart | null;
};

/** For each asked leave: its type's balance in the year it starts, and how far it goes over. */
export async function balanceNotes(db: Database, rows: readonly Asked[], r?: Rules) {
  const rules = r ?? (await leaveRules(db));
  const years = new Map<string, Map<string, Map<string, LeaveBalance>>>();
  for (const l of rows)
    for (const y of leaveYearsOf(l, rules.yearStartMonth))
      if (!years.has(y.start))
        years.set(y.start, await balancesFor(db, rows.map((x) => x.staffId), y.start, rules));
  return rows.map((l) => {
    const spans = leaveYearsOf(l, rules.yearStartMonth);
    const at = (start: string) => years.get(start)?.get(l.staffId)?.get(l.kind);
    return {
      balance: at(spans[0]!.start) ?? null,
      overBy: spans.reduce((sum, y) => sum + overBalanceBy(at(y.start), y.days), 0),
    };
  });
}

/** Under "Leave balances: refuse", leave past the balance is refused; under "warn" HR decides. */
export async function refuseOverBalance(db: Database, l: Asked) {
  const rules = await leaveRules(db);
  if (rules.overBalance !== 'refuse') return;
  const { overBy } = (await balanceNotes(db, [l], rules))[0]!;
  if (overBy)
    throw new ConflictError(
      `This leave is ${daysText(overBy)} over the ${l.kind} balance, and the setting "Leave balances" refuses leave over the balance.`,
    );
}

/** One person's balances for the leave year holding `day`; read like their attendance (own, or HR's reach). */
export async function readBalances(db: Database, actor: Actor, staffId: string, day?: string) {
  const [staff] = await readableStaff(db, actor, { staffId });
  if (!staff) notFound('Staff member');
  const rules = await leaveRules(db);
  const year = leaveYear(day ?? istToday(new Date()), rules.yearStartMonth);
  const mine = (await balancesFor(db, [staff.id], year.start, rules)).get(staff.id)!;
  return { year, balances: [...mine].map(([type, balance]) => ({ type, balance })) };
}
export type Balances = Awaited<ReturnType<typeof readBalances>>;

/** The year a form names must be a leave year's first day. */
function yearOf(r: Rules, yearStart: string) {
  const year = leaveYear(yearStart, r.yearStartMonth);
  if (year.start !== yearStart) throw fieldError('yearStart', 'Choose a leave year from the list');
  return year;
}

function balancedType(r: Rules, type: string) {
  if (!r.types.includes(type)) throw fieldError('leaveType', 'Choose a leave type from the list');
  if (r.unpaid.includes(type))
    throw fieldError(
      'leaveType',
      `${type} leave never uses a balance (setting "Leave types without a balance"), so it takes no allowance.`,
    );
}

/**
 * Everyone the reader may read (HR: HR's staff scope), their balance per type for one leave year.
 * shortcut: all matching staff at once, no pages (HR covers tens of people); page it past a few hundred.
 */
export async function allowanceSheet(
  db: Database,
  actor: Actor,
  query: z.output<typeof allowanceListQuery>,
) {
  await accessScope(db, actor, 'ops:attendance:read');
  const rules = await leaveRules(db);
  const year = leaveYear(query.yearStart ?? istToday(new Date()), rules.yearStartMonth);
  const staff = await readableStaff(db, actor, query);
  const all = await balancesFor(db, staff.map((s) => s.id), year.start, rules);
  const other = (day: string) => leaveYear(day, rules.yearStartMonth);
  return {
    year,
    /** The year before, this one and the next: the tab's year links. */
    years: [other(addDays(year.start, -1)), year, other(addDays(year.end, 1))],
    types: rules.types,
    unpaid: rules.unpaid,
    rows: staff.map((s) => ({ staff: s, balances: Object.fromEntries(all.get(s.id)!) })),
  };
}
export type AllowanceSheet = Awaited<ReturnType<typeof allowanceSheet>>;

/** The download: allowance, carried, adjusted, taken and balance per type; not set stays words, never 0. */
export async function leaveAllowanceExport(db: Database, actor: Actor, p: Record<string, string | undefined>) {
  const query = allowanceListQuery.safeParse(p);
  if (!query.success) throw new ValidationError('Choose a leave year and filters from the page.');
  const { year, types, rows } = await allowanceSheet(db, actor, query.data);
  const cells = (b: LeaveBalance): CsvCell[] =>
    b.state === 'set'
      ? [b.allowance, b.carried, b.adjusted, b.taken, b.balance]
      : [balanceText(b), '', '', b.taken, ''];
  return {
    filename: `leave-balances-${year.label}.csv`,
    header: [
      'Staff member',
      'Staff code',
      'Department',
      ...types.flatMap((t) => ['allowance', 'carried forward', 'adjusted', 'taken', 'balance'].map((c) => `${t} ${c}`)),
    ],
    rows: rows.map((r) => [
      r.staff.name,
      r.staff.staffCode,
      r.staff.departmentName,
      ...types.flatMap((t) => cells(r.balances[t]!)),
    ]),
    footer: [
      [],
      [`Leave balances · leave year ${year.label} (${year.start} to ${year.end})`],
      [
        `Days are calendar days; a half day is 0.5. "${NO_ALLOWANCE}" means no balance is kept for that type, which is not 0 days.`,
      ],
    ],
  };
}

/** Set (or change) the allowance for one person, or for everyone with `role` in HR's reach except yourself. */
export async function setAllowance(
  db: Database,
  actor: Actor,
  body: z.output<typeof allowanceBody>,
  requestId?: string,
) {
  await manage(db, actor, body.staffId);
  const rules = await leaveRules(db);
  balancedType(rules, body.leaveType);
  const year = yearOf(rules, body.yearStart);
  const own = await staffIdForUser(db, actor.id);
  const reach = body.staffId ? [] : (await hrAttendanceStaff(db, actor)).map((s) => s.id);
  const staffIds = body.staffId
    ? [body.staffId]
    : (await withRole(db, reach, body.role!)).filter((id) => id !== own);
  if (!staffIds.length)
    throw fieldError('role', 'Nobody with this role is in the staff HR manages (yourself left out).');
  return withTransaction(db, async (tx) => {
    for (const staffId of staffIds) {
      const key = {
        staffId: staffId as StaffMemberId,
        leaveType: body.leaveType,
        yearStart: year.start,
      };
      const [before] = await tx
        .select()
        .from(opsLeaveAllowances)
        .where(
          and(
            eq(opsLeaveAllowances.staffId, key.staffId),
            eq(opsLeaveAllowances.leaveType, key.leaveType),
            eq(opsLeaveAllowances.yearStart, key.yearStart),
          ),
        );
      const [after] = await tx
        .insert(opsLeaveAllowances)
        .values({ ...key, days: body.days, createdBy: actor.id })
        .onConflictDoUpdate({
          target: [opsLeaveAllowances.staffId, opsLeaveAllowances.leaveType, opsLeaveAllowances.yearStart],
          set: { days: body.days, updatedBy: actor.id, updatedAt: new Date() },
        })
        .returning();
      await audit(tx, actor, after!.id, 'leave.allowance_set', {
        before,
        after,
        metadata: body.role ? { role: body.role } : undefined,
      }, requestId);
    }
    return { set: staffIds.length, year: year.label };
  });
}

const withRole = async (db: Database, ids: readonly string[], role: string) =>
  ids.length
    ? (
        await db
          .selectDistinct({ id: staffMembers.id })
          .from(staffMembers)
          .innerJoin(userRoles, eq(userRoles.userId, staffMembers.userId))
          .where(and(inArray(staffMembers.id, ids as StaffMemberId[]), eq(userRoles.role, role as never)))
      ).map((s) => s.id as string)
    : [];

/** A carry-forward (once a year, within the cap and what was left) or an adjustment, with a reason. */
export async function addLeaveAdjustment(
  db: Database,
  actor: Actor,
  body: z.output<typeof adjustmentBody>,
  requestId?: string,
) {
  await manage(db, actor, body.staffId);
  const rules = await leaveRules(db);
  balancedType(rules, body.leaveType);
  const year = yearOf(rules, body.yearStart);
  const balance = async (start: string) =>
    (await balancesFor(db, [body.staffId], start, rules)).get(body.staffId)!.get(body.leaveType)!;
  if ((await balance(year.start)).state !== 'set')
    throw fieldError('leaveType', `Set a ${body.leaveType} allowance for ${year.label} first.`);
  if (body.kind === 'carry_forward') {
    const before = leaveYear(addDays(year.start, -1), rules.yearStartMonth);
    const problem = carryProblem(body.days, rules.carryForwardCapDays, await balance(before.start));
    if (problem) throw fieldError('days', problem);
  }
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(opsLeaveAdjustments)
      .values({
        staffId: body.staffId as StaffMemberId,
        leaveType: body.leaveType,
        yearStart: year.start,
        kind: body.kind,
        days: body.days,
        reason: body.reason,
        createdBy: actor.id,
      })
      .onConflictDoNothing()
      .returning();
    if (!row)
      throw new ConflictError(
        `${body.leaveType} leave is already carried into ${year.label}. Add an adjustment instead.`,
      );
    // The reason stays on the row, not in the audit trail (words about leave, as leaveAudit).
    await audit(tx, actor, row.id, `leave.${body.kind}_added`, leaveAudit({ after: row }), requestId);
    return row;
  });
}
