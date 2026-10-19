/**
 * HR dashboard data (`/ops/reports/hr`, permission `ops:hr_reports:read`):
 * the HR records, lifecycle and time metrics for one period (Asia/Kolkata).
 * Every figure is a `Metric`; missing stays missing (never 0). Department
 * managers get their reporting chain; organisation-wide lifecycle figures are
 * missing for them, with the reason.
 */
import { scopeFor } from '@elevate/authorization';
import type { Database } from '@elevate/database';
import { addDays, istToday, type IsoDate } from '../../domain/dates';
import { accessScope, type Actor } from '../context';
import { hrLifecycleMetrics } from './hr-lifecycle-metrics';
import {
  activeEmployeesMetric,
  employeesByDepartmentMetric,
  upcomingJoiningDates,
} from './hr-records-metrics';
import { hrTimeMetrics } from './hr-time-metrics';

export const HR_REPORT_PERIODS = {
  this_month: 'This month to date',
  last_month: 'Last month',
} as const;
export type HrReportPeriod = keyof typeof HR_REPORT_PERIODS;

/** IST calendar window: this month from the 1st to today, or the whole previous month. */
export function hrReportWindow(period: HrReportPeriod, now = new Date()) {
  const today = istToday(now);
  const firstOfMonth = `${today.slice(0, 8)}01` as IsoDate;
  const lastMonthEnd = addDays(firstOfMonth, -1);
  const [from, to] =
    period === 'this_month'
      ? [firstOfMonth, today]
      : [`${lastMonthEnd.slice(0, 8)}01` as IsoDate, lastMonthEnd];
  return { from, to, label: HR_REPORT_PERIODS[period] };
}

export async function buildHrReport(
  db: Database,
  actor: Actor,
  options: { period?: HrReportPeriod; now?: Date } = {},
) {
  await accessScope(db, actor, 'ops:hr_reports:read');
  const now = options.now ?? new Date();
  const period = options.period ?? 'this_month';
  const window = hrReportWindow(period, now);
  return {
    period,
    window,
    scope: scopeFor(actor, 'ops:hr_reports:read'),
    activeEmployees: await activeEmployeesMetric(db, actor, now),
    byDepartment: await employeesByDepartmentMetric(db, actor, now),
    joining: await upcomingJoiningDates(db, actor, { now }),
    lifecycle: await hrLifecycleMetrics(db, actor, { from: window.from, to: window.to, now }),
    time: await hrTimeMetrics(db, actor, window),
  };
}
