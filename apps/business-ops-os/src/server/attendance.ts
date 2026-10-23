/**
 * Staff attendance reads (owner brief 23 Oct 2026 §12). A day's status is derived when it is read,
 * from the raw records (punches, schedule, holidays, approved leave, settings), so it is never
 * stale; `ops.daily_attendance` holds only HR's decisions (basis `hr_decision`), which always win
 * and which no recomputation touches. Class delivery and teaching logs are never read here
 * (scenario 10). Own scope = your own days only; another person's id → 404.
 */
import { and, asc, eq, gte, ilike, inArray, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  departments,
  opsAttendancePunches,
  opsDailyAttendance,
  opsHolidays,
  opsLeaveRecords,
  opsStaffProfiles,
  opsWorkSchedules,
  staffMembers,
  type Database,
} from '@elevate/database';
import type { StaffMemberId } from '@elevate/shared-types';
import { z } from 'zod';
import {
  datesBetween,
  deriveDay,
  punchesByDay,
  reviewReasons,
  summariseDays,
  type AttendanceStatus,
  type DerivedDay,
  type ReviewReason,
} from '../domain/attendance';
import { addDays, istInstant, istToday, type IsoDate } from '../domain/dates';
import type { AttendanceListQuery } from './attendance-schemas';
import { accessScope, notFound, type Actor } from './context';
import { groupBy, inOrder } from './ops-common';
import { hrReachWhere, hrScopeFor } from './organisation';
import { loadSettings } from './settings';

export const ATTENDANCE_PAGE_SIZE = 50;
/** The longest range one list shows (days). */
export const MAX_RANGE_DAYS = 62;

export interface AttendanceStaff {
  id: StaffMemberId;
  name: string;
  staffCode: string | null;
  departmentName: string | null;
  branchId: string | null;
  scheduleId: string | null;
}

/** Current staff (or the named people), optionally narrowed; `scope` = an HR scope condition. */
export function attendanceStaff(
  db: Database,
  where: {
    ids?: readonly string[];
    department?: string;
    branch?: string;
    q?: string;
    scope?: SQL;
  } = {},
): Promise<AttendanceStaff[]> {
  return db
    .select({
      id: staffMembers.id,
      name: sql<string>`coalesce(${opsStaffProfiles.displayName}, ${staffMembers.fullName})`,
      staffCode: opsStaffProfiles.staffCode,
      departmentName: departments.name,
      branchId: opsStaffProfiles.branchId,
      scheduleId: opsStaffProfiles.workScheduleId,
    })
    .from(staffMembers)
    .leftJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
    .leftJoin(departments, eq(departments.id, staffMembers.departmentId))
    .where(
      and(
        // Named people keep their history after they leave; lists show current staff.
        where.ids
          ? inArray(staffMembers.id, where.ids as StaffMemberId[])
          : ne(staffMembers.status, 'inactive'),
        where.scope,
        where.department ? eq(staffMembers.departmentId, where.department as never) : undefined,
        where.branch ? eq(opsStaffProfiles.branchId, where.branch as never) : undefined,
        where.q
          ? or(
              ilike(staffMembers.fullName, `%${where.q}%`),
              ilike(opsStaffProfiles.displayName, `%${where.q}%`),
              ilike(opsStaffProfiles.staffCode, `%${where.q}%`),
            )
          : undefined,
      ),
    )
    .orderBy(asc(staffMembers.fullName));
}

/** Staff the actor reaches in HR attendance (organisation.ts `hrReachWhere`: HR-only managers see their departments and themselves). */
export const hrAttendanceStaff = async (
  db: Database,
  actor: Actor,
  where: Omit<Parameters<typeof attendanceStaff>[1], 'scope'> = {},
) => attendanceStaff(db, { ...where, scope: hrReachWhere(actor, await hrScopeFor(db, actor)) });

/**
 * Every day from `from` to `to` (never past today) for each staff member, derived from the raw
 * records with HR decisions on top.
 * shortcut: loads the range for all listed staff into memory (≈ staff × 62 days); page by staff
 * in SQL if HR covers more than a few hundred people.
 */
export async function deriveDays(
  db: Database,
  staff: readonly AttendanceStaff[],
  from: IsoDate,
  to: IsoDate,
): Promise<Map<string, DerivedDay[]>> {
  const today = istToday(new Date());
  const last = to < today ? to : today;
  const out = new Map<string, DerivedDay[]>();
  if (!staff.length || from > last) return out;
  const ids = staff.map((s) => s.id);
  const [settings, schedules, holidays, leave, punches, decisions] = await inOrder([
    () => loadSettings(db),
    db.select().from(opsWorkSchedules),
    db
      .select()
      .from(opsHolidays)
      .where(and(gte(opsHolidays.holidayOn, from), lte(opsHolidays.holidayOn, last))),
    db
      .select()
      .from(opsLeaveRecords)
      .where(
        and(
          inArray(opsLeaveRecords.staffId, ids),
          eq(opsLeaveRecords.status, 'approved'),
          lte(opsLeaveRecords.fromDate, last),
          gte(opsLeaveRecords.toDate, from),
        ),
      ),
    // A day before and after: overnight check-outs belong to the day of their check-in.
    db
      .select()
      .from(opsAttendancePunches)
      .where(
        and(
          inArray(opsAttendancePunches.staffId, ids),
          gte(opsAttendancePunches.punchedAt, istInstant(addDays(from, -1))),
          lt(opsAttendancePunches.punchedAt, istInstant(addDays(last, 2))),
        ),
      ),
    db
      .select()
      .from(opsDailyAttendance)
      .where(
        and(
          inArray(opsDailyAttendance.staffId, ids),
          eq(opsDailyAttendance.basis, 'hr_decision'),
          gte(opsDailyAttendance.workDate, from),
          lte(opsDailyAttendance.workDate, last),
        ),
      ),
  ] as const);
  const rules = {
    graceMinutes: settings['hr.attendance.late_grace_minutes'].value.minutes,
    halfDayHours: settings['hr.attendance.half_day_hours'].value.hours,
    fullDayHours: settings['hr.attendance.full_day_hours'].value.hours,
  };
  const fallback = schedules.find((s) => s.isDefault) ?? null;
  const punchesOf = groupBy(punches, (p) => p.staffId);
  const leaveOf = groupBy(leave, (l) => l.staffId);
  const decisionOf = new Map(decisions.map((d) => [`${d.staffId}:${d.workDate}`, d]));
  const dates = datesBetween(from, last);
  for (const s of staff) {
    const schedule = s.scheduleId ? schedules.find((x) => x.id === s.scheduleId)! : fallback;
    const holidayOn = (date: string, states: string[]) =>
      holidays.some(
        (h) =>
          h.holidayOn === date &&
          (h.branchId === null || h.branchId === s.branchId) &&
          states.includes(h.decisionState),
      );
    const byDay = punchesByDay(
      (punchesOf.get(s.id) ?? []).map((p) => ({ at: p.punchedAt, direction: p.direction })),
    );
    out.set(
      s.id,
      dates.map((date) => {
        const decision = decisionOf.get(`${s.id}:${date}`);
        return deriveDay(
          {
            date,
            pattern: schedule?.weeklyPattern ?? null,
            graceMinutes: schedule?.graceMinutes,
            holiday: holidayOn(date, ['approved', 'locked']),
            proposedHoliday: holidayOn(date, ['proposed']),
            finished: date < today,
            onLeave: (leaveOf.get(s.id) ?? []).some((l) => l.fromDate <= date && l.toDate >= date),
            punches: byDay.get(date) ?? [],
            decision: decision ? { status: decision.status, note: decision.note } : null,
          },
          rules,
        );
      }),
    );
  }
  return out;
}

/** The range a list shows: default the last 7 days, never past today, at most MAX_RANGE_DAYS. */
export function listRange(query: { from?: string; to?: string }, today = istToday(new Date())) {
  const to = (query.to && query.to < today ? query.to : today) as IsoDate;
  const earliest = addDays(to, -(MAX_RANGE_DAYS - 1));
  const from = (query.from ?? addDays(to, -6)) as IsoDate;
  return { from: from < earliest ? earliest : from > to ? to : from, to };
}

/** Staff ids the actor may read, after the URL's narrowing; another person's id (own) → 404. */
async function readableStaff(
  db: Database,
  actor: Actor,
  query: { staffId?: string; department?: string; branch?: string; q?: string },
) {
  const access = await accessScope(db, actor, 'ops:attendance:read');
  if (access.scope === 'own') {
    if (!access.staffId || (query.staffId && query.staffId !== access.staffId))
      notFound('Staff member');
    return attendanceStaff(db, { ids: [access.staffId] });
  }
  return hrAttendanceStaff(db, actor, {
    ids: query.staffId ? [query.staffId] : undefined,
    department: query.department,
    branch: query.branch,
    q: query.q,
  });
}

export type AttendanceRow = DerivedDay & { staff: AttendanceStaff; reasons: ReviewReason[] };

/**
 * GET /attendance: one row per staff member and day, newest day first, with per-day counts
 * (the "Attendance by date" chart) from the same rows before the status/review filters.
 */
export async function listAttendance(db: Database, actor: Actor, query: AttendanceListQuery) {
  const today = istToday(new Date());
  const { from, to } = listRange(query, today);
  const staff = await readableStaff(db, actor, query);
  if (query.staffId && !staff.length) notFound('Staff member');
  const days = await deriveDays(db, staff, from, to);
  const all: AttendanceRow[] = staff.flatMap((s) =>
    (days.get(s.id) ?? []).map((d) => ({ ...d, staff: s, reasons: reviewReasons(d, today) })),
  );
  const rows = all.filter(
    (r) =>
      (!query.status || r.status === query.status) &&
      (!query.review || r.reasons.some((x) => query.review === '1' || x === query.review)),
  );
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.staff.name.localeCompare(b.staff.name));
  const byDate = datesBetween(from, to).map((date) => {
    const counts = {} as Record<AttendanceStatus, number>;
    for (const r of all) if (r.date === date) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return { date, counts };
  });
  const page = Number(query.page ?? 1);
  return {
    from,
    to,
    items: rows.slice((page - 1) * ATTENDANCE_PAGE_SIZE, page * ATTENDANCE_PAGE_SIZE),
    total: rows.length,
    page,
    pageSize: ATTENDANCE_PAGE_SIZE,
    byDate,
  };
}

/** One staff member's day: derived status (with any HR decision) and the raw punches with their source. */
export async function attendanceDay(db: Database, actor: Actor, staffId: string, date: IsoDate) {
  if (!z.uuid().safeParse(staffId).success) notFound('Staff member');
  const [staff] = await readableStaff(db, actor, { staffId });
  if (!staff) notFound('Staff member');
  const day = (await deriveDays(db, [staff], date, date)).get(staff.id)?.[0] ?? null;
  // A day either side: an overnight check-out belongs to the day of its check-in.
  const punches = await db
    .select()
    .from(opsAttendancePunches)
    .where(
      and(
        eq(opsAttendancePunches.staffId, staff.id),
        gte(opsAttendancePunches.punchedAt, istInstant(addDays(date, -1))),
        lt(opsAttendancePunches.punchedAt, istInstant(addDays(date, 2))),
      ),
    );
  const mine = punchesByDay(punches.map((p) => ({ ...p, at: p.punchedAt }))).get(date) ?? [];
  return { staff, date, day, punches: mine };
}

/**
 * Brief §14 attendance figures for one person and period (REP's monthly report). No permission
 * check: the calling service checks its own. Days after today are not counted.
 */
export async function attendanceSummary(db: Database, staffId: string, from: string, to: string) {
  const staff = await attendanceStaff(db, { ids: [staffId] });
  const days = (await deriveDays(db, staff, from as IsoDate, to as IsoDate)).get(staffId) ?? [];
  return summariseDays(days);
}
