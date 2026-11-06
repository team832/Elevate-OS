/**
 * Payroll and payslips (F4-14): components and salaries, a monthly run built from salaries,
 * approved unpaid leave (half days) and advance instalments, one-off lines, submit and approve
 * (never by who started or submitted it), the lock after approval, marking paid, own payslips
 * only, and amount-free audit rows and notices. Months are in 2026 before November; the review's
 * regression cases (REV-PAY) use 2025 and run after the 2026 ones. Fictional data.
 */
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@elevate/shared-types';
import {
  auditEvents,
  notifications,
  opsLeaveRecords,
  opsPayslipLines,
  opsPayslips,
  opsSettings,
  opsStaffProfiles,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import {
  authedRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { POST as addAdvance } from '../../src/app/api/v1/payroll/advances/route';
import { POST as addComponent } from '../../src/app/api/v1/payroll/components/route';
import { PATCH as setComponent } from '../../src/app/api/v1/payroll/components/[id]/route';
import { DELETE as removeLine } from '../../src/app/api/v1/payroll/lines/[id]/route';
import { POST as markPaid } from '../../src/app/api/v1/payroll/payslips/[id]/route';
import { GET as runDownload } from '../../src/app/api/v1/payroll/runs/[id]/download/route';
import { POST as addLine } from '../../src/app/api/v1/payroll/runs/[id]/lines/route';
import { POST as runAction } from '../../src/app/api/v1/payroll/runs/[id]/route';
import { POST as createRun } from '../../src/app/api/v1/payroll/runs/route';
import { POST as addStructure } from '../../src/app/api/v1/payroll/structures/route';
import { GET as payslipPdf } from '../../src/app/api/v1/payslips/[id]/pdf/route';
import { myPayslips, payrollHome } from '../../src/server/payroll-read';
import { post } from './admissions-fixtures';
import { setupReference, staffUser, type StaffUser } from './fixtures';

/** What each payslip PDF printed (the drawn lines), to check whose payslip a download holds. */
const printed = vi.hoisted(() => [] as string[]);
vi.mock('../../src/server/pdf/payslip', async (orig) => {
  const real = await orig<typeof import('../../src/server/pdf/payslip')>();
  return {
    ...real,
    payslipsPdf: async (...a: Parameters<typeof real.payslipsPdf>) => {
      const pdf = await real.payslipsPdf(...a);
      printed.push(pdf.lines.join(' '));
      return pdf;
    },
  };
});

const ctx = setupTestDatabase();
const db = (): Database => ctx.db;
let hr: StaffUser;
let director: StaffUser;
let director2: StaffUser;
let teacher: StaffUser;
let counsellor: StaffUser;
let auditor: TestUser;
const comp: Record<string, string> = {};

type Env<T> = { status: number; data?: T; error?: unknown };
const ok = async <T>(r: Promise<Env<T>>) => {
  const res = await r;
  expect(res.error ?? null).toBeNull();
  return res.data as T;
};
const status = async (r: Promise<{ status: number }>) => (await r).status;
const act = (user: TestUser, id: string, action: string) =>
  callRoute(runAction, post(user, { action }), { id });
const startRun = (user: TestUser, month: string) =>
  ok(callRoute<{ id: string }>(createRun, post(user, { month })));
async function approvedRun(month: string, maker: TestUser = hr, approver: TestUser = director) {
  const { id } = await startRun(maker, month);
  await ok(act(maker, id, 'submit'));
  await ok(act(approver, id, 'approve'));
  return id;
}
const slipOf = async (runId: string, staffId: string) =>
  (
    await db()
      .select()
      .from(opsPayslips)
      .where(and(eq(opsPayslips.runId, runId), eq(opsPayslips.staffId, staffId as never)))
  )[0];
const linesOf = (payslipId: string) =>
  db().select().from(opsPayslipLines).where(eq(opsPayslipLines.payslipId, payslipId));
const leave = (
  staffId: string,
  fromDate: string,
  kind: string,
  dayPart: 'first_half' | null = null,
  st: 'approved' | 'cancelled' = 'approved',
) =>
  db()
    .insert(opsLeaveRecords)
    .values({
      staffId: staffId as never,
      fromDate,
      toDate: fromDate,
      kind,
      dayPart,
      status: st,
      approvedBy: hr.id,
    });
/** Teachers open it in Academic, where work.ts mounts the same handler (D-073). */
const pdfOf = (user: TestUser, id: string) =>
  payslipPdf(
    authedRequest(user, `/${user === teacher ? 'academic' : 'ops'}/api/v1/payslips/${id}/pdf`),
    {
      params: Promise.resolve({ id }),
    },
  );
const salary = (
  user: TestUser,
  staffId: string,
  effectiveFrom: string,
  lines: Record<string, string>,
) => callRoute<{ id: string }>(addStructure, post(user, { staffId, effectiveFrom, lines }));

beforeAll(async () => {
  await setupReference(db());
  hr = await staffUser(db(), ['hr_manager'], { name: 'Sample HR Manager' });
  director = await staffUser(db(), ['director'], { name: 'Sample Director' });
  director2 = await staffUser(db(), ['director'], { name: 'Sample Second Director' });
  teacher = await staffUser(db(), ['teacher'], { name: 'Sample Payroll Teacher' });
  counsellor = await staffUser(db(), ['admissions_counsellor'], {
    name: 'Sample Payroll Counsellor',
  });
  auditor = await createTestUser(db(), { roles: ['auditor'] });
  for (const [code, name, kind] of [
    ['basic', 'Basic pay', 'earning'],
    ['hra', 'House rent allowance', 'earning'],
    ['pt', 'Professional tax', 'deduction'],
    ['old_bonus', 'Old bonus', 'earning'],
  ] as const)
    comp[code] = (
      await ok(callRoute<{ id: string }>(addComponent, post(hr, { code, name, kind })))
    ).id;
  await ok(
    callRoute(
      setComponent,
      authedRequest(hr, '/x', { method: 'PATCH', json: { status: 'retired' } }),
      { id: comp.old_bonus! },
    ),
  );
}, 120_000);

describe('components and salaries', () => {
  it.each<[string, () => TestUser | null, object, number]>([
    ['signed out', () => null, { code: 'da', name: 'Dearness allowance', kind: 'earning' }, 401],
    [
      'a counsellor',
      () => counsellor,
      { code: 'da', name: 'Dearness allowance', kind: 'earning' },
      403,
    ],
    [
      'the auditor',
      () => auditor,
      { code: 'da', name: 'Dearness allowance', kind: 'earning' },
      403,
    ],
    ['a code with spaces', () => hr, { code: 'House rent', name: 'HRA', kind: 'earning' }, 400],
    ['a code twice', () => hr, { code: 'basic', name: 'Basic again', kind: 'earning' }, 400],
  ])('adding a component as %s', async (_, who, json, code) => {
    const user = who();
    const req = user
      ? post(user, json)
      : authedRequest({ token: 'test-only-none' }, '/x', { method: 'POST', json });
    expect(await status(callRoute(addComponent, req))).toBe(code);
  });

  it('refuses a salary not from the 1st, a retired component, and a second salary from the same month', async () => {
    expect(
      (await salary(hr, teacher.staffId, '2026-06-15', { [comp.basic!]: '25,000' })).status,
    ).toBe(400);
    expect(
      (await salary(hr, teacher.staffId, '2026-06-01', { [comp.old_bonus!]: '100' })).status,
    ).toBe(400);
    expect((await salary(hr, teacher.staffId, '2026-06-01', {})).status).toBe(400);
    await ok(
      salary(hr, teacher.staffId, '2026-06-01', {
        [comp.basic!]: '25,000',
        [comp.hra!]: '5,000',
        [comp.pt!]: '200',
      }),
    );
    expect(
      (await salary(hr, teacher.staffId, '2026-06-01', { [comp.basic!]: '26,000' })).status,
    ).toBe(400);
    expect(
      (await salary(counsellor, counsellor.staffId, '2026-01-01', { [comp.basic!]: '1' })).status,
    ).toBe(403);
    await ok(salary(hr, counsellor.staffId, '2026-01-01', { [comp.basic!]: '20,000' }));
  });
});

let june: string;
let teacherJune: string;
describe('a monthly run (June 2026: 30 days)', () => {
  it('builds lines from the salary, unpaid leave (half days) and the advance instalment', async () => {
    await leave(teacher.staffId, '2026-06-05', 'Unpaid');
    await leave(teacher.staffId, '2026-06-08', 'Unpaid', 'first_half');
    await leave(teacher.staffId, '2026-06-09', 'Casual');
    await leave(teacher.staffId, '2026-06-10', 'Unpaid', null, 'cancelled');
    const advance = {
      staffId: teacher.staffId,
      amount: '12,000',
      monthlyInstalment: '5,000',
      givenOn: '2026-05-20',
      recoverFrom: '2026-06-01',
      reason: 'Medical (test)',
    };
    expect(
      (await callRoute(addAdvance, post(hr, { ...advance, monthlyInstalment: '13,000' }))).status,
    ).toBe(400);
    await ok(callRoute(addAdvance, post(hr, advance)));

    june = (await startRun(hr, '2026-06')).id;
    const slip = (await slipOf(june, teacher.staffId))!;
    teacherJune = slip.id;
    expect(slip).toMatchObject({ daysInMonth: 30, lossOfPayDays: 1.5 });
    const lines = (await linesOf(slip.id)).map((l) => [l.source, l.kind, l.amountPaise]);
    expect(lines).toEqual(
      expect.arrayContaining([
        ['structure', 'earning', 25_000_00],
        ['structure', 'earning', 5_000_00],
        ['structure', 'deduction', 200_00],
        ['loss_of_pay', 'deduction', 1_500_00], // 30,000 × 1.5 ÷ 30
        ['advance_recovery', 'deduction', 5_000_00],
      ]),
    );
    expect(lines).toHaveLength(5);
    expect((await callRoute(createRun, post(hr, { month: '2026-06' }))).status).toBe(409);
    expect((await callRoute(createRun, post(hr, { month: '2099-01' }))).status).toBe(400);
  });

  it('adds a one-off line to a draft, then submit and approve by someone else', async () => {
    await ok(
      callRoute(
        addLine,
        post(hr, {
          staffId: teacher.staffId,
          kind: 'earning',
          source: 'one_off',
          label: 'Exam invigilation',
          amount: '1,000',
          note: 'Mock test duty (test)',
        }),
        { id: june },
      ),
    );
    expect((await act(hr, june, 'approve')).status).toBe(403); // HR prepares, does not approve
    const paid = { paidOn: '2026-07-01', paidMode: 'upi' };
    expect((await callRoute(markPaid, post(hr, paid), { id: teacherJune })).status).toBe(409); // draft
    await ok(act(hr, june, 'submit'));
    expect((await callRoute(markPaid, post(hr, paid), { id: teacherJune })).status).toBe(409); // submitted
    expect(
      (
        await callRoute(
          addLine,
          post(hr, {
            staffId: teacher.staffId,
            kind: 'earning',
            source: 'one_off',
            label: 'Late',
            amount: '1',
            note: 'x',
          }),
          { id: june },
        )
      ).status,
    ).toBe(409);
    await ok(act(director, june, 'approve'));
  });

  it('is locked once approved: no rebuild, line, removal or return; corrections go next month', async () => {
    const oneOff = (await linesOf(teacherJune)).find((l) => l.source === 'one_off')!;
    expect((await act(hr, june, 'rebuild')).status).toBe(409);
    expect((await act(director, june, 'return')).status).toBe(409);
    expect(
      (
        await callRoute(removeLine, authedRequest(hr, '/x', { method: 'DELETE' }), {
          id: oneOff.id,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await callRoute(
          addLine,
          post(hr, {
            staffId: teacher.staffId,
            kind: 'deduction',
            source: 'adjustment',
            label: 'Fix',
            amount: '1',
            note: 'x',
          }),
          { id: june },
        )
      ).status,
    ).toBe(409);
  });

  it('marks a payslip paid once, with date, mode and reference', async () => {
    const paid = { paidOn: '2026-07-01', paidMode: 'bank_transfer', paidReference: 'TEST-UTR-1' };
    expect(
      (
        await callRoute(markPaid, post(director2, { ...paid, paidOn: '2099-01-01' }), {
          id: teacherJune,
        })
      ).status,
    ).toBe(400);
    await ok(callRoute(markPaid, post(hr, paid), { id: teacherJune }));
    expect((await callRoute(markPaid, post(hr, paid), { id: teacherJune })).status).toBe(409);
    expect(await slipOf(june, teacher.staffId)).toMatchObject({
      paidOn: '2026-07-01',
      paidMode: 'bank_transfer',
      paidBy: hr.id,
    });
  });
});

describe('advance recovery stops at zero', () => {
  let september: string;
  it('recovers 5,000 + 5,000 + 2,000 and nothing after', async () => {
    const months = { '2026-07': 5_000_00, '2026-08': 2_000_00 };
    for (const [month, paise] of Object.entries(months)) {
      const id = await approvedRun(month);
      const rec = (await linesOf((await slipOf(id, teacher.staffId))!.id)).filter(
        (l) => l.source === 'advance_recovery',
      );
      expect(rec.map((l) => l.amountPaise)).toEqual([paise]);
    }
    september = (await startRun(hr, '2026-09')).id;
    const slip = (await slipOf(september, teacher.staffId))!;
    expect((await linesOf(slip.id)).filter((l) => l.source === 'advance_recovery')).toEqual([]);
    const home = await payrollHome(db(), hr);
    expect(home.advances[0]).toMatchObject({ recoveredPaise: 12_000_00, remainingPaise: 0 });
  });

  it('rebuilding a draft picks up leave approved since; net pay below zero cannot be submitted', async () => {
    await leave(teacher.staffId, '2026-09-14', 'unpaid', 'first_half');
    await ok(act(hr, september, 'rebuild'));
    const slip = (await slipOf(september, teacher.staffId))!;
    expect(slip.lossOfPayDays).toBe(0.5);
    expect((await linesOf(slip.id)).find((l) => l.source === 'loss_of_pay')?.amountPaise).toBe(
      50_000,
    ); // 30,000 × 0.5 ÷ 30
    const big = await ok(
      callRoute<{ id: string }>(
        addLine,
        post(hr, {
          staffId: teacher.staffId,
          kind: 'deduction',
          source: 'adjustment',
          label: 'Overpaid in August',
          amount: '1,00,000',
          note: 'Correction (test)',
        }),
        { id: september },
      ),
    );
    const refused = await act(hr, september, 'submit');
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.error)).toContain('Sample Payroll Teacher');
    expect(JSON.stringify(refused.error)).toContain('cancel the advance or add an earning');
    await ok(callRoute(removeLine, authedRequest(hr, '/x', { method: 'DELETE' }), { id: big.id }));
  });
});

describe('approver is neither the creator nor the submitter', () => {
  it.each<[string, () => TestUser, () => TestUser, () => TestUser, number]>([
    ['2026-01', () => director, () => director, () => director, 403], // started and submitted it
    ['2026-02', () => hr, () => director, () => director, 403], // submitted it
    ['2026-03', () => director, () => hr, () => director, 403], // started it
    ['2026-04', () => hr, () => hr, () => director2, 200],
  ])('%s', async (month, maker, submitter, approver, code) => {
    const { id } = await startRun(maker(), month);
    await ok(act(submitter(), id, 'submit'));
    expect((await act(approver(), id, 'approve')).status).toBe(code);
  });
});

describe('own payslips only', () => {
  it.each<[string, () => TestUser, () => Promise<string>, number]>([
    ['the teacher, own approved payslip', () => teacher, async () => teacherJune, 200],
    [
      'the teacher, a colleague’s payslip',
      () => teacher,
      async () => (await slipOf(june, counsellor.staffId))!.id,
      404,
    ],
    [
      'the teacher, own payslip in a draft run',
      () => teacher,
      async () =>
        (
          await db()
            .select()
            .from(opsPayslips)
            .where(
              and(eq(opsPayslips.staffId, teacher.staffId), eq(opsPayslips.lossOfPayDays, 0.5)),
            )
        )[0]!.id,
      404,
    ],
    ['a counsellor, the teacher’s payslip', () => counsellor, async () => teacherJune, 404],
    ['the auditor', () => auditor, async () => teacherJune, 403],
    ['HR, any payslip', () => hr, async () => teacherJune, 200],
    ['a director, any payslip', () => director, async () => teacherJune, 200],
  ])('%s', async (_, who, id, code) => {
    const res = await pdfOf(who(), await id());
    expect(res.status).toBe(code);
    if (code !== 200) return;
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(printed.at(-1)).toContain('Sample Payroll Teacher');
    expect(printed.at(-1)).not.toContain('Sample Payroll Counsellor');
  });

  it('My payslips lists only approved months of the signed-in person', async () => {
    const mine = await myPayslips(db(), teacher);
    expect(mine!.map((p) => p.month)).toEqual(['2026-08-01', '2026-07-01', '2026-06-01']);
    expect(mine![2]).toMatchObject({
      earningsPaise: 31_000_00,
      deductionsPaise: 6_700_00,
      netPaise: 24_300_00,
    });
  });

  it('the run spreadsheet and bulk PDF are for payroll holders only', async () => {
    const get = (user: TestUser, format: string) =>
      runDownload(
        authedRequest(user, `/ops/api/v1/payroll/runs/${june}/download?format=${format}`),
        { params: Promise.resolve({ id: june }) },
      );
    const csv = await get(hr, 'csv');
    expect(csv.status).toBe(200);
    expect(await csv.text()).toContain('Sample Payroll Teacher');
    expect((await get(director, 'pdf')).headers.get('content-type')).toBe('application/pdf');
    expect((await get(teacher, 'csv')).status).toBe(403);
    expect((await get(auditor, 'pdf')).status).toBe(403);
  });
});

describe('permissions per role (Proposed grants)', () => {
  it.each<[RoleKey, boolean, boolean]>([
    ['hr_manager', true, true],
    ['director', true, true],
    ['operations_manager', false, true],
    ['admissions_counsellor', false, true],
    ['finance_officer', false, true],
    ['academic_coordinator', false, true],
    ['teacher', false, true],
    ['auditor', false, false],
  ])('%s: salaries %s, own payslips %s', async (role, salaries, own) => {
    const user = await createTestUser(db(), { roles: [role] });
    await (salaries
      ? expect(payrollHome(db(), user)).resolves.toBeTruthy()
      : expect(payrollHome(db(), user)).rejects.toMatchObject({ status: 403 }));
    await (own
      ? expect(myPayslips(db(), user)).resolves.toBeNull()
      : expect(myPayslips(db(), user)).rejects.toMatchObject({ status: 403 }));
  });
});

// REV-PAY regression cases, in 2025 so they leave the 2026 runs above alone.
describe('who is paid in a month (2025)', () => {
  let raised: StaffUser;
  let leaver: StaffUser;
  let goner: StaffUser;
  let july: string;
  const leftOn = (staffId: string, day: string) =>
    db()
      .insert(opsStaffProfiles)
      .values({ staffId: staffId as never, leftOn: day, employmentStatus: 'exited' })
      .onConflictDoUpdate({ target: opsStaffProfiles.staffId, set: { leftOn: day } });
  const recovery = async (runId: string) =>
    (await linesOf((await slipOf(runId, raised.staffId))!.id))
      .filter((l) => l.source === 'advance_recovery')
      .reduce((t, l) => t + l.amountPaise, 0);

  beforeAll(async () => {
    raised = await staffUser(db(), ['teacher'], { name: 'Sample Raised Teacher' });
    leaver = await staffUser(db(), ['teacher'], { name: 'Sample Leaving Teacher' });
    goner = await staffUser(db(), ['teacher'], { name: 'Sample Gone Teacher' });
    for (const [who, from, amount] of [
      [raised, '2025-01-01', '20,000'],
      [raised, '2025-07-01', '22,000'],
      [raised, '2025-12-01', '99,000'],
      [leaver, '2025-01-01', '10,000'],
      [goner, '2025-01-01', '15,000'],
    ] as const)
      await ok(salary(hr, who.staffId, from, { [comp.basic!]: amount }));
    await leftOn(leaver.staffId, '2025-07-15');
  });

  it('uses the salary in force on the 1st, and nobody who left before the month', async () => {
    const aug = (await startRun(hr, '2025-08')).id;
    const lines = await linesOf((await slipOf(aug, raised.staffId))!.id);
    expect(lines.map((l) => l.amountPaise)).toEqual([22_000_00]);
    expect(await slipOf(aug, leaver.staffId)).toBeUndefined();
    july = (await startRun(hr, '2025-07')).id;
    expect(await slipOf(july, leaver.staffId)).toBeTruthy(); // the whole month: part months are an owner question
  });

  it('a rebuild resets the payslip of someone no longer paid, keeping hand-made lines', async () => {
    await leave(leaver.staffId, '2025-07-07', 'Unpaid');
    await ok(act(hr, july, 'rebuild'));
    expect((await slipOf(july, leaver.staffId))!.lossOfPayDays).toBe(1);
    await ok(
      callRoute(
        addLine,
        post(hr, {
          staffId: leaver.staffId,
          kind: 'earning',
          source: 'one_off',
          label: 'Notice pay',
          amount: '2,000',
          note: 'Settlement (test)',
        }),
        { id: july },
      ),
    );
    await leftOn(leaver.staffId, '2025-06-20');
    await leftOn(goner.staffId, '2025-06-30');
    await ok(act(hr, july, 'rebuild'));
    const kept = (await slipOf(july, leaver.staffId))!;
    expect(kept).toMatchObject({ structureId: null, lossOfPayDays: 0 });
    expect((await linesOf(kept.id)).map((l) => l.source)).toEqual(['one_off']);
    expect(await slipOf(july, goner.staffId)).toBeUndefined();
  });

  it('two open drafts never recover the same advance twice', async () => {
    await ok(
      callRoute(
        addAdvance,
        post(hr, {
          staffId: raised.staffId,
          amount: '10,000',
          monthlyInstalment: '10,000',
          givenOn: '2025-01-10',
          recoverFrom: '2025-02-01',
          reason: 'Two drafts (test)',
        }),
      ),
    );
    const feb = (await startRun(hr, '2025-02')).id;
    const mar = (await startRun(hr, '2025-03')).id;
    await ok(act(hr, feb, 'rebuild'));
    expect([await recovery(feb), await recovery(mar)]).toEqual([10_000_00, 0]);
  });

  it('counts the leave types of the setting "Leave types without a balance" as loss of pay', async () => {
    await leave(raised.staffId, '2025-09-02', 'Leave without pay');
    await leave(raised.staffId, '2025-09-04', 'Leave without pay');
    await leave(raised.staffId, '2025-09-03', 'Unpaid');
    await db()
      .insert(opsSettings)
      .values({ key: 'hr.leave_unpaid_types', value: { types: ['Leave without pay'] } });
    const sep = (await startRun(hr, '2025-09')).id;
    expect((await slipOf(sep, raised.staffId))!.lossOfPayDays).toBe(2);
    expect((await payrollHome(db(), hr)).unpaidTypes).toEqual(['Leave without pay']);
    await db().delete(opsSettings).where(eq(opsSettings.key, 'hr.leave_unpaid_types'));
  });
});

describe('an approver wrote nothing in the run (2025)', () => {
  it('refuses who added a line, even to their own payslip', async () => {
    const { id } = await startRun(hr, '2025-05');
    await ok(
      callRoute(
        addLine,
        post(director, {
          staffId: director.staffId,
          kind: 'earning',
          source: 'one_off',
          label: 'Bonus',
          amount: '5,00,000',
          note: 'Own line (test)',
        }),
        { id },
      ),
    );
    await ok(act(hr, id, 'submit'));
    const refused = await act(director, id, 'approve');
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.error)).toContain('You wrote a line in this payroll');
    expect((await act(director2, id, 'approve')).status).toBe(200);
  });

  it('refuses who set a salary the run uses', async () => {
    const newcomer = await staffUser(db(), ['teacher'], { name: 'Sample Newcomer' });
    await ok(salary(director2, newcomer.staffId, '2025-10-01', { [comp.basic!]: '18,000' }));
    const { id } = await startRun(hr, '2025-10');
    await ok(act(hr, id, 'submit'));
    const refused = await act(director2, id, 'approve');
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.error)).toContain('a salary it uses');
    expect((await act(director, id, 'approve')).status).toBe(200);
  });

  it('refuses the submit when nobody left may approve it (rule unchanged: owner question)', async () => {
    // Every other approver (directors made by earlier tests) is signed out for good: disabled.
    const others = await db()
      .select({ id: userRoles.userId })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.role, 'director'),
          notInArray(userRoles.userId, [director.id, director2.id]),
        ),
      );
    await db()
      .update(users)
      .set({ status: 'disabled' })
      .where(
        inArray(
          users.id,
          others.map((o) => o.id),
        ),
      );
    const joiner = await staffUser(db(), ['teacher'], { name: 'Sample November Joiner' });
    await ok(salary(director, joiner.staffId, '2025-11-01', { [comp.basic!]: '16,000' }));
    const { id } = await startRun(hr, '2025-11'); // director2 set the newcomer's salary above
    const refused = await act(hr, id, 'submit');
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.error)).toContain('Nobody else can approve this payroll');
    const sent = await db().select().from(notifications).where(eq(notifications.entityId, id));
    expect(sent).toEqual([]);
  });
});

describe('privacy: no salary in audit rows or notices', () => {
  const ENTITIES = [
    'payroll_component',
    'salary_structure',
    'salary_advance',
    'payroll_run',
    'payslip_line',
    'payslip',
  ];
  const KEYS = new Set(['staffId', 'lines', 'payslips', 'runId', 'payslipId', 'format']);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it('audit rows hold record ids and counts only', async () => {
    const rows = await db()
      .select()
      .from(auditEvents)
      .where(inArray(auditEvents.entityType, ENTITIES));
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) {
      expect([r.before, r.after]).toEqual([null, null]);
      for (const [k, v] of Object.entries((r.metadata ?? {}) as Record<string, unknown>)) {
        expect(KEYS.has(k), `${r.action} ${k}`).toBe(true);
        expect(
          typeof v === 'string'
            ? UUID.test(v) || ['pdf', 'csv'].includes(v)
            : Number.isInteger(v) && (v as number) < 100,
        ).toBe(true);
      }
    }
  });

  it('the approval notice names the month, never an amount', async () => {
    const sent = await db()
      .select()
      .from(notifications)
      .where(eq(notifications.kind, 'payroll.submitted'));
    expect(sent.length).toBeGreaterThan(0);
    for (const n of sent) {
      expect(n.title).toMatch(/^Payroll for [A-Z][a-z]+ 202[56] is waiting for your approval$/);
      expect(n.body).toBeNull();
    }
  });
});
