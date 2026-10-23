import { describe, expect, it } from 'vitest';
import type { IsoDate } from '../../src/domain';
import { allocateInstalments, planTotals, type PlanLedgerRow } from '../../src/domain/fee-plans';
import {
  acceptedVersions,
  feeYearRow,
  feeYearTotals,
  type FeeYearMoney,
} from '../../src/domain/fee-year';

const today = '2026-10-20' as IsoDate;
const TOTAL = 100_000_00;
const due = (d1: string, d2 = today as string, d3 = '2027-01-15') => [
  { id: 'i1', sequence: 1, dueDate: d1, amountPaise: 50_000_00 },
  { id: 'i2', sequence: 2, dueDate: d2, amountPaise: 25_000_00 },
  { id: 'i3', sequence: 3, dueDate: d3, amountPaise: 25_000_00 },
];
const row = (
  kind: PlanLedgerRow['kind'],
  amountPaise: number,
  extra: Partial<PlanLedgerRow> = {},
) => ({ kind, amountPaise, direction: null, status: 'recorded', ...extra }) as PlanLedgerRow;
/** The same two calls plansWithLedger makes for one agreement. */
const year = (ledger: PlanLedgerRow[], schedule = due('2026-09-01')) =>
  feeYearRow(
    {
      totals: planTotals(TOTAL, schedule, ledger),
      instalments: allocateInstalments(schedule, ledger, today),
    },
    today,
  );
const L = 100; // ₹1 in paise

describe('A-FEE-9 one agreement for the year', () => {
  it.each<[string, PlanLedgerRow[], Partial<FeeYearMoney> & { nextDueDate?: string | null }]>([
    [
      '50/25/25 partly paid: first instalment covered, second due today',
      [row('received', 60_000_00)],
      {
        billedPaise: TOTAL,
        paidPaise: 60_000_00,
        outstandingPaise: 40_000_00,
        dueNowPaise: 15_000_00,
        overduePaise: 0,
        futurePaise: 25_000_00,
        nextDueDate: today,
      },
    ],
    [
      'fully paid',
      [row('received', TOTAL)],
      {
        paidPaise: TOTAL,
        outstandingPaise: 0,
        dueNowPaise: 0,
        overduePaise: 0,
        futurePaise: 0,
        nextDueDate: null,
      },
    ],
    [
      'unpaid: past instalment overdue, today’s due now, the last in the future',
      [],
      {
        paidPaise: 0,
        outstandingPaise: TOTAL,
        overduePaise: 50_000_00,
        dueNowPaise: 25_000_00,
        futurePaise: 25_000_00,
        nextDueDate: '2026-09-01',
      },
    ],
    [
      'overdue part: what is left of a past instalment',
      [row('received', 30_000_00)],
      { overduePaise: 20_000_00, dueNowPaise: 25_000_00, futurePaise: 25_000_00 },
    ],
    [
      'discount lowers what is billed, not what is paid',
      [row('received', 50_000_00), row('discount', 10_000_00)],
      {
        billedPaise: 90_000_00,
        paidPaise: 50_000_00,
        outstandingPaise: 40_000_00,
        dueNowPaise: 15_000_00,
        futurePaise: 25_000_00,
      },
    ],
    [
      'waiver of the whole tuition: nothing billed, nothing owed',
      [row('waiver', TOTAL)],
      { billedPaise: 0, paidPaise: 0, outstandingPaise: 0, futurePaise: 0 },
    ],
    [
      'reductions above the tuition: nothing billed, the excess is a credit',
      [row('waiver', TOTAL), row('discount', 10_000_00)],
      { billedPaise: 0, paidPaise: 0, outstandingPaise: 0, futurePaise: 0, creditPaise: 10_000_00 },
    ],
    [
      'refund lowers what is paid',
      [
        row('received', 60_000_00, { id: 'p1' }),
        row('refund', 10_000_00, { reversesRecordId: 'p1' }),
      ],
      {
        paidPaise: 50_000_00,
        outstandingPaise: 50_000_00,
        dueNowPaise: 25_000_00,
        futurePaise: 25_000_00,
      },
    ],
    [
      'a voided payment never counts',
      [row('received', 50_000_00, { status: 'voided' })],
      { paidPaise: 0, outstandingPaise: TOTAL, overduePaise: 50_000_00 },
    ],
    [
      'a reversed payment never counts',
      [
        row('received', 50_000_00, { id: 'p1' }),
        row('received', 50_000_00, { reversesRecordId: 'p1' }),
      ],
      { paidPaise: 0, outstandingPaise: TOTAL },
    ],
    [
      'overpayment is a credit, not paid',
      [row('received', 110_000_00)],
      { billedPaise: TOTAL, paidPaise: TOTAL, outstandingPaise: 0, creditPaise: 10_000_00 },
    ],
    [
      'a debit above the instalments is owed but not scheduled',
      [row('received', TOTAL), row('adjustment', 5_000_00, { direction: 'debit' })],
      {
        billedPaise: TOTAL + 5_000_00,
        paidPaise: TOTAL,
        outstandingPaise: 5_000_00,
        futurePaise: 5_000_00,
        overduePaise: 0,
        dueNowPaise: 0,
      },
    ],
  ])('%s', (_, ledger, expected) => {
    const r = year(ledger);
    expect(r).toMatchObject(expected);
    expect(r.dueNowPaise + r.overduePaise + r.futurePaise).toBe(r.outstandingPaise);
    expect(r.paidPaise + r.outstandingPaise).toBe(r.billedPaise);
  });

  it('future-only schedule: everything owed is future', () => {
    const r = year([], due('2026-11-01', '2026-12-01', '2027-01-01'));
    expect(r.paidPaise + r.outstandingPaise).toBe(r.billedPaise);
    expect(year([], due('2026-11-01', '2026-12-01', '2027-01-01'))).toMatchObject({
      outstandingPaise: TOTAL,
      futurePaise: TOTAL,
      dueNowPaise: 0,
      overduePaise: 0,
      nextDueDate: '2026-11-01',
    });
  });
});

describe('A-FEE-9 totals = the sum of the rows', () => {
  const money = (billed: number, paid: number, studentId: string) => ({
    studentId,
    billedPaise: billed,
    paidPaise: paid,
    outstandingPaise: billed - paid,
    dueNowPaise: 0,
    overduePaise: billed - paid,
    futurePaise: 0,
    creditPaise: 0,
  });

  it('sums every figure and gives outstanding / billed', () => {
    const t = feeYearTotals([
      money(100_000 * L, 70_000 * L, 's1'),
      money(50_000 * L, 50_000 * L, 's2'),
    ]);
    expect(t).toMatchObject({
      students: 2,
      billedPaise: 150_000 * L,
      paidPaise: 120_000 * L,
      outstandingPaise: 30_000 * L,
      overduePaise: 30_000 * L,
    });
    expect(t.outstandingPct).toBe(20);
  });

  it.each([
    ['no rows', []],
    ['only fully waived agreements', [money(0, 0, 's1')]],
  ])('zero billed (%s) → no percentage, never NaN or 0%%', (_, rows) => {
    const t = feeYearTotals(rows);
    expect(t.billedPaise).toBe(0);
    expect(t.outstandingPct).toBeNull();
  });
});

describe('A-FEE-9 which versions count', () => {
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
  const on = new Date('2026-06-01T00:00:00Z');

  it.each([
    ['an active agreement counts', [p('a', 'active', on)], ['a'], [], []],
    [
      'a closed (cancelled) agreement that was accepted still counts',
      [p('a', 'closed', on)],
      ['a'],
      [],
      [],
    ],
    [
      'a draft closed before acceptance never billed anything',
      [p('a', 'closed', null)],
      [],
      [],
      [],
    ],
    ['a first draft is not billed yet', [p('a', 'draft', null)], [], [], ['a']],
    [
      'a newer activated version replaces the older one',
      [p('v1', 'closed', on), p('v2', 'active', on, 'v1')],
      ['v2'],
      [],
      [],
    ],
    [
      'a change waiting for approval: the last approved version still counts',
      [p('v1', 'closed', on), p('v2', 'draft', null, 'v1')],
      ['v1'],
      ['v1'],
      [],
    ],
    [
      'a rejected change closed unapproved: the last approved version still counts',
      [p('v1', 'closed', on), p('v2', 'closed', null, 'v1'), p('v3', 'active', on, 'v2')],
      ['v3'],
      [],
      [],
    ],
    [
      'two chains are counted apart',
      [p('a1', 'closed', on), p('a2', 'draft', null, 'a1'), p('b1', 'active', on)],
      ['a1', 'b1'],
      ['a1'],
      [],
    ],
  ])('%s', (_, plans, counted, changing, drafts) => {
    const r = acceptedVersions(plans);
    expect(r.counted.map((x) => x.id).sort()).toEqual(counted);
    expect(r.changing.map((x) => x.id)).toEqual(changing);
    expect(r.drafts.map((x) => x.id)).toEqual(drafts);
  });
});
