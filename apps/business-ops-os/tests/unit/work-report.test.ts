import { describe, expect, it } from 'vitest';
import type { IsoDate } from '../../src/domain/dates';
import {
  expectation,
  onTimeRate,
  periodLabel,
  periodOf,
  reportDeadline,
  reportStanding,
  reviewTurnaround,
  type DueTask,
  type Period,
} from '../../src/domain/work-report';

const ist = (day: string, time: string) => new Date(`${day}T${time}:00+05:30`);
const d = (s: string) => s as IsoDate;
const WEEK: Period = { kind: 'week', start: d('2026-10-19'), end: d('2026-10-25') };

describe('A-REP-1 periods and deadlines', () => {
  it.each([
    ['day', '2026-10-21', 'monday', '2026-10-21', '2026-10-21'],
    ['week', '2026-10-21', 'monday', '2026-10-19', '2026-10-25'],
    ['week', '2026-10-19', 'monday', '2026-10-19', '2026-10-25'],
    ['week', '2026-10-21', 'saturday', '2026-10-17', '2026-10-23'],
    ['week', '2026-10-18', 'sunday', '2026-10-18', '2026-10-24'],
    ['month', '2026-02-14', 'monday', '2026-02-01', '2026-02-28'],
    ['month', '2026-12-31', 'monday', '2026-12-01', '2026-12-31'],
  ] as const)('%s containing %s (week starts %s) = %s..%s', (kind, day, ws, start, end) => {
    expect(periodOf(kind, d(day), ws)).toEqual({ kind, start, end });
  });

  it('labels', () => {
    expect(periodLabel(WEEK)).toBe('Week 19 Oct 2026 – 25 Oct 2026');
    expect(periodLabel(periodOf('month', d('2026-10-05')))).toBe('October 2026');
  });

  it.each([
    ['no deadline set', WEEK, {}, null],
    [
      'weekly: first Monday on or after the last day',
      WEEK,
      { week: { day: 'monday', time: '10:00' } },
      ist('2026-10-26', '10:00'),
    ],
    [
      'weekly: the last day itself',
      WEEK,
      { week: { day: 'sunday', time: '18:00' } },
      ist('2026-10-25', '18:00'),
    ],
    [
      'monthly: day 3 of the next month',
      periodOf('month', d('2026-10-09')),
      { month: { dayOfNextMonth: 3, time: '17:00' } },
      ist('2026-11-03', '17:00'),
    ],
    [
      'EOD: that time on the day',
      periodOf('day', d('2026-10-21')),
      { day: '19:30' },
      ist('2026-10-21', '19:30'),
    ],
  ] as const)('%s', (_n, p, s, want) => {
    expect(reportDeadline(p, { day: null, week: null, month: null, ...s })).toEqual(want);
  });

  const due = ist('2026-10-26', '10:00');
  const sent = (
    status: 'draft' | 'submitted' | 'acknowledged',
    at: Date | null,
    d: Date | null,
  ) => ({
    status,
    firstSubmittedAt: at,
    deadlineAtSubmit: d,
  });
  it.each([
    [
      'not started, before the deadline',
      null,
      ist('2026-10-26', '09:00'),
      due,
      true,
      'not_started',
      false,
    ],
    [
      'draft after the deadline → Missing',
      sent('draft', null, null),
      ist('2026-10-26', '10:01'),
      due,
      true,
      'missing',
      false,
    ],
    [
      'nothing after the period, no deadline → Missing',
      null,
      ist('2026-10-26', '00:00'),
      null,
      true,
      'missing',
      false,
    ],
    [
      'leave or holidays all week → never Missing',
      null,
      ist('2026-10-27', '00:00'),
      due,
      false,
      'not_expected',
      false,
    ],
    [
      'no work schedule → unknown, never Missing',
      null,
      ist('2026-10-27', '00:00'),
      due,
      null,
      'no_schedule',
      false,
    ],
    [
      'submitted exactly at the deadline is not late',
      sent('submitted', due, due),
      ist('2026-10-27', '00:00'),
      due,
      true,
      'submitted',
      false,
    ],
    [
      'first submitted after the deadline is late, even when reviewed',
      sent('acknowledged', ist('2026-10-26', '11:00'), due),
      ist('2026-10-28', '00:00'),
      due,
      true,
      'acknowledged',
      true,
    ],
    [
      'a deadline set after submission never makes it late',
      sent('submitted', ist('2026-10-26', '11:00'), null),
      ist('2026-10-28', '00:00'),
      due,
      true,
      'submitted',
      false,
    ],
    [
      'weekly without a deadline is never late',
      sent('submitted', ist('2026-11-20', '11:00'), null),
      ist('2026-11-28', '00:00'),
      null,
      true,
      'submitted',
      false,
    ],
    [
      'older version without a stored deadline: judged by the deadline from settings',
      {
        status: 'submitted',
        firstSubmittedAt: ist('2026-10-26', '11:00'),
        deadlineAtSubmit: undefined,
      },
      ist('2026-10-28', '00:00'),
      due,
      true,
      'submitted',
      true,
    ],
  ] as const)('%s', (_n, r, now, deadline, expected, standing, late) => {
    expect(reportStanding(r, WEEK, deadline, now, expected)).toEqual({ standing, late });
  });

  const wd = (scheduled: boolean | null, status = 'unmarked') => ({ scheduled, status });
  it.each([
    ['one scheduled workday is enough', [wd(false, 'weekly_off'), wd(true)], true],
    ['approved leave all week', [wd(true, 'on_leave'), wd(false, 'weekly_off')], false],
    ['approved holiday and weekly off', [wd(true, 'holiday'), wd(false, 'weekly_off')], false],
    ['no schedule known on any day', [wd(null), wd(null)], null],
    ['no days at all (period not started)', [], false],
  ] as const)('expectation: %s', (_n, days, want) => {
    expect(expectation(days)).toBe(want);
  });
});

const task = (id: string, over: Partial<DueTask> = {}): DueTask => ({
  taskId: id,
  title: `Sample ${id}`,
  status: 'in_review',
  dueOn: '2026-10-23',
  dueTime: '17:00',
  originalDueOn: '2026-10-23',
  originalDueTime: '17:00',
  firstSubmittedAt: null,
  dueAtSubmission: null,
  dueChangeReason: null,
  ...over,
});
const at = ist('2026-10-23', '17:00');
const original = { dueOn: '2026-10-23', dueTime: '17:00' };

describe('A-REP-2 on-time submission rate', () => {
  it.each([
    [
      'submitted exactly at the deadline',
      task('a', { firstSubmittedAt: at, dueAtSubmission: original }),
      'on_time',
    ],
    [
      'one minute late',
      task('a', { firstSubmittedAt: ist('2026-10-23', '17:01'), dueAtSubmission: original }),
      'late',
    ],
    [
      'deadline moved later AFTER a late submission stays late',
      task('a', {
        dueOn: '2026-10-24',
        firstSubmittedAt: ist('2026-10-23', '18:00'),
        dueAtSubmission: original,
      }),
      'late',
    ],
    [
      'deadline moved later BEFORE submitting: the deadline then in force applies',
      task('a', {
        dueOn: '2026-10-24',
        firstSubmittedAt: ist('2026-10-24', '09:00'),
        dueAtSubmission: { dueOn: '2026-10-24', dueTime: '17:00' },
      }),
      'on_time',
    ],
    ['never submitted stays in the denominator', task('a'), 'not_submitted'],
    [
      'approved the next week: approval never changes it',
      task('a', {
        status: 'done',
        firstSubmittedAt: ist('2026-10-22', '12:00'),
        dueAtSubmission: original,
      }),
      'on_time',
    ],
    [
      'no due time: the end of the due day',
      task('a', {
        dueTime: null,
        originalDueTime: null,
        firstSubmittedAt: ist('2026-10-23', '23:59'),
        dueAtSubmission: { dueOn: '2026-10-23', dueTime: null },
      }),
      'on_time',
    ],
  ])('%s', (_n, t, outcome) => {
    const r = onTimeRate([t], WEEK);
    expect(r.eligible).toBe(1);
    expect(r.rows[0]!.outcome).toBe(outcome);
    expect(r.rate).toBe(outcome === 'on_time' ? 1 : 0);
  });

  it('cancelled and draft tasks are excluded and listed; tasks due outside the period are ignored', () => {
    const r = onTimeRate(
      [
        task('ok', { firstSubmittedAt: at, dueAtSubmission: original, status: 'done' }),
        task('never'),
        task('gone', { status: 'cancelled' }),
        task('draft', { status: 'draft' }),
        task('next', { dueOn: '2026-10-26' }),
      ],
      WEEK,
    );
    expect(r).toMatchObject({ eligible: 2, onTime: 1, notSubmitted: 1, delivered: 1, rate: 0.5 });
    expect(r.excluded.map((x) => [x.taskId, x.why])).toEqual([
      ['gone', 'Cancelled'],
      ['draft', 'Draft, not assigned'],
    ]);
  });

  it('lists deadline revisions (original → current) instead of silently improving the rate', () => {
    const r = onTimeRate(
      [task('m', { dueOn: '2026-10-24', dueTime: null, dueChangeReason: 'Parent meeting moved' })],
      WEEK,
    );
    expect(r.revisions).toEqual([
      {
        taskId: 'm',
        title: 'Sample m',
        from: '2026-10-23 17:00',
        to: '2026-10-24',
        reason: 'Parent meeting moved',
      },
    ]);
  });

  it('nothing due: the rate is unknown, not 0', () => {
    expect(onTimeRate([], WEEK).rate).toBeNull();
  });
});

describe('A-REP-3 reviewer turnaround', () => {
  it('median hours of decided submissions; waiting counted apart', () => {
    const s = ist('2026-10-20', '10:00');
    const h = (n: number) => new Date(s.getTime() + n * 3_600_000);
    expect(
      reviewTurnaround([
        { taskId: 'a', title: 'a', submittedAt: s, decidedAt: h(2) },
        { taskId: 'b', title: 'b', submittedAt: s, decidedAt: h(5) },
        { taskId: 'c', title: 'c', submittedAt: s, decidedAt: null },
      ]),
    ).toEqual({ decided: 2, waiting: 1, medianHours: 3.5 });
    expect(reviewTurnaround([]).medianHours).toBeNull();
  });
});
