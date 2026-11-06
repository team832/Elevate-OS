/** F4-12 leave balance rules (all Proposed): leave year, days, balance, over-balance, carry-forward. */
import { describe, expect, it } from 'vitest';
import {
  balanceText,
  carryProblem,
  leaveBalance,
  leaveDaysIn,
  leaveYear,
  leaveYearsOf,
  NO_ALLOWANCE,
  overBalanceBy,
  type LeaveBalance,
} from '../../src/domain/leave-balance';
import { leaveRange } from '../../src/domain/leave';
import { adjustmentBody, allowanceBody, leaveApplicationBody } from '../../src/server/attendance-schemas';

describe('leave year (Proposed April to March, IST dates)', () => {
  it.each([
    ['2026-03-31', 'april', '2025-04-01', '2026-03-31', '2025-26'],
    ['2026-04-01', 'april', '2026-04-01', '2027-03-31', '2026-27'],
    ['2027-02-28', 'april', '2026-04-01', '2027-03-31', '2026-27'],
    ['2026-01-01', 'january', '2026-01-01', '2026-12-31', '2026'],
    ['2028-02-29', 'march', '2027-03-01', '2028-02-29', '2027-28'],
  ] as const)('%s with a year from %s', (day, month, start, end, label) => {
    expect(leaveYear(day, month)).toEqual({ start, end, label });
  });

  it('leave across 31 Mar and 1 Apr counts in each year', () => {
    const l = { fromDate: '2026-03-30', toDate: '2026-04-02', dayPart: null };
    expect(leaveYearsOf(l, 'april').map((y) => [y.label, y.days])).toEqual([
      ['2025-26', 2],
      ['2026-27', 2],
    ]);
  });
});

describe('days of leave: calendar days, a half day 0.5', () => {
  it.each([
    ['one day', '2026-05-04', '2026-05-04', null, 1],
    ['three days', '2026-05-04', '2026-05-06', null, 3],
    ['a first half', '2026-05-04', '2026-05-04', 'first_half', 0.5],
    ['a second half', '2026-05-04', '2026-05-04', 'second_half', 0.5],
    ['clipped to the year', '2026-03-29', '2026-04-03', null, 3],
    ['outside the year', '2026-03-01', '2026-03-05', null, 0],
  ] as const)('%s', (_, fromDate, toDate, dayPart, days) => {
    expect(leaveDaysIn({ fromDate, toDate, dayPart }, '2026-04-01', '2027-03-31')).toBe(days);
  });
});

describe('balance = allowance + carried + adjustments − approved', () => {
  const carry = (days: number) => ({ kind: 'carry_forward' as const, days });
  const adjust = (days: number) => ({ kind: 'adjustment' as const, days });
  it.each([
    ['allowance only', false, 12, [], 0, 'set', 12, '12 days left of 12'],
    ['some taken', false, 12, [], 4.5, 'set', 7.5, '7.5 days left of 12'],
    ['carried and adjusted', false, 10, [carry(2), adjust(-1.5), adjust(0.5)], 3, 'set', 8, '8 days left of 11'],
    ['all used', false, 1, [], 1, 'set', 0, '0 days left of 1'],
    ['over (approved by HR under warn)', false, 1, [], 2, 'set', -1, '1 day over the 1 allowed'],
    ['no allowance: words, not 0', false, null, [carry(2)], 3, 'not_set', undefined, NO_ALLOWANCE],
    ['unpaid never uses a balance', true, 12, [], 5, 'unpaid', undefined, 'Does not use a balance'],
  ] as const)('%s', (_, unpaid, allowance, adjustments, taken, state, balance, text) => {
    const b = leaveBalance({ unpaid, allowance, adjustments, taken });
    expect(b.state).toBe(state);
    expect(b.taken).toBe(taken);
    expect(b.state === 'set' ? b.balance : undefined).toBe(balance);
    expect(balanceText(b)).toBe(text);
    expect(balanceText(b)).not.toMatch(/^0 days left of 0/);
  });
});

const set = (balance: number): LeaveBalance => ({
  state: 'set',
  allowance: balance,
  carried: 0,
  adjusted: 0,
  taken: 0,
  balance,
});

describe('over the balance: a warning for HR (Proposed), never for no allowance or unpaid', () => {
  it.each([
    ['fits', set(5), 3, 0],
    ['exactly', set(3), 3, 0],
    ['a half day over', set(2.5), 3, 0.5],
    ['already below zero: only these days', set(-1), 2, 2],
    ['no allowance set', { state: 'not_set', taken: 4 } as LeaveBalance, 30, 0],
    ['unpaid', { state: 'unpaid', taken: 4 } as LeaveBalance, 30, 0],
    ['type not in the list', undefined, 30, 0],
  ] as const)('%s', (_, b, days, over) => {
    expect(overBalanceBy(b, days)).toBe(over);
  });
});

describe('carry-forward: within the cap (Proposed 0) and what was left', () => {
  it.each([
    ['cap 0 refuses any', 1, 0, set(5), /allows 0 days/],
    ['over the cap', 4, 3, set(5), /At most 3 days/],
    ['nothing set the year before', 1, 5, { state: 'not_set', taken: 0 } as LeaveBalance, /nothing to carry/],
    ['more than was left', 3, 5, set(2), /only 2 days left/],
    ['within both', 2, 5, set(2), null],
    ['half a day', 0.5, 1, set(0.5), null],
  ] as const)('%s', (_, days, cap, before, problem) => {
    const p = carryProblem(days, cap, before);
    if (problem) expect(p).toMatch(problem);
    else expect(p).toBeNull();
  });
});

describe('forms refuse what the database would round or refuse (0020 numeric(5,1))', () => {
  const staffId = '00000000-0000-4000-8000-000000000001';
  const allowance = { leaveType: 'Casual', yearStart: '2026-04-01', staffId };
  const adjustment = { ...allowance, kind: 'adjustment', reason: 'Sample correction' };
  it.each([
    ['allowance 1.46', allowanceBody, { ...allowance, days: 1.46 }, 'days', /whole or half days/],
    ['allowance 0.25', allowanceBody, { ...allowance, days: 0.25 }, 'days', /whole or half days/],
    ['allowance below 0', allowanceBody, { ...allowance, days: -1 }, 'days', /At least 0/],
    ['allowance for a person and a role', allowanceBody, { ...allowance, days: 1, role: 'teacher' }, 'staffId', /one staff member or one role/],
    ['adjustment 1.46', adjustmentBody, { ...adjustment, days: 1.46 }, 'days', /whole or half days/],
    ['adjustment 0', adjustmentBody, { ...adjustment, days: 0 }, 'days', /minus number/],
    ['carry-forward 2.2', adjustmentBody, { ...adjustment, kind: 'carry_forward', days: 2.2 }, 'days', /whole or half days/],
    ['carry-forward below 0', adjustmentBody, { ...adjustment, kind: 'carry_forward', days: -1 }, 'days', /more than 0/],
    ['adjustment without a reason', adjustmentBody, { ...adjustment, days: 1, reason: ' ' }, 'reason', /Say why/],
    ['a half day over three days', leaveApplicationBody, { kind: 'Casual', fromDate: '2026-05-04', toDate: '2026-05-06', reason: 'Sample reason', dayPart: 'first_half' }, 'dayPart', /half day is one day/],
  ] as const)('%s', (_, schema, body, path, message) => {
    const r = schema.safeParse(body);
    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.path.join('.') === path);
    expect(issue?.message).toMatch(message);
  });

  it.each([
    [allowanceBody, { ...allowance, days: 7.5 }],
    [adjustmentBody, { ...adjustment, days: -1.5 }],
    [leaveApplicationBody, { kind: 'Casual', fromDate: '2026-05-04', toDate: '2026-05-04', reason: 'Sample reason', dayPart: 'second_half' }],
  ] as const)('accepts half steps and a one-day half day %#', (schema, body) => {
    expect(schema.safeParse(body).success).toBe(true);
  });
});

it('a half day reads as words', () => {
  expect(leaveRange('2026-11-02', '2026-11-02', 'first_half')).toBe('2 Nov 2026 (first half)');
});
