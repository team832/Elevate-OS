/**
 * Overdue fees (F4-04): one row per student with tuition instalments past their due date and not
 * fully paid, taken from the Outstanding allocation (outstandingInstalments: agreements in force,
 * the reader's own scope), and the "Send fee reminders" job. Manually recorded figures, not
 * verified payments. Families are never messaged.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  idempotencyKeys,
  opsAdmissions,
  opsFeeInstalments,
  opsFeePlans,
  opsFeeRecords,
  programmes,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import { notify } from '@elevate/notifications';
import { recordAudit, toCsv, withTransaction } from '@elevate/server-kit';
import type { UserId } from '@elevate/shared-types';
import { daysBetween, istInstant, istToday, type IsoDate } from '../domain/dates';
import { effectiveRecords, type FeeRecordLike } from '../domain/fees';
import { feeReminderDue } from '../domain/policies-jobs';
import { fmtDate, fmtPaise } from '../ui/format';
import { accessScope, userIdsHolding, userIdsWithRole, type Actor } from './context';
import { FEE_PAGE_SIZE, outstandingInstalments } from './fee-collections';
import { loadSettings } from './settings';

/** Days-overdue filter: [label, first day, last day]. */
export const OVERDUE_BANDS = {
  '1-30': ['1 to 30 days', 1, 30],
  '31-60': ['31 to 60 days', 31, 60],
  '61-90': ['61 to 90 days', 61, 90],
  'over-90': ['Over 90 days', 91, Infinity],
} as const;
type Band = keyof typeof OVERDUE_BANDS;

const picked = z.string().max(64).optional().catch(undefined);
/** The page's and the download's filters; a bad value is ignored, never an error. */
export const defaultersQuery = z.object({
  programme: picked,
  counsellor: picked,
  band: z
    .enum(Object.keys(OVERDUE_BANDS) as [Band, ...Band[]])
    .optional()
    .catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
});
export type DefaultersQuery = z.output<typeof defaultersQuery>;

/** The case each instalment's agreement hangs on: counsellor (and whether they can be reached) and programme. */
async function casesOf(db: Database, instalmentIds: readonly string[]) {
  const rows = await db
    .select({
      id: opsFeeInstalments.id,
      admissionId: opsAdmissions.id,
      counsellorId: opsAdmissions.counsellorStaffId,
      counsellor: staffMembers.fullName,
      counsellorUserId: staffMembers.userId,
      counsellorActive: sql<boolean>`coalesce(${staffMembers.status} <> 'inactive' and ${users.status} = 'active', false)`,
      programmeId: opsAdmissions.programmeId,
      programme: programmes.name,
    })
    .from(opsFeeInstalments)
    .innerJoin(opsFeePlans, eq(opsFeePlans.id, opsFeeInstalments.planId))
    .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeePlans.admissionId))
    .leftJoin(staffMembers, eq(staffMembers.id, opsAdmissions.counsellorStaffId))
    .leftJoin(users, eq(users.id, staffMembers.userId))
    .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
    .where(inArray(opsFeeInstalments.id, instalmentIds as never[]));
  return new Map(rows.map((r) => [r.id as string, r]));
}

/** Each student's latest tuition payment that still counts (a reversed one does not). */
async function lastPayments(db: Database, studentIds: readonly string[]) {
  const rows = await db
    .select({ r: opsFeeRecords, studentId: opsFeePlans.studentId })
    .from(opsFeeRecords)
    .innerJoin(opsFeePlans, eq(opsFeePlans.id, opsFeeRecords.planId))
    .where(inArray(opsFeePlans.studentId, studentIds as never[]));
  const last = new Map<string, string>();
  const ledger = rows.map(({ r, studentId }) => ({
    ...(r as FeeRecordLike & { paymentDate: string | null }),
    studentId: studentId as string,
  }));
  for (const r of effectiveRecords(ledger))
    if (r.kind === 'received' && r.paymentDate && r.paymentDate > (last.get(r.studentId) ?? ''))
      last.set(r.studentId, r.paymentDate);
  return last;
}

/** Students with overdue tuition in the reader's scope, most days overdue first. */
async function defaulters(db: Database, actor: Actor, now: Date) {
  // Oldest due date first, so a student's first instalment here is their oldest.
  const overdue = (await outstandingInstalments(db, actor, now)).filter(
    (i) => i.status === 'overdue',
  );
  const [cases, paid] = await Promise.all([
    casesOf(
      db,
      overdue.map((i) => i.id),
    ),
    lastPayments(
      db,
      overdue.map((i) => i.studentId),
    ),
  ]);
  const today = istToday(now);
  const first = (i: (typeof overdue)[number], admissionId: string) => ({
    studentId: i.studentId,
    studentName: i.studentName,
    isSample: i.isSample,
    href: i.href,
    caseHref: `/ops/admissions/${admissionId}#fee-agreement`,
    oldestDue: i.dueDate as IsoDate,
    daysOverdue: daysBetween(i.dueDate as IsoDate, today),
    instalments: 0,
    overduePaise: 0,
    counsellors: new Map<string, string>(),
    programmes: new Map<string, string>(),
    lastPaymentOn: paid.get(i.studentId) ?? null,
  });
  const students = new Map<string, ReturnType<typeof first>>();
  for (const i of overdue) {
    const c = cases.get(i.id)!; // every agreement hangs on a case
    const s = students.get(i.studentId) ?? first(i, c.admissionId);
    s.instalments += 1;
    s.overduePaise += i.remainingPaise;
    if (c.counsellorId) s.counsellors.set(c.counsellorId, c.counsellor ?? 'Unnamed');
    if (c.programmeId) s.programmes.set(c.programmeId, c.programme ?? 'Unnamed');
    students.set(i.studentId, s);
  }
  return [...students.values()].sort((a, b) => b.daysOverdue - a.daysOverdue);
}
export type Defaulter = Awaited<ReturnType<typeof defaulters>>[number];

const matches = (q: DefaultersQuery) => (s: Defaulter) =>
  (!q.programme || s.programmes.has(q.programme)) &&
  (!q.counsellor || s.counsellors.has(q.counsellor)) &&
  (!q.band ||
    (s.daysOverdue >= OVERDUE_BANDS[q.band][1] && s.daysOverdue <= OVERDUE_BANDS[q.band][2]));

const optionsOf = (rows: readonly Defaulter[], key: 'counsellors' | 'programmes') =>
  [...new Map(rows.flatMap((s) => [...s[key]])).entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

/** One page of overdue students under the filters, with the filter choices from the whole list. */
export async function listDefaulters(
  db: Database,
  actor: Actor,
  q: DefaultersQuery,
  now = new Date(),
) {
  const all = await defaulters(db, actor, now);
  const rows = all.filter(matches(q));
  return {
    rows: rows.slice((q.page - 1) * FEE_PAGE_SIZE, q.page * FEE_PAGE_SIZE),
    total: rows.length,
    overduePaise: rows.reduce((n, s) => n + s.overduePaise, 0),
    samplePaise: rows.reduce((n, s) => n + (s.isSample ? s.overduePaise : 0), 0),
    page: q.page,
    pageSize: FEE_PAGE_SIZE,
    any: all.length > 0,
    programmes: optionsOf(all, 'programmes'),
    counsellors: optionsOf(all, 'counsellors'),
  };
}

/** A student's counsellors or programmes as one line. */
export const names = (m: Map<string, string>, none = '') => [...m.values()].join(', ') || none;

/** The filtered list as a spreadsheet (every row, not one page); each download is audited. */
export async function defaultersCsv(
  db: Database,
  actor: Actor,
  q: DefaultersQuery,
  now = new Date(),
) {
  const rows = (await defaulters(db, actor, now)).filter(matches(q));
  await recordAudit(db, {
    actorUserId: actor.id,
    module: 'ops',
    action: 'fees.defaulters_exported',
    entityType: 'fee_report',
    entityId: 'defaulters',
    metadata: { rows: rows.length, programme: q.programme, counsellor: q.counsellor, band: q.band },
  });
  const csv = toCsv(
    [
      'Student',
      'Programme',
      'Counsellor',
      'Oldest due date',
      'Days overdue',
      'Overdue instalments',
      'Amount overdue (₹)',
      'Last payment date',
      'Sample data',
    ],
    rows.map((s) => [
      s.studentName ?? 'Not linked',
      names(s.programmes),
      names(s.counsellors, 'Not assigned'),
      s.oldestDue,
      s.daysOverdue,
      s.instalments,
      (s.overduePaise / 100).toFixed(2),
      s.lastPaymentOn,
      s.isSample ? 'Yes' : '',
    ]),
  );
  return { csv, filename: `overdue-fees-${istToday(now)}.csv` };
}

const reminderTitle = (days: number, name: string) =>
  `${days < 0 ? `Fee due in ${-days} day(s)` : days === 0 ? 'Fee due today' : `Fee overdue by ${days} day(s)`}: ${name}`;

/**
 * Job "Send fee reminders" (F4-04, off until switched on): on the Proposed days around each tuition
 * instalment's due date (`fees.reminders`), an in-app notice to the case's counsellor and every
 * finance officer. Each instalment and reminder day is claimed first in core.idempotency_keys
 * (unique, like the runner's slots; it expires once that reminder can no longer be sent), so no run
 * sends one twice. Someone who cannot be reached (no counsellor, login or employment ended) is
 * counted, never sent to. Runs as the job's actor, whose fee scope it lists (ops:jobs:run holders
 * see every case today).
 */
export async function runFeeReminders(
  db: Database,
  { actor, now = new Date(), requestId }: { actor: Actor; now?: Date; requestId?: string },
) {
  await accessScope(db, actor, 'ops:jobs:run');
  const { reminderDays } = (await loadSettings(db))['fees.reminders'].value;
  const today = istToday(now);
  const due = (await outstandingInstalments(db, actor, now)).flatMap((i) => {
    const r = i.dueDate ? feeReminderDue(i.dueDate as IsoDate, today, reminderDays) : null;
    return r ? [{ ...i, ...r }] : [];
  });
  const [cases, finance, readers] = await Promise.all([
    casesOf(
      db,
      due.map((d) => d.id),
    ),
    userIdsWithRole(db, 'finance_officer'),
    userIdsHolding(db, 'ops:fees:read'),
  ]);
  const reachable = new Set(
    (
      await db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, readers), eq(users.status, 'active')))
    ).map((u) => u.id),
  );
  return withTransaction(db, async (tx) => {
    const counts = { reminded: 0, sent: 0, unreachable: 0 };
    for (const d of due) {
      const [claimed] = await tx
        .insert(idempotencyKeys)
        .values({
          scope: 'fee-reminder',
          key: `${d.id}:${d.offset}`,
          userId: null,
          requestHash: 'scheduled',
          expiresAt: istInstant(d.until),
        })
        .onConflictDoNothing()
        .returning({ id: idempotencyKeys.id });
      if (!claimed) continue;
      const c = cases.get(d.id)!;
      const meant = [c.counsellorActive ? c.counsellorUserId : null, ...finance];
      const to = meant.filter((u): u is UserId => !!u && reachable.has(u));
      await notify(tx, {
        userIds: to,
        module: 'ops',
        kind: 'fee.reminder',
        title: reminderTitle(daysBetween(d.dueDate as IsoDate, today), d.studentName ?? 'Student'),
        body: `Instalment ${d.sequence} of ${d.of} (${d.plan}), due ${fmtDate(d.dueDate)}: ${fmtPaise(d.remainingPaise)} still owed. Counsellor: ${c.counsellor ?? 'not assigned'}.`,
        link: `/ops/admissions/${c.admissionId}#fee-agreement`,
        entityType: 'fee_instalment',
        entityId: d.id,
      });
      counts.reminded += 1;
      counts.sent += new Set(to).size;
      counts.unreachable += meant.length - to.length;
    }
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'job.fee_reminders',
      entityType: 'job',
      entityId: 'fee-reminders',
      after: { ...counts, considered: due.length, today, reminderDays },
      requestId,
    });
    return counts;
  });
}
