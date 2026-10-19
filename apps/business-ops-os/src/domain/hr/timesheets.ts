/**
 * Timesheet summaries (OPS-059). Pure.
 *
 * Per employee and day: scheduled minutes (or "not scheduled"), worked minutes
 * of closed, non-superseded sessions, late/early flags, missing clock-outs,
 * unresolved exceptions and approved leave. Period totals keep missing apart
 * from zero. The worked − scheduled difference is an "unapproved difference",
 * never overtime (no overtime approval exists). Attendance alone is never a
 * performance measure.
 */
import type { IsoDate } from '@elevate/shared-types';
import { sessionWorkedMinutes } from './attendance';
import { scheduledMinutesTotal, type DaySchedule } from './shifts';

export interface TimesheetSession {
  workDate: string;
  clockInAt: Date;
  clockOutAt: Date | null;
  breakMinutes: number;
  status: 'open' | 'closed' | 'superseded';
  lateMinutes: number | null;
  earlyDepartureMinutes: number | null;
  missingClockOutFlaggedAt: Date | null;
}

export interface TimesheetDay {
  date: IsoDate;
  schedule: DaySchedule;
  sessions: number;
  workedMinutes: number | null;
  late: boolean;
  early: boolean;
  missingClockOut: boolean;
  openSession: boolean;
  leaveDays: number;
  pendingCorrections: number;
}

export function dailyTimesheet(
  schedule: readonly DaySchedule[],
  sessions: readonly TimesheetSession[],
  approvedLeaveByDate: ReadonlyMap<string, number>,
  pendingCorrectionsByDate: ReadonlyMap<string, number>,
): TimesheetDay[] {
  return schedule.map((s) => {
    const day = sessions.filter((x) => x.workDate === s.date && x.status !== 'superseded');
    const closed = day.filter((x) => x.status === 'closed');
    return {
      date: s.date,
      schedule: s,
      sessions: day.length,
      workedMinutes: closed.length
        ? closed.reduce((sum, x) => sum + (sessionWorkedMinutes(x) ?? 0), 0)
        : null,
      late: day.some((x) => (x.lateMinutes ?? 0) > 0),
      early: day.some((x) => (x.earlyDepartureMinutes ?? 0) > 0),
      missingClockOut: day.some((x) => x.status === 'open' && x.missingClockOutFlaggedAt !== null),
      openSession: day.some((x) => x.status === 'open'),
      leaveDays: approvedLeaveByDate.get(s.date) ?? 0,
      pendingCorrections: pendingCorrectionsByDate.get(s.date) ?? 0,
    };
  });
}

export type Measured = { status: 'ok'; value: number } | { status: 'missing'; reason: string };

export interface PeriodSummary {
  from: IsoDate;
  to: IsoDate;
  scheduledMinutes: Measured;
  scheduledDays: number;
  workedMinutes: Measured;
  daysWithAttendance: number;
  lateCount: number;
  earlyCount: number;
  missingClockOuts: number;
  /** Missing clock-outs + pending corrections. */
  unresolvedExceptions: number;
  approvedLeaveDays: number;
  /** worked − scheduled when both are known; not approved overtime. */
  unapprovedDifferenceMinutes: Measured;
}

export function periodSummary(
  from: IsoDate,
  to: IsoDate,
  days: readonly TimesheetDay[],
): PeriodSummary {
  const total = scheduledMinutesTotal(days.map((d) => d.schedule));
  const scheduledMinutes: Measured =
    total.status === 'ok' ? { status: 'ok', value: total.minutes } : total;
  const withWork = days.filter((d) => d.workedMinutes !== null);
  const workedMinutes: Measured = withWork.length
    ? { status: 'ok', value: withWork.reduce((s, d) => s + (d.workedMinutes ?? 0), 0) }
    : { status: 'missing', reason: 'No completed attendance session recorded in this period.' };
  const missingClockOuts = days.filter((d) => d.missingClockOut).length;
  const pending = days.reduce((s, d) => s + d.pendingCorrections, 0);
  return {
    from,
    to,
    scheduledMinutes,
    scheduledDays: total.status === 'ok' ? total.scheduledDays : 0,
    workedMinutes,
    daysWithAttendance: days.filter((d) => d.sessions > 0).length,
    lateCount: days.filter((d) => d.late).length,
    earlyCount: days.filter((d) => d.early).length,
    missingClockOuts,
    unresolvedExceptions: missingClockOuts + pending,
    approvedLeaveDays: days.reduce((s, d) => s + d.leaveDays, 0),
    unapprovedDifferenceMinutes:
      scheduledMinutes.status === 'ok' && workedMinutes.status === 'ok'
        ? { status: 'ok', value: workedMinutes.value - scheduledMinutes.value }
        : {
            status: 'missing',
            reason: 'Needs both scheduled and worked hours for the period.',
          },
  };
}

/** Sum measured values; missing only when every part is missing. */
export function sumMeasured(values: readonly Measured[], reason: string): Measured {
  const ok = values.filter((v): v is { status: 'ok'; value: number } => v.status === 'ok');
  return ok.length
    ? { status: 'ok', value: ok.reduce((s, v) => s + v.value, 0) }
    : { status: 'missing', reason };
}
