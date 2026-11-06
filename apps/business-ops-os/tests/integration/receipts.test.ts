/**
 * Fee receipts (F4-01): issued with the payment in the same transaction, gap-free per financial
 * year and retry-safe; "Issue receipt" for an older payment; the year from the payment date (or,
 * by setting, the IST issue day: 31 Mar / 1 Apr); Duplicate from the second print; Cancelled once
 * reversed; the balance as it stood after the payment; readers = fee record readers. Fictional people.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  auditEvents,
  opsAdmissions,
  opsDocumentCounters,
  opsFeeReceipts,
  opsFeePlans,
  opsFeeRecords,
  opsLeads,
  opsSettings,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { POST as recordFee } from '../../src/app/api/v1/admissions/[id]/fees/route';
import { POST as addEntry } from '../../src/app/api/v1/fee-plans/[id]/entries/route';
import { POST as feeAction } from '../../src/app/api/v1/fees/[id]/route';
import { GET as receiptPdf, POST as issue } from '../../src/app/api/v1/fees/[id]/receipt/route';
import { financialYearOf } from '../../src/domain/documents';
import { issueReceiptInTx, type ReceiptDocument } from '../../src/server/receipts';
import { pendingCase, post } from './admissions-fixtures';
import { activePlan } from './application-fixtures';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { caseOf, identity } from './lifecycle-fixtures';

const printed = vi.hoisted(() => [] as ReceiptDocument[]);
vi.mock('../../src/server/pdf/receipt', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/server/pdf/receipt')>();
  return {
    ...real,
    receiptPdf: async (doc: ReceiptDocument, size?: 'a4' | 'a5') => {
      printed.push(doc);
      return real.receiptPdf(doc, size);
    },
  };
});

const ctx = setupTestDatabase();
let finance: StaffUser;
let counsellor: StaffUser;
let colleague: StaffUser;
let auditor: TestUser;
let coordinator: TestUser;
let admissionId: string;

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const YEAR = financialYearOf(today());
const pay = (amountPaise: number, extra: object = {}) => ({
  kind: 'received',
  amountPaise,
  paymentDate: today(),
  method: 'upi',
  receiptReference: `SAMPLE-UTR-${amountPaise}`,
  ...extra,
});
const record = (body: unknown, headers?: Record<string, string>, who = finance) =>
  callRoute<{ id: string }>(recordFee, post(who, body, headers), { id: admissionId });
const receiptOf = async (feeRecordId: string) =>
  (
    await ctx.db
      .select()
      .from(opsFeeReceipts)
      .where(eq(opsFeeReceipts.feeRecordId, feeRecordId as never))
  )[0];
const download = (user: { token: string } | null, id: string, size = '') =>
  receiptPdf(
    user
      ? authedRequest(user, `/ops/api/v1/fees/${id}/receipt${size}`)
      : buildRequest(`/ops/api/v1/fees/${id}/receipt`),
    { params: Promise.resolve({ id }) },
  );
let older = 0;
/** A payment recorded before receipts existed: a ledger row with no receipt. */
async function olderPayment(paymentDate: string, amountPaise = 50_000) {
  const [a] = await ctx.db
    .select()
    .from(opsAdmissions)
    .where(eq(opsAdmissions.id, admissionId as never));
  const [row] = await ctx.db
    .insert(opsFeeRecords)
    .values({
      code: `FEE-9${String((older += 1)).padStart(5, '0')}`,
      admissionId: admissionId as never,
      leadId: a!.leadId,
      kind: 'received',
      chargeCategory: 'tuition',
      amountPaise,
      currency: 'INR',
      paymentDate,
      receiptReference: `SAMPLE-OLD-${paymentDate}`,
      recordedBy: finance.id,
    })
    .returning();
  return row!;
}

beforeAll(async () => {
  await setupReference(ctx.db);
  const manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  colleague = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  finance = await staffUser(ctx.db, ['finance_officer'], { name: 'Sample Finance Officer' });
  auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
  coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
  ({ admissionId } = await pendingCase(counsellor));
  expect((await record({ kind: 'due', amountPaise: 10_000_000 })).status).toBe(201);
});

describe('issued with the payment: gap-free, retry-safe', () => {
  let first: string;
  it('numbers each payment in order; a refused payment takes no number', async () => {
    const a = await record(pay(4_000_000));
    expect(a.status).toBe(201);
    first = a.data!.id;
    expect((await record(pay(100, { paymentDate: '2999-01-01' }))).status).toBe(400);
    const b = await record(pay(1_000_000));
    expect((await receiptOf(first))!.receiptNumber).toBe(`ER/${YEAR}/000001`);
    expect((await receiptOf(b.data!.id))!.receiptNumber).toBe(`ER/${YEAR}/000002`);
    const audits = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'fee_receipt.issued'));
    expect(audits).toHaveLength(2);
  });

  it('a retried payment (same Idempotency-Key) and a second "Issue receipt" give the same receipt', async () => {
    const key = { 'idempotency-key': 'test-only-receipt-retry-1' };
    const once = await record(pay(77_700), key);
    const again = await record(pay(77_700), key);
    expect(again.data!.id).toBe(once.data!.id);
    const r = await receiptOf(once.data!.id);
    expect(r!.receiptNumber).toBe(`ER/${YEAR}/000003`);
    const issued = await callRoute<{ receiptNumber: string }>(issue, post(finance, {}), {
      id: once.data!.id,
    });
    expect(issued).toMatchObject({ status: 200, data: { receiptNumber: r!.receiptNumber } });
    expect(await ctx.db.select().from(opsFeeReceipts)).toHaveLength(3);
  });

  it('a transaction that fails after taking a number gives it back', async () => {
    const row = await olderPayment('2026-10-01');
    await expect(
      withTransaction(ctx.db, async (tx) => {
        await issueReceiptInTx(tx, finance, row);
        throw new Error('test-only failure after the number');
      }),
    ).rejects.toThrow('test-only');
    const [counter] = await ctx.db
      .select()
      .from(opsDocumentCounters)
      .where(eq(opsDocumentCounters.series, `receipt/${YEAR}`));
    expect(counter!.nextValue).toBe(4);
    const issued = await callRoute<{ receiptNumber: string }>(issue, post(finance, {}), {
      id: row.id,
    });
    expect(issued).toMatchObject({ status: 201, data: { receiptNumber: `ER/${YEAR}/000004` } });
  });

  it('the balance printed is the one after that payment, also on a later reprint', async () => {
    printed.length = 0;
    expect((await download(finance, first)).status).toBe(200);
    expect(printed[0]).toMatchObject({
      balancePaise: 6_000_000,
      duplicate: false,
      cancelled: false,
      amountPaise: 4_000_000,
      admissionNumber: null,
      recordedBy: 'Sample Finance Officer',
    });
  });
});

describe('older payments and the financial year', () => {
  it.each([
    ['2026-03-31', 'ER/2025-26/000001'],
    ['2026-04-01', `ER/2026-27/000005`],
  ])('"Issue receipt" for a payment of %s: %s (year of the payment date)', async (date, number) => {
    const row = await olderPayment(date);
    const r = await callRoute<{ receiptNumber: string }>(issue, post(finance, {}), { id: row.id });
    expect(r).toMatchObject({ status: 201, data: { receiptNumber: number } });
  });

  it.each([
    ['2027-03-31T18:29:59Z', '2026-27'],
    ['2027-03-31T18:30:00Z', '2027-28'],
  ])('setting "issue date": issued at %s (IST) falls in %s', async (at, year) => {
    await ctx.db
      .insert(opsSettings)
      .values({
        key: 'fees.receipts',
        value: { numberPrefix: 'ER', yearFrom: 'issue_date' },
        decisionState: 'proposed',
        source: 'test-only',
      })
      .onConflictDoNothing();
    const row = await olderPayment('2026-05-05');
    const r = await withTransaction(ctx.db, (tx) =>
      issueReceiptInTx(tx, finance, row, new Date(at)),
    );
    expect(r.receipt.financialYear).toBe(year);
    expect(r.receipt.receiptNumber).toMatch(new RegExp(`^ER/${year}/\\d{6}$`));
  });
});

describe('Duplicate, Cancelled and no receipt for other entries', () => {
  it('the second print says Duplicate; a reversed payment says Cancelled; reversals and refunds get none', async () => {
    const paid = await record(pay(250_000));
    const id = paid.data!.id;
    printed.length = 0;
    await download(finance, id);
    await download(finance, id, '?size=a5');
    expect(printed.map((d) => d.duplicate)).toEqual([false, true]);
    const reversal = await callRoute<{ id: string }>(
      feeAction,
      post(finance, { action: 'reverse', reason: 'Entered twice by mistake' }),
      { id },
    );
    expect(reversal.status).toBe(201);
    await download(finance, id);
    expect(printed[2]).toMatchObject({ cancelled: true, duplicate: true });
    expect(await receiptOf(reversal.data!.id)).toBeUndefined();
    const refundable = await record(pay(300_000));
    const refund = await callRoute<{ id: string }>(
      feeAction,
      post(finance, {
        action: 'refund',
        amountPaise: 100_000,
        paymentDate: today(),
        receiptReference: 'SAMPLE-REFUND-1',
      }),
      { id: refundable.data!.id },
    );
    expect(refund.status).toBe(201);
    expect(await receiptOf(refund.data!.id)).toBeUndefined();
    const refused = await callRoute(issue, post(finance, {}), { id: reversal.data!.id });
    expect(refused.status).toBe(409);
  });
});

describe('who may read and issue', () => {
  let id: string;
  beforeAll(async () => {
    id = (await record(pay(11_100))).data!.id;
  });
  it.each([
    ['nobody signed in', () => null, 401],
    ['the counsellor of the case', () => counsellor, 200],
    ['another counsellor', () => colleague, 403],
    ['the academic coordinator', () => coordinator, 403],
    ['the auditor', () => auditor, 200],
    ['finance', () => finance, 200],
  ])('download by %s: %i', async (_n, who, status) => {
    const res = await download(who(), id);
    expect(res.status).toBe(status);
    if (status === 200) {
      expect(res.headers.get('content-type')).toBe('application/pdf');
      expect(res.headers.get('content-disposition')).toContain(`receipt-ER_${YEAR}_`);
    }
  });
  it.each([
    ['the counsellor', () => counsellor, 403],
    ['the auditor', () => auditor, 403],
    ['finance', () => finance, 200],
  ])('"Issue receipt" by %s: %i', async (_n, who, status) => {
    expect((await callRoute(issue, post(who(), {}), { id })).status).toBe(status);
  });
  it('a download is counted', async () => {
    const [r] = await ctx.db
      .select()
      .from(opsFeeReceipts)
      .where(eq(opsFeeReceipts.feeRecordId, id as never));
    expect(r!.printCount).toBe(3);
  });
});

describe('as it stood at the payment; sample series apart', () => {
  it('a later accepted change of the agreement leaves a reprint’s balance as it was', async () => {
    const director = await createTestUser(ctx.db, { roles: ['director'] });
    const sid = await identity(ctx.db, 'Sample Scholarship Student');
    const admission = await caseOf(ctx.db, finance.id, sid, 'enrolled');
    const v1 = await activePlan(ctx.db, director, admission.id, sid, finance.id);
    const paid = await callRoute<{ id: string }>(
      addEntry,
      post(finance, {
        kind: 'received',
        amountPaise: 4_000_000,
        paymentDate: today(),
        receiptReference: 'SAMPLE-SCHOLARSHIP-1',
        method: 'upi',
      }),
      { id: v1.id },
    );
    expect(paid.status).toBe(201);
    printed.length = 0;
    await download(finance, paid.data!.id);
    await ctx.db
      .update(opsFeePlans)
      .set({
        status: 'closed',
        closedAt: new Date(),
        closedBy: finance.id,
        closeReason: 'Changed (test)',
      })
      .where(eq(opsFeePlans.id, v1.id));
    await activePlan(ctx.db, director, admission.id, sid, finance.id, {
      totalPaise: 9_000_000,
      version: 2,
      supersedesPlanId: v1.id,
      adjustmentReason: 'Scholarship of ten thousand rupees (test)',
    });
    await download(finance, paid.data!.id);
    expect(printed.map((d) => [d.duplicate, d.balancePaise])).toEqual([
      [false, 6_000_000],
      [true, 6_000_000],
    ]);
  });

  it('a sample payment numbers in its own series; the next real payment takes the next real number', async () => {
    const real = (await ctx.db.select().from(opsFeeReceipts))
      .filter((r) => r.financialYear === YEAR && !r.receiptNumber.startsWith('SAMPLE-'))
      .map((r) => r.sequence);
    const sample = await pendingCase(counsellor, { name: 'Sample Series Student' });
    await ctx.db
      .update(opsLeads)
      .set({ isSample: true })
      .where(eq(opsLeads.id, sample.leadId as never));
    const s = await callRoute<{ id: string }>(recordFee, post(finance, pay(5_500)), {
      id: sample.admissionId,
    });
    expect((await receiptOf(s.data!.id))!.receiptNumber).toBe(`SAMPLE-ER/${YEAR}/000001`);
    const r = await record(pay(6_600));
    expect((await receiptOf(r.data!.id))!.receiptNumber).toBe(
      `ER/${YEAR}/${String(Math.max(...real) + 1).padStart(6, '0')}`,
    );
  });
});
