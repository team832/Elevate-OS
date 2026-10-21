import { describe, expect, it } from 'vitest';
import type { IsoDate } from '../../src/domain';
import {
  agreementStatus,
  allocateInstalments,
  checkAgreementInput,
  checkFeeStructureChange,
  instalmentStatus,
  nextDue,
  planTotals,
  reconcilePlan,
  studentFeeStatus,
  type InstalmentStatus,
  type PlanLedgerRow,
} from '../../src/domain/fee-plans';
import { summariseFees, validateFeeRecord } from '../../src/domain/fees';

const today = '2026-10-20' as IsoDate;
const row = (
  kind: PlanLedgerRow['kind'],
  amountPaise: number,
  extra: Partial<PlanLedgerRow> = {},
) => ({ kind, amountPaise, direction: null, status: 'recorded', ...extra }) as PlanLedgerRow;
const plan = [
  { id: 'i1', sequence: 1, dueDate: '2026-09-01', amountPaise: 50_000_00 },
  { id: 'i2', sequence: 2, dueDate: '2026-10-25', amountPaise: 25_000_00 },
  { id: 'i3', sequence: 3, dueDate: '2027-01-15', amountPaise: 25_000_00 },
];
const TOTAL = 100_000_00;
const states = (ledger: PlanLedgerRow[], schedule: typeof plan = plan) =>
  allocateInstalments(schedule, ledger, today).map((a) => [
    a.instalment.id,
    a.paidPaise,
    a.adjustedPaise,
    a.status,
  ]);

describe('A-FEE-3 instalment status', () => {
  it.each<[string, number, number, string | null, InstalmentStatus]>([
    ['fully paid', 100, 0, '2026-09-01', 'paid'],
    ['covered partly by a waiver', 60, 40, '2026-09-01', 'waived_adjusted'],
    ['past due, nothing paid', 0, 0, '2026-10-19', 'overdue'],
    ['past due, part-paid', 40, 0, '2026-10-19', 'overdue'],
    ['due today is not overdue', 0, 0, '2026-10-20', 'unpaid'],
    ['future, part-paid', 1, 0, '2026-12-01', 'part_paid'],
    ['no due date is never overdue', 0, 0, null, 'unpaid'],
  ])('%s', (_, paid, adjusted, due, expected) => {
    expect(instalmentStatus(100, paid, adjusted, due, today)).toBe(expected);
  });
});

describe('A-FEE-2 allocation: explicit instalment first, then oldest due first', () => {
  it('payments then reductions, oldest due first; refunds lower what is applied', () => {
    const ledger = [row('received', 60_000_00), row('discount', 5_000_00), row('refund', 2_000_00)];
    expect(states(ledger, [...plan].reverse())).toEqual([
      ['i1', 50_000_00, 0, 'paid'],
      ['i2', 8_000_00, 5_000_00, 'part_paid'],
      ['i3', 0, 0, 'unpaid'],
    ]);
  });

  it('a payment that names an instalment is applied there first', () => {
    expect(states([row('received', 25_000_00, { instalmentId: 'i3' })])).toEqual([
      ['i1', 0, 0, 'overdue'],
      ['i2', 0, 0, 'unpaid'],
      ['i3', 25_000_00, 0, 'paid'],
    ]);
  });

  it('the part of a linked payment above its instalment flows to the oldest due', () => {
    expect(states([row('received', 30_000_00, { instalmentId: 'i3' })])).toEqual([
      ['i1', 5_000_00, 0, 'overdue'],
      ['i2', 0, 0, 'unpaid'],
      ['i3', 25_000_00, 0, 'paid'],
    ]);
  });

  it('a waiver covering the rest marks the instalment waived or adjusted', () => {
    const ledger = [row('received', 50_000_00), row('waiver', 25_000_00, { instalmentId: 'i3' })];
    expect(states(ledger).map((s) => s[3])).toEqual(['paid', 'unpaid', 'waived_adjusted']);
  });

  it('voided and reversed rows never count; nothing recorded leaves the past one overdue', () => {
    const ledger = [
      row('received', 30_000_00, { status: 'voided' }),
      row('received', 10_000_00, { id: 'p1' }),
      row('received', 10_000_00, { id: 'p1r', reversesRecordId: 'p1' }),
    ];
    expect(planTotals(TOTAL, plan, ledger).netPaidPaise).toBe(0);
    expect(states(ledger)[0]?.[3]).toBe('overdue');
  });

  it('instalments without a due date come last and are never overdue', () => {
    const open = plan.map((i) => (i.id === 'i1' ? { ...i, dueDate: null } : i));
    expect(states([row('received', 25_000_00)], open as typeof plan)).toEqual([
      ['i2', 25_000_00, 0, 'paid'],
      ['i3', 0, 0, 'unpaid'],
      ['i1', 0, 0, 'unpaid'],
    ]);
  });
});

describe('A-FEE-1 totals equal the ledger; reductions and credit are explicit', () => {
  it('sums each kind separately', () => {
    const ledger = [
      row('received', 50_000_00),
      row('refund', 5_000_00),
      row('discount', 3_000_00),
      row('waiver', 2_000_00),
      row('adjustment', 1_000_00, { direction: 'credit' }),
      row('adjustment', 500_00, { direction: 'debit' }),
    ];
    expect(planTotals(TOTAL, plan, ledger)).toEqual({
      totalPaise: TOTAL,
      scheduledPaise: TOTAL,
      paidPaise: 50_000_00,
      refundedPaise: 5_000_00,
      netPaidPaise: 45_000_00,
      reductionsPaise: 5_500_00,
      outstandingPaise: TOTAL - 5_500_00 - 45_000_00,
      creditPaise: 0,
    });
  });

  it('an overpayment is an explicit credit, never absorbed', () => {
    const totals = planTotals(TOTAL, plan, [row('received', TOTAL + 1_500_00)]);
    expect(totals).toMatchObject({ outstandingPaise: 0, creditPaise: 1_500_00 });
    expect(reconcilePlan(totals, plan, []).reconciled).toBe(true);
  });

  it('a discount needs a reason and is counted as a credit in the admission summary', () => {
    expect(validateFeeRecord({ kind: 'discount', amountPaise: 100 }, [], today)).toEqual([
      { path: 'notes', message: 'Give the reason for the discount.' },
    ]);
    const s = summariseFees([
      { kind: 'due', amountPaise: 1000, direction: null, status: 'recorded' },
      { kind: 'discount', amountPaise: 100, direction: null, status: 'recorded' },
    ]);
    expect(s.balancePaise).toBe(900);
  });
});

describe('A-FEE-7 overall status and next due', () => {
  it.each<[string, PlanLedgerRow[], InstalmentStatus, string | null]>([
    ['nothing recorded, first due in the past', [], 'overdue', 'i1'],
    ['first paid, second not yet due', [row('received', 50_000_00)], 'part_paid', 'i2'],
    ['all paid', [row('received', TOTAL)], 'paid', null],
    [
      'all covered, part by waiver',
      [row('received', 75_000_00), row('waiver', 25_000_00)],
      'waived_adjusted',
      null,
    ],
    [
      'all paid but a debit is still owed',
      [row('received', TOTAL), row('adjustment', 100, { direction: 'debit' })],
      'part_paid',
      'i3',
    ],
  ])('%s', (_, ledger, overall, next) => {
    const allocated = allocateInstalments(plan, ledger, today);
    expect(agreementStatus(allocated, planTotals(TOTAL, plan, ledger))).toBe(overall);
    expect(nextDue(allocated)?.instalment.id ?? null).toBe(next);
  });
});

describe('A-FEE-4 reconciliation', () => {
  it.each<[string, PlanLedgerRow[], typeof plan, boolean]>([
    ['clean ledger', [row('received', 10_000_00, { instalmentId: 'i1' })], plan, true],
    ['refund above payments', [row('refund', 100)], plan, false],
    ['instalment of another plan', [row('received', 100, { instalmentId: 'x' })], plan, false],
    ['schedule does not add up', [], plan.slice(0, 2), false],
    ['a due row on a plan', [row('due', 100)], plan, false],
  ])('%s', (_, ledger, schedule, reconciled) => {
    const totals = planTotals(TOTAL, schedule, ledger);
    expect(reconcilePlan(totals, schedule, ledger).reconciled).toBe(reconciled);
  });
});

describe('student fee status for lists', () => {
  it.each<[string, InstalmentStatus[], string]>([
    ['no active plan', [], 'not_configured'],
    ['all paid or waived', ['paid', 'waived_adjusted'], 'paid'],
    ['one overdue', ['paid', 'overdue'], 'overdue'],
    ['part-paid, nothing overdue', ['part_paid', 'unpaid'], 'due'],
  ])('%s', (_, plans, expected) => {
    expect(studentFeeStatus(plans)).toBe(expected);
  });
});

describe('agreement input', () => {
  const ok = {
    tuitionPaise: TOTAL,
    academicYear: '2026-27',
    dueDates: ['2026-11-01', '2027-01-15', '2027-03-15'],
    sharesPercent: [50, 25, 25],
  };
  it.each([
    [{}, []],
    [{ tuitionPaise: 0 }, ['totalPaise']],
    [{ tuitionPaise: 2 }, ['totalPaise']],
    [{ tuitionPaise: 10.5 }, ['totalPaise']],
    [{ academicYear: '2026-28' }, ['academicYear']],
    [{ academicYear: '26-27' }, ['academicYear']],
    [{ academicYear: '2099-00' }, []],
    [{ dueDates: ['2026-11-01'] }, ['dueDates']],
    [{ dueDates: ['2027-01-15', '2026-11-01', '2027-03-15'] }, ['dueDates']],
  ])('%j → %j', (patch, paths) => {
    expect(checkAgreementInput({ ...ok, ...patch }).map((i) => i.path)).toEqual(paths);
  });
});

describe('checkFeeStructureChange (A-FEE-6)', () => {
  const sample = { source: 'sample', status: 'draft' } as const;
  const approved = { source: 'owner_approved', status: 'approved' } as const;
  const reason = 'Owner confirmed on 21 Oct 2026.';
  it.each([
    ['edit a sample figure', sample, { termsChanged: true }, false, null],
    [
      'approve a sample figure',
      sample,
      { status: 'approved', reason, termsChanged: false },
      true,
      'status',
    ],
    [
      'promote without permission',
      sample,
      { source: 'owner_approved', reason, termsChanged: false },
      false,
      'source',
    ],
    [
      'promote without a reason',
      sample,
      { source: 'owner_approved', reason: 'ok', termsChanged: false },
      true,
      'reason',
    ],
    [
      'promote and approve',
      sample,
      { source: 'owner_approved', status: 'approved', reason, termsChanged: false },
      true,
      null,
    ],
    [
      'change an approved fee without permission',
      approved,
      { termsChanged: true },
      false,
      'source',
    ],
    ['change an approved fee with permission', approved, { termsChanged: true }, true, null],
    [
      'edit a website figure',
      { source: 'website_stated', status: 'draft' },
      { termsChanged: true },
      false,
      null,
    ],
  ] as const)('%s', (_name, before, change, canApprove, path) => {
    expect(checkFeeStructureChange(before, change, canApprove)?.path ?? null).toBe(path);
  });
});
