import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeCapacity, type CalendarRule, type CapacityExclusion } from '../../src/domain';

const legacy = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../data/legacy/academic/class12-plan.json', import.meta.url)),
    'utf8',
  ),
) as {
  summary: { lessons: number };
  capacity_math: { cells: { cell: string; value: number }[] };
  exclusions: { period: string; holiday_days: number; school_exam_days: number; slots_per_excluded_day: number; excluded_slots: number }[];
};

/** The documented Class 12 weekly pattern (planning_controls "Weekly pattern"). */
const CLASS12_RULES: CalendarRule[] = [
  { label: 'Apr–Jun Mon–Fri × 2', periodStart: '2027-04-01', periodEnd: '2027-06-30', weekdays: [1, 2, 3, 4, 5], slotsPerDay: 2, kind: 'regular' },
  { label: 'Jul–15 Oct Mon–Sat × 2', periodStart: '2027-07-01', periodEnd: '2027-10-15', weekdays: [1, 2, 3, 4, 5, 6], slotsPerDay: 2, kind: 'regular' },
  { label: 'Jul–15 Oct Tue/Thu third class', periodStart: '2027-07-01', periodEnd: '2027-10-15', weekdays: [2, 4], slotsPerDay: 1, kind: 'extra' },
];
const PERIODS: Record<string, [string, string]> = {
  April: ['2027-04-01', '2027-04-30'],
  May: ['2027-05-01', '2027-05-31'],
  June: ['2027-06-01', '2027-06-30'],
  July: ['2027-07-01', '2027-07-31'],
  August: ['2027-08-01', '2027-08-31'],
  September: ['2027-09-01', '2027-09-30'],
  'October: 1–15': ['2027-10-01', '2027-10-15'],
};
/** The legacy 28-slot allowance as undated allowance records (holiday and school-exam days per month). */
function legacyAllowances(): CapacityExclusion[] {
  return legacy.exclusions.flatMap((e) => {
    const [periodStart, periodEnd] = PERIODS[e.period]!;
    return [
      { label: `${e.period} holiday allowance`, kind: 'holiday', periodStart, periodEnd, days: e.holiday_days, slotsPerDay: e.slots_per_excluded_day },
      { label: `${e.period} school-exam allowance`, kind: 'school_exam', periodStart, periodEnd, days: e.school_exam_days, slotsPerDay: e.slots_per_excluded_day },
    ];
  });
}
const cell = (c: string) => legacy.capacity_math.cells.find((x) => x.cell === c)!.value;

describe('computeCapacity — legacy Class 12 reproduction (BR-ACD-7)', () => {
  const result = computeCapacity({
    window: { from: '2027-04-01', to: '2027-10-15' },
    rules: CLASS12_RULES,
    exclusions: legacyAllowances(),
    requiredClasses: legacy.summary.lessons,
  });

  it('reproduces 157 days × 2 + 31 third classes = 345 gross', () => {
    expect(result.teachingDays).toBe(cell("'Assessment budget'!B28"));
    expect(result.extraSlots).toBe(cell("'Assessment budget'!B29"));
    expect(result.grossSlots).toBe(345);
    expect(result.grossSlots).toBe(cell("'Assessment budget'!B30"));
  });

  it('reproduces 345 − 28 = 317 net vs 305 required, headroom 12, feasible', () => {
    expect(result.excludedSlots).toBe(28);
    expect(result.netSlots).toBe(317);
    expect(result.netSlots).toBe(cell("'Assessment budget'!B52"));
    expect(result.requiredClasses).toBe(305);
    expect(result.headroom).toBe(12);
    expect(result.headroom).toBe(cell("'Assessment budget'!B35"));
    expect(result.verdict).toBe('feasible');
    expect(result.caveat).toMatch(/do not prove/);
    expect(JSON.stringify(result)).not.toMatch(/optimal schedule exists|is optimal/i);
  });

  it('monthly gross slots match the workbook (April 42 … September 61)', () => {
    const gross = Object.fromEntries(result.months.map((m) => [m.month, m.grossSlots]));
    expect(gross).toEqual({
      '2027-04': 44,
      '2027-05': 42,
      '2027-06': 44,
      '2027-07': 63,
      '2027-08': 61,
      '2027-09': 61,
      '2027-10': 30,
    });
    // Workbook "Net slots" April = 42 = 44 gross − 2 holiday allowance.
    expect(result.months.find((m) => m.month === '2027-04')!.netSlots).toBe(42);
  });
});

describe('computeCapacity — rules', () => {
  const rules: CalendarRule[] = [
    { label: 'Mon–Fri × 2', periodStart: '2027-04-05', periodEnd: '2027-04-11', weekdays: [1, 2, 3, 4, 5], slotsPerDay: 2, kind: 'regular' },
  ];
  const window = { from: '2027-04-05', to: '2027-04-11' };

  it('a closure on a weekend is not deducted (no double counting)', () => {
    const r = computeCapacity({
      window,
      rules,
      exclusions: [{ label: 'Sunday festival', kind: 'holiday', date: '2027-04-11' }],
      requiredClasses: 10,
    });
    expect(r.grossSlots).toBe(10);
    expect(r.excludedSlots).toBe(0);
    expect(r.verdict).toBe('feasible');
    expect(r.headroom).toBe(0); // boundary: exactly enough
  });

  it('a dated closure replaces the allowance it uses up (not added to it)', () => {
    const r = computeCapacity({
      window,
      rules,
      exclusions: [
        { label: 'Week allowance', kind: 'holiday', periodStart: '2027-04-05', periodEnd: '2027-04-11', days: 1, slotsPerDay: 2 },
        { label: 'Dated holiday', kind: 'holiday', date: '2027-04-07' },
      ],
      requiredClasses: 9,
    });
    expect(r.excludedSlots).toBe(2);
    expect(r.netSlots).toBe(8);
    expect(r.verdict).toBe('infeasible');
    expect(r.reasons[0]).toMatch(/short by 1/);
  });

  it('two closures on the same day deduct once', () => {
    const r = computeCapacity({
      window,
      rules,
      exclusions: [
        { label: 'A', kind: 'holiday', date: '2027-04-06' },
        { label: 'B', kind: 'school_exam', date: '2027-04-06' },
      ],
      requiredClasses: null,
    });
    expect(r.excludedSlots).toBe(2);
    expect(r.verdict).toBe('not_assessed');
    expect(r.headroom).toBeNull();
  });

  it('flags months over capacity (relocation needed)', () => {
    const r = computeCapacity({ window, rules, exclusions: [], requiredClasses: 10, plannedByMonth: { '2027-04': 12 } });
    expect(r.months[0]).toMatchObject({ month: '2027-04', overBy: 2 });
    expect(r.reasons.some((x) => x.includes('relocation needed: 2'))).toBe(true);
  });

  it('rejects invalid and conflicting input instead of guessing', () => {
    expect(computeCapacity({ window: { from: '2027-04-10', to: '2027-04-01' }, rules, exclusions: [], requiredClasses: 1 }).errors).toHaveLength(1);
    expect(
      computeCapacity({ window, rules: [{ ...rules[0]!, weekdays: [0] }], exclusions: [], requiredClasses: 1 }).verdict,
    ).toBe('not_assessed');
    const overlapping = computeCapacity({ window, rules: [...rules, { ...rules[0]!, label: 'dup' }], exclusions: [], requiredClasses: 1 });
    expect(overlapping.errors[0]).toMatch(/Regular rules overlap/);
    const orphanExtra = computeCapacity({
      window,
      rules: [{ label: 'Sat extra', periodStart: '2027-04-05', periodEnd: '2027-04-11', weekdays: [6], slotsPerDay: 1, kind: 'extra' }],
      exclusions: [],
      requiredClasses: 1,
    });
    expect(orphanExtra.errors[0]).toMatch(/no regular teaching rule/);
  });
});
