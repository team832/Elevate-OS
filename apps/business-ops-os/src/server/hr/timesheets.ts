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
import { withTransaction } from '@elevate/server-kit';
import type { Database } from '@elevate/database';
import { ValidationError } from '@elevate/shared-contracts';
import { daysBetween } from '../../domain/dates';
import { toCsv } from '../../domain/hr/csv';
import { sumMeasured, type Measured, type PeriodSummary } from '../../domain/hr/timesheets';
import type { Actor } from '../context';
import { assertHrScope, hrScope, hrScopeIds } from '../hr-scope';
import { opsAudit } from '../ops-common';
import { employeePeriod } from './attendance';
import { loadEmployees } from './shifts';
import type { TimesheetQuery } from './time-schemas';

const MAX_DAYS = 62;
const auditExport = opsAudit('timesheet_export');

export async function buildTimesheets(
  db: Database,
  actor: Actor,
  query: TimesheetQuery,
  permission: 'ops:hr_reports:read' | 'ops:hr_reports:export' = 'ops:hr_reports:read',
) {
  const scope = await hrScope(db, actor, permission);
  if (query.to < query.from) throw new ValidationError('"to" is before "from".');
  if (daysBetween(query.from, query.to) + 1 > MAX_DAYS)
    throw new ValidationError(`Choose at most ${MAX_DAYS} days.`);
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

type Sheets = Awaited<ReturnType<typeof buildTimesheets>>;
type CsvValue = (p: Sheets['people'][number], s: PeriodSummary, d: Sheets) => string | number;

/** Export columns: header and value per employee. */
const CSV_COLUMNS: [string, CsvValue][] = [
  ['employee_code', (p) => p.employeeCode ?? ''],
  ['name', (p) => p.fullName],
  ['department', (p) => p.departmentName ?? ''],
  ['from', (_p, _s, d) => d.from],
  ['to', (_p, _s, d) => d.to],
  ['scheduled_hours', (_p, s) => hours(s.scheduledMinutes)],
  ['worked_hours', (_p, s) => hours(s.workedMinutes)],
  ['unapproved_difference_hours', (_p, s) => hours(s.unapprovedDifferenceMinutes)],
  ['scheduled_days', (_p, s) => s.scheduledDays],
  ['days_with_attendance', (_p, s) => s.daysWithAttendance],
  ['late_count', (_p, s) => s.lateCount],
  ['early_departure_count', (_p, s) => s.earlyCount],
  ['missing_clock_outs', (_p, s) => s.missingClockOuts],
  ['unresolved_exceptions', (_p, s) => s.unresolvedExceptions],
  ['approved_leave_days', (_p, s) => s.approvedLeaveDays],
];

/** Employee-level CSV (one row per employee). Audited; needs `ops:hr_reports:export`. */
export async function exportTimesheetsCsv(
  db: Database,
  actor: Actor,
  query: TimesheetQuery,
  requestId?: string,
): Promise<{ filename: string; csv: string; rows: number }> {
  const data = await buildTimesheets(db, actor, query, 'ops:hr_reports:export');
  const rows = [
    CSV_COLUMNS.map(([name]) => name),
    ...data.people.map((p) => CSV_COLUMNS.map(([, value]) => value(p, p.summary, data))),
  ];
  const { from, to } = data;
  const after = {
    from,
    to,
    staffId: query.staffId ?? null,
    departmentId: query.departmentId ?? null,
    employees: data.people.length,
  };
  await withTransaction(db, (tx) =>
    auditExport(tx, actor, `${from}_${to}`, 'timesheet.exported', { after }, requestId),
  );
  return {
    filename: `timesheets_${from}_${to}.csv`,
    csv: toCsv(rows),
    rows: data.people.length,
  };
}
