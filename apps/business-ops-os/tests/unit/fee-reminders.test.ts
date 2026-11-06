/** Fee reminders (F4-04): which reminder an instalment is due on a day, and the Proposed settings. */
import { describe, expect, it } from 'vitest';
import { resolveSettings } from '../../src/domain';
import type { IsoDate } from '../../src/domain/dates';
import { feeReminderDue } from '../../src/domain/policies-jobs';

const DUE = '2026-12-10' as IsoDate;
const DAYS = [-3, 0, 7, 15];

describe('feeReminderDue (due 10 Dec, reminders 3 days before, on the day, 7 and 15 days after)', () => {
  it.each([
    ['2026-12-06', null],
    ['2026-12-07', { offset: -3, until: '2026-12-10' }],
    ['2026-12-09', { offset: -3, until: '2026-12-10' }], // a missed day is caught up
    ['2026-12-10', { offset: 0, until: '2026-12-17' }],
    ['2026-12-16', { offset: 0, until: '2026-12-17' }],
    ['2026-12-17', { offset: 7, until: '2026-12-25' }],
    ['2026-12-25', { offset: 15, until: '2027-01-01' }],
    ['2026-12-31', { offset: 15, until: '2027-01-01' }], // the last one up to a week late
    ['2027-01-01', null],
  ])('on %s → %j', (today, want) => {
    expect(feeReminderDue(DUE, today as IsoDate, DAYS)).toEqual(want);
  });

  it('takes the days in any order, a repeated day once', () => {
    expect(feeReminderDue(DUE, '2026-12-11' as IsoDate, [7, 0, 0, -3])).toEqual({
      offset: 0,
      until: '2026-12-17',
    });
  });
});

it('the reminder days are Proposed and the job starts off, once a day', () => {
  const s = resolveSettings([]);
  expect(s['fees.reminders']).toMatchObject({
    value: { reminderDays: [-3, 0, 7, 15] },
    decisionState: 'proposed',
  });
  expect(s['jobs.fee-reminders'].value).toEqual({ enabled: false, everyMinutes: 1440 });
});
