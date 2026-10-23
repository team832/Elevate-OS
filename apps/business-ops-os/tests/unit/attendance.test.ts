import { describe, expect, it } from 'vitest';
import {
  deriveDay,
  monthRange,
  parsePunchCsv,
  punchesByDay,
  reviewReasons,
  summariseDays,
  type DayInput,
  type Punch,
  type WeeklyPattern,
} from '../../src/domain/attendance';
import type { IsoDate } from '../../src/domain/dates';

const ist = (day: string, time: string) => new Date(`${day}T${time}:00+05:30`);
const nine = { start: '09:00', end: '17:00' };
const WEEK: WeeklyPattern = {
  mon: nine,
  tue: nine,
  wed: nine,
  thu: nine,
  fri: nine,
  sat: nine,
  sun: null,
};
const MON = '2026-10-19' as IsoDate;
const SUN = '2026-10-25' as IsoDate;
const TODAY = '2026-11-01' as IsoDate;
const RULES = { graceMinutes: 10, halfDayHours: 4, fullDayHours: 8 };
const p = (time: string, direction: Punch['direction'], day: string = MON): Punch => ({
  at: ist(day, time),
  direction,
});
const day = (over: Partial<DayInput> = {}): DayInput => ({
  date: MON,
  pattern: WEEK,
  holiday: false,
  onLeave: false,
  punches: [],
  ...over,
});

describe('deriveDay', () => {
  it.each([
    [
      'scheduled day, no punches, no decision → unmarked (never absent)',
      {},
      'unmarked',
      null,
      false,
    ],
    ['weekly off', { date: SUN }, 'weekly_off', null, false],
    ['no schedule known, no punches', { pattern: null }, 'unmarked', null, false],
    ['full day on time', { punches: [p('09:00', 'in'), p('17:00', 'out')] }, 'present', 0, false],
    [
      'exactly at grace is not late',
      { punches: [p('09:10', 'in'), p('17:30', 'out')] },
      'present',
      0,
      false,
    ],
    [
      'one minute past grace is late (minutes from start)',
      { punches: [p('09:11', 'in'), p('17:30', 'out')] },
      'present',
      11,
      false,
    ],
    [
      'between half and full hours → half day',
      { punches: [p('09:00', 'in'), p('13:00', 'out')] },
      'half_day',
      0,
      false,
    ],
    [
      'short day (under half-day hours) stays unmarked for HR',
      { punches: [p('09:00', 'in'), p('10:00', 'out')] },
      'unmarked',
      0,
      false,
    ],
    [
      'missing out-punch today → present with the exception flag',
      { punches: [p('09:05', 'in')] },
      'present',
      0,
      true,
    ],
    [
      'missing out-punch on a past day → unmarked for HR, never present',
      { finished: true, punches: [p('09:05', 'in')] },
      'unmarked',
      0,
      true,
    ],
    ['a proposed holiday is not applied', { proposedHoliday: true }, 'unmarked', null, false],
    ['out-punch only → unmarked', { punches: [p('17:00', 'out')] }, 'unmarked', null, false],
    [
      'holiday + punch → holiday, punches kept',
      { holiday: true, punches: [p('09:00', 'in'), p('17:00', 'out')] },
      'holiday',
      null,
      false,
    ],
    [
      'leave + punch → on leave',
      { onLeave: true, punches: [p('09:00', 'in'), p('17:00', 'out')] },
      'on_leave',
      0,
      false,
    ],
    ['leave on a weekly off → weekly off', { date: SUN, onLeave: true }, 'weekly_off', null, false],
  ] as const)('%s', (_name, over, status, late, missing) => {
    const d = deriveDay(day(over as Partial<DayInput>), RULES);
    expect(d.status).toBe(status);
    expect(d.lateMinutes).toBe(late);
    expect(d.missingCheckout).toBe(missing);
    expect(d.basis).toBe('computed');
  });

  it('keeps first in and last out', () => {
    const d = deriveDay(
      day({ punches: [p('13:00', 'out'), p('09:00', 'in'), p('12:00', 'in'), p('17:15', 'out')] }),
      RULES,
    );
    expect(d.firstIn).toEqual(ist(MON, '09:00'));
    expect(d.lastOut).toEqual(ist(MON, '17:15'));
    expect(d.status).toBe('present');
  });

  it('a schedule grace above zero overrides the setting', () => {
    const d = deriveDay(
      day({ punches: [p('09:20', 'in'), p('18:00', 'out')], graceMinutes: 30 }),
      RULES,
    );
    expect(d.lateMinutes).toBe(0);
  });

  it('an HR decision wins over the computed status and is never recomputed', () => {
    const decision = { status: 'absent' as const, note: 'Confirmed with the employee' };
    const before = deriveDay(day({ decision }), RULES);
    const after = deriveDay(
      day({ decision, punches: [p('09:00', 'in'), p('17:00', 'out')] }),
      RULES,
    );
    for (const d of [before, after]) {
      expect(d.status).toBe('absent');
      expect(d.basis).toBe('hr_decision');
    }
    expect(after.firstIn).toEqual(ist(MON, '09:00')); // raw facts still shown
  });
});

describe('punchesByDay', () => {
  it('an out-punch after midnight closes the previous day', () => {
    const tue = '2026-10-20';
    const days = punchesByDay([p('22:00', 'in'), p('01:30', 'out', tue), p('09:00', 'in', tue)]);
    expect(days.get(MON)?.map((x) => x.direction)).toEqual(['in', 'out']);
    expect(days.get(tue as IsoDate)?.map((x) => x.direction)).toEqual(['in']);
    expect(deriveDay(day({ pattern: null, punches: days.get(MON)! }), RULES).missingCheckout).toBe(
      false,
    );
  });

  it('an out-punch long after the last check-in stays on its own day', () => {
    const wed = '2026-10-21';
    const days = punchesByDay([p('09:00', 'in'), p('08:00', 'out', wed)]);
    expect(days.get(MON)?.length).toBe(1);
    expect(days.get(wed as IsoDate)?.length).toBe(1);
  });
});

describe('summariseDays and reviewReasons', () => {
  it('counts each kind; unmarked is not absence; no ranking or score', () => {
    const days = [
      deriveDay(day({ punches: [p('09:00', 'in'), p('17:00', 'out')] }), RULES),
      deriveDay(day({ date: '2026-10-20' as IsoDate }), RULES),
      deriveDay(day({ date: '2026-10-21' as IsoDate, holiday: true }), RULES),
      deriveDay(day({ date: '2026-10-22' as IsoDate, onLeave: true }), RULES),
      deriveDay(
        day({ date: '2026-10-23' as IsoDate, decision: { status: 'absent', note: null } }),
        RULES,
      ),
      deriveDay(
        day({
          date: '2026-10-24' as IsoDate,
          punches: [p('09:00', 'in', '2026-10-24'), p('13:30', 'out', '2026-10-24')],
        }),
        RULES,
      ),
      deriveDay(day({ date: SUN }), RULES),
    ];
    expect(summariseDays(days)).toEqual({
      scheduledWorkdays: 5,
      present: 1,
      halfDays: 1,
      leave: 1,
      holidays: 1,
      confirmedAbsences: 1,
      unmarked: 1,
      noSchedule: 0,
    });
    expect(days.map((d) => reviewReasons(d, TODAY))).toEqual([
      [],
      ['unmarked'],
      [],
      [],
      [],
      [],
      [],
    ]);
  });

  it('a past day without a check-out is reviewed as a missing check-out (not twice)', () => {
    const past = deriveDay(day({ finished: true, punches: [p('09:00', 'in')] }), RULES);
    expect(reviewReasons(past, TODAY)).toEqual(['missing_checkout']);
    expect(deriveDay(day({ proposedHoliday: true }), RULES).proposedHoliday).toBe(true);
  });

  it('without any schedule: working days unknown (null), nothing counted as unmarked', () => {
    const days = [MON, SUN].map((date) => deriveDay(day({ date, pattern: null }), RULES));
    expect(summariseDays(days)).toMatchObject({
      scheduledWorkdays: null,
      unmarked: 0,
      noSchedule: 2,
    });
  });

  it('flags a missing check-out but not an HR-decided day', () => {
    const open = deriveDay(day({ punches: [p('09:00', 'in')] }), RULES);
    expect(reviewReasons(open, TODAY)).toEqual(['missing_checkout']);
    expect(reviewReasons(open, MON)).toEqual([]); // the day is not over yet
    const decided = deriveDay(
      day({ decision: { status: 'present', note: null }, punches: [p('09:00', 'in')] }),
      RULES,
    );
    expect(reviewReasons(decided, TODAY)).toEqual([]);
  });

  it('monthRange', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});

describe('parsePunchCsv', () => {
  it('reads staff code, IST date-time and direction; reports bad rows by line', () => {
    const csv = [
      'Staff code,Date-time,Direction',
      'DEMO-T01,2026-10-19 09:02,in',
      '"DEMO-T01","2026-10-19T17:05:00+05:30",OUT',
      'DEMO-T02,19/10/2026 09:00,in',
      ',2026-10-19 09:00,in',
      'DEMO-T02,2026-10-19 09:00,sideways',
      '',
    ].join('\r\n');
    const out = parsePunchCsv(csv);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rows).toEqual([
      {
        line: 2,
        staffCode: 'DEMO-T01',
        at: ist(MON, '09:02').toISOString(),
        direction: 'in',
        errors: [],
      },
      {
        line: 3,
        staffCode: 'DEMO-T01',
        at: ist(MON, '17:05').toISOString(),
        direction: 'out',
        errors: [],
      },
      {
        line: 4,
        staffCode: 'DEMO-T02',
        at: null,
        direction: 'in',
        errors: ['Date-time must look like 2026-10-19 09:30 (IST)'],
      },
      {
        line: 5,
        staffCode: '',
        at: ist(MON, '09:00').toISOString(),
        direction: 'in',
        errors: ['Staff code is empty'],
      },
      {
        line: 6,
        staffCode: 'DEMO-T02',
        at: ist(MON, '09:00').toISOString(),
        direction: null,
        errors: ['Direction must be in or out'],
      },
    ]);
  });

  it.each([
    ['', 'The file is empty.'],
    ['name,when\nA,B', 'The first row must name the columns: Staff code, Date-time, Direction.'],
  ])('refuses a file without the columns: %j', (csv, error) => {
    expect(parsePunchCsv(csv)).toEqual({ ok: false, error });
  });
});
