import { beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { auditEvents, opsAdmissions, opsFeePlans, students } from '@elevate/database';
import {
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { GET as listPlans, POST as createPlan } from '../../src/app/api/v1/fee-plans/route';
import { POST as planAction } from '../../src/app/api/v1/fee-plans/[id]/route';
import { POST as addEntry } from '../../src/app/api/v1/fee-plans/[id]/entries/route';
import { POST as decide } from '../../src/app/api/v1/fee-plans/[id]/decision/route';
import { POST as askApproval } from '../../src/app/api/v1/fee-plans/[id]/approval-request/route';
import { GET as allFees, POST as charge } from '../../src/app/api/v1/fees/route';
import { POST as feeAction } from '../../src/app/api/v1/fees/[id]/route';
import { feeAgreementPreview, feeStatusForStudents, recordFee } from '../../src/server/fees';
import { admissionRow, readinessOf } from '../../src/server/admissions';
import { feeAgreementSource, feeArrangementSource } from '../../src/server/approvals';
import { updateSetting } from '../../src/server/settings';
import { MANUAL_FEE_DISCLAIMER } from '../../src/domain/fees';
import { setupReference, staffUser, isoDaysFromNow, type StaffUser } from './fixtures';
import { get, pendingCase, post } from './admissions-fixtures';
import { POST as check } from '../../src/app/api/v1/admissions/[id]/checks/route';
import { POST as feeApproval } from '../../src/app/api/v1/admissions/[id]/fee-approval/route';

// Lets one test take ops:fees:read away from an approver (no role has approve without it today).
const noFeeRead = vi.hoisted(() => ({ on: false }));
vi.mock('@elevate/authorization', async (load) => {
  const real = await load<typeof import('@elevate/authorization')>();
  return {
    ...real,
    can: (p: Parameters<typeof real.can>[0], x: Parameters<typeof real.can>[1]) =>
      !(noFeeRead.on && x === 'ops:fees:read') && real.can(p, x),
  };
});

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
let colleague: StaffUser;
let finance: StaffUser;
let director: TestUser;
let auditor: TestUser;
let coordinator: TestUser;
let teacher: TestUser;
let studentId: string;
let admissionId: string;
let planId: string;

type Instalment = {
  instalment: { id: string; sequence: number; amountPaise: number; dueDate: string };
  paidPaise: number;
  adjustedPaise: number;
  status: string;
};
type PlanView = {
  plans: {
    plan: { id: string; status: string; version: number; totalPaise: number };
    status: string;
    canActivate: boolean;
    totals: {
      netPaidPaise: number;
      refundedPaise: number;
      reductionsPaise: number;
      outstandingPaise: number;
      creditPaise: number;
    };
    instalments: Instalment[];
    ledger: { id: string; kind: string; code: string; manuallyRecorded: true }[];
    versions: { version: number; adjustmentReason: string | null }[];
    reconciliation: { reconciled: boolean };
  }[];
  registration: { configuredPaise: number | null; summary: { balancePaise: number | null } };
  tuitionOutsideAgreement: { duePaise: number };
  disclaimer: string;
};

async function newStudent(name: string) {
  const [s] = await ctx.db.insert(students).values({ fullName: name, isSample: true }).returning();
  return s!.id as string;
}
/** Demo booking / conversion links the canonical student; direct test cases link it here. */
const link = (id: string, sid: string) =>
  ctx.db
    .update(opsAdmissions)
    .set({ studentId: sid as never })
    .where(eq(opsAdmissions.id, id as never));

/** A pending admission linked to `sid` (a new student by default). */
async function newCase(sid?: string) {
  const { admissionId: id } = await pendingCase(counsellor);
  await link(id, sid ?? (await newStudent(`Fee Student ${id.slice(0, 6)}`)));
  return id;
}
/** BR-OPS-7: both fee verifications, by two different people. */
async function verify(id: string) {
  for (const [user, itemKey] of [
    [counsellor, 'fee_verification_1'],
    [manager, 'fee_verification_2'],
  ] as const)
    expect((await callRoute(check, post(user, { itemKey, status: 'done' }), { id })).status).toBe(
      200,
    );
}
/**
 * An admission of `sid` (a new student by default), verified, with an APPROVED admission-level
 * fee-arrangement approval, which since D-039 activates nothing.
 */
async function verifiedCase(sid?: string) {
  const id = await newCase(sid);
  await verify(id);
  for (const [user, action] of [
    [counsellor, 'request'],
    [director, 'approve'],
  ] as const)
    expect((await callRoute(feeApproval, post(user, { action }), { id })).status).toBe(200);
  return id;
}
const studentOf = async (id: string) => (await admissionRow(ctx.db, id)).studentId as string;

/** The plan's own approval: counsellor asks, director approves, finance activates. */
async function approveAndActivate(id: string) {
  expect((await callRoute(askApproval, post(counsellor, {}), { id })).status).toBe(201);
  expect((await callRoute(decide, post(director, { decision: 'approved' }), { id })).status).toBe(
    200,
  );
  const res = await callRoute<{ status: string; approvedBy: string }>(
    planAction,
    post(finance, { action: 'activate' }),
    { id },
  );
  expect(res.data).toMatchObject({ status: 'active', approvedBy: director.id });
}
const dueDates = [isoDaysFromNow(-10), isoDaysFromNow(60), isoDaysFromNow(150)];
const planBody = (extra: Record<string, unknown> = {}) => ({
  admissionId,
  studentId,
  label: 'Class 12 + CLAT, annual agreement',
  pricingReference: 'No approved fee schedule (OD-013); test figure',
  academicYear: '2026-27',
  totalPaise: 100_000_00,
  dueDates,
  ...extra,
});
const view = async (user: { token: string }, id = studentId) =>
  callRoute<PlanView>(listPlans, get(user, `/ops/api/v1/fee-plans?studentId=${id}`));
const current = async () => (await view(finance)).data!.plans[0]!;
const entry = (user: { token: string }, body: unknown, id = planId) =>
  callRoute<{ id: string; kind: string }>(addEntry, post(user, body), { id });
const act = (user: { token: string }, body: unknown, id: string) =>
  callRoute<{ id: string; status: string }>(feeAction, post(user, body), { id });
const auditsOf = (entityId: string, action: string) =>
  ctx.db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityId, entityId), eq(auditEvents.action, action)));
const pay = (amountPaise: number, extra: Record<string, unknown> = {}) => ({
  kind: 'received',
  amountPaise,
  paymentDate: isoDaysFromNow(0),
  receiptReference: `TEST-RCPT-${amountPaise}`,
  method: 'upi',
  ...extra,
});

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  colleague = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  finance = await staffUser(ctx.db, ['finance_officer']);
  director = await createTestUser(ctx.db, { roles: ['director'] });
  auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
  coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
  teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
  admissionId = await verifiedCase();
  studentId = await studentOf(admissionId);
});

describe('fee agreement: create (401 / 403 / 400 / 201 / 409), split 50/25/25', () => {
  it('checks session, permission and the input before writing', async () => {
    const anonymous = buildRequest('/x', { method: 'POST', json: planBody() });
    expect((await callRoute(createPlan, anonymous)).status).toBe(401);
    for (const user of [counsellor, auditor, director, teacher])
      expect((await callRoute(createPlan, post(user, planBody()))).status).toBe(403);
    for (const [patch, path] of [
      [{ dueDates: dueDates.slice(0, 2) }, 'dueDates'],
      [{ dueDates: [...dueDates].reverse() }, 'dueDates'],
      [{ totalPaise: 2 }, 'totalPaise'],
      [{ academicYear: '2026-28' }, 'academicYear'],
    ] as const) {
      const bad = await callRoute(createPlan, post(finance, planBody(patch)));
      expect(bad.status, path).toBe(400);
      expect(bad.error?.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: [path] })]),
      );
    }
    // Instalment amounts are never typed in: the split decides them (D-039).
    const typed = { instalments: [{ dueDate: dueDates[0], amountPaise: 100_000_00 }] };
    expect((await callRoute(createPlan, post(finance, planBody(typed)))).status).toBe(400);
  });

  it('₹1,00,000 → 50,000 / 25,000 / 25,000 as a draft, audited; the bundle is charged once', async () => {
    const res = await callRoute<{
      id: string;
      status: string;
      instalments: { sequence: number; amountPaise: number }[];
    }>(createPlan, post(finance, planBody()));
    expect(res.status).toBe(201);
    expect(res.data?.status).toBe('draft');
    expect(res.data?.instalments.map((i) => [i.sequence, i.amountPaise])).toEqual([
      [1, 50_000_00],
      [2, 25_000_00],
      [3, 25_000_00],
    ]);
    planId = res.data!.id;
    expect(await auditsOf(planId, 'fee_plan.created')).toHaveLength(1);
    // Same student and year from another programme admission of the bundle → 409, nothing written.
    const extra = await pendingCase(counsellor, { programmeCode: 'CLAT' });
    await link(extra.admissionId, studentId);
    const again = await callRoute(
      createPlan,
      post(finance, planBody({ admissionId: extra.admissionId })),
    );
    expect(again.status).toBe(409);
    const plans = await ctx.db
      .select()
      .from(opsFeePlans)
      .where(eq(opsFeePlans.studentId, studentId as never));
    expect(plans).toHaveLength(1);
  });

  it('preview: ₹1,20,000 → 60,000 / 30,000 / 30,000; approved registration fee ₹5,000 (D-044)', async () => {
    const p = await feeAgreementPreview(ctx.db, 120_000_00, [dueDates[0]!]);
    expect(p.instalments.map((i) => [i.sharePercent, i.amountPaise, i.dueDate])).toEqual([
      [50, 60_000_00, dueDates[0]],
      [25, 30_000_00, null],
      [25, 30_000_00, null],
    ]);
    expect(p.registration).toEqual({ amountPaise: 5_000_00, message: null });
  });
});

describe('fee agreement: activation needs its own approval', () => {
  it('a plan without its approval stays a draft (409); entries need an active plan', async () => {
    const pending = await pendingCase(counsellor);
    const sid = await newStudent('Draft Student');
    await link(pending.admissionId, sid);
    const other = await callRoute<{ id: string }>(
      createPlan,
      post(manager, planBody({ admissionId: pending.admissionId, studentId: sid })),
    );
    expect(other.status).toBe(201);
    const res = await callRoute(planAction, post(finance, { action: 'activate' }), {
      id: other.data!.id,
    });
    expect(res.status).toBe(409);
    expect((await entry(finance, pay(100), other.data!.id)).status).toBe(400);
    const closed = await callRoute<{ status: string }>(
      planAction,
      post(finance, { action: 'close', reason: 'Plan entered by mistake (test)' }),
      { id: other.data!.id },
    );
    expect(closed.data?.status).toBe('closed');
  });

  it('activates with the approver of its own request copied onto the plan', async () => {
    await approveAndActivate(planId);
  });
});

describe('fee ledger: partial payments, allocation, refunds, reversals, credit', () => {
  it('a part-payment fills the oldest instalment; a payment naming instalment 3 goes there', async () => {
    expect((await entry(counsellor, pay(100))).status).toBe(403);
    expect((await entry(manager, { kind: 'discount', amountPaise: 2_000_00 })).status).toBe(400);
    expect((await entry(finance, pay(30_000_00))).status).toBe(201);
    const third = (await current()).instalments.find((i) => i.instalment.sequence === 3)!;
    expect(
      (await entry(finance, pay(10_000_00, { instalmentId: third.instalment.id }))).status,
    ).toBe(201);
    const p = await current();
    expect(p.instalments.map((i) => [i.instalment.sequence, i.paidPaise, i.status])).toEqual([
      [1, 30_000_00, 'overdue'],
      [2, 0, 'unpaid'],
      [3, 10_000_00, 'part_paid'],
    ]);
    expect(p.status).toBe('overdue');
    expect(p.totals).toMatchObject({ netPaidPaise: 40_000_00, outstandingPaise: 60_000_00 });
    expect(p.ledger.every((r) => r.manuallyRecorded)).toBe(true);
  });

  it('a refund names its payment, never exceeds it, and is a linked audited row', async () => {
    const [payment] = (await current()).ledger.filter((r) => r.kind === 'received');
    const refund = (amountPaise: number) => ({
      action: 'refund',
      amountPaise,
      paymentDate: isoDaysFromNow(0),
      receiptReference: 'TEST-RFND-1',
    });
    expect((await act(counsellor, refund(100), payment!.id)).status).toBe(403);
    expect((await act(finance, refund(10_000_01), payment!.id)).status).toBe(400);
    const ok = await act(finance, refund(1_000_00), payment!.id);
    expect(ok.status).toBe(201);
    expect(await auditsOf(ok.data!.id, 'fee_record.refunded')).toHaveLength(1);
    const p = await current();
    expect(p.totals).toMatchObject({ refundedPaise: 1_000_00, netPaidPaise: 39_000_00 });
    expect(p.ledger).toHaveLength(3);
    // A refunded payment is not reversed while its refund counts (collected never goes negative).
    const blocked = await act(finance, { action: 'reverse', reason: 'Wrong row' }, payment!.id);
    expect(blocked.status).toBe(400);
    expect(blocked.error?.message).toBe('Reverse its refunds first.');
  });

  it('a reversal (wrong entry) cancels it as a linked row; the original stays; void is refused', async () => {
    const res = await entry(finance, pay(5_000_00, { receiptReference: 'TEST-BOUNCED' }));
    expect((await act(finance, { action: 'void', reason: 'Typo' }, res.data!.id)).status).toBe(409);
    expect((await act(finance, { action: 'reverse' }, res.data!.id)).status).toBe(400);
    const rev = await act(finance, { action: 'reverse', reason: 'Cheque bounced' }, res.data!.id);
    expect(rev.status).toBe(201);
    expect(await auditsOf(rev.data!.id, 'fee_record.reversed')).toHaveLength(1);
    expect((await act(finance, { action: 'reverse', reason: 'Again' }, res.data!.id)).status).toBe(
      400,
    );
    const p = await current();
    expect(p.totals.netPaidPaise).toBe(39_000_00);
    expect(p.ledger.map((r) => r.id)).toEqual(expect.arrayContaining([res.data!.id, rev.data!.id]));
  });

  it('discounts are separate from tuition; an overpayment is an explicit credit', async () => {
    const discount = await entry(manager, {
      kind: 'discount',
      amountPaise: 2_000_00,
      notes: 'Sibling (test)',
    });
    expect(discount.status).toBe(201);
    const refundDiscount = { action: 'refund', amountPaise: 1, paymentDate: isoDaysFromNow(0) };
    expect((await act(finance, refundDiscount, discount.data!.id)).status).toBe(400);
    expect((await entry(finance, pay(70_000_00))).status).toBe(201);
    const p = await current();
    expect(p.plan.totalPaise).toBe(100_000_00);
    expect(p.totals).toMatchObject({
      reductionsPaise: 2_000_00,
      netPaidPaise: 109_000_00,
      outstandingPaise: 0,
      creditPaise: 11_000_00,
    });
    expect(p.status).toBe('paid');
    expect(p.reconciliation.reconciled).toBe(true);
  });

  it('an instalment id without its agreement is refused (service level)', async () => {
    const inst = (await current()).instalments[0]!.instalment.id;
    await expect(
      recordFee(ctx.db, finance, admissionId, { ...pay(100), instalmentId: inst } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // No second tuition ledger beside the agreement (old POST /admissions/{id}/fees path).
    await expect(recordFee(ctx.db, finance, admissionId, pay(100) as never)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [expect.objectContaining({ path: ['planId'] })],
    });
    const otherAdmission = await verifiedCase();
    await expect(
      recordFee(ctx.db, finance, otherAdmission, {
        ...pay(100),
        planId,
        instalmentId: inst,
      } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('versioned adjustment keeps old receipts', () => {
  it('needs a reason and, for an accepted agreement, the fee-approval permission', async () => {
    const body = {
      action: 'adjust',
      totalPaise: 120_000_00,
      dueDates,
      reason: 'Scholarship withdrawn (test)',
    };
    expect((await callRoute(planAction, post(finance, body), { id: planId })).status).toBe(403);
    expect(
      (await callRoute(planAction, post(manager, { ...body, reason: 'short' }), { id: planId }))
        .status,
    ).toBe(400);
    const before = (await current()).ledger.map((r) => r.code).sort();
    const res = await callRoute<{ id: string; version: number; status: string }>(
      planAction,
      post(manager, body),
      { id: planId },
    );
    expect(res.status).toBe(200);
    // The new terms are a draft until a different person approves a NEW request (no self-approval).
    expect(res.data).toMatchObject({ version: 2, status: 'draft', approvalId: null });
    expect(await auditsOf(planId, 'fee_plan.adjusted')).toHaveLength(1);
    const v2 = res.data!.id;
    const activate = await callRoute(planAction, post(manager, { action: 'activate' }), { id: v2 });
    expect(activate.status).toBe(409);
    const approve = { decision: 'approved' };
    expect((await callRoute(decide, post(manager, approve), { id: v2 })).status).toBe(403);
    expect((await callRoute(decide, post(finance, approve), { id: v2 })).status).toBe(403);
    // R3-1: the director's inbox shows the version with tuition before -> after and the change.
    const [item] = (await feeAgreementSource.list(ctx.db, director)).filter((i) =>
      i.decide?.includes(v2),
    );
    expect(item).toMatchObject({
      title: `Fee Student ${admissionId.slice(0, 6)}: fee agreement 2026-27, version 2`,
      link: `/ops/students/${studentId}?tab=fees`,
      decide: `/ops/api/v1/fee-plans/${v2}/decision`,
    });
    expect(item).toMatchObject({ beforePaise: 1_00_000_00, afterPaise: 1_20_000_00 });
    // The request comment can carry amounts: without ops:fees:read the row shows neither.
    noFeeRead.on = true;
    const hidden = (await feeAgreementSource.list(ctx.db, director)).find((i) =>
      i.decide?.includes(v2),
    );
    noFeeRead.on = false;
    expect(hidden).toMatchObject({ detail: null, title: item!.title });
    expect(hidden).not.toHaveProperty('afterPaise');
    expect((await callRoute(decide, post(director, approve), { id: v2 })).status).toBe(200);
    const decided = await callRoute<{ status: string; approvedBy: string; approvalId: string }>(
      planAction,
      post(finance, { action: 'activate' }),
      { id: v2 },
    );
    expect(decided.data).toMatchObject({ status: 'active', approvedBy: director.id });
    const [v1] = await ctx.db
      .select()
      .from(opsFeePlans)
      .where(eq(opsFeePlans.id, planId as never));
    expect(decided.data!.approvalId).not.toBe(v1!.approvalId);
    const p = await current();
    expect(p.plan.id).toBe(res.data!.id);
    expect(p.instalments.map((i) => i.instalment.amountPaise)).toEqual([
      60_000_00, 30_000_00, 30_000_00,
    ]);
    expect(p.versions.map((v) => [v.version, v.adjustmentReason])).toEqual([
      [1, null],
      [2, 'Scholarship withdrawn (test)'],
    ]);
    // Receipts stay on version 1, untouched, and still count.
    expect(p.ledger.map((r) => r.code).sort()).toEqual(before);
    expect(p.totals).toMatchObject({ netPaidPaise: 109_000_00, outstandingPaise: 9_000_00 });
    const old = await ctx.db
      .select()
      .from(opsFeePlans)
      .where(eq(opsFeePlans.id, planId as never));
    expect(old[0]?.status).toBe('closed');
    planId = res.data!.id;
    expect((await callRoute(planAction, post(manager, body), { id: old[0]!.id })).status).toBe(409);
    const otherYear = { ...body, academicYear: '2027-28' };
    expect((await callRoute(planAction, post(manager, otherYear), { id: planId })).status).toBe(
      400,
    );
  });

  it('closing an accepted agreement needs approval rights; a new one continues it and needs a new approval', async () => {
    const aid = await verifiedCase();
    const sid = await studentOf(aid);
    const made = await callRoute<{ id: string }>(
      createPlan,
      post(finance, planBody({ admissionId: aid, studentId: sid })),
    );
    const id = made.data!.id;
    await approveAndActivate(id);
    expect((await entry(finance, pay(10_000_00), id)).status).toBe(201);
    const close = { action: 'close', reason: 'Family asked to restart (test)' };
    expect((await callRoute(planAction, post(finance, close), { id })).status).toBe(403);
    expect((await callRoute(planAction, post(manager, close), { id })).status).toBe(200);
    const again = await callRoute<{ id: string; version: number; supersedesPlanId: string }>(
      createPlan,
      post(finance, planBody({ admissionId: aid, studentId: sid, totalPaise: 80_000_00 })),
    );
    expect(again.data).toMatchObject({ version: 2, supersedesPlanId: id });
    const reuse = await callRoute(planAction, post(finance, { action: 'activate' }), {
      id: again.data!.id,
    });
    expect(reuse.status).toBe(409);
    expect(reuse.error?.message).toMatch(/not approved yet/);
    const [shown] = (await view(finance, sid)).data!.plans;
    expect(shown).toMatchObject({ plan: { id: again.data!.id } });
    expect(shown!.totals).toMatchObject({ netPaidPaise: 10_000_00, outstandingPaise: 70_000_00 });
  });
});

describe('bundle: a sibling admission cannot carry new terms through its old approval', () => {
  it('close → new agreement on the sibling → its old approval is refused; request → reject → re-request → approve', async () => {
    const first = await verifiedCase();
    const sid = await studentOf(first);
    const sibling = await verifiedCase(sid);
    // Tuition recorded on the old path before any agreement exists stays visible, labelled apart.
    expect(
      (await recordFee(ctx.db, finance, first, { kind: 'due', amountPaise: 1_000_00 })).kind,
    ).toBe('due');
    expect((await view(finance, sid)).data!.tuitionOutsideAgreement).toMatchObject({
      duePaise: 1_000_00,
    });
    const v1 = await callRoute<{ id: string }>(
      createPlan,
      post(finance, planBody({ admissionId: first, studentId: sid })),
    );
    const activate = (id: string) =>
      callRoute(planAction, post(finance, { action: 'activate' }), { id });
    await approveAndActivate(v1.data!.id);
    expect((await entry(finance, pay(10_000_00), v1.data!.id)).status).toBe(201);
    const close = { action: 'close', reason: 'Moving the agreement (test)' };
    expect((await callRoute(planAction, post(manager, close), { id: v1.data!.id })).status).toBe(
      200,
    );
    const v2 = await callRoute<{ id: string; version: number }>(
      createPlan,
      post(finance, planBody({ admissionId: sibling, studentId: sid, totalPaise: 50_000_00 })),
    );
    expect(v2.data).toMatchObject({ version: 2 });
    const id = v2.data!.id;
    const refused = await activate(id);
    expect(refused.status).toBe(409);
    expect(refused.error?.message).toMatch(/not approved yet/);
    // N1: after admission there is still a way to ask; the requester never decides it.
    await ctx.db
      .update(opsAdmissions)
      .set({ status: 'admitted' })
      .where(eq(opsAdmissions.id, sibling as never));
    expect((await callRoute(askApproval, post(finance, {}), { id })).status).toBe(403);
    expect((await callRoute(askApproval, post(counsellor, {}), { id })).status).toBe(201);
    expect((await callRoute(askApproval, post(counsellor, {}), { id })).status).toBe(409);
    const reject = { decision: 'rejected', comment: 'Wrong tuition (test)' };
    expect((await callRoute(decide, post(director, reject), { id })).status).toBe(200);
    expect((await activate(id)).status).toBe(409);
    await approveAndActivate(id);
    expect((await view(finance, sid)).data!.plans[0]!.totals).toMatchObject({
      netPaidPaise: 10_000_00,
      outstandingPaise: 40_000_00,
    });
  });
});

describe('an approval binds one exact agreement version (every reuse path found in review)', () => {
  type Caller = { token: string };
  const make = async (user: Caller, aid: string, extra: Record<string, unknown> = {}) =>
    callRoute<{ id: string; version: number }>(
      createPlan,
      post(user, planBody({ admissionId: aid, studentId: await studentOf(aid), ...extra })),
    );
  const activateAs = (user: Caller, id: string) =>
    callRoute(planAction, post(user, { action: 'activate' }), { id });
  const decideAs = (user: Caller, id: string) =>
    callRoute(decide, post(user, { decision: 'approved' }), { id });
  /** An active agreement made by `maker` on a verified admission (counsellor asks, director approves). */
  const activeBy = async (maker: Caller, aid?: string) => {
    const id = (await make(maker, aid ?? (await verifiedCase()))).data!.id;
    await approveAndActivate(id);
    return id;
  };
  /** Two verified admissions of one student (a bundle), each with an approved admission-level approval. */
  const bundle = async () => {
    const first = await verifiedCase();
    return { first, sibling: await verifiedCase(await studentOf(first)) };
  };
  const draftRequestedBy = async (maker: Caller, requester: Caller) => {
    const id = (await make(maker, await verifiedCase())).data!.id;
    expect((await callRoute(askApproval, post(requester, {}), { id })).status).toBe(201);
    return id;
  };

  type Reply = { status: number; error?: { message: string } };
  const PATHS: [string, number, RegExp, () => Promise<Reply>][] = [
    [
      'V1: first agreement at ₹3, made and activated by finance alone (admission approval exists)',
      409,
      /not approved yet/,
      async () =>
        activateAs(
          finance,
          (await make(finance, await verifiedCase(), { totalPaise: 300 })).data!.id,
        ),
    ],
    [
      'I1: close, continue the chain on a bundle sibling, activate with the sibling approval',
      409,
      /not approved yet/,
      async () => {
        const { first, sibling } = await bundle();
        const id = await activeBy(finance, first);
        const close = { action: 'close', reason: 'Moving the agreement (test)' };
        expect((await callRoute(planAction, post(manager, close), { id })).status).toBe(200);
        const v2 = await make(finance, sibling, { totalPaise: 300 });
        expect(v2.data?.version).toBe(2);
        return activateAs(finance, v2.data!.id);
      },
    ],
    [
      'O1: another-year agreement on a bundle sibling, activated with its old approval',
      409,
      /not approved yet/,
      async () => {
        const { first, sibling } = await bundle();
        await activeBy(finance, first);
        const other = await make(finance, sibling, { academicYear: '2027-28', totalPaise: 300 });
        return activateAs(finance, other.data!.id);
      },
    ],
    [
      'V2: an admission with no student record, student chosen by the client',
      400,
      /no student record/,
      async () => {
        const { admissionId: aid } = await pendingCase(counsellor);
        return make(finance, aid, { studentId: await newStudent('Free Choice Student') });
      },
    ],
    [
      'V2: another student named on an admission that has one',
      400,
      /not on this admission/,
      async () => make(finance, await verifiedCase(), { studentId: await newStudent('Other') }),
    ],
    [
      'adjustment: the person who made the new version approves it',
      403,
      /You made this agreement/,
      async () => {
        const id = await activeBy(finance);
        const adjust = {
          action: 'adjust',
          totalPaise: 300,
          dueDates,
          reason: 'Lower tuition (test, maker)',
        };
        const v2 = await callRoute<{ id: string }>(planAction, post(manager, adjust), { id });
        return decideAs(manager, v2.data!.id);
      },
    ],
    [
      'adjustment by entry: the agreement maker posts a waiver on their own agreement',
      403,
      /other than the agreement’s maker/,
      async () =>
        entry(
          manager,
          { kind: 'waiver', amountPaise: 1_000_00, notes: 'Own (test)' },
          await activeBy(manager),
        ),
    ],
    [
      'adjustment by entry: finance (no approval permission) posts a credit',
      403,
      /fee-approval permission/,
      async () =>
        entry(
          finance,
          {
            kind: 'adjustment',
            direction: 'credit',
            amountPaise: 1_000_00,
            notes: 'Credit (test)',
          },
          await activeBy(finance),
        ),
    ],
    [
      'decide by the requester',
      403,
      /your own approval request/,
      async () => decideAs(manager, await draftRequestedBy(finance, manager)),
    ],
    [
      'decide by the maker via the inbox (not listed to them; the decision route refuses)',
      403,
      /You made this agreement/,
      async () => {
        const id = await draftRequestedBy(manager, counsellor);
        const listed = async (user: TestUser) =>
          (await feeAgreementSource.list(ctx.db, user)).some((i) => i.decide?.includes(id));
        expect([await listed(manager), await listed(director)]).toEqual([false, true]);
        return decideAs(manager, id);
      },
    ],
  ];
  it.each(PATHS)('%s → %i', async (_, status, message, run) => {
    const res = await run();
    expect([res.status, res.error?.message]).toEqual([status, expect.stringMatching(message)]);
  });

  it('happy path: counsellor asks after both verifications, director approves in the inbox, finance activates, payments count', async () => {
    const aid = await newCase();
    const id = (await make(finance, aid)).data!.id;
    const ask = () => callRoute(askApproval, post(counsellor, {}), { id });
    // R2-1 (BR-OPS-7): no request before both fee verifications by different people.
    expect((await ask()).status).toBe(400);
    await verify(aid);
    expect((await ask()).status).toBe(201);
    const gaps = async () => (await readinessOf(ctx.db, await admissionRow(ctx.db, aid))).gaps;
    const [item] = (await feeAgreementSource.list(ctx.db, director)).filter((i) =>
      i.decide?.includes(id),
    );
    expect(item).toMatchObject({
      title: `Fee Student ${aid.slice(0, 6)}: fee agreement 2026-27, version 1`,
      requestedByUserId: counsellor.id,
      decide: `/ops/api/v1/fee-plans/${id}/decision`,
    });
    expect(item).toMatchObject({ beforePaise: null, afterPaise: 1_00_000_00 });
    expect((await decideAs(director, id)).status).toBe(200);
    // One approval step: the readiness gap closes once that approved agreement is active.
    expect(await gaps()).toContain('fee_arrangement_approval');
    expect((await activateAs(finance, id)).status).toBe(200);
    expect(await gaps()).not.toContain('fee_arrangement_approval');
    expect((await entry(finance, pay(50_000_00), id)).status).toBe(201);
    expect((await view(finance, await studentOf(aid))).data!.plans[0]!.totals).toMatchObject({
      netPaidPaise: 50_000_00,
      outstandingPaise: 50_000_00,
    });
  });
});

describe('a retried payment never posts twice (Idempotency-Key)', () => {
  it('same key → one ledger row and a replay; a new key → a deliberate second payment', async () => {
    const aid = await verifiedCase();
    const id = (
      await callRoute<{ id: string }>(
        createPlan,
        post(finance, planBody({ admissionId: aid, studentId: await studentOf(aid) })),
      )
    ).data!.id;
    await approveAndActivate(id);
    const send = (key: string) =>
      callRoute<{ id: string }>(
        addEntry,
        post(finance, pay(5_000_00), { 'idempotency-key': key }),
        {
          id,
        },
      );
    const [a, b, c] = [
      await send('test-only-pay-1'),
      await send('test-only-pay-1'),
      await send('test-only-pay-2'),
    ];
    expect([a, b, c].map((r) => [r.status, r.headers.get('idempotency-replayed')])).toEqual([
      [201, 'false'],
      [201, 'true'],
      [201, 'false'],
    ]);
    expect(b.data!.id).toBe(a.data!.id);
    const plan = (await view(finance, await studentOf(aid))).data!.plans.find(
      (p) => p.plan.id === id,
    )!;
    expect(plan.ledger.filter((r) => r.kind === 'received').map((r) => r.id)).toEqual(
      expect.arrayContaining([a.data!.id, c.data!.id]),
    );
    expect(plan.ledger.filter((r) => r.kind === 'received')).toHaveLength(2);
  });
});

describe('registration and demo fees are separate charges', () => {
  const reg = (extra: Record<string, unknown> = {}) => ({
    admissionId,
    chargeCategory: 'registration',
    kind: 'due',
    ...extra,
  });
  it('charging needs the configured amount; it is charged once and never touches tuition', async () => {
    // The approved default is ₹5,000 (D-044); a stored "not set" still blocks.
    await updateSetting(ctx.db, manager, {
      key: 'fees.registration',
      value: { amountPaise: null },
    });
    const blocked = await callRoute(charge, post(finance, reg()));
    expect(blocked.status).toBe(400);
    expect(blocked.error?.message).toBe('Registration fee not configured.');
    await updateSetting(ctx.db, manager, {
      key: 'fees.registration',
      value: { amountPaise: 5_000_00 },
    });
    expect((await callRoute(charge, post(finance, reg()))).status).toBe(201);
    expect((await callRoute(charge, post(finance, reg()))).status).toBe(400);
    // Once per student: a second programme admission of the same student is not charged again.
    const second = await verifiedCase();
    await ctx.db
      .update(opsAdmissions)
      .set({ studentId: studentId as never })
      .where(inArray(opsAdmissions.id, [admissionId, second] as never[]));
    const twice = await callRoute(charge, post(finance, reg({ admissionId: second })));
    expect(twice.status).toBe(400);
    expect(twice.error?.message).toMatch(/already charged for this student/);
    const paid = await callRoute(
      charge,
      post(finance, {
        admissionId,
        chargeCategory: 'registration',
        kind: 'received',
        amountPaise: 5_000_00,
        paymentDate: isoDaysFromNow(0),
        receiptReference: 'TEST-REG-1',
      }),
    );
    expect(paid.status).toBe(201);
    expect(
      (
        await callRoute(
          charge,
          post(finance, { ...reg(), chargeCategory: 'demo', kind: 'received' }),
        )
      ).status,
    ).toBe(400);
    const v = (await view(finance)).data!;
    expect(v.registration).toMatchObject({
      configuredPaise: 5_000_00,
      summary: { balancePaise: 0 },
    });
    expect(v.plans[0]!.totals.netPaidPaise).toBe(109_000_00);
  });
});

describe('fee records are inaccessible to unauthorised roles (acceptance 21)', () => {
  it('401 / 403 / own scope on every fee read; finance list hidden from other counsellors', async () => {
    expect((await callRoute(listPlans, buildRequest(`/x?studentId=${studentId}`))).status).toBe(
      401,
    );
    for (const user of [coordinator, teacher]) {
      expect((await view(user)).status).toBe(403);
      expect((await callRoute(allFees, get(user))).status).toBe(403);
    }
    expect(
      (await callRoute(listPlans, get(finance, '/ops/api/v1/fee-plans?studentId=nope'))).status,
    ).toBe(400);
    expect((await view(counsellor)).data?.plans).toHaveLength(1);
    expect((await view(auditor)).data?.plans).toHaveLength(1);
    expect((await view(colleague)).data?.plans).toEqual([]);
    expect((await callRoute<{ items: unknown[] }>(allFees, get(colleague))).data?.items).toEqual(
      [],
    );
    expect((await view(finance)).data?.disclaimer).toBe(MANUAL_FEE_DISCLAIMER);
  });

  it('admission-level inbox rows hide the request comment (it may name amounts) without ops:fees:read', async () => {
    const id = await newCase();
    await verify(id);
    const comment = 'Discount of ₹10,000 agreed by phone';
    expect(
      (await callRoute(feeApproval, post(counsellor, { action: 'request', comment }), { id }))
        .status,
    ).toBe(200);
    const row = async () =>
      (await feeArrangementSource.list(ctx.db, director)).find((i) => i.link.endsWith(id));
    expect(await row()).toMatchObject({ detail: comment });
    noFeeRead.on = true;
    const hidden = await row();
    noFeeRead.on = false;
    expect(hidden).toMatchObject({ detail: null });
  });

  it('feeStatusForStudents: no agreement is not_configured (never paid)', async () => {
    const none = await newStudent('No Plan Student');
    const statuses = await feeStatusForStudents(ctx.db, [studentId, none]);
    expect(statuses.get(studentId)).toBe('due');
    expect(statuses.get(none)).toBe('not_configured');
  });
});
