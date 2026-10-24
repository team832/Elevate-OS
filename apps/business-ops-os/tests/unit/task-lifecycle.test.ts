import { describe, expect, it } from 'vitest';
import {
  isSelfLogged,
  allowedActions,
  createsCycle,
  currentEntries,
  decide,
  overlapWarnings,
  taskTimeSummary,
  type LifecycleTask,
  type TaskAction,
  nextAction,
  type TaskRole,
} from '../../src/domain/task-lifecycle';
import type { TaskStatus } from '../../src/domain/staff-tasks';
import { eventDetail, fmtDuration } from '../../src/domain/task-report';

const task = (status: TaskStatus, more: Partial<LifecycleTask> = {}): LifecycleTask => ({
  status,
  reviewRequired: false,
  acknowledged: true,
  blocked: false,
  selfLogged: false,
  ...more,
});
const as = (...roles: TaskRole[]) => ({ roles, closedBy: 'owner' as const });

describe('A-TSK-5 task lifecycle', () => {
  it.each<[string, TaskAction, LifecycleTask, TaskRole[], string | null, TaskStatus | null]>([
    ['owner starts', 'start', task('pending'), ['owner'], null, 'in_progress'],
    ['manager starts for a report', 'start', task('pending'), ['manager'], null, 'in_progress'],
    [
      'owner acknowledges, status unchanged',
      'acknowledge',
      task('pending', { acknowledged: false }),
      ['owner'],
      null,
      null,
    ],
    [
      'owner submits a reviewed task',
      'submit',
      task('in_progress', { reviewRequired: true }),
      ['owner'],
      null,
      'in_review',
    ],
    [
      'reviewer approves',
      'approve',
      task('in_review', { reviewRequired: true }),
      ['reviewer'],
      null,
      'done',
    ],
    [
      'all-scope manager approves',
      'approve',
      task('in_review', { reviewRequired: true }),
      ['admin'],
      null,
      'done',
    ],
    [
      'reviewer requests changes',
      'request_changes',
      task('in_review', { reviewRequired: true }),
      ['reviewer'],
      'Add receipts',
      'changes_requested',
    ],
    [
      'owner responds to changes (resubmits)',
      'submit',
      task('changes_requested', { reviewRequired: true }),
      ['owner'],
      null,
      'in_review',
    ],
    [
      'owner marks blocked: status kept (R4)',
      'block',
      task('in_progress'),
      ['owner'],
      'Room',
      null,
    ],
    ['manager assigns a draft', 'publish', task('draft'), ['creator'], null, 'pending'],
    [
      'reviewer reopens an approved task (setting tasks.reopen_roles)',
      'reopen',
      task('done', { reviewRequired: true }),
      [],
      'Answer key wrong',
      'in_progress',
    ],
    ['owner completes a no-review task', 'complete', task('in_progress'), ['owner'], null, 'done'],
    [
      'owner completes straight from not started',
      'complete',
      task('pending'),
      ['owner'],
      null,
      'done',
    ],
    [
      'clear a blocker: status kept',
      'resume',
      task('in_progress', { blocked: true }),
      ['owner'],
      null,
      null,
    ],
    ['reopen a done task', 'reopen', task('done'), ['owner'], 'Parent called back', 'in_progress'],
    [
      'a manager reopens a cancelled task',
      'reopen',
      task('cancelled'),
      ['manager'],
      'Needed after all',
      'in_progress',
    ],
    [
      'owner cancels own self-assigned task',
      'cancel',
      task('pending', { selfLogged: true }),
      ['owner'],
      'Duplicate',
      'cancelled',
    ],
  ])('%s', (_, action, t, roles, reason, to) => {
    const ctx = { ...as(...roles), mayReopenApproved: true };
    expect(decide(action, t, ctx, reason)).toMatchObject({ ok: true, to });
  });

  it.each<
    [string, TaskAction, LifecycleTask, TaskRole[], string | null, 'forbidden' | 'state' | 'reason']
  >([
    [
      'owner cannot approve own work',
      'approve',
      task('in_review', { reviewRequired: true }),
      ['owner'],
      null,
      'forbidden',
    ],
    [
      'a chain manager cannot close a reviewed task',
      'approve',
      task('in_review', { reviewRequired: true }),
      ['manager'],
      null,
      'forbidden',
    ],
    [
      'owner cannot mark a reviewed task done',
      'complete',
      task('in_progress', { reviewRequired: true }),
      ['owner'],
      null,
      'state',
    ],
    ['no review step: submit refused', 'submit', task('in_progress'), ['owner'], null, 'state'],
    [
      'submit needs the work started',
      'submit',
      task('pending', { reviewRequired: true }),
      ['owner'],
      null,
      'state',
    ],
    [
      'request changes needs a reason',
      'request_changes',
      task('in_review', { reviewRequired: true }),
      ['reviewer'],
      ' ',
      'reason',
    ],
    ['block needs a reason', 'block', task('in_progress'), ['owner'], null, 'reason'],
    ['hold needs a reason', 'hold', task('in_progress'), ['owner'], null, 'reason'],
    ['cancel needs a reason', 'cancel', task('pending'), ['creator'], null, 'reason'],
    [
      'a manager of the owner cannot cancel assigned work',
      'cancel',
      task('pending'),
      ['manager'],
      'x',
      'forbidden',
    ],
    ['reopen needs a reason', 'reopen', task('done'), ['owner'], null, 'reason'],
    [
      'owner cannot cancel assigned work',
      'cancel',
      task('pending'),
      ['owner'],
      'No longer needed',
      'forbidden',
    ],
    ['acknowledging twice is refused', 'acknowledge', task('pending'), ['owner'], null, 'state'],
    [
      'only the recipient acknowledges',
      'acknowledge',
      task('pending', { acknowledged: false }),
      ['manager'],
      null,
      'forbidden',
    ],
    ['a stranger cannot start', 'start', task('pending'), [], null, 'forbidden'],
    ['done cannot be started again', 'start', task('done'), ['owner'], null, 'state'],
    [
      'submit refused while blocked',
      'submit',
      task('in_progress', { reviewRequired: true, blocked: true }),
      ['owner'],
      null,
      'state',
    ],
    [
      'blocking twice is refused',
      'block',
      task('in_progress', { blocked: true }),
      ['owner'],
      'x',
      'state',
    ],
    [
      'an approved task is reopened only per tasks.reopen_roles',
      'reopen',
      task('done', { reviewRequired: true }),
      ['owner', 'manager', 'admin'],
      'x',
      'forbidden',
    ],
    ['the assignee cannot assign a draft', 'publish', task('draft'), ['owner'], null, 'forbidden'],
    [
      'a submitted task cannot be submitted again',
      'submit',
      task('in_review', { reviewRequired: true }),
      ['owner'],
      null,
      'state',
    ],
  ])('%s', (_, action, t, roles, reason, code) => {
    expect(decide(action, t, as(...roles), reason)).toMatchObject({ ok: false, code });
  });

  it('closedBy=manager: the owner can no longer close a no-review task, the manager can', () => {
    const ctx = (r: TaskRole) => ({ roles: [r], closedBy: 'manager' as const });
    expect(decide('complete', task('in_progress'), ctx('owner'))).toMatchObject({
      code: 'forbidden',
    });
    expect(decide('complete', task('in_progress'), ctx('manager'))).toMatchObject({ ok: true });
  });

  it('allowed actions follow status and role', () => {
    expect(allowedActions(task('pending', { acknowledged: false }), as('owner'))).toEqual([
      'acknowledge',
      'clarify',
      'start',
      'block',
      'hold',
      'comment',
      'complete',
    ]);
    expect(allowedActions(task('in_review', { reviewRequired: true }), as('reviewer'))).toEqual([
      'approve',
      'request_changes',
      'comment',
    ]);
  });

  it.each<[string, LifecycleTask, TaskRole[], boolean]>([
    [
      'the owner cannot reopen assigned work that was cancelled (I4)',
      task('cancelled'),
      ['owner'],
      false,
    ],
    ['the creator reopens cancelled work', task('cancelled'), ['creator'], true],
    ['a manager of the owner reopens cancelled work', task('cancelled'), ['manager'], true],
    [
      'the owner reopens their own self-logged cancelled work',
      task('cancelled', { selfLogged: true }),
      ['owner'],
      true,
    ],
  ])('%s', (_n, t, roles, ok) => {
    expect(decide('reopen', t, as(...roles), 'Needed after all').ok).toBe(ok);
  });

  it.each<[string, 'hr_and_reviewer_only' | 'allowed' | undefined, string[]]>([
    ['hr_and_reviewer_only (owner, 23 Oct 2026): read only', 'hr_and_reviewer_only', []],
    ['unset: the same as hr_and_reviewer_only', undefined, []],
    ['allowed: comment and nothing else (M1)', 'allowed', ['comment']],
  ])('tasks.peer_discussion %s', (_n, peerDiscussion, actions) => {
    expect(allowedActions(task('in_progress'), { ...as('collaborator'), peerDiscussion })).toEqual(
      actions,
    );
    expect(allowedActions(task('in_review'), { ...as('reviewer'), peerDiscussion })).toContain(
      'comment',
    );
  });
});

describe('My Tasks: the one next action (brief §18)', () => {
  it.each<[string, LifecycleTask, string | null]>([
    ['not acknowledged', task('pending', { acknowledged: false }), 'Acknowledge'],
    ['acknowledged', task('pending'), 'Start'],
    ['in progress, review', task('in_progress', { reviewRequired: true }), 'Submit'],
    ['in progress, no review', task('in_progress'), 'Mark done'],
    [
      'changes requested',
      task('changes_requested', { reviewRequired: true }),
      'Respond to changes',
    ],
    ['blocked', task('in_progress', { blocked: true }), 'Clear blocker'],
    ['submitted', task('in_review', { reviewRequired: true }), null],
    ['approved', task('done', { reviewRequired: true }), null],
    ['draft', task('draft'), null],
  ])('%s → %s', (_n, t, label) => {
    expect(nextAction(t)?.label ?? null).toBe(label);
  });

  it('respects tasks.completion_without_reviewer: the owner cannot mark it done (M5)', () => {
    expect(nextAction(task('in_progress'), 'manager')).toBeNull();
    expect(nextAction(task('in_progress', { reviewRequired: true }), 'manager')?.label).toBe(
      'Submit',
    );
  });
});

describe('A-TSK-6 dependencies', () => {
  const edges: [string, string][] = [
    ['a', 'b'],
    ['b', 'c'],
  ];
  it.each([
    ['self', 'a', 'a', true],
    ['direct cycle', 'b', 'a', true],
    ['indirect cycle', 'c', 'a', true],
    ['new branch', 'a', 'd', false],
    ['shortcut along the chain', 'a', 'c', false],
  ] as const)('%s', (_, from, to, cycle) => {
    expect(createsCycle(edges, from, to)).toBe(cycle);
  });
});

describe('A-TSK-7 work entries and time', () => {
  const at = (hhmm: string, day = '2026-10-20') => new Date(`${day}T${hhmm}:00+05:30`);
  const entry = (id: string, s: string | null, e: string | null, more = {}) => ({
    id,
    occurredOn: '2026-10-20',
    startedAt: s ? at(s) : null,
    endedAt: e ? at(e) : null,
    durationMinutes: null as number | null,
    correctsUpdateId: null as string | null,
    ...more,
  });

  it('a corrected entry is replaced by its correction', () => {
    const list = [entry('1', null, null), entry('2', null, null, { correctsUpdateId: '1' })];
    expect(currentEntries(list).map((e) => e.id)).toEqual(['2']);
  });

  it('flags overlaps with the same day entries and a midnight crossing, never corrects them', () => {
    const others = [entry('1', '10:00', '11:00'), entry('2', '13:00', '14:00')];
    expect(overlapWarnings(entry('n', '10:30', '12:00'), others)).toEqual([
      'Overlaps another entry on this day (10:00 am–11:00 am IST).',
    ]);
    expect(overlapWarnings(entry('n', '11:00', '12:00'), others)).toEqual([]);
    const late = { ...entry('n', '23:30', null), endedAt: at('00:30', '2026-10-21') };
    expect(overlapWarnings(late, [])).toEqual([
      'Crosses midnight IST; counted on the work date 20 Oct 2026.',
    ]);
  });

  it('separates recorded work time from elapsed and waiting time', () => {
    const t0 = at('09:00');
    const events = [
      { occurredAt: t0, toStatus: 'pending' as const, reason: null },
      { occurredAt: at('10:00'), toStatus: 'in_progress' as const, reason: null },
      { occurredAt: at('11:00'), toStatus: 'blocked' as const, reason: 'Waiting for parent' },
      { occurredAt: at('13:00'), toStatus: 'in_progress' as const, reason: null },
      { occurredAt: at('14:00'), toStatus: 'in_review' as const, reason: null },
      { occurredAt: at('15:00'), toStatus: 'done' as const, reason: null },
    ];
    const entries = [entry('1', '10:00', '11:00'), entry('2', null, null, { durationMinutes: 45 })];
    const s = taskTimeSummary(events, entries, t0, at('18:00'));
    expect(s).toMatchObject({ elapsedMinutes: 360, waitingMinutes: 180, recordedMinutes: 105 });
    expect(s.waits).toEqual([
      { status: 'blocked', from: at('11:00'), to: at('13:00'), reason: 'Waiting for parent' },
      { status: 'in_review', from: at('14:00'), to: at('15:00'), reason: null },
    ]);
    expect(
      taskTimeSummary(events, [entry('1', null, null)], t0, at('18:00')).recordedMinutes,
    ).toBeNull();
  });
});

describe('end-to-end report wording', () => {
  it.each([
    [null, 'Not recorded'],
    [0, '0 min'],
    [45, '45 min'],
    [105, '1 h 45 min'],
    [1440 + 185, '1 day 3 h'],
  ] as const)('fmtDuration(%s) = %s', (m, text) => {
    expect(fmtDuration(m)).toBe(text);
  });

  it('describes handoffs, due changes and reasons in words', () => {
    const base = {
      occurredAt: new Date(),
      fromStatus: null,
      toStatus: null,
      fromStaffName: null,
      toStaffName: null,
      actorName: 'Sample Lead',
      reason: null,
      data: null,
    };
    expect(
      eventDetail({
        ...base,
        kind: 'reassigned',
        fromStaffName: 'A',
        toStaffName: 'B',
        reason: 'Leave',
      }),
    ).toBe('A to B · Reason: Leave');
    expect(
      eventDetail({
        ...base,
        kind: 'due_changed',
        data: {
          fromDueOn: '2026-10-20',
          toDueOn: '2026-10-22',
          fromDueTime: null,
          toDueTime: '17:30:00',
        },
      }),
    ).toBe('2026-10-20 to 2026-10-22 17:30 IST');
    expect(
      eventDetail({
        ...base,
        kind: 'changes_requested',
        fromStatus: 'in_review',
        toStatus: 'in_progress',
        reason: 'Add receipts',
      }),
    ).toBe('Submitted to In progress · Reason: Add receipts');
  });
});

describe('R18 self-logged is fixed at creation', () => {
  it.each([
    ['owner logged it as self', { source: 'self', createdBy: 'u1' }, 'u1', null, true],
    [
      'someone else logged it, even as self',
      { source: 'self', createdBy: 'u2' },
      'u1',
      null,
      false,
    ],
    ['manager-assigned', { source: 'manager', createdBy: 'u1' }, 'u1', null, false],
    ['owner without a login', { source: 'self', createdBy: 'u1' }, null, null, false],
    ['imported, owner = mapped staff', { source: 'import', createdBy: 'imp' }, 'u1', 's1', true],
    ['imported, then reassigned', { source: 'import', createdBy: 'imp' }, 'u1', 's9', false],
    ['imported without a batch', { source: 'import', createdBy: 'imp' }, 'u1', null, false],
    [
      'verbal request logged by the owner',
      { source: 'verbal', createdBy: 'u1' },
      'u1',
      null,
      false,
    ],
  ] as const)('%s', (_, t, owner, batchStaff, expected) => {
    expect(isSelfLogged({ ...t, staffId: 's1' }, owner, batchStaff)).toBe(expected);
  });
});
