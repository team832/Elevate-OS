import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditEvents } from '@elevate/database';
import {
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import {
  GET as listFees,
  POST as recordFee,
} from '../../src/app/api/v1/admissions/[id]/fees/route';
import { POST as feeAction } from '../../src/app/api/v1/fees/[id]/route';
import { GET as allFees } from '../../src/app/api/v1/fees/route';
import { MANUAL_FEE_DISCLAIMER, type FeeSummary } from '../../src/domain/fees';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { admittedCase, get, post } from './admissions-fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
let colleague: StaffUser;
let finance: StaffUser;
let director: TestUser;
let auditor: TestUser;
let coordinator: TestUser;
let admissionId: string;

type FeeList = {
  records: { id: string; status: string }[];
  summary: FeeSummary;
  disclaimer: string;
};
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  colleague = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  finance = await staffUser(ctx.db, ['finance_officer']);
  director = await createTestUser(ctx.db, { roles: ['director'] });
  auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
  coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
  ({ admissionId } = await admittedCase({ counsellor, manager, director }));
});

const record = (user: { token: string }, body: unknown) =>
  callRoute<{ id: string; code: string; status: string; manuallyRecorded: boolean }>(
    recordFee,
    post(user, body),
    { id: admissionId },
  );

describe('fee records: permissions (ops:fees:read / ops:fees:record)', () => {
  it('401 without a session; record needs ops:fees:record; reads follow own scope', async () => {
    expect(
      (
        await callRoute(
          recordFee,
          buildRequest('/x', { method: 'POST', json: { kind: 'due', amountPaise: 100 } }),
          { id: admissionId },
        )
      ).status,
    ).toBe(401);
    expect((await record(counsellor, { kind: 'due', amountPaise: 100 })).status).toBe(403);
    expect((await record(auditor, { kind: 'due', amountPaise: 100 })).status).toBe(403);
    expect((await record(director, { kind: 'due', amountPaise: 100 })).status).toBe(403);
    expect((await callRoute(listFees, get(counsellor), { id: admissionId })).status).toBe(200);
    expect((await callRoute(listFees, get(colleague), { id: admissionId })).status).toBe(403);
    expect((await callRoute(listFees, get(auditor), { id: admissionId })).status).toBe(200);
    expect((await callRoute(listFees, get(coordinator), { id: admissionId })).status).toBe(403);
  });
});

describe('fee records: validation (integer paise, INR)', () => {
  it.each([
    [{ kind: 'due', amountPaise: -100 }, 'amountPaise'],
    [{ kind: 'due', amountPaise: 0 }, 'amountPaise'],
    [{ kind: 'due', amountPaise: 100.5 }, 'amountPaise'],
    [{ kind: 'due', amountPaise: 2_000_000_000 }, 'amountPaise'],
    [{ kind: 'due', amountRupees: '12.345' }, 'amountRupees'],
    [{ kind: 'due', amountPaise: 100, amountRupees: '1' }, 'amountRupees'],
    [{ kind: 'received', amountPaise: 100, paymentDate: today() }, 'receiptReference'],
    [{ kind: 'received', amountPaise: 100, receiptReference: 'R-1' }, 'paymentDate'],
    [
      { kind: 'received', amountPaise: 100, receiptReference: 'R-1', paymentDate: '2999-01-01' },
      'paymentDate',
    ],
    [{ kind: 'adjustment', amountPaise: 100 }, 'direction'],
    [{ kind: 'due', amountPaise: 100, direction: 'credit' }, 'direction'],
    [
      { kind: 'adjustment', direction: 'credit', amountPaise: 100, demoId: crypto.randomUUID() },
      'demoId',
    ],
  ])('rejects %j (400 on %s)', async (body, path) => {
    const res = await record(manager, body);
    expect(res.status).toBe(400);
    expect(res.error?.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: [path] })]),
    );
  });

  it('a refund cannot exceed what was recorded as received (less earlier refunds)', async () => {
    expect(
      (
        await record(manager, {
          kind: 'refund',
          amountPaise: 1,
          paymentDate: today(),
          receiptReference: 'RF-0',
        })
      ).status,
    ).toBe(400);
  });
});

describe('fee records: summary, second-person check, void', () => {
  it('records due/received/refund/credit, computes the balance, audits, and labels the data as manual', async () => {
    const due = await record(manager, {
      kind: 'due',
      amountRupees: '50,000',
      pricingReference: 'Quote sent 12 Oct (no approved schedule)',
    });
    expect(due.status).toBe(201);
    expect(due.data).toMatchObject({ status: 'recorded', manuallyRecorded: true });
    expect(due.data?.code).toMatch(/^FEE-\d{6}$/);
    const paid = await record(finance, {
      kind: 'received',
      amountPaise: 2_000_000,
      paymentDate: today(),
      receiptReference: 'RCPT-TEST-77',
      method: 'upi',
    });
    expect(paid.status).toBe(201);
    expect(
      (
        await record(manager, {
          kind: 'refund',
          amountPaise: 2_000_001,
          paymentDate: today(),
          receiptReference: 'RF-1',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await record(manager, {
          kind: 'refund',
          amountPaise: 50_000,
          paymentDate: today(),
          receiptReference: 'RF-1',
        })
      ).status,
    ).toBe(201);
    expect(
      (await record(manager, { kind: 'adjustment', direction: 'credit', amountPaise: 100_000 }))
        .status,
    ).toBe(201);
    const list = await callRoute<FeeList>(listFees, get(counsellor), { id: admissionId });
    expect(list.data?.disclaimer).toBe(MANUAL_FEE_DISCLAIMER);
    expect(list.data?.summary).toMatchObject({
      duePaise: 5_000_000,
      receivedPaise: 2_000_000,
      refundedPaise: 50_000,
      netReceivedPaise: 1_950_000,
      creditAdjustmentsPaise: 100_000,
      balancePaise: 2_950_000,
      balanceState: 'outstanding',
      verifiedNetReceivedPaise: 0,
    });
    const audits = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.action, 'fee_record.created'), eq(auditEvents.entityId, paid.data!.id)),
      );
    expect(audits).toHaveLength(1);

    // Second-person check: the recorder cannot check their own entry (no self-approval).
    const self = await callRoute(feeAction, post(finance, { action: 'verify' }), {
      id: paid.data!.id,
    });
    expect(self.status).toBe(403);
    expect(
      (await callRoute(feeAction, post(counsellor, { action: 'verify' }), { id: paid.data!.id }))
        .status,
    ).toBe(403);
    const ok = await callRoute<{ status: string }>(
      feeAction,
      post(manager, { action: 'verify', note: 'Matches bank statement (test)' }),
      { id: paid.data!.id },
    );
    expect(ok.data?.status).toBe('verified');
    expect(
      (await callRoute(feeAction, post(manager, { action: 'verify' }), { id: paid.data!.id }))
        .status,
    ).toBe(409);

    // Void: reason required; the voided record stays but no longer counts.
    expect(
      (await callRoute(feeAction, post(manager, { action: 'void' }), { id: due.data!.id })).status,
    ).toBe(400);
    expect(
      (
        await callRoute(
          feeAction,
          post(manager, { action: 'void', reason: 'Wrong amount (test)' }),
          {
            id: due.data!.id,
          },
        )
      ).status,
    ).toBe(200);
    const after = await callRoute<FeeList>(listFees, get(manager), { id: admissionId });
    expect(after.data?.records.find((r) => r.id === due.data!.id)?.status).toBe('voided');
    expect(after.data?.summary).toMatchObject({
      balancePaise: null,
      balanceState: 'no_due_recorded',
      verifiedNetReceivedPaise: 2_000_000,
      voidedCount: 1,
    });
  });

  it('the finance list is paginated by code and respects own scope', async () => {
    const page = await callRoute<{ items: { code: string }[] }>(
      allFees,
      get(finance, '/ops/api/v1/fees?limit=2'),
    );
    if (!page.ok) throw new Error(`fee list failed: ${page.status}`);
    expect(page.data.items).toHaveLength(2);
    const cursor = page.meta?.page?.nextCursor;
    expect(cursor).toMatch(/^FEE-/);
    const next = await callRoute<{ items: { code: string }[] }>(
      allFees,
      get(finance, `/ops/api/v1/fees?limit=2&cursor=${cursor}`),
    );
    expect((next.data?.items[0]?.code ?? '') < page.data.items[1]!.code).toBe(true);
    const colleagueView = await callRoute<{ items: unknown[] }>(allFees, get(colleague));
    expect(colleagueView.data?.items).toHaveLength(0);
  });
});
