import { describe, expect, it } from 'vitest';
import {
  OPS_EOD_REVIEW_EVENT_KINDS,
  OPS_EOD_STATUSES,
  OPS_TASK_EVENT_KINDS,
  OPS_TASK_PRIORITIES,
  OPS_TASK_RECURRENCES,
  OPS_TASK_SOURCES,
  OPS_TASK_STATUSES,
} from '@elevate/database';
import {
  buildEodSnapshot,
  EOD_REVIEW_EVENT_KINDS,
  EOD_STATUSES,
  isOverdue,
  missingReasons,
  nextOccurrence,
  resolveTaskState,
  submittedOnTime,
  TASK_EVENT_KINDS,
  taskStatusLabel,
  TASK_PRIORITIES,
  TASK_RECURRENCES,
  TASK_SOURCES,
  TASK_STATUSES,
  type EodTask,
  type TaskState,
} from '../../src/domain/staff-tasks';

const ist = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`);

describe('staff task vocabularies match the database', () => {
  it.each([
    ['task statuses', TASK_STATUSES, OPS_TASK_STATUSES],
    ['priorities', TASK_PRIORITIES, OPS_TASK_PRIORITIES],
    ['recurrences', TASK_RECURRENCES, OPS_TASK_RECURRENCES],
    ['task sources', TASK_SOURCES, OPS_TASK_SOURCES],
    ['task event kinds', TASK_EVENT_KINDS, OPS_TASK_EVENT_KINDS],
    ['EOD statuses', EOD_STATUSES, OPS_EOD_STATUSES],
    ['EOD review event kinds', EOD_REVIEW_EVENT_KINDS, OPS_EOD_REVIEW_EVENT_KINDS],
  ] as const)('%s', (_, app, db) => {
    expect([...app]).toEqual([...db]);
  });
});

describe('A-TSK-1 task status rules', () => {
  const pending: TaskState = { status: 'pending', progressPercent: 30, reason: null };
  const blocked: TaskState = {
    status: 'cancelled',
    progressPercent: 30,
    reason: 'Waiting for fee slip',
  };
  it.each<[string, TaskState | null, Partial<TaskState>, Partial<TaskState> | null, string | null]>(
    [
      [
        'new task defaults to pending at 0%',
        null,
        {},
        { status: 'pending', progressPercent: 0 },
        null,
      ],
      [
        'done forces 100%',
        pending,
        { status: 'done', progressPercent: 40 },
        { progressPercent: 100 },
        null,
      ],
      ['cancelled without a reason is refused', pending, { status: 'cancelled' }, null, 'reason'],
      [
        'cancelled with a blank reason is refused',
        pending,
        { status: 'cancelled', reason: '  ' },
        null,
        'reason',
      ],
      [
        'cancelled with a reason is accepted',
        pending,
        { status: 'cancelled', reason: ' Parent away ' },
        { reason: 'Parent away' },
        null,
      ],
      [
        'progress change keeps the reason',
        blocked,
        { progressPercent: 50 },
        { status: 'cancelled', reason: 'Waiting for fee slip' },
        null,
      ],
      [
        'clearing the reason of a cancelled task is refused',
        blocked,
        { reason: null },
        null,
        'reason',
      ],
      [
        'reopening a task keeps its progress unless given',
        { status: 'done', progressPercent: 100, reason: null },
        { status: 'in_progress', progressPercent: 80 },
        { status: 'in_progress', progressPercent: 80 },
        null,
      ],
      [
        'a status change drops the old reason unless one is given again',
        { status: 'pending', progressPercent: 0, reason: 'Continuing tomorrow' },
        { status: 'in_progress' },
        { status: 'in_progress', reason: null },
        null,
      ],
      [
        'done clears the reason',
        blocked,
        { status: 'done', reason: 'Waiting for fee slip' },
        { status: 'done', reason: null },
        null,
      ],
      [
        'a reason on an open task is kept (EOD "not done" reason)',
        pending,
        { reason: 'Call not answered' },
        { status: 'pending', reason: 'Call not answered' },
        null,
      ],
    ],
  )('%s', (_name, cur, patch, expected, errorField) => {
    const r = resolveTaskState(cur, patch);
    expect(r.error?.field ?? null).toBe(errorField);
    if (expected) expect(r.state).toMatchObject(expected);
  });
});

describe('A-TSK-2 overdue (IST)', () => {
  it.each<[string, Pick<EodTask, 'status' | 'dueOn' | 'dueTime'>, Date, boolean]>([
    [
      'due today, no time, during the day',
      { status: 'pending', dueOn: '2026-10-21', dueTime: null },
      ist('2026-10-21', '23:59'),
      false,
    ],
    [
      'due yesterday, no time',
      { status: 'pending', dueOn: '2026-10-20', dueTime: null },
      ist('2026-10-21', '00:00'),
      true,
    ],
    [
      'due today 10:30, now 10:29',
      { status: 'in_progress', dueOn: '2026-10-21', dueTime: '10:30:00' },
      ist('2026-10-21', '10:29'),
      false,
    ],
    [
      'due today 10:30, now 10:30 (at the deadline is not late)',
      { status: 'in_progress', dueOn: '2026-10-21', dueTime: '10:30' },
      ist('2026-10-21', '10:30'),
      false,
    ],
    [
      'due today 10:30, now 10:31',
      { status: 'in_progress', dueOn: '2026-10-21', dueTime: '10:30' },
      ist('2026-10-21', '10:31'),
      true,
    ],
    [
      'no time: 23:59 IST is the deadline, 00:00 next day is late',
      { status: 'pending', dueOn: '2026-10-21', dueTime: null },
      ist('2026-10-22', '00:00'),
      true,
    ],
    [
      'done is never overdue',
      { status: 'done', dueOn: '2026-10-01', dueTime: null },
      ist('2026-10-21', '12:00'),
      false,
    ],
    [
      'changes requested past its deadline is overdue',
      { status: 'changes_requested', dueOn: '2026-10-19', dueTime: '18:00' },
      ist('2026-10-20', '09:00'),
      true,
    ],
    [
      'submitted is never overdue (R5)',
      { status: 'in_review', dueOn: '2026-10-19', dueTime: null },
      ist('2026-10-21', '09:00'),
      false,
    ],
    [
      'a draft is never overdue',
      { status: 'draft', dueOn: '2026-10-19', dueTime: null },
      ist('2026-10-21', '09:00'),
      false,
    ],
  ])('%s', (_name, task, now, expected) => {
    expect(isOverdue(task, now)).toBe(expected);
  });
});

describe('A-TSK-3 next occurrence (anchor day, month-end clamp)', () => {
  it.each<[string, 'none' | 'daily' | 'weekly' | 'monthly', string | null, string | null]>([
    ['2026-10-21', 'none', null, null],
    ['2026-10-31', 'daily', null, '2026-11-01'],
    ['2026-12-29', 'weekly', null, '2027-01-05'],
    ['2026-10-15', 'monthly', null, '2026-11-15'],
    ['2026-01-31', 'monthly', null, '2026-02-28'],
    ['2028-01-31', 'monthly', null, '2028-02-29'],
    ['2026-03-31', 'monthly', null, '2026-04-30'],
    ['2026-12-31', 'monthly', null, '2027-01-31'],
    ['2026-02-28', 'monthly', '2026-01-31', '2026-03-31'],
    ['2028-02-29', 'monthly', '2028-01-31', '2028-03-31'],
    ['2026-04-30', 'monthly', '2026-03-31', '2026-05-31'],
    ['2026-02-28', 'monthly', '2026-01-30', '2026-03-30'],
    ['2026-02-28', 'monthly', '2026-01-28', '2026-03-28'],
    ['2026-06-15', 'monthly', '2026-05-31', '2026-07-15'],
  ])('%s %s (previous %s) → %s', (dueOn, recurrence, prev, expected) => {
    expect(nextOccurrence(dueOn, recurrence, prev)).toBe(expected);
  });
});

describe('A-TSK-4 EOD snapshot', () => {
  const day = '2026-10-21';
  const base = {
    details: null,
    progressPercent: 0,
    reason: null,
    dueTime: null,
    completedAt: null,
  };
  const tasks: EodTask[] = [
    {
      ...base,
      id: 'a',
      title: 'Done today',
      priority: 'low',
      status: 'done',
      dueOn: day,
      progressPercent: 100,
      completedAt: ist(day, '11:00'),
    },
    {
      ...base,
      id: 'b',
      title: 'Done yesterday',
      priority: 'high',
      status: 'done',
      dueOn: '2026-10-20',
      progressPercent: 100,
      completedAt: ist('2026-10-20', '17:00'),
    },
    {
      ...base,
      id: 'c',
      title: 'Open, due 10:00',
      priority: 'medium',
      status: 'in_progress',
      dueOn: day,
      dueTime: '10:00:00',
      progressPercent: 60,
    },
    {
      ...base,
      id: 'd',
      title: 'Open, high, no time',
      priority: 'high',
      status: 'pending',
      dueOn: day,
      reason: 'Waiting for call back',
    },
    {
      ...base,
      id: 'e',
      title: 'Carried from Monday',
      priority: 'low',
      status: 'in_progress',
      dueOn: '2026-10-19',
      reason: 'Parent away',
    },
    {
      ...base,
      id: 'f',
      title: 'Due tomorrow',
      priority: 'high',
      status: 'pending',
      dueOn: '2026-10-22',
    },
    {
      ...base,
      id: 'g',
      title: 'Done early for a later day',
      priority: 'medium',
      status: 'done',
      dueOn: '2026-10-25',
      progressPercent: 100,
      completedAt: ist(day, '09:00'),
    },
  ];
  const snap = buildEodSnapshot(tasks, day, ist(day, '19:00'));

  it('groups done today, still open today, carried forward; ignores other days', () => {
    expect(snap.done.map((t) => t.id)).toEqual(['g', 'a']);
    expect(snap.open.map((t) => t.id)).toEqual(['d', 'c']);
    expect(snap.carried.map((t) => t.id)).toEqual(['e']);
    expect(snap.counts).toEqual({ done: 2, open: 2, carried: 1, overdue: 2 });
  });

  it('marks overdue as at the report time and keeps reasons', () => {
    expect(snap.open.find((t) => t.id === 'c')).toMatchObject({
      overdue: true,
      progressPercent: 60,
    });
    expect(snap.open.find((t) => t.id === 'd')).toMatchObject({
      overdue: false,
      reason: 'Waiting for call back',
    });
    expect(snap.carried[0]).toMatchObject({ overdue: true, reason: 'Parent away' });
  });

  it('a past day is judged at the end of that day, not now', () => {
    const past = buildEodSnapshot(tasks, '2026-10-19', ist('2026-10-21', '19:00'));
    expect(past.open.map((t) => t.id)).toEqual(['e']);
    expect(past.open[0]!.overdue).toBe(false);
  });

  it('lists tasks still not done that have no reason (submit needs one each)', () => {
    expect(missingReasons(snap).map((t) => t.id)).toEqual(['c']);
  });
});

describe('R4 labels and R5 on-time submission', () => {
  it.each([
    ['pending', false, 'Assigned'],
    ['in_review', true, 'Submitted'],
    ['changes_requested', true, 'Changes requested'],
    ['done', true, 'Approved'],
    ['done', false, 'Done'],
    ['draft', false, 'Draft'],
  ] as const)('%s (review %s) reads "%s"', (status, review, label) => {
    expect(taskStatusLabel(status, review)).toBe(label);
  });

  const t = { originalDueOn: '2026-10-24', originalDueTime: '17:00' };
  const moved = (at: string, toDueOn: string, toDueTime: string | null) => ({
    occurredAt: new Date(at),
    data: { toDueOn, toDueTime },
  });
  it.each([
    ['not submitted yet', null, [], null],
    ['before the original deadline', '2026-10-24T16:59:00+05:30', [], true],
    ['after the original deadline', '2026-10-24T17:01:00+05:30', [], false],
    [
      'judged on the deadline in force when first submitted (extended earlier)',
      '2026-10-25T10:00:00+05:30',
      [moved('2026-10-23T09:00:00+05:30', '2026-10-26', null)],
      true,
    ],
    [
      'a later extension does not excuse a late first submission',
      '2026-10-25T10:00:00+05:30',
      [moved('2026-10-26T09:00:00+05:30', '2026-10-30', null)],
      false,
    ],
  ] as const)('%s', (_n, first, changes, expected) => {
    expect(
      submittedOnTime({ ...t, firstSubmittedAt: first ? new Date(first) : null }, changes),
    ).toBe(expected);
  });
});
