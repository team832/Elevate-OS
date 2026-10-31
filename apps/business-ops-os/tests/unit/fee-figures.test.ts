/**
 * The pure money rules behind the surfaces (HMO-001 to HMO-013): the statement, the version chain,
 * debits, and the Proposed refusals. Hand-computed values from the hunters' reports.
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_FORM_FIELDS, feeSummary, feeTracker } from '../../src/domain/admission-form';
import { feeCollections } from '../../src/domain/admissions-kpis';
import type { ApplicationSnapshot } from '../../src/domain/applications';
import type { IsoDate } from '../../src/domain/dates';
import { feeStatement, feeStatementLines } from '../../src/domain/fee-statement';
import {
  agreementPosition,
  allocateInstalments,
  owedAboveInstalments,
  planTotals,
  reconcilePlan,
  splitTuition,
  versionRows,
  type PlanLedgerRow,
} from '../../src/domain/fee-plans';
import { acceptedVersions, feeYearRow } from '../../src/domain/fee-year';
import {
  duplicatePaymentIssue,
  reductionAboveOwedIssue,
  validateFeeRecord,
  type FeeRecordLike,
} from '../../src/domain/fees';

const TODAY = '2026-10-20' as IsoDate;
const TUITION = 100_000_00;
const row = (
  kind: FeeRecordLike['kind'],
  amountPaise: number,
  extra: Partial<PlanLedgerRow> = {},
) =>
  ({
    kind,
    amountPaise,
    direction: null,
    status: 'recorded',
    chargeCategory: 'tuition',
    ...extra,
  }) as PlanLedgerRow & { planId?: string; paymentDate?: string; method?: string };
const debit = (amountPaise: number) => row('adjustment', amountPaise, { direction: 'debit' });
const plan = (id: string, totalPaise: number, supersedesPlanId: string | null = null) => ({
  id,
  totalPaise,
  supersedesPlanId,
  status: 'active',
  approvedAt: new Date(),
});
const schedule = (id = 'p', total = TUITION) =>
  splitTuition(total, [50, 25, 25]).map((amountPaise, i) => ({
    id: `${id}-i${i + 1}`,
    planId: id,
    sequence: i + 1,
    dueDate: `2026-1${i}-01`,
    amountPaise,
  }));
const onPlan = (kind: FeeRecordLike['kind'], amountPaise: number, extra = {}) =>
  row(kind, amountPaise, { planId: 'p', ...extra } as never);

describe('feeStatement: agreement, registration and demo, never a blended sum (HMO-001, HMO-004)', () => {
  it.each<[string, Parameters<typeof feeStatement>[1], Record<string, unknown>]>([
    [
      'HMO-001: ₹1,00,000, ₹50,000 paid, registration and demo charged and paid',
      [
        onPlan('received', 50_000_00),
        row('due', 5_000_00, { chargeCategory: 'registration' }),
        row('received', 5_000_00, { chargeCategory: 'registration' }),
        row('due', 1_000_00, { chargeCategory: 'demo' }),
        row('received', 1_000_00, { chargeCategory: 'demo' }),
      ],
      {
        duePaise: 106_000_00,
        netReceivedPaise: 56_000_00,
        balancePaise: 50_000_00,
        balanceState: 'outstanding',
        unchargedPaise: 0,
      },
    ],
    [
      'HMO-004a: overpaid by ₹2,000 is a credit, not zero',
      [onPlan('received', 102_000_00)],
      { balancePaise: -2_000_00, balanceState: 'credit_balance' },
    ],
    [
      'HMO-004b: a registration payment with no charge recorded never lowers what is owed',
      [
        onPlan('received', 30_000_00),
        row('received', 5_000_00, { chargeCategory: 'registration' }),
      ],
      {
        duePaise: TUITION,
        netReceivedPaise: 35_000_00,
        balancePaise: 70_000_00,
        unchargedPaise: 5_000_00,
      },
    ],
    [
      'a reversed payment and its reversal count as nothing',
      [
        onPlan('received', 30_000_00, { id: 'a' }),
        onPlan('received', 30_000_00, { id: 'b', reversesRecordId: 'a' }),
        onPlan('received', 7_000_00, { id: 'c' }),
      ],
      { netReceivedPaise: 7_000_00, balancePaise: 93_000_00 },
    ],
    [
      'discounts and debits: charged − credits − received = balance',
      [onPlan('discount', 5_000_00), onPlan('adjustment', 20_000_00, { direction: 'debit' })],
      { duePaise: 120_000_00, creditAdjustmentsPaise: 5_000_00, balancePaise: 115_000_00 },
    ],
  ])('%s', (_, records, want) => {
    expect(feeStatement([plan('p', TUITION)], records)).toMatchObject(want);
  });

  it('a chain counts once, at the newest accepted version', () => {
    const plans = [plan('v1', TUITION), plan('v2', 110_000_00, 'v1')];
    const rows = [row('received', 50_000_00, { planId: 'v1' } as never)];
    expect(feeStatement(plans, rows)).toMatchObject({
      duePaise: 110_000_00,
      balancePaise: 60_000_00,
    });
  });

  it('a draft change bills nothing; the accepted version stands', () => {
    const plans = [
      { ...plan('v1', TUITION), status: 'closed' },
      { ...plan('v2', 120_000_00, 'v1'), status: 'draft', approvedAt: null },
    ];
    const rows = [row('received', 30_000_00, { planId: 'v1' } as never)];
    expect(feeStatement(plans, rows).balancePaise).toBe(70_000_00);
  });

  it('nothing known stays missing, never zero', () => {
    expect(feeStatement([], [])).toMatchObject({ balancePaise: null, balanceState: 'no_records' });
    expect(feeStatement([], [row('received', 100)])).toMatchObject({
      balancePaise: null,
      balanceState: 'no_due_recorded',
      netReceivedPaise: 100,
    });
  });

  it('the printed lines add up, and an old stored statement says it cannot be relied on', () => {
    const lines = feeStatementLines({
      duePaise: 106_000_00,
      creditAdjustmentsPaise: 5_000_00,
      netReceivedPaise: 56_000_00,
      unchargedPaise: 0,
      balancePaise: 45_000_00,
      balance: 'Balance outstanding',
      basis: 'agreement',
    });
    expect(lines).toEqual([
      ['Amount due', '₹1,06,000.00'],
      ['Discounts and credits', '₹5,000.00'],
      ['Received (net)', '₹56,000.00'],
      ['Balance', '₹45,000.00 (Balance outstanding)'],
    ]);
    const old = feeStatementLines({
      duePaise: 6_000_00,
      netReceivedPaise: 56_000_00,
      balancePaise: -50_000_00,
      balance: 'Credit balance (more recorded than due)',
    });
    expect(old.at(-1)![0]).toBe('Check before relying on this');
  });
});

describe('agreementPosition: the one reading of an agreement version (HMO-003)', () => {
  const family = [plan('v1', TUITION), plan('v2', 110_000_00, 'v1')];
  const instalments = [...schedule('v1'), ...schedule('v2', 110_000_00)];
  const ledger = [
    row('received', 50_000_00, { planId: 'v1', instalmentId: 'v1-i1' } as never),
    row('discount', 5_000_00, { planId: 'v1' } as never),
  ];

  it('a row on an earlier version counts for the instalment with the same number', () => {
    const d = agreementPosition(family[1]!, family, instalments, ledger, TODAY);
    expect(d.totals).toMatchObject({ reductionsPaise: 5_000_00, outstandingPaise: 55_000_00 });
    expect(d.instalments.find((i) => i.instalment.sequence === 1)).toMatchObject({
      paidPaise: 50_000_00,
      adjustedPaise: 5_000_00,
      remainingPaise: 0,
    });
    expect(d.versions.map((v) => v.id)).toEqual(['v1', 'v2']);
  });

  it('the paper: section 07 and 08 of the hunter’s case', () => {
    const snapshot = {
      registrationFeePaise: 5_000_00,
      feeAgreement: { planId: 'v2', totalPaise: 110_000_00 },
      form: EMPTY_FORM_FIELDS,
    } as unknown as ApplicationSnapshot;
    const rows = versionRows(family[1]!, family, instalments, ledger).mapped;
    expect(feeSummary(snapshot, rows)).toMatchObject({
      discountPaise: 5_000_00,
      netPaise: 110_000_00,
    });
    const tracker = feeTracker(snapshot, rows, schedule('v2', 110_000_00), TODAY);
    expect(tracker.find((t) => t.label === '1st instalment')).toMatchObject({
      receivedPaise: 50_000_00,
      balancePaise: 0,
    });
    expect(tracker.find((t) => t.label === 'Other')?.receivedPaise).toBeNull();
  });
});

describe('a debit is owed apart from the instalments (HMO-006)', () => {
  const inst = schedule();
  it.each<[string, PlanLedgerRow[], number[], number]>([
    ['nothing paid, debit ₹20,000', [debit(20_000_00)], [0, 0, 0], 20_000_00],
    [
      'instalment 1 paid in full stays paid',
      [debit(20_000_00), row('received', 50_000_00)],
      [50_000_00, 0, 0],
      20_000_00,
    ],
    [
      'a discount nets against the debit first',
      [debit(3_000_00), row('discount', 10_000_00), row('received', 10_000_00)],
      [10_000_00, 0, 0],
      0,
    ],
    [
      'money above the instalments pays the debit',
      [debit(20_000_00), row('received', 110_000_00)],
      [50_000_00, 25_000_00, 25_000_00],
      10_000_00,
    ],
  ])('%s', (_, ledger, paid, above) => {
    const allocated = allocateInstalments(inst, ledger, TODAY);
    const totals = planTotals(TUITION, inst, ledger);
    expect(allocated.map((a) => a.paidPaise)).toEqual(paid);
    expect(owedAboveInstalments(totals, allocated)).toBe(above);
    expect(allocated.reduce((n, a) => n + a.remainingPaise, 0) + above).toBe(
      totals.outstandingPaise,
    );
  });

  it('a paid instalment with a debit is Paid, not part paid, and never turns overdue', () => {
    const [first] = allocateInstalments(
      inst,
      [debit(20_000_00), row('received', 50_000_00)],
      TODAY,
    );
    expect(first!.status).toBe('paid');
  });

  it('a debit alone is valid: the agreement and its ledger agree', () => {
    const ledger = [debit(20_000_00)];
    const totals = planTotals(TUITION, inst, ledger);
    expect(reconcilePlan(totals, inst, ledger).reconciled).toBe(true);
  });

  it('property: 5,000 random ledgers, the instalments plus the rest always equal what is owed', () => {
    let seed = 20261030;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
    for (let i = 0; i < 5_000; i += 1) {
      const ledger = Array.from({ length: rnd(6) }, () => {
        const amount = (rnd(60_000) + 1) * 100;
        return [
          row('received', amount),
          row('discount', amount),
          row('waiver', amount),
          row('adjustment', amount, { direction: 'credit' }),
          debit(amount),
        ][rnd(5)]!;
      });
      const allocated = allocateInstalments(inst, ledger, TODAY);
      const totals = planTotals(TUITION, inst, ledger);
      const above = owedAboveInstalments(totals, allocated);
      expect(above).toBeGreaterThanOrEqual(0);
      expect(allocated.reduce((n, a) => n + a.remainingPaise, 0) + above).toBe(
        totals.outstandingPaise,
      );
      expect(allocated.every((a) => a.remainingPaise >= 0)).toBe(true);
      const y = feeYearRow({ totals, instalments: allocated }, TODAY);
      expect(y.dueNowPaise + y.overduePaise + y.futurePaise).toBe(totals.outstandingPaise);
    }
  });
});

describe('which version stands (HMO-002)', () => {
  const on = new Date();
  const p = (
    id: string,
    status: string,
    approvedAt: Date | null,
    supersedesPlanId: string | null = null,
  ) => ({
    id,
    status,
    approvedAt,
    supersedesPlanId,
  });
  it.each([
    ['one active agreement', [p('a', 'active', on)], ['a'], []],
    ['a change waiting', [p('a', 'closed', on), p('b', 'draft', null, 'a')], ['a'], ['b']],
    ['a change withdrawn', [p('a', 'closed', on), p('b', 'closed', null, 'a')], ['a'], []],
    ['a deliberately closed agreement', [p('a', 'closed', on)], [], []],
    ['a first draft', [p('a', 'draft', null)], [], []],
    ['a change activated', [p('a', 'closed', on), p('b', 'active', on, 'a')], ['b'], []],
  ])('%s', (_, plans, inForce, proposed) => {
    const v = acceptedVersions(plans);
    expect(v.inForce.map((x) => x.id)).toEqual(inForce);
    expect(v.proposed.map((x) => x.id)).toEqual(proposed);
  });
});

describe('Proposed refusals, the safe side until the owner decides', () => {
  it('HMO-007: a reduction above what is still owed', () => {
    const lowers = { kind: 'discount' as const, direction: null, amountPaise: 150_000_00 };
    expect(reductionAboveOwedIssue(lowers, TUITION)?.message).toMatch(
      /₹1,00,000\.00 is still owed/,
    );
    expect(reductionAboveOwedIssue({ ...lowers, amountPaise: TUITION }, TUITION)).toBeNull();
    expect(reductionAboveOwedIssue(lowers, null)).toBeNull();
    expect(
      reductionAboveOwedIssue({ kind: 'adjustment', direction: 'debit', amountPaise: 1 }, 0),
    ).toBeNull();
  });

  it('HMO-008: a demo fee credited to tuition cannot be refunded or reversed until the credit is', () => {
    const paid = row('received', 1_000_00, {
      id: 'pay',
      chargeCategory: 'demo',
      demoId: 'd1',
    } as never);
    const credit = row('adjustment', 1_000_00, {
      id: 'credit',
      direction: 'credit',
      demoId: 'd1',
    } as never);
    const refund = {
      kind: 'refund' as const,
      amountPaise: 1_000_00,
      paymentDate: TODAY,
      receiptReference: 'R',
      reversesRecordId: 'pay',
    };
    const reversal = {
      kind: 'received' as const,
      amountPaise: 1_000_00,
      notes: 'Wrong',
      reversesRecordId: 'pay',
    };
    for (const input of [refund, reversal])
      expect(validateFeeRecord(input, [paid, credit], TODAY).map((i) => i.message)).toEqual([
        'This demo fee is credited to tuition. Reverse that credit first.',
      ]);
    const creditReversed = row('adjustment', 1_000_00, {
      id: 'back',
      direction: 'credit',
      reversesRecordId: 'credit',
    } as never);
    expect(validateFeeRecord(refund, [paid, credit, creditReversed], TODAY)).toEqual([]);
  });

  it('HMO-012: a refund dated before its payment', () => {
    const paid = row('received', 10_000_00, { id: 'pay', paymentDate: '2026-10-10' } as never);
    const refund = (paymentDate: string) => ({
      kind: 'refund' as const,
      amountPaise: 1_000_00,
      paymentDate,
      receiptReference: 'R',
      reversesRecordId: 'pay',
    });
    expect(validateFeeRecord(refund('2026-10-09'), [paid], TODAY).map((i) => i.path)).toEqual([
      'paymentDate',
    ]);
    expect(validateFeeRecord(refund('2026-10-10'), [paid], TODAY)).toEqual([]);
  });

  it('HUS-008: the same payment twice, and what is not the same', () => {
    const made = row('received', 5_000_00, {
      id: 'a',
      code: 'FEE-1',
      paymentDate: TODAY,
      receiptReference: 'r-1',
    } as never);
    const again = {
      kind: 'received' as const,
      amountPaise: 5_000_00,
      paymentDate: TODAY,
      receiptReference: ' R-1 ',
    };
    expect(duplicatePaymentIssue(again, [made])?.message).toMatch(/already recorded/);
    expect(duplicatePaymentIssue({ ...again, instalmentId: 'i2' }, [made])).toBeNull();
    expect(
      duplicatePaymentIssue({ ...again, receiptReference: null }, [
        { ...made, receiptReference: null } as never,
      ]),
    ).toBeNull();
    const reversal = row('received', 5_000_00, { id: 'b', reversesRecordId: 'a' } as never);
    expect(duplicatePaymentIssue(again, [made, reversal])).toBeNull();
  });
});

describe('feeCollections: a status narrows the total, a reversal still cancels (HMO-009)', () => {
  const W = { from: '2026-10-01' as IsoDate, to: '2026-10-31' as IsoDate };
  const paid = (id: string, status: string, amountPaise: number, extra = {}) =>
    row('received', amountPaise, {
      id,
      status,
      paymentDate: '2026-10-05',
      ...extra,
    } as never) as never;
  const rows = [
    paid('a', 'verified', 30_000_00),
    paid('b', 'recorded', 7_000_00),
    row('received', 30_000_00, {
      id: 'c',
      reversesRecordId: 'a',
      paymentDate: null,
    } as never) as never,
    paid('d', 'verified', 2_000_00),
  ];
  it.each([
    [undefined, 9_000_00],
    ['verified', 2_000_00],
    ['recorded', 7_000_00],
    ['voided', 0],
  ] as const)('status %s → %i', (status, net) => {
    expect(feeCollections(rows, W, status)?.netPaise).toBe(net);
  });
  it('the sample share of a total', () => {
    const mixed = [paid('x', 'recorded', 100, { isSample: true }), paid('y', 'recorded', 50)];
    expect(feeCollections(mixed, W)).toMatchObject({ netPaise: 150, samplePaise: 100 });
  });
});

describe('the paper’s tracker (HMO-006, HMO-013)', () => {
  const snapshot = {
    registrationFeePaise: 5_000_00,
    feeAgreement: { planId: 'p', totalPaise: TUITION },
    form: EMPTY_FORM_FIELDS,
  } as unknown as ApplicationSnapshot;
  const inst = schedule();

  it('HMO-013: a payment naming no instalment still gives its row a date and a mode', () => {
    const tracker = feeTracker(
      snapshot,
      [
        onPlan('received', 50_000_00, { paymentDate: '2026-10-02', method: 'upi' }),
        onPlan('received', 10_000_00, { paymentDate: '2026-10-05', method: 'cash' }),
      ],
      inst,
      TODAY,
    );
    expect(tracker.find((t) => t.label === '1st instalment')).toMatchObject({
      receivedPaise: 50_000_00,
      lastReceiptDate: '2026-10-02',
      mode: 'upi',
    });
    expect(tracker.find((t) => t.label === '2nd instalment')).toMatchObject({
      receivedPaise: 10_000_00,
      lastReceiptDate: '2026-10-05',
      mode: 'cash',
    });
  });

  it('a payment that spans two instalments shows on both', () => {
    const tracker = feeTracker(
      snapshot,
      [onPlan('received', 60_000_00, { paymentDate: '2026-10-02', method: 'upi' })],
      inst,
      TODAY,
    );
    expect(tracker.find((t) => t.label === '2nd instalment')).toMatchObject({
      receivedPaise: 10_000_00,
      lastReceiptDate: '2026-10-02',
    });
  });

  it('a debit and a credit each have their line, so the paper adds up', () => {
    const labels = (rows: Parameters<typeof feeTracker>[1]) =>
      feeTracker(snapshot, rows, inst, TODAY)
        .filter((t) => !/instalment|Registration|Other/.test(t.label))
        .map((t) => [t.label, t.balancePaise]);
    expect(labels([onPlan('adjustment', 20_000_00, { direction: 'debit' })])).toEqual([
      ['Debit adjustments', 20_000_00],
    ]);
    expect(labels([onPlan('received', 102_000_00)])).toEqual([
      ['Paid above what is owed', -2_000_00],
    ]);
  });
});
