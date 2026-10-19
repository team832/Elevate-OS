/**
 * HR time metrics for the HR dashboard (OPS-059; definitions in
 * docs/parts/hr-time.md → KPI). Every value is `metric.ok` or `metric.missing`
 * — never a 0 standing in for "no data". Scoped like the reports
 * (`ops:hr_reports:read`; department managers see their chain).
 * Attendance figures are operational signals, never performance measures.
 */
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  opsAttendanceCorrections,
  opsAttendanceSessions,
  opsLeaveRequests,
  type Database,
} from '@elevate/database';
import { metric, type Metric } from '@elevate/shared-contracts';
import type { IsoDate } from '@elevate/shared-types';
import type { Actor } from '../context';
import { hrScope, hrScopeIds } from '../hr-scope';
import { buildTimesheets } from '../hr/timesheets';

export interface HrTimeMetrics {
  attendanceExceptionsOpen: Metric;
  leaveRequestsAwaitingApproval: Metric;
  scheduledHours: Metric;
  recordedHours: Metric;
}

export async function hrTimeMetrics(
  db: Database,
  actor: Actor,
  window: { from: IsoDate; to: IsoDate; label?: string },
): Promise<HrTimeMetrics> {
  const scope = await hrScope(db, actor, 'ops:hr_reports:read');
  const ids = hrScopeIds(scope);
  const w = { from: window.from, to: window.to, label: window.label };
  if (ids && ids.length === 0) {
    const none = (definition: string, unit: Metric['unit']) =>
      metric.missing('Your account is not linked to staff records in scope.', {
        definition,
        window: w,
        unit,
      });
    return {
      attendanceExceptionsOpen: none(DEFINITIONS.exceptions, 'count'),
      leaveRequestsAwaitingApproval: none(DEFINITIONS.leave, 'count'),
      scheduledHours: none(DEFINITIONS.scheduled, 'hours'),
      recordedHours: none(DEFINITIONS.recorded, 'hours'),
    };
  }

  const [missing] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(opsAttendanceSessions)
    .where(
      and(
        eq(opsAttendanceSessions.status, 'open'),
        isNotNull(opsAttendanceSessions.missingClockOutFlaggedAt),
        ids ? inArray(opsAttendanceSessions.staffId, ids) : undefined,
      ),
    );
  const [pendingCorrections] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(opsAttendanceCorrections)
    .where(
      and(
        eq(opsAttendanceCorrections.status, 'pending'),
        ids ? inArray(opsAttendanceCorrections.staffId, ids) : undefined,
      ),
    );
  const [pendingLeave] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(opsLeaveRequests)
    .where(
      and(
        eq(opsLeaveRequests.status, 'pending'),
        ids ? inArray(opsLeaveRequests.staffId, ids) : undefined,
      ),
    );

  const sheets = await buildTimesheets(db, actor, { from: window.from, to: window.to });
  const toHours = (
    m: { status: 'ok'; value: number } | { status: 'missing'; reason: string },
    definition: string,
  ) =>
    m.status === 'ok'
      ? metric.ok(Math.round((m.value / 60) * 10) / 10, { definition, window: w, unit: 'hours' })
      : metric.missing(m.reason, { definition, window: w, unit: 'hours' });

  return {
    // Counts of records are measured facts: 0 here means "none open", which is known.
    attendanceExceptionsOpen: metric.ok((missing?.n ?? 0) + (pendingCorrections?.n ?? 0), {
      definition: DEFINITIONS.exceptions,
      window: w,
      unit: 'count',
    }),
    leaveRequestsAwaitingApproval: metric.ok(pendingLeave?.n ?? 0, {
      definition: DEFINITIONS.leave,
      window: w,
      unit: 'count',
    }),
    scheduledHours: toHours(sheets.totals.scheduledMinutes, DEFINITIONS.scheduled),
    recordedHours: toHours(sheets.totals.workedMinutes, DEFINITIONS.recorded),
  };
}

export const DEFINITIONS = {
  exceptions:
    'Open attendance exceptions now: sessions flagged as missing clock-out plus correction requests awaiting a decision.',
  leave: 'Leave requests in "pending" state now, awaiting an approver.',
  scheduled:
    'Paid scheduled hours from assigned shifts in the window (holidays and non-working days excluded); missing when nobody has a shift.',
  recorded:
    'Hours worked in closed, non-superseded attendance sessions in the window (break excluded); missing when no session was recorded.',
} as const;
