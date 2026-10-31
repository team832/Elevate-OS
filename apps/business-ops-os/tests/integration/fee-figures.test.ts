/**
 * One ledger, one figure (HMO-001 to HMO-013, HMO-020, HMO-021, HUS-008): for the same ledger, every
 * screen, paper and record that says what a student owes gives the same amount. Each scenario has
 * its own counsellor, so the reader's own scope isolates it on the lists. Fictional data only.
 */
import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { opsAdmissions, opsExitRecords, opsLeads, type opsApplications } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { callRoute, createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { POST as lifecycle } from '../../src/app/api/v1/admissions/[id]/lifecycle/route';
import { POST as planAction } from '../../src/app/api/v1/fee-plans/[id]/route';
import { POST as addEntry } from '../../src/app/api/v1/fee-plans/[id]/entries/route';
import { POST as decide } from '../../src/app/api/v1/fee-plans/[id]/decision/route';
import { POST as charge } from '../../src/app/api/v1/fees/route';
import { POST as feeAction } from '../../src/app/api/v1/fees/[id]/route';
import type { IsoDate } from '../../src/domain/dates';
import { getAdmission } from '../../src/server/admissions-read';
import { admissionRecord } from '../../src/server/application-record';
import { createApplication } from '../../src/server/applications';
import { liveSnapshot, paidOf } from '../../src/server/applications-state';
import { buildAdmissionsOverview } from '../../src/server/admissions-overview';
import { listCollections, listOutstanding } from '../../src/server/fee-collections';
import { feeYear } from '../../src/server/fee-year';
import { feeStatusForStudents, listAdmissionFees, studentFeePlans } from '../../src/server/fees';
import { loadSettings } from '../../src/server/settings';
import { getStudent } from '../../src/server/student-profile';
import { StudentFeesSection } from '../../src/ui/student-fees-section';
import { post } from './admissions-fixtures';
import { activePlan } from './application-fixtures';
import { isoDaysFromNow, setupReference, staffUser, type StaffUser } from './fixtures';
import { caseOf, identity } from './lifecycle-fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const ctx = setupTestDatabase();
const db = () => ctx.db;
let manager: StaffUser;
let otherManager: StaffUser;
let finance: StaffUser;
let director: TestUser;

const today = isoDaysFromNow(0) as IsoDate;
type Student = Awaited<ReturnType<typeof newStudent>>;

async function newStudent(tuition = 100_000_00) {
  const reader = await staffUser(db(), ['admissions_counsellor']);
  const sid = await identity(db(), 'Sample Fee Figures');
  const admission = await caseOf(db(), manager.id, sid, 'enrolled', {
    counsellorStaffId: reader.staffId,
  });
  const plan = await activePlan(db(), director, admission.id, sid, finance.id, {
    totalPaise: tuition,
  });
  return { reader, sid, admission, formCase: admission, planId: plan.id as string };
}

let receipt = 0;
const accepted = async <R extends { status: number; error?: unknown }>(
  res: Promise<R>,
  status = 201,
) => {
  const r = await res;
  expect(r.error ?? null).toBeNull();
  expect(r.status).toBe(status);
  return r;
};
const entry = (who: { token: string }, s: Student, body: unknown) =>
  callRoute<{ id: string }>(addEntry, post(who, body), { id: s.planId });
const payment = (amountPaise: number, extra: Record<string, unknown> = {}) => ({
  kind: 'received',
  amountPaise,
  paymentDate: today,
  receiptReference: `TEST-FIG-${(receipt += 1)}`,
  method: 'upi',
  ...extra,
});
const pay = (s: Student, amountPaise: number, extra?: Record<string, unknown>) =>
  accepted(entry(finance, s, payment(amountPaise, extra)));
const reverse = (id: string) =>
  accepted(
    callRoute(feeAction, post(finance, { action: 'reverse', reason: 'Wrong entry (test)' }), {
      id,
    }),
  );
const adjust = async (s: Student, totalPaise: number) =>
  (
    await accepted(
      callRoute<{ id: string }>(
        planAction,
        post(manager, {
          action: 'adjust',
          totalPaise,
          dueDates: [isoDaysFromNow(30), isoDaysFromNow(120), isoDaysFromNow(210)],
          reason: 'Change of terms (test)',
        }),
        { id: s.planId },
      ),
      200,
    )
  ).data!.id;
const decideOn = (id: string, decision: 'approved' | 'rejected') =>
  accepted(callRoute(decide, post(director, { decision, comment: 'Decided (test)' }), { id }), 200);
const activate = (id: string) =>
  accepted(callRoute(planAction, post(finance, { action: 'activate' }), { id }), 200);

const statementOwed = (b: number | null | undefined) => Math.max(0, b ?? Number.NaN);
const statementCredit = (b: number | null | undefined) => Math.max(0, -(b ?? Number.NaN));
const sum = <T>(rows: readonly T[], of: (r: T) => number) => rows.reduce((n, r) => n + of(r), 0);

/** What each surface says is owed, and the credit where the surface shows one. */
async function figures(s: Student) {
  const r = s.reader;
  const id = s.admission.id;
  const fees = await studentFeePlans(db(), r, s.sid);
  const inForce = fees.plans.filter((p) => p.plan.status !== 'draft');
  const [casePage, api, profile, list, overview, year] = [
    (await listAdmissionFees(db(), r, id)).summary.balancePaise,
    (await getAdmission(db(), r, id)).feeSummary?.balancePaise,
    (await getStudent(db(), r, s.sid)).fees?.balancePaise,
    await listOutstanding(db(), r, { page: 1 }),
    (await buildAdmissionsOverview(db(), r)).fees?.outstanding,
    (await feeYear(db(), r, {})).totals,
  ];
  return {
    owed: {
      feesTab: sum(inForce, (p) => p.totals.outstandingPaise),
      casePage: statementOwed(casePage),
      admissionApi: statementOwed(api),
      studentReport: statementOwed(profile),
      outstandingList: list.owedPaise,
      overview: overview?.outstandingPaise ?? 0,
      feeYear: year.outstandingPaise,
    },
    credit: {
      feesTab: sum(inForce, (p) => p.totals.creditPaise),
      casePage: statementCredit(casePage),
      admissionApi: statementCredit(api),
      studentReport: statementCredit(profile),
      overview: overview?.creditPaise ?? 0,
      feeYear: year.creditPaise,
    },
  };
}

/** Sections 07 and 08 of the paper, printed from the application's own snapshot. */
async function paper(s: Student) {
  const app = await withTransaction(db(), (tx) =>
    createApplication(tx, manager, {
      admission: s.formCase,
      studentId: s.sid as never,
      origin: 'direct',
      academicYear: '2026-27',
    }),
  );
  const row = app as unknown as typeof opsApplications.$inferSelect;
  const snapshot = await liveSnapshot(db(), row, await loadSettings(db()));
  return admissionRecord(db(), row, snapshot, 1, new Date());
}

type Scenario = [
  string,
  number,
  (s: Student) => Promise<unknown>,
  { owed: number; credit?: number; paper?: false },
];
const SCENARIOS: Scenario[] = [
  [
    'typical: part paid, registration charged and paid (HMO-001)',
    100_000_00,
    async (s) => {
      await pay(s, 50_000_00);
      const reg = { admissionId: s.admission.id, chargeCategory: 'registration' };
      await accepted(callRoute(charge, post(finance, { ...reg, kind: 'due' })));
      await accepted(
        callRoute(
          charge,
          post(finance, {
            ...reg,
            kind: 'received',
            amountPaise: 5_000_00,
            paymentDate: today,
            receiptReference: 'TEST-FIG-REG',
          }),
        ),
      );
    },
    { owed: 50_000_00 },
  ],
  [
    'a reversed payment counts once, as nothing (HMO-009, HMO-010)',
    100_000_00,
    async (s) => {
      const wrong = await pay(s, 30_000_00);
      await pay(s, 7_000_00);
      await reverse(wrong.data!.id);
    },
    { owed: 93_000_00 },
  ],
  [
    'a refund lowers what was paid',
    100_000_00,
    async (s) => {
      const p = await pay(s, 40_000_00);
      await accepted(
        callRoute(
          feeAction,
          post(finance, {
            action: 'refund',
            amountPaise: 10_000_00,
            paymentDate: today,
            receiptReference: 'TEST-FIG-REFUND',
          }),
          { id: p.data!.id },
        ),
      );
    },
    { owed: 70_000_00 },
  ],
  [
    'a discount lowers what is owed',
    100_000_00,
    async (s) => {
      await accepted(
        entry(manager, s, { kind: 'discount', amountPaise: 5_000_00, notes: 'Sibling (test)' }),
      );
      await pay(s, 10_000_00);
    },
    { owed: 85_000_00 },
  ],
  [
    'a debit stays owed and leaves a paid instalment paid (HMO-006)',
    100_000_00,
    async (s) => {
      await accepted(
        entry(finance, s, {
          kind: 'adjustment',
          direction: 'debit',
          amountPaise: 20_000_00,
          notes: 'Late fee (test)',
        }),
      );
      await pay(s, 50_000_00);
    },
    { owed: 70_000_00 },
  ],
  [
    'an overpayment is a credit, on every record (HMO-004)',
    10_000_00,
    (s) => pay(s, 12_000_00),
    { owed: 0, credit: 2_000_00 },
  ],
  [
    'an approved version change keeps the receipts and the discount (HMO-003)',
    100_000_00,
    async (s) => {
      await pay(s, 50_000_00);
      await accepted(
        entry(manager, s, { kind: 'discount', amountPaise: 5_000_00, notes: 'Sibling (test)' }),
      );
      const v2 = await adjust(s, 110_000_00);
      await decideOn(v2, 'approved');
      await activate(v2);
      s.planId = v2;
    },
    { owed: 55_000_00 },
  ],
  [
    'a change waiting for approval moves nothing (HMO-002)',
    100_000_00,
    async (s) => {
      await pay(s, 30_000_00);
      await adjust(s, 120_000_00);
    },
    { owed: 70_000_00, paper: false },
  ],
  [
    'a rejected change restores nothing because nothing moved; money still posts (HMO-002)',
    100_000_00,
    async (s) => {
      await pay(s, 30_000_00);
      await decideOn(await adjust(s, 120_000_00), 'rejected');
      await pay(s, 10_000_00);
    },
    { owed: 60_000_00, paper: false },
  ],
  [
    'a chain continued on a bundle sibling counts the earlier receipts (HMO-005)',
    100_000_00,
    async (s) => {
      await pay(s, 40_000_00);
      await accepted(
        callRoute(planAction, post(manager, { action: 'close', reason: 'Moving (test)' }), {
          id: s.planId,
        }),
        200,
      );
      const sibling = await caseOf(db(), manager.id, s.sid, 'enrolled', {
        programme: 'CLASS_12',
        counsellorStaffId: s.reader.staffId,
      });
      const v2 = await activePlan(db(), director, sibling.id, s.sid, finance.id, {
        version: 2,
        supersedesPlanId: s.planId,
        adjustmentReason: 'Moved to the other case (test)',
      });
      s.planId = v2.id;
      s.formCase = sibling;
    },
    { owed: 60_000_00 },
  ],
];

beforeAll(async () => {
  await setupReference(db());
  manager = await staffUser(db(), ['operations_manager']);
  otherManager = await staffUser(db(), ['operations_manager']);
  finance = await staffUser(db(), ['finance_officer']);
  director = await createTestUser(db(), { roles: ['director'] });
}, 120_000);

describe('every surface shows the same figure for the same ledger', () => {
  it.each(SCENARIOS)('%s', async (_, tuition, build, want) => {
    const s = await newStudent(tuition);
    await build(s);
    const { owed, credit } = await figures(s);
    const all = <O extends object>(o: O, n: number) =>
      Object.fromEntries(Object.keys(o).map((k) => [k, n]));
    expect(owed).toEqual(all(owed, want.owed));
    expect(credit).toEqual(all(credit, want.credit ?? 0));

    const status = (await feeStatusForStudents(db(), [s.sid])).get(s.sid);
    expect(status).not.toBe('not_configured');
    if (want.owed > 0) expect(status).not.toBe('paid');

    if (want.paper !== false) {
      const { tracker } = await paper(s);
      const agreement = tracker.filter((t) => t.label !== 'Registration' && t.label !== 'Other');
      expect(sum(agreement, (t) => t.balancePaise ?? 0)).toBe(want.owed - (want.credit ?? 0));
    }

    await accepted(
      callRoute(
        lifecycle,
        post(manager, {
          action: 'exit',
          exitStatus: 'withdrawn',
          exitDate: today,
          reason: 'Family moved (test)',
        }),
        { id: s.admission.id },
      ),
      200,
    );
    const [record] = await db()
      .select()
      .from(opsExitRecords)
      .where(eq(opsExitRecords.admissionId, s.admission.id));
    expect(record!.balancePaise).toBe(want.owed - (want.credit ?? 0));
  });
});

describe('the statement: charged, received, owed (HMO-001)', () => {
  it('₹1,00,000 agreement, ₹50,000 paid, registration ₹5,000 charged and paid', async () => {
    const s = await newStudent();
    await SCENARIOS[0]![2](s);
    expect((await listAdmissionFees(db(), s.reader, s.admission.id)).summary).toMatchObject({
      duePaise: 105_000_00,
      netReceivedPaise: 55_000_00,
      balancePaise: 50_000_00,
      balanceState: 'outstanding',
    });
  });
});

describe('a change waiting for approval (HMO-002)', () => {
  it('the Fees tab reads the accepted figures first, labels the draft, and offers the payment form once', async () => {
    const s = await newStudent();
    await pay(s, 30_000_00);
    await adjust(s, 120_000_00);
    const html = renderToStaticMarkup(
      await StudentFeesSection({ studentId: s.sid as never, user: finance as never }),
    );
    expect(html).toContain('These figures stand');
    expect(html).toContain('Proposed change');
    expect(html).toContain('Outstanding if activated');
    expect(html.indexOf('₹70,000')).toBeLessThan(html.indexOf('₹90,000'));
    expect(html.match(/Record a payment/g)).toHaveLength(1);
    expect(html.match(/Payment history/g)).toHaveLength(1);
    expect(html.match(/Tuition, 2026-27/g)).toHaveLength(1);
  });

  it('the Fees tab shows the accepted version and the draft apart; money posts only on the accepted one', async () => {
    const s = await newStudent();
    await pay(s, 30_000_00);
    const v2 = await adjust(s, 120_000_00);
    const { plans } = await studentFeePlans(db(), s.reader, s.sid);
    expect(plans.map((p) => [p.plan.id, p.inForce, p.proposedChange])).toEqual([
      [v2, false, true],
      [s.planId, true, false],
    ]);
    const draft = await callRoute(addEntry, post(finance, payment(1_000_00)), { id: v2 });
    expect(draft.status).toBe(400);
    expect(draft.error?.message).toMatch(/draft/);
  });

  it('after the new version is activated the old one takes no more money', async () => {
    const s = await newStudent();
    const v2 = await adjust(s, 120_000_00);
    await decideOn(v2, 'approved');
    await activate(v2);
    const old = await callRoute(addEntry, post(finance, payment(1_000_00)), { id: s.planId });
    expect(old.status).toBe(400);
  });

  it('a deliberately closed agreement stays closed to money', async () => {
    const s = await newStudent();
    await accepted(
      callRoute(planAction, post(manager, { action: 'close', reason: 'Ended (test)' }), {
        id: s.planId,
      }),
      200,
    );
    expect((await entry(finance, s, payment(1_000_00))).status).toBe(400);
  });
});

describe('the Overview under a programme filter (HMO-005)', () => {
  it('counts receipts on the earlier version, on another case', async () => {
    const s = await newStudent();
    await SCENARIOS[9]![2](s);
    const o = await buildAdmissionsOverview(db(), s.reader, { programme: 'CLASS_12' });
    expect(o.fees?.outstanding).toMatchObject({ agreements: 1, outstandingPaise: 60_000_00 });
  });
});

describe('the outstanding list holds what no instalment holds (HMO-006)', () => {
  it('a debit above the instalments has its own row, and the views add up', async () => {
    const s = await newStudent();
    await accepted(
      entry(finance, s, {
        kind: 'adjustment',
        direction: 'debit',
        amountPaise: 20_000_00,
        notes: 'Late fee (test)',
      }),
    );
    const list = await listOutstanding(db(), s.reader, { page: 1 });
    expect(list.owedPaise).toBe(120_000_00);
    expect(list.rows.find((r) => r.sequence === null)).toMatchObject({
      remainingPaise: 20_000_00,
      dueDate: null,
    });
  });
});

describe('a reduction never makes a credit nobody paid (HMO-007, Proposed)', () => {
  it.each([
    ['a discount above what is owed', 'discount', 150_000_00, 400],
    ['a waiver above what is owed', 'waiver', 100_000_01, 400],
    ['a discount of exactly what is owed', 'discount', 100_000_00, 201],
  ])('%s → %s', async (_, kind, amountPaise, status) => {
    const s = await newStudent();
    const res = await entry(manager, s, { kind, amountPaise, notes: 'Test reason' });
    expect(res.status).toBe(status as number);
    if (status === 400) expect(res.error?.message).toMatch(/still owed/);
  });

  it('counts what was already paid on the earlier version', async () => {
    const s = await newStudent();
    await pay(s, 90_000_00);
    const v2 = await adjust(s, 100_000_00);
    await decideOn(v2, 'approved');
    await activate(v2);
    s.planId = v2;
    const over = { kind: 'waiver', amountPaise: 10_000_01, notes: 'Test reason' };
    expect((await entry(otherManager, s, over)).status).toBe(400);
  });

  it('a registration waiver is bound by the registration fee', async () => {
    const s = await newStudent();
    const reg = { admissionId: s.admission.id, chargeCategory: 'registration' };
    await accepted(callRoute(charge, post(finance, { ...reg, kind: 'due' })));
    const body = { ...reg, kind: 'waiver', amountPaise: 5_000_01, notes: 'Test reason' };
    expect((await callRoute(charge, post(finance, body))).status).toBe(400);
  });
});

describe('a refund cannot predate its payment (HMO-012, Proposed)', () => {
  it('refused before the payment date, accepted on it', async () => {
    const s = await newStudent();
    const p = await pay(s, 10_000_00, { paymentDate: isoDaysFromNow(-5) });
    const refund = (paymentDate: string) =>
      callRoute(
        feeAction,
        post(finance, {
          action: 'refund',
          amountPaise: 1_000_00,
          paymentDate,
          receiptReference: 'TEST-FIG-REFUND-DATE',
        }),
        { id: p.data!.id },
      );
    expect((await refund(isoDaysFromNow(-6))).status).toBe(400);
    expect((await refund(isoDaysFromNow(-5))).status).toBe(201);
  });
});

describe('Collections: the list and its total (HMO-009)', () => {
  it('a reversed payment is marked; the status filter narrows the total too', async () => {
    const s = await newStudent();
    const wrong = await pay(s, 30_000_00);
    await pay(s, 7_000_00);
    await reverse(wrong.data!.id);
    const range = { from: today, to: today, page: 1 };
    const all = await listCollections(db(), s.reader, range);
    expect(all.collected?.netPaise).toBe(7_000_00);
    expect(all.rows.map((r) => [r.amountPaise, r.reversed]).sort()).toEqual([
      [30_000_00, true],
      [7_000_00, false],
    ]);
    const verified = await listCollections(db(), s.reader, { ...range, status: 'verified' });
    expect(verified.total).toBe(0);
    expect(verified.collected?.netPaise).toBe(0);
  });
});

describe('sample money says so (HMO-020)', () => {
  it('collections and outstanding carry the sample share; real money does not', async () => {
    const s = await newStudent();
    await pay(s, 30_000_00);
    const range = { from: today, to: today, page: 1 };
    const before = await listCollections(db(), s.reader, range);
    expect(before.collected?.samplePaise).toBe(0);
    expect((await listOutstanding(db(), s.reader, { page: 1 })).samplePaise).toBe(0);
    await db().update(opsLeads).set({ isSample: true }).where(eq(opsLeads.id, s.admission.leadId));
    expect((await listCollections(db(), s.reader, range)).collected?.samplePaise).toBe(30_000_00);
    expect((await listOutstanding(db(), s.reader, { page: 1 })).samplePaise).toBe(70_000_00);
    const o = await buildAdmissionsOverview(db(), s.reader);
    expect(o.fees?.collected?.samplePaise).toBe(30_000_00);
    expect(o.fees?.outstanding?.samplePaise).toBe(70_000_00);
  });
});

describe('an agreement on the bundle’s second case (HMO-021)', () => {
  it('the application sees it, and its money counts towards the payment gate', async () => {
    const s = await newStudent();
    const sibling = await caseOf(db(), manager.id, s.sid, 'enrolled', {
      programme: 'CLASS_12',
      counsellorStaffId: s.reader.staffId,
    });
    await accepted(
      callRoute(planAction, post(manager, { action: 'close', reason: 'Moving (test)' }), {
        id: s.planId,
      }),
      200,
    );
    const plan = await activePlan(db(), director, sibling.id, s.sid, finance.id, {
      version: 2,
      supersedesPlanId: s.planId,
      adjustmentReason: 'Moved to the other case (test)',
    });
    s.planId = plan.id;
    await pay(s, 50_000_00);
    const app = await withTransaction(db(), (tx) =>
      createApplication(tx, manager, {
        admission: s.admission,
        studentId: s.sid as never,
        origin: 'direct',
        academicYear: '2026-27',
        bundleAdmissionIds: [sibling.id],
      }),
    );
    const row = app as unknown as typeof opsApplications.$inferSelect;
    const snapshot = await liveSnapshot(db(), row, await loadSettings(db()));
    expect(snapshot.feeAgreement?.planId).toBe(plan.id);
    expect((await paidOf(db(), [s.admission.id, sibling.id])).tuitionPaise).toBe(50_000_00);
  });
});

describe('the payment gate counts a reversed payment as nothing (HMO-011)', () => {
  it('₹5,000 paid and reversed is ₹0, not ₹10,000', async () => {
    const s = await newStudent();
    const reg = { admissionId: s.admission.id, chargeCategory: 'registration' };
    const paid = await accepted(
      callRoute<{ id: string }>(
        charge,
        post(finance, {
          ...reg,
          kind: 'received',
          amountPaise: 5_000_00,
          paymentDate: today,
          receiptReference: 'TEST-FIG-GATE',
        }),
      ),
    );
    expect((await paidOf(db(), [s.admission.id])).registrationPaise).toBe(5_000_00);
    await reverse(paid.data!.id);
    expect((await paidOf(db(), [s.admission.id])).registrationPaise).toBe(0);
  });
});

describe('a paper for a version that was since replaced (HMO-003)', () => {
  it('prints its signed terms and money to date, and names the version in force', async () => {
    const s = await newStudent();
    const v1 = (await studentFeePlans(db(), s.reader, s.sid)).plans[0]!;
    const app = await withTransaction(db(), (tx) =>
      createApplication(tx, manager, {
        admission: s.admission,
        studentId: s.sid as never,
        origin: 'direct',
        academicYear: '2026-27',
      }),
    );
    const row = app as unknown as typeof opsApplications.$inferSelect;
    const signed = await liveSnapshot(db(), row, await loadSettings(db()));
    expect(signed.feeAgreement?.planId).toBe(v1.plan.id);
    await pay(s, 10_000_00);
    const v2 = await adjust(s, 120_000_00);
    await decideOn(v2, 'approved');
    await activate(v2);
    s.planId = v2;
    await pay(s, 5_000_00);
    const record = await admissionRecord(db(), row, signed, 1, new Date());
    expect(record.summary.coursePaise).toBe(100_000_00);
    expect(record.tracker.find((t) => t.label === '1st instalment')?.receivedPaise).toBe(15_000_00);
    expect(record.laterVersion).toBe(2);
    const current = await liveSnapshot(db(), row, await loadSettings(db()));
    expect((await admissionRecord(db(), row, current, 2, new Date())).laterVersion).toBeNull();
  });
});

describe('the same payment twice (HUS-008, API-008, Proposed)', () => {
  it.each<[string, Record<string, unknown>, number]>([
    ['same receipt, amount, date: refused', {}, 400],
    ['a receipt in other capitals is the same receipt: refused', { upper: true }, 400],
    ['another receipt is a second payment', { receiptReference: 'TEST-FIG-OTHER' }, 201],
    ['another amount on one receipt is allowed', { amountPaise: 1_000_00 }, 201],
    ['another date on one receipt is allowed', { paymentDate: isoDaysFromNow(-1) }, 201],
    ['one receipt split over a named instalment is allowed', { named: true }, 201],
  ])('%s', async (_, change, status) => {
    const s = await newStudent();
    const first = { ...payment(5_000_00), receiptReference: 'test-fig-dup' };
    await accepted(entry(finance, s, first));
    const { upper, named, ...rest } = change;
    const { plans } = await studentFeePlans(db(), s.reader, s.sid);
    const res = await entry(finance, s, {
      ...first,
      ...rest,
      ...(upper ? { receiptReference: 'TEST-FIG-DUP' } : {}),
      ...(named ? { instalmentId: plans[0]!.instalments[1]!.instalment.id } : {}),
    });
    expect(res.status).toBe(status);
    if (status === 400) expect(res.error?.message).toMatch(/already recorded/);
  });

  it('a reversed payment may be entered again, correctly', async () => {
    const s = await newStudent();
    const first = { ...payment(5_000_00), receiptReference: 'TEST-FIG-AGAIN' };
    const made = await accepted(entry(finance, s, first));
    await reverse(made.data!.id);
    expect((await entry(finance, s, first)).status).toBe(201);
  });

  it('three at once: one row, whatever the keys', async () => {
    const s = await newStudent();
    const body = { ...payment(5_000_00), receiptReference: 'TEST-FIG-RACE' };
    const codes = await Promise.all([1, 2, 3].map(() => entry(finance, s, body)));
    expect(codes.map((r) => r.status).sort()).toEqual([201, 400, 400]);
  });
});

describe('a fee row opens a page that exists (RVA-002)', () => {
  it.each([
    ['admission_pending', false],
    ['enrolled', true],
  ] as const)('%s, has a student record: %s', async (status, hasRecord) => {
    const reader = await staffUser(db(), ['admissions_counsellor']);
    const sid = await identity(db(), 'Sample Fee Link');
    const admission = await caseOf(db(), manager.id, sid, status, { counsellorStaffId: reader.staffId });
    if (!hasRecord)
      await db().update(opsAdmissions).set({ admittedAt: null, admissionNumber: null }).where(eq(opsAdmissions.id, admission.id));
    const plan = await activePlan(db(), director, admission.id, sid, finance.id, { totalPaise: 100_000_00 });
    await pay({ planId: plan.id as string } as Student, 10_000_00);
    const href = hasRecord ? `/ops/students/${sid}?tab=fees` : `/ops/admissions/${admission.id}#fee-agreement`;
    const collections = await listCollections(db(), reader, { from: today, to: today, page: 1 });
    expect(collections.rows.map((r) => r.href)).toEqual([href]);
    expect((await listOutstanding(db(), reader, { page: 1 })).rows[0]!.href).toBe(href);
    expect((await feeYear(db(), reader, {})).rows[0]!.href).toBe(href);
    if (hasRecord) await expect(getStudent(db(), reader, sid)).resolves.toBeTruthy();
    else await expect(getStudent(db(), reader, sid)).rejects.toThrow(/no student record yet/);
  });
});
