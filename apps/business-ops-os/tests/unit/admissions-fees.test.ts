import { describe, expect, it } from 'vitest';
import {
  canVerifyFee,
  canVoidFee,
  checkAmountPaise,
  downPaymentHint,
  formatPaise,
  parseRupeesToPaise,
  summariseFees,
  validateFeeRecord,
  type FeeRecordLike,
} from '../../src/domain/fees';
import { fmtPaise } from '../../src/ui/format';

const r = (
  kind: FeeRecordLike['kind'],
  amountPaise: number,
  extra: Partial<FeeRecordLike> = {},
): FeeRecordLike => ({ kind, amountPaise, direction: null, status: 'recorded', ...extra });
const TODAY = '2026-10-19';

describe('amounts in integer paise', () => {
  it('accepts positive integers up to one crore rupees', () => {
    expect(checkAmountPaise(1)).toEqual({ ok: true, value: 1 });
    expect(checkAmountPaise(1_000_000_000)).toEqual({ ok: true, value: 1_000_000_000 });
  });
  it.each([[0], [-1], [10.5], [1_000_000_001], [Number.NaN], [null], ['100']])('rejects %s', (v) =>
    expect(checkAmountPaise(v)).toHaveProperty('path', 'amountPaise'),
  );
  it('parses rupee text without floating point', () => {
    expect(parseRupeesToPaise('1000')).toBe(100_000);
    expect(parseRupeesToPaise('1,000.5')).toBe(100_050);
    expect(parseRupeesToPaise('₹ 0.07')).toBe(7);
    expect(parseRupeesToPaise('0.1')).toBe(10);
    expect(parseRupeesToPaise('12.345')).toBeNull();
    expect(parseRupeesToPaise('-5')).toBeNull();
    expect(parseRupeesToPaise('abc')).toBeNull();
    expect(parseRupeesToPaise('')).toBeNull();
  });
  it('formats with Indian grouping; missing is a dash, never ₹0', () => {
    expect(formatPaise(10_000_000)).toBe('₹1,00,000.00');
    expect(formatPaise(5)).toBe('₹0.05');
    expect(formatPaise(-150)).toBe('−₹1.50');
    expect(formatPaise(null)).toBe('—');
  });
  it.each([
    [10_000_000, '₹1,00,000'],
    [150_050, '₹1,500.50'],
    [5, '₹0.05'],
    [-100, '−₹1'],
    [0, '₹0'],
    [null, '—'],
  ])('screens drop ".00" only when paise are 0: %s → %s', (paise, shown) => {
    expect(fmtPaise(paise)).toBe(shown);
  });
});

describe('validateFeeRecord', () => {
  const received = {
    kind: 'received' as const,
    amountPaise: 500,
    paymentDate: TODAY,
    receiptReference: 'R1',
  };
  it('valid records produce no issues', () => {
    expect(validateFeeRecord({ kind: 'due', amountPaise: 100, dueDate: TODAY }, [], TODAY)).toEqual(
      [],
    );
    expect(validateFeeRecord(received, [], TODAY)).toEqual([]);
  });
  it('received/refund need a past-or-today payment date and (configurably) a receipt reference', () => {
    expect(
      validateFeeRecord({ ...received, paymentDate: null }, [], TODAY).map((i) => i.path),
    ).toEqual(['paymentDate']);
    expect(
      validateFeeRecord({ ...received, paymentDate: '2026-10-20' }, [], TODAY).map((i) => i.path),
    ).toEqual(['paymentDate']);
    expect(
      validateFeeRecord({ ...received, receiptReference: ' ' }, [], TODAY).map((i) => i.path),
    ).toEqual(['receiptReference']);
    expect(
      validateFeeRecord({ ...received, receiptReference: null }, [], TODAY, {
        requireReceiptReference: false,
      }),
    ).toEqual([]);
  });
  it('direction iff adjustment; due has no payment date', () => {
    expect(validateFeeRecord({ kind: 'adjustment', amountPaise: 1 }, [], TODAY)[0]?.path).toBe(
      'direction',
    );
    expect(
      validateFeeRecord({ kind: 'due', amountPaise: 1, direction: 'credit' }, [], TODAY)[0]?.path,
    ).toBe('direction');
    expect(
      validateFeeRecord({ kind: 'due', amountPaise: 1, paymentDate: TODAY }, [], TODAY)[0]?.path,
    ).toBe('paymentDate');
  });
  it('a refund names its payment and cannot exceed it less earlier refunds; voided rows do not count', () => {
    const existing = [
      r('received', 1000, { id: 'p1' }),
      r('refund', 300, { reversesRecordId: 'p1' }),
      r('refund', 999, { reversesRecordId: 'p1', status: 'voided' }),
      r('received', 5000, { id: 'p2', status: 'voided' }),
    ];
    const refund = { kind: 'refund' as const, paymentDate: TODAY, receiptReference: 'RF' };
    const of = (id: string, amountPaise: number) =>
      validateFeeRecord({ ...refund, amountPaise, reversesRecordId: id }, existing, TODAY);
    expect(of('p1', 700)).toEqual([]);
    expect(of('p1', 701)[0]?.message).toMatch(/₹7\.00 available/);
    expect(of('p2', 1)[0]?.path).toBe('reversesRecordId');
    expect(validateFeeRecord({ ...refund, amountPaise: 1 }, [], TODAY)[0]?.path).toBe(
      'reversesRecordId',
    );
  });
  it('reports several problems at once', () => {
    expect(
      validateFeeRecord({ kind: 'received', amountPaise: -1 }, [], TODAY)
        .map((i) => i.path)
        .sort(),
    ).toEqual(['amountPaise', 'paymentDate', 'receiptReference']);
  });
});

describe('summariseFees', () => {
  it('no records / no due recorded → balance missing, not zero', () => {
    expect(summariseFees([])).toMatchObject({ balancePaise: null, balanceState: 'no_records' });
    expect(summariseFees([r('received', 100)])).toMatchObject({
      balancePaise: null,
      balanceState: 'no_due_recorded',
      netReceivedPaise: 100,
    });
  });
  it('due + debit − credit − (received − refunded); verified figures separate', () => {
    const s = summariseFees([
      r('due', 10_000),
      r('adjustment', 500, { direction: 'debit' }),
      r('adjustment', 1_000, { direction: 'credit' }),
      r('received', 4_000, { status: 'verified' }),
      r('received', 2_000),
      r('refund', 500),
      r('due', 99_999, { status: 'voided' }),
    ]);
    expect(s).toMatchObject({
      duePaise: 10_500,
      creditAdjustmentsPaise: 1_000,
      netReceivedPaise: 5_500,
      verifiedNetReceivedPaise: 4_000,
      balancePaise: 4_000,
      balanceState: 'outstanding',
      unverifiedCount: 5,
      voidedCount: 1,
    });
  });
  it('settled at exactly zero; credit balance when more was recorded than due', () => {
    expect(summariseFees([r('due', 100), r('received', 100)]).balanceState).toBe('settled');
    expect(summariseFees([r('due', 100), r('received', 150)])).toMatchObject({
      balancePaise: -50,
      balanceState: 'credit_balance',
    });
  });
  it('down-payment hint is informational text only', () => {
    expect(downPaymentHint(summariseFees([]))).toMatch(/No amount received/);
    expect(downPaymentHint(summariseFees([r('received', 100)]))).toMatch(/not yet checked/);
    expect(downPaymentHint(summariseFees([r('received', 100, { status: 'verified' })]))).toMatch(
      /checked by a second person/,
    );
  });
});

describe('second-person check and void', () => {
  it('the recorder cannot check their own entry; only recorded entries can be checked', () => {
    expect(canVerifyFee({ status: 'recorded', recordedBy: 'u1' }, 'u1')).toMatchObject({
      ok: false,
      code: 'SELF',
    });
    expect(canVerifyFee({ status: 'recorded', recordedBy: 'u1' }, 'u2')).toEqual({ ok: true });
    expect(canVerifyFee({ status: 'verified', recordedBy: 'u1' }, 'u2')).toMatchObject({
      code: 'STATE',
    });
    expect(canVerifyFee({ status: 'voided', recordedBy: 'u1' }, 'u2')).toMatchObject({
      code: 'STATE',
    });
  });
  it('void needs a reason and cannot repeat', () => {
    expect(canVoidFee({ status: 'recorded' }, ' ')).toMatchObject({ code: 'REASON' });
    expect(canVoidFee({ status: 'verified' }, 'typo')).toEqual({ ok: true });
    expect(canVoidFee({ status: 'voided' }, 'again')).toMatchObject({ code: 'STATE' });
  });
});
