/**
 * Overdue fees and the "Fee reminders" job (F4-04): the list keeps the Outstanding instalments past
 * their due date, one row per student, in the reader's scope; the job tells the case's counsellor
 * and finance once per instalment and reminder day, never families. Each student's due dates are
 * moved apart so one scenario's dates never reach another's reminders. Fictional data only.
 */
import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditEvents, notifications, opsFeeInstalments, users } from '@elevate/database';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { POST as addEntry } from '../../src/app/api/v1/fee-plans/[id]/entries/route';
import { POST as planAction } from '../../src/app/api/v1/fee-plans/[id]/route';
import { GET as download } from '../../src/app/api/v1/fees/defaulters/route';
import { POST as feeAction } from '../../src/app/api/v1/fees/[id]/route';
import { POST as runNow } from '../../src/app/api/v1/jobs/[job]/route';
import { addDays, istInstant, type IsoDate } from '../../src/domain/dates';
import { listDefaulters, runFeeReminders } from '../../src/server/fee-defaulters';
import { runDueJobs } from '../../src/server/job-runner';
import { post } from './admissions-fixtures';
import { activePlan } from './application-fixtures';
import { isoDaysFromNow, setupReference, staffUser, type StaffUser } from './fixtures';
import { caseOf, identity } from './lifecycle-fixtures';

const ctx = setupTestDatabase();
const db = () => ctx.db;
let manager: StaffUser;
let finance: StaffUser;
let director: TestUser;
let receipt = 0;
const today = isoDaysFromNow(0);

beforeAll(async () => {
  await setupReference(db());
  manager = await staffUser(db(), ['operations_manager']);
  finance = await staffUser(db(), ['finance_officer']);
  director = await createTestUser(db(), { roles: ['director'] });
}, 120_000);

/** An active ₹1,00,000 agreement (50/25/25, first due in 30 days + `shift`) with its own counsellor. */
async function student(name = 'Sample Overdue Student', shift = 0) {
  const counsellor = await staffUser(db(), ['admissions_counsellor']);
  const sid = await identity(db(), name);
  const admission = await caseOf(db(), manager.id, sid, 'enrolled', {
    counsellorStaffId: counsellor.staffId,
  });
  const planId = (await activePlan(db(), director, admission.id, sid, finance.id)).id as string;
  await db()
    .update(opsFeeInstalments)
    .set({ dueDate: sql`${opsFeeInstalments.dueDate} + ${shift}::int` })
    .where(eq(opsFeeInstalments.planId, planId as never));
  const [first] = await db()
    .select()
    .from(opsFeeInstalments)
    .where(and(eq(opsFeeInstalments.planId, planId as never), eq(opsFeeInstalments.sequence, 1)));
  return {
    counsellor,
    sid: sid as string,
    admissionId: admission.id as string,
    planId,
    instalmentId: first!.id as string,
    due: first!.dueDate as IsoDate,
  };
}
type Student = Awaited<ReturnType<typeof student>>;

const ok = async <R extends { status: number; error?: unknown }>(r: Promise<R>) => {
  const res = await r;
  expect(res.error ?? null).toBeNull();
  return res;
};
const pay = (s: Student, amountPaise: number) =>
  ok(
    callRoute<{ id: string }>(
      addEntry,
      post(finance, {
        kind: 'received',
        amountPaise,
        paymentDate: today,
        receiptReference: `TEST-OVERDUE-${(receipt += 1)}`,
        method: 'upi',
      }),
      { id: s.planId },
    ),
  );
/** Noon IST `days` after the student's first due date. */
const at = (s: Student, days: number) => istInstant(addDays(s.due, days), '12:00');

describe('Overdue fees list', () => {
  it.each<[string, (s: Student) => Promise<unknown>, number, object | null]>([
    ['paid on time', (s) => pay(s, 50_000_00), 1, null],
    [
      'part-paid',
      (s) => pay(s, 10_000_00),
      1,
      { overduePaise: 40_000_00, daysOverdue: 1, lastPaymentOn: today },
    ],
    ['overdue by 1 day', async () => {}, 1, { overduePaise: 50_000_00, daysOverdue: 1 }],
    ['overdue by 30 days', async () => {}, 30, { overduePaise: 50_000_00, daysOverdue: 30 }],
    ['due today, not yet overdue', async () => {}, 0, null],
    ['due in future', async () => {}, -5, null],
    [
      'cancelled agreement',
      (s) =>
        ok(
          callRoute(planAction, post(manager, { action: 'close', reason: 'Left (test)' }), {
            id: s.planId,
          }),
        ),
      1,
      null,
    ],
    [
      'payment refunded',
      async (s) => {
        const p = await pay(s, 50_000_00);
        await ok(
          callRoute(
            feeAction,
            post(finance, {
              action: 'refund',
              amountPaise: 50_000_00,
              paymentDate: today,
              receiptReference: 'TEST-OVERDUE-REFUND',
            }),
            { id: p.data!.id },
          ),
        );
      },
      1,
      { overduePaise: 50_000_00, daysOverdue: 1, lastPaymentOn: today },
    ],
  ])('%s', async (_, setup, days, want) => {
    const s = await student();
    await setup(s);
    const { rows } = await listDefaulters(db(), s.counsellor, { page: 1 }, at(s, days));
    expect(rows).toEqual(
      want
        ? [
            expect.objectContaining({
              studentId: s.sid,
              instalments: 1,
              oldestDue: s.due,
              lastPaymentOn: null,
              ...want,
            }),
          ]
        : [],
    );
  });

  it('a counsellor sees only their students, finance every one; filters narrow it', async () => {
    const [a, b] = [await student('Sample Scope A'), await student('Sample Scope B')];
    const now = at(a, 40);
    const list = (who: TestUser, q: object = {}) =>
      listDefaulters(db(), who, { page: 1, ...q }, now);
    const ids = async (who: TestUser, q?: object) =>
      (await list(who, q)).rows.map((r) => r.studentId);
    expect(await ids(a.counsellor)).toEqual([a.sid]);
    expect(await ids(finance)).toEqual(expect.arrayContaining([a.sid, b.sid]));
    const mine = { counsellor: b.counsellor.staffId };
    const programme = (await list(b.counsellor)).programmes[0]!.value;
    expect(await ids(finance, mine)).toEqual([b.sid]);
    expect(await ids(finance, { ...mine, band: '31-60', programme })).toEqual([b.sid]);
    expect(await ids(finance, { ...mine, band: '1-30' })).toEqual([]);
    expect(await ids(finance, { ...mine, programme: 'another' })).toEqual([]);
  });
});

describe('Overdue fees spreadsheet', () => {
  const path = '/ops/api/v1/fees/defaulters';
  it('401 signed out, 403 without fee access; header, escaped cells, audited', async () => {
    const s = await student('Sample, "Quoted" Student', -35);
    expect((await callRoute(download, buildRequest(path))).status).toBe(401);
    const teacher = await createTestUser(db(), { roles: ['teacher'] });
    expect((await callRoute(download, authedRequest(teacher, path))).status).toBe(403);
    const res = await download(authedRequest(s.counsellor, path), { params: Promise.resolve({}) });
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    const [header, ...rows] = (await res.text()).trimEnd().split('\r\n');
    expect(header).toBe(
      'Student,Programme,Counsellor,Oldest due date,Days overdue,Overdue instalments,Amount overdue (₹),Last payment date,Sample data',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/^"Sample, ""Quoted"" Student",.+,\d+,1,50000\.00,,(Yes)?$/);
    const [audit] = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'fees.defaulters_exported'));
    expect(audit).toMatchObject({ actorUserId: s.counsellor.id, metadata: { rows: 1 } });
  });
});

describe('Fee reminders job', () => {
  const notices = (s: Student) =>
    db()
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.entityType, 'fee_instalment'),
          eq(notifications.entityId, s.instalmentId),
        ),
      );
  const run = (s: Student, days: number) =>
    runFeeReminders(db(), { actor: manager, now: at(s, days) });

  it('is registered and off: the runner leaves it alone; "Run now" runs it', async () => {
    expect(await runDueJobs(db(), new Date())).not.toContain('fee-reminders');
    expect((await callRoute(runNow, post(manager, {}), { job: 'fee-reminders' })).status).toBe(200);
  });

  it('tells the counsellor and finance once per instalment and reminder day, across runs', async () => {
    const s = await student('Sample Reminder Student', 370);
    expect(await run(s, -4)).toMatchObject({ reminded: 0 });
    expect(await run(s, -3)).toEqual({ reminded: 1, sent: 2, unreachable: 0 });
    expect(await run(s, -3)).toMatchObject({ reminded: 0 });
    expect(await run(s, -1)).toMatchObject({ reminded: 0 }); // caught up, but already sent
    expect(await run(s, 0)).toEqual({ reminded: 1, sent: 2, unreachable: 0 });
    expect(await run(s, 0)).toMatchObject({ reminded: 0 });
    const sent = await notices(s);
    expect(sent.map((n) => n.userId).sort()).toEqual(
      [s.counsellor.id, s.counsellor.id, finance.id, finance.id].sort(),
    );
    expect(new Set(sent.map((n) => n.title))).toEqual(
      new Set([
        'Fee due in 3 day(s): Sample Reminder Student',
        'Fee due today: Sample Reminder Student',
      ]),
    );
    for (const n of sent) {
      expect(n.link).toBe(`/ops/admissions/${s.admissionId}#fee-agreement`);
      expect(n.body).toMatch(/^Instalment 1 of 3 .*₹50,000 still owed/);
      expect(n.body).not.toMatch(/\d{10}/);
    }
  });

  it('counts a counsellor whose login is off as unreachable and still tells finance', async () => {
    const s = await student('Sample Unreachable Student', 1000);
    await db().update(users).set({ status: 'disabled' }).where(eq(users.id, s.counsellor.id));
    expect(await run(s, 7)).toEqual({ reminded: 1, sent: 1, unreachable: 1 });
    expect((await notices(s)).map((n) => n.userId)).toEqual([finance.id]);
  });
});
