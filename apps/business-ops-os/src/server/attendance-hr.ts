/**
 * HR Overview figures for attendance (owner brief 23 Oct 2026 §7: "attendance needing review").
 * Each figure links to the filtered list it counts. Only for people who read everyone's attendance.
 */
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { requirePermission, can } from '@elevate/authorization';
import { opsAttendanceCorrections, type Database } from '@elevate/database';
import { reviewReasons } from '../domain/attendance';
import { addDays, istToday } from '../domain/dates';
import { deriveDays, hrAttendanceStaff, listRange } from './attendance';
import type { Actor } from './context';

export { attendanceSummary } from './attendance';

const BASE = '/ops/hr/attendance';

export async function hrAttendanceCounts(
  db: Database,
  user: Actor,
): Promise<{ key: string; label: string; value: number | null; href: string }[]> {
  if (!can(user, 'ops:attendance:read') || requirePermission(user, 'ops:attendance:read') !== 'all')
    return [];
  const { from, to } = listRange({});
  const today = istToday(new Date());
  const yesterday = addDays(today, -1);
  const staff = await hrAttendanceStaff(db, user);
  const days = [...(await deriveDays(db, staff, from, to)).values()].flat();
  const [pending] = await db
    .select({ n: count() })
    .from(opsAttendanceCorrections)
    .where(
      and(
        eq(opsAttendanceCorrections.status, 'pending'),
        staff.length
          ? inArray(
              opsAttendanceCorrections.staffId,
              staff.map((s) => s.id),
            )
          : sql`false`,
      ),
    );
  const reasons = days.map((d) => reviewReasons(d, today));
  return [
    {
      key: 'attendance_review',
      label: 'Attendance days needing review (last 6 days)',
      value: reasons.filter((r) => r.length).length,
      href: `${BASE}?tab=review`,
    },
    {
      key: 'attendance_missing_checkout',
      label: 'Missing check-outs (last 6 days)',
      value: reasons.filter((r) => r.includes('missing_checkout')).length,
      href: `${BASE}?tab=review&review=missing_checkout`,
    },
    {
      key: 'attendance_corrections',
      label: 'Correction requests waiting',
      value: pending?.n ?? 0,
      href: `${BASE}?tab=corrections`,
    },
    {
      key: 'attendance_unmarked_yesterday',
      label: 'Unmarked scheduled days yesterday',
      value: days.filter(
        (d) => d.date === yesterday && reviewReasons(d, today).includes('unmarked'),
      ).length,
      href: `${BASE}?from=${yesterday}&to=${yesterday}&review=unmarked`,
    },
  ];
}
