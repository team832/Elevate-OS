/**
 * F4-11: the end-of-day report reminder, sent by the task-reminders job (off until switched on)
 * `eod.deadline_reminder` minutes before `eod.submission_deadline`, to each active person who can
 * file a report, has a scheduled workday (HR attendance) and has not submitted that day's report.
 * Claimed per person and day in core.idempotency_keys before notifying (as the fee reminders do),
 * so a person is reminded once a day however often the job runs. In-app only.
 */
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  idempotencyKeys,
  opsEodReports as reports,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import { notify } from '@elevate/notifications';
import { addDays, istInstant } from '../domain/dates';
import { periodLabel, periodOf, reminderDay } from '../domain/work-report';
import { fmtDateTime } from '../ui/format';
import { userIdsHolding } from './context';
import { ownReportPath } from './eod-report-access';
import { loadSettings } from './settings';
import { linkFor } from './task-links';
import { expectations } from './work-reports';

/** Send the day's EOD reminders now due; returns how many were sent. */
export async function remindEodDeadline(tx: Database, now: Date) {
  const s = await loadSettings(tx);
  const time = s['eod.submission_deadline'].value.time;
  const minutes = s['eod.deadline_reminder'].value.minutesBefore;
  if (!time || !minutes) return 0;
  const day = reminderDay(now, time, minutes);
  const filers = day ? await userIdsHolding(tx, 'ops:tasks:write') : [];
  if (!day || !filers.length) return 0;
  const people = await tx
    .select({ staffId: staffMembers.id, userId: users.id })
    .from(staffMembers)
    .innerJoin(users, eq(users.id, staffMembers.userId))
    .leftJoin(
      reports,
      and(
        eq(reports.staffId, staffMembers.id),
        eq(reports.periodKind, 'day'),
        eq(reports.periodStart, day),
      ),
    )
    .where(
      and(
        eq(staffMembers.status, 'active'),
        eq(users.status, 'active'),
        inArray(users.id, filers),
        or(isNull(reports.id), eq(reports.status, 'draft')),
      ),
    );
  const period = periodOf('day', day);
  const expected = await expectations(
    tx,
    people.map((p) => p.staffId),
    period,
  );
  let sent = 0;
  for (const p of people) {
    if (expected.get(p.staffId) !== true) continue; // day off, or no work schedule known
    const [claimed] = await tx
      .insert(idempotencyKeys)
      .values({
        scope: 'eod-reminder',
        key: `${p.staffId}:${day}`,
        userId: null,
        requestHash: 'scheduled',
        // Kept past the day, so a later deadline set the same day cannot remind twice.
        expiresAt: istInstant(addDays(day, 2)),
      })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });
    if (!claimed) continue;
    await notify(tx, {
      userIds: [p.userId],
      module: 'ops',
      kind: 'eod.deadline_soon',
      title: `End-of-day report due by ${time} IST`,
      body: `Your report for ${periodLabel(period)} is due by ${fmtDateTime(istInstant(day, time))}.`,
      link: await linkFor(
        tx,
        p.userId,
        'work',
        ownReportPath({ periodKind: 'day', periodStart: day }),
      ),
    });
    sent += 1;
  }
  return sent;
}
