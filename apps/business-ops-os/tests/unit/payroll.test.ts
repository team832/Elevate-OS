/**
 * Payroll rules (F4-14): loss-of-pay days and amount (half days, months of 28–31 days, the paise
 * remainder), advance recovery, run states and who approves, and the payslip PDF text (net pay
 * in words uses the receipts' helper, tested with it). Fictional data only.
 */
import { writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  daysInMonth,
  LOCKED,
  lossOfPayDays,
  lossOfPayPaise,
  NOT_DRAFT,
  OWN_RUN,
  RUN_AUTHOR,
  payslipTotals,
  recoveryPaise,
  runActionRefusal,
  type LeaveDay,
} from '../../src/domain/payroll';
import type { RunPayslip } from '../../src/server/payroll-read';
import { DRAFT_BANNER, payslipsPdf } from '../../src/server/pdf/payslip';

const unpaid = (fromDate: string, toDate = fromDate, dayPart: string | null = null): LeaveDay => ({
  fromDate,
  toDate,
  kind: 'Unpaid',
  dayPart,
});

describe('days in a month', () => {
  it.each([
    ['2026-02-01', 28],
    ['2028-02-01', 29],
    ['2026-04-01', 30],
    ['2026-10-01', 31],
  ])('%s has %i days', (month, days) => expect(daysInMonth(month)).toBe(days));
});

describe('loss-of-pay days (Proposed: approved unpaid leave only, half day 0.5)', () => {
  it.each<[string, LeaveDay[], number]>([
    ['one whole day', [unpaid('2026-10-05')], 1],
    ['a first half', [unpaid('2026-10-05', '2026-10-05', 'first_half')], 0.5],
    [
      'both halves of one day',
      [
        unpaid('2026-10-05', '2026-10-05', 'first_half'),
        unpaid('2026-10-05', '2026-10-05', 'second_half'),
      ],
      1,
    ],
    [
      'the same half twice counts once',
      [
        unpaid('2026-10-05', '2026-10-05', 'first_half'),
        unpaid('2026-10-05', '2026-10-05', 'first_half'),
      ],
      0.5,
    ],
    [
      'a whole day beats a half on the same date',
      [unpaid('2026-10-05'), unpaid('2026-10-05', '2026-10-05', 'second_half')],
      1,
    ],
    [
      'overlapping records count each date once',
      [unpaid('2026-10-01', '2026-10-03'), unpaid('2026-10-02', '2026-10-04')],
      4,
    ],
    ['only the days inside the month', [unpaid('2026-09-29', '2026-10-02')], 2],
    ['leave of another month', [unpaid('2026-11-01', '2026-11-03')], 0],
    ['casual leave is paid', [{ ...unpaid('2026-10-05'), kind: 'Casual' }], 0],
    [
      'the type is matched without case or spaces',
      [{ ...unpaid('2026-10-05'), kind: ' unpaid ' }],
      1,
    ],
    ['a whole month', [unpaid('2026-10-01', '2026-10-31')], 31],
  ])('%s', (_, leave, days) => expect(lossOfPayDays('2026-10-01', leave, ['Unpaid'])).toBe(days));

  it.each<[string[], number]>([
    [['Leave without pay', 'Sabbatical'], 2],
    [['Unpaid'], 1],
    [[], 0],
  ])('the types come from the setting "Leave types without a balance": %j → %f', (types, days) =>
    expect(
      lossOfPayDays(
        '2026-10-01',
        [
          unpaid('2026-10-05'),
          { ...unpaid('2026-10-06'), kind: 'Leave without pay' },
          { ...unpaid('2026-10-07'), kind: 'sabbatical' },
        ],
        types,
      ),
    ).toBe(days),
  );
});

describe('loss-of-pay amount: gross × days ÷ days in month, rounded down once to the paisa', () => {
  const gross = 30_000_00; // ₹30,000
  it.each([
    [1, 28, 107_142], // 107142.857… paise
    [1, 29, 103_448], // 103448.27…
    [1, 30, 100_000], // exact
    [1, 31, 96_774], // 96774.19…
    [0.5, 31, 48_387], // 48387.09…
    [1.5, 31, 145_161], // 145161.29…
    [28, 28, gross], // a whole month equals the gross exactly
    [31, 31, gross],
    [0, 30, 0],
  ])('%f day(s) of a %i-day month → %i paise', (days, monthDays, paise) =>
    expect(lossOfPayPaise(gross, days, monthDays)).toBe(paise),
  );
  it('the part of a paisa left over stays with the staff member (never rounded up)', () => {
    for (const monthDays of [28, 29, 30, 31])
      for (let halves = 0; halves <= monthDays * 2; halves++) {
        const lop = lossOfPayPaise(gross, halves / 2, monthDays);
        expect(Number.isInteger(lop)).toBe(true);
        expect(lop * 2 * monthDays).toBeLessThanOrEqual(gross * halves);
        expect((lop + 1) * 2 * monthDays).toBeGreaterThan(gross * halves);
      }
  });
});

describe('advance recovery stops at zero', () => {
  const advance = { amountPaise: 12_000_00, monthlyInstalmentPaise: 5_000_00 };
  it.each([
    [0, 5_000_00],
    [5_000_00, 5_000_00],
    [10_000_00, 2_000_00],
    [12_000_00, 0],
    [13_000_00, 0],
  ])('after %i recovered → %i this month', (recovered, now) =>
    expect(recoveryPaise(advance, recovered)).toBe(now),
  );
});

describe('payroll run actions', () => {
  const run = (status: 'draft' | 'submitted' | 'approved') => ({
    status,
    createdBy: 'maker',
    submittedBy: status === 'draft' ? null : 'submitter',
  });
  it.each([
    ['submitted', 'approve', 'maker', OWN_RUN],
    ['submitted', 'approve', 'submitter', OWN_RUN],
    ['submitted', 'approve', 'approver', null],
    ['submitted', 'approve', 'author', RUN_AUTHOR], // wrote a line or a salary the run uses
    ['submitted', 'return', 'author', null],
    ['submitted', 'return', 'approver', null],
    ['submitted', 'submit', 'maker', NOT_DRAFT],
    ['submitted', 'rebuild', 'maker', NOT_DRAFT],
    ['draft', 'submit', 'maker', null],
    ['draft', 'rebuild', 'maker', null],
    [
      'draft',
      'approve',
      'approver',
      'This payroll is still a draft. Submit it for approval first.',
    ],
    ['approved', 'rebuild', 'maker', LOCKED],
    ['approved', 'return', 'approver', LOCKED],
    ['approved', 'approve', 'approver', LOCKED],
  ] as const)('%s run, %s by %s → %s', (status, action, actor, refusal) =>
    expect(runActionRefusal(run(status), action, actor, ['author'])).toBe(refusal),
  );
});

describe('payslip PDF (payslip/1)', () => {
  const slip = (over: Partial<RunPayslip> = {}) => {
    const lines = [
      { kind: 'earning', source: 'structure', label: 'Basic pay', amountPaise: 25_000_00 },
      {
        kind: 'earning',
        source: 'structure',
        label: 'House rent allowance',
        amountPaise: 5_000_00,
      },
      {
        kind: 'deduction',
        source: 'loss_of_pay',
        label: 'Loss of pay (1.5 days)',
        amountPaise: 1_451_61,
      },
    ];
    return {
      id: '00000000-0000-4000-8000-000000000001',
      staffName: 'नमूना शिक्षक Sample Teacher',
      staffCode: 'EMP-TEST-1',
      title: null,
      department: null,
      daysInMonth: 31,
      lossOfPayDays: 1.5,
      paidOn: null,
      paidMode: null,
      paidReference: null,
      isSample: true,
      lines,
      ...payslipTotals(lines),
      ...over,
    } as unknown as RunPayslip;
  };
  const run = { month: '2026-10-01', status: 'approved', isSample: false };
  /** Drawn lines rejoined: a long value wraps over several. */
  const textOf = (pdf: { lines: string[] }) => pdf.lines.join(' ');

  it('prints the facts, lines, net pay in figures and words, in Hindi too; one A4 page each', async () => {
    const pdf = await payslipsPdf(
      run,
      [slip(), slip({ staffName: 'Second Sample Staff' })],
      'PAY-2026-10-ALL',
    );
    const text = textOf(pdf);
    for (const want of [
      'नमूना शिक्षक Sample Teacher',
      'EMP-TEST-1',
      'October 2026',
      'Basic pay',
      '₹25,000.00',
      'Loss of pay (1.5 days)',
      'Gross earnings',
      '₹30,000.00',
      '₹28,548.39',
      'Rupees Twenty Eight Thousand Five Hundred Forty Eight and Thirty Nine Paise Only',
      'Not marked paid yet',
      'Sample data: a fictional staff member, not a real payment.',
      'Second Sample Staff',
      'Name, job title and department as recorded on',
    ])
      expect(text).toContain(want);
    expect(text).not.toContain(DRAFT_BANNER);
    expect(text).not.toMatch(/\bnull\b|undefined|bank_transfer/);
    if (process.env.PDF_SAMPLE_OUT) writeFileSync(process.env.PDF_SAMPLE_OUT, pdf.bytes);
    const doc = await PDFDocument.load(pdf.bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(Math.round(doc.getPage(0).getWidth())).toBe(595);
  });

  it('says Draft until approved, and prints the payment once marked paid', async () => {
    const draft = await payslipsPdf(
      { ...run, status: 'draft' },
      [slip({ netPaise: -50_00 })],
      'PAY-1',
    );
    expect(textOf(draft)).toContain(DRAFT_BANNER);
    expect(textOf(draft)).toContain('Minus Rupees Fifty Only'); // only a draft can be below zero
    const paid = await payslipsPdf(
      run,
      [slip({ paidOn: '2026-11-02', paidMode: 'bank_transfer', paidReference: 'TEST-UTR-1' })],
      'PAY-1',
    );
    expect(textOf(paid)).toContain('Paid on 2 Nov 2026, Bank transfer, reference TEST-UTR-1');
  });
});
