/**
 * Timesheets (OPS-059): daily and period summaries per employee and per
 * department — scheduled vs worked hours, late/early counts, missing
 * clock-outs, unresolved exceptions, approved leave days — and the audited
 * employee-level CSV export.
 *
 * Permissions: `ops:hr_reports:read` (HR scope: department managers see their
 * chain) · export `ops:hr_reports:export`. Worked − scheduled is shown as an
 * "unapproved difference"; approved overtime is not built.
 */
import { recordAudit, withTransaction } from '@elevate/server-kit';
import type { Database } from '@elevate/database';
import { ValidationError } from '@elevate/shared-contracts';
import type { IsoDate } from '@elevate/shared-types';
import { daysBetween } from '../../domain/dates';
import { toCsv } from '../../domain/hr/csv';
import { sumMeasured, type Measured, type PeriodSummary } from '../../domain/hr/timesheets';
import type { Actor } from '../context';
import { assertHrScope, hrScope, hrScopeIds } from '../hr-scope';
import { employeePeriod } from './attendance';
import { loadEmployees } from './shifts';
import type { TimesheetQuery } from './time-schemas';

const MAX_DAYS = 62;

function checkRange(from: IsoDate, to: IsoDate) {
  if (to < from) throw new ValidationError('"to" is before "from".');
  if (daysBetween(from, to) + 1 > MAX_DAYS)
    throw new ValidationError(`Choose at most ${MAX_DAYS} days.`);
}

export async function buildTimesheets(
  db: Database,
  actor: Actor,
  query: TimesheetQuery,
  permission: 'ops:hr_reports:read' | 'ops:hr_reports:export' = 'ops:hr_reports:read',
) {
  const scope = await hrScope(db, actor, permission);
  checkRange(query.from, query.to);
  if (query.staffId) assertHrScope(scope, query.staffId);
  const ids = query.staffId ? [query.staffId] : hrScopeIds(scope);
  const employees = (await loadEmployees(db, ids, query.departmentId ?? null)).filter(
    (e) => e.staffStatus === 'active' || query.staffId,
  );
  const people = [];
  for (const e of employees) {
    const p = await employeePeriod(db, e, query.from, query.to);
    people.push({
      staffId: e.staffId,
      fullName: e.fullName,
      employeeCode: e.employeeCode,
      departmentName: e.departmentName,
      timezone: e.timezone,
      summary: p.summary,
      days: query.staffId ? p.days : undefined,
    });
  }
  return { from: query.from, to: query.to, people, totals: totals(people.map((p) => p.summary)) };
}

function totals(list: readonly PeriodSummary[]) {
  const sum = (k: keyof PeriodSummary) => list.reduce((s, x) => s + (x[k] as number), 0);
  const measured = (k: 'scheduledMinutes' | 'workedMinutes' | 'unapprovedDifferenceMinutes') =>
    sumMeasured(
      list.map((x) => x[k] as Measured),
      'No employee in this view has data for this measure.',
    );
  return {
    employees: list.length,
    scheduledMinutes: measured('scheduledMinutes'),
    workedMinutes: measured('workedMinutes'),
    unapprovedDifferenceMinutes: measured('unapprovedDifferenceMinutes'),
    lateCount: sum('lateCount'),
    earlyCount: sum('earlyCount'),
    missingClockOuts: sum('missingClockOuts'),
    unresolvedExceptions: sum('unresolvedExceptions'),
    approvedLeaveDays: sum('approvedLeaveDays'),
  };
}

const hours = (m: Measured) => (m.status === 'ok' ? (m.value / 60).toFixed(2) : 'missing');

/** Employee-level CSV (one row per employee). Audited; needs `ops:hr_reports:export`. */
export async function exportTimesheetsCsv(
  db: Database,
  actor: Actor,
  query: TimesheetQuery,
  requestId?: string,
): Promise<{ filename: string; csv: string; rows: number }> {
  const data = await buildTimesheets(db, actor, query, 'ops:hr_reports:export');
  const rows = [
    [
      'employee_code',
      'name',
      'department',
      'from',
      'to',
      'scheduled_hours',
      'worked_hours',
      'unapproved_difference_hours',
      'scheduled_days',
      'days_with_attendance',
      'late_count',
      'early_departure_count',
      'missing_clock_outs',
      'unresolved_exceptions',
      'approved_leave_days',
    ],
    ...data.people.map((p) => [
      p.employeeCode ?? '',
      p.fullName,
      p.departmentName ?? '',
      data.from,
      data.to,
      hours(p.summary.scheduledMinutes),
      hours(p.summary.workedMinutes),
      hours(p.summary.unapprovedDifferenceMinutes),
      p.summary.scheduledDays,
      p.summary.daysWithAttendance,
      p.summary.lateCount,
      p.summary.earlyCount,
      p.summary.missingClockOuts,
      p.summary.unresolvedExceptions,
      p.summary.approvedLeaveDays,
    ]),
  ];
  await withTransaction(db, async (tx) => {
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'timesheet.exported',
      entityType: 'timesheet_export',
      entityId: `${data.from}_${data.to}`,
      after: {
        from: data.from,
        to: data.to,
        staffId: query.staffId ?? null,
        departmentId: query.departmentId ?? null,
        employees: data.people.length,
      },
      requestId,
    });
  });
  return {
    filename: `timesheets_${data.from}_${data.to}.csv`,
    csv: toCsv(rows),
    rows: data.people.length,
  };
}
