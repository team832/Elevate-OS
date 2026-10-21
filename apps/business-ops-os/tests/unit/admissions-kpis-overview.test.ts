import { describe, expect, it } from 'vitest';
import {
  admissionsConfirmed,
  applicationsAwaiting,
  demoDayProgress,
  demoToAdmissionConversion,
  feeCollections,
  overdueOnboarding,
  tuitionOutstanding,
} from '../../src/domain/admissions-kpis';
import type { IsoDate } from '../../src/domain/dates';
import type { OnboardingStatus } from '../../src/domain/onboarding';

const NOW = new Date('2026-10-21T06:30:00Z'); // 12:00 IST, 21 Oct 2026
const W = { from: '2026-10-01' as IsoDate, to: '2026-10-21' as IsoDate };
/** A class at 10:30 IST on `day` (YYYY-MM-DD), on demo day `dayNumber`. */
const cls = (day: string, dayNumber: number, attendance = 'present') => ({
  dayNumber,
  attendance,
  startsAt: new Date(`${day}T05:00:00Z`),
});
const demo = (
  sessions: ReturnType<typeof cls>[],
  confirmedAt: Date | null = null,
  planned = 3,
) => ({
  plannedDayCount: planned,
  sessions,
  confirmedAt,
});

describe('demoDayProgress (days attended, not classes)', () => {
  it.each([
    [
      'three classes on day 1 = 1 day',
      [demo([cls('2026-10-05', 1), cls('2026-10-05', 1), cls('2026-10-05', 1)])],
      1,
      3,
      0,
    ],
    [
      'all three days attended',
      [demo([cls('2026-10-05', 1), cls('2026-10-06', 2, 'late'), cls('2026-10-07', 3)])],
      3,
      3,
      1,
    ],
    [
      'absent and excused days do not count',
      [
        demo([
          cls('2026-10-05', 1, 'absent'),
          cls('2026-10-06', 2, 'excused'),
          cls('2026-10-07', 3),
        ]),
      ],
      1,
      3,
      0,
    ],
    [
      'a demo with no class in the window is left out',
      [demo([cls('2026-09-05', 1)]), demo([cls('2026-10-05', 1)])],
      1,
      3,
      0,
    ],
  ])('%s', (_, rows, attended, planned, complete) => {
    const r = demoDayProgress(rows, W);
    expect([r.daysAttended.value, r.plannedDays, r.allDaysAttended]).toEqual([
      attended,
      planned,
      complete,
    ]);
    expect(r.daysAttended.status).toBe('ok');
  });

  it('no demo with a class in the window → missing, never 0', () => {
    const r = demoDayProgress([demo([cls('2026-09-05', 1)])], W);
    expect(r.daysAttended).toMatchObject({ status: 'missing', value: null });
    expect(r.demos).toBe(0);
  });
});

describe('demoToAdmissionConversion (cohort = first demo day in the window)', () => {
  const at = (iso: string) => new Date(`${iso}T06:00:00Z`);
  it.each([
    // first day 2 Oct; 7-day windows end 9 Oct (≤ 21 Oct): settled
    [
      'converted within N days',
      [demo([cls('2026-10-02', 1)], at('2026-10-08'))],
      7,
      [1, 1, 0, 100],
    ],
    [
      'confirmed after N days is not converted',
      [demo([cls('2026-10-02', 1)], at('2026-10-12'))],
      7,
      [0, 1, 0, 0],
    ],
    [
      'still inside its window → waiting, not in the denominator',
      [demo([cls('2026-10-02', 1)]), demo([cls('2026-10-18', 1)])],
      7,
      [0, 1, 1, 0],
    ],
    [
      'first day before the window → not in the cohort',
      [demo([cls('2026-09-28', 1), cls('2026-10-02', 2)], at('2026-10-03'))],
      7,
      [0, 0, 0, null],
    ],
    [
      'confirmed before the first demo day is not a conversion',
      [demo([cls('2026-10-05', 1)], at('2026-10-02'))],
      7,
      [0, 1, 0, 0],
    ],
    [
      'cancelled classes do not set the first day',
      [demo([cls('2026-09-28', 1, 'cancelled'), cls('2026-10-02', 1)], at('2026-10-03'))],
      7,
      [1, 1, 0, 100],
    ],
  ])('%s', (_, rows, days, [converted, cohort, waiting, rate]) => {
    const r = demoToAdmissionConversion(rows, W, days, NOW);
    expect([r.converted, r.cohort, r.waiting, r.rate.value]).toEqual([
      converted,
      cohort,
      waiting,
      rate,
    ]);
  });

  it('only demos still in their window → missing with the reason', () => {
    const r = demoToAdmissionConversion([demo([cls('2026-10-18', 1)])], W, 30, NOW);
    expect(r.rate).toMatchObject({ status: 'missing' });
    expect(r.rate.status === 'missing' && r.rate.reason).toMatch(/30-day window/);
    expect(r.rate.definition).toMatch(/within 30 days/);
  });
});

describe('applicationsAwaiting and admissionsConfirmed', () => {
  it('counts each waiting status; a real 0 stays 0', () => {
    const r = applicationsAwaiting(
      ['draft', 'draft', 'form_generated', 'admission_confirmed', 'withdrawn'].map((status) => ({
        status,
      })),
      NOW,
    );
    expect(Object.fromEntries(Object.entries(r).map(([k, m]) => [k, m.value]))).toEqual({
      draft: 2,
      ready_for_review: 0,
      form_generated: 1,
      signatures_confirmed: 0,
    });
  });

  it('admissions confirmed on IST days inside the window', () => {
    const rows = [
      { approvedAt: new Date('2026-09-30T18:29:00Z') }, // 30 Sep 23:59 IST
      { approvedAt: new Date('2026-09-30T18:30:00Z') }, // 1 Oct 00:00 IST
      { approvedAt: new Date('2026-10-21T10:00:00Z') },
    ];
    const r = admissionsConfirmed(rows, W);
    expect(r.metric.value).toBe(2);
    expect(r.rows).toEqual(rows.slice(1));
  });
});

type Item = { admissionId: string; dueDate: string | null; status: OnboardingStatus };
describe('overdueOnboarding', () => {
  it.each([
    [
      'past due, not done',
      [{ admissionId: 'a', dueDate: '2026-10-20', status: 'in_progress' }],
      1,
      1,
    ],
    [
      'due today is not overdue',
      [{ admissionId: 'a', dueDate: '2026-10-21', status: 'not_started' }],
      0,
      0,
    ],
    [
      'completed / not applicable never overdue',
      [
        { admissionId: 'a', dueDate: '2026-10-01', status: 'completed' },
        { admissionId: 'a', dueDate: '2026-10-01', status: 'not_applicable' },
      ],
      0,
      0,
    ],
    [
      'two items of one student',
      [
        { admissionId: 'a', dueDate: '2026-10-01', status: 'blocked' },
        { admissionId: 'a', dueDate: null, status: 'blocked' },
        { admissionId: 'a', dueDate: '2026-10-02', status: 'not_started' },
      ],
      2,
      1,
    ],
  ])('%s', (_, items, n, students) => {
    const r = overdueOnboarding(items as Item[], NOW);
    expect([r.items.value, r.admissions]).toEqual([n, students]);
  });

  it('no checklist items at all → missing', () => {
    expect(overdueOnboarding([], NOW).items.status).toBe('missing');
  });
});

describe('fees: collections in the window and tuition outstanding', () => {
  const rec = (
    kind: 'received' | 'refund' | 'due',
    amountPaise: number,
    paymentDate: string | null,
    extra: Record<string, unknown> = {},
  ) => ({ kind, amountPaise, paymentDate, status: 'recorded' as const, direction: null, ...extra });

  it.each([
    [
      'net of refunds, per charge',
      [
        rec('received', 50_000_00, '2026-10-05', { chargeCategory: 'tuition' }),
        rec('refund', 5_000_00, '2026-10-06', { chargeCategory: 'tuition' }),
        rec('received', 1_000_00, '2026-10-07', { chargeCategory: 'demo' }),
      ],
      { tuition: 45_000_00, registration: 0, demo: 1_000_00 },
      46_000_00,
    ],
    [
      'outside the window and voided rows do not count',
      [
        rec('received', 10_000_00, '2026-09-30'),
        rec('received', 20_000_00, '2026-10-02', { status: 'voided' }),
      ],
      { tuition: 0, registration: 0, demo: 0 },
      0,
    ],
    [
      'a reversed payment does not count',
      [
        rec('received', 10_000_00, '2026-10-02', { id: 'p1' }),
        rec('received', 10_000_00, '2026-10-03', { id: 'r1', reversesRecordId: 'p1' }),
      ],
      { tuition: 0, registration: 0, demo: 0 },
      0,
    ],
  ])('%s', (_, records, byCategory, net) => {
    expect(feeCollections(records as never, W)).toEqual({ byCategory, netPaise: net });
  });

  it('no fee records at all → null (missing), not ₹0', () => {
    expect(feeCollections([], W)).toBeNull();
  });

  it('outstanding sums active agreements; none → null', () => {
    const t = (outstandingPaise: number, creditPaise = 0) => ({ outstandingPaise, creditPaise });
    expect(tuitionOutstanding([t(50_000_00), t(0, 2_000_00)])).toEqual({
      agreements: 2,
      outstandingPaise: 50_000_00,
      creditPaise: 2_000_00,
    });
    expect(tuitionOutstanding([])).toBeNull();
  });
});
