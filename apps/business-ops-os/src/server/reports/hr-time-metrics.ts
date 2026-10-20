/**
 * HR time metrics for the HR dashboard (OPS-059; definitions in
 * docs/parts/hr-time.md → KPI). Every value is `metric.ok` or `metric.missing`
 * — never a 0 standing in for "no data". Scoped like the reports
 * (`ops:hr_reports:read`; department managers see their chain).
 * Attendance figures are operational signals, never performance measures.
 */
import { and, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core';
import {
  opsAttendanceCorrections,
  opsAttendanceSessions,
  opsLeaveRequests,
  type Database,
} from '@elevate/database';
import { metric, type Metric } from '@elevate/shared-contracts';
import type { IsoDate } from '@elevate/shared-types';
import type { Measured } from '../../domain/hr/timesheets';
import type { Actor } from '../context';
import { hrScope, hrScopeIds } from '../hr-scope';
import { buildTimesheets } from '../hr/timesheets';

export interface HrTimeMetrics {
  attendanceExceptionsOpen: Metric;
  leaveRequestsAwaitingApproval: Metric;
  scheduledHours: Metric;
  recordedHours: Metric;
}

const DEFINITIONS = {
  exceptions:
    'Open attendance exceptions now: sessions flagged as missing clock-out plus correction requests awaiting a decision.',
  leave: 'Leave requests in "pending" state now, awaiting an approver.',
  scheduled:
    'Paid scheduled hours from assigned shifts in the window (holidays and non-working days excluded); missing when nobody has a shift.',
  recorded:
    'Hours worked in closed, non-superseded attendance sessions in the window (break excluded); missing when no session was recorded.',
} as const;

export async function hrTimeMetrics(
  db: Database,
  actor: Actor,
  window: { from: IsoDate; to: IsoDate; label?: string },
): Promise<HrTimeMetrics> {
  const scope = await hrScope(db, actor, 'ops:hr_reports:read');
  const ids = hrScopeIds(scope);
  const w = { from: window.from, to: window.to, label: window.label };
  const meta = (definition: string, unit: Metric['unit']) => ({ definition, window: w, unit });
  if (ids && ids.length === 0) {
    const none = (definition: string, unit: Metric['unit']) =>
      metric.missing(
        'Your account is not linked to staff records in scope.',
        meta(definition, unit),
      );
    return {
      attendanceExceptionsOpen: none(DEFINITIONS.exceptions, 'count'),
      leaveRequestsAwaitingApproval: none(DEFINITIONS.leave, 'count'),
      scheduledHours: none(DEFINITIONS.scheduled, 'hours'),
      recordedHours: none(DEFINITIONS.recorded, 'hours'),
    };
  }

  /** Rows of `table` in scope matching `where`. */
  const count = async (table: AnyPgTable & { staffId: AnyPgColumn }, where: SQL | undefined) => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .where(and(where, ids ? inArray(table.staffId, ids) : undefined));
    return row?.n ?? 0;
  };
  const missing = await count(
    opsAttendanceSessions,
    and(
      eq(opsAttendanceSessions.status, 'open'),
      isNotNull(opsAttendanceSessions.missingClockOutFlaggedAt),
    ),
  );
  const pendingCorrections = await count(
    opsAttendanceCorrections,
    eq(opsAttendanceCorrections.status, 'pending'),
  );
  const pendingLeave = await count(opsLeaveRequests, eq(opsLeaveRequests.status, 'pending'));

  const sheets = await buildTimesheets(db, actor, { from: window.from, to: window.to });
  const toHours = (m: Measured, definition: string) =>
    m.status === 'ok'
      ? metric.ok(Math.round((m.value / 60) * 10) / 10, meta(definition, 'hours'))
      : metric.missing(m.reason, meta(definition, 'hours'));

  return {
    // Counts of records are measured facts: 0 here means "none open", which is known.
    attendanceExceptionsOpen: metric.ok(
      missing + pendingCorrections,
      meta(DEFINITIONS.exceptions, 'count'),
    ),
    leaveRequestsAwaitingApproval: metric.ok(pendingLeave, meta(DEFINITIONS.leave, 'count')),
    scheduledHours: toHours(sheets.totals.scheduledMinutes, DEFINITIONS.scheduled),
    recordedHours: toHours(sheets.totals.workedMinutes, DEFINITIONS.recorded),
  };
}
