import { describe, expect, it } from 'vitest';
import {
  buildEodFacts,
  eodPlainText,
  factsMissingReasons,
  taskStateAt,
  type EodFacts,
  type EodInput,
  type FactEvent,
  type FactTask,
  type FactUpdate,
} from '../../src/domain/eod';
import { factsHash } from '../../src/server/eod-facts';

const S = 'staff-s';
const OTHER = 'staff-o';
const ist = (day: string, time: string) => new Date(`${day}T${time}:00+05:30`);
const D = '2026-10-19';
const NEXT = '2026-10-20';
const PREV = '2026-10-18';

const task = (id: string, over: Partial<FactTask> = {}): FactTask => ({
  id,
  title: `Sample task ${id}`,
  priority: 'medium',
  dueOn: D,
  dueTime: null,
  staffId: S,
  status: 'in_progress',
  reason: null,
  linkedRef: null,
  createdAt: ist(PREV, '09:00'),
  completedAt: null,
  ...over,
});
const ev = (
  taskId: string,
  kind: FactEvent['kind'],
  at: Date,
  over: Partial<FactEvent> = {},
): FactEvent => ({
  taskId,
  kind,
  toStatus: null,
  fromStatus: null,
  fromStaffId: null,
  toStaffId: null,
  occurredAt: at,
  reason: null,
  data: null,
  ...over,
});
const upd = (id: string, taskId: string, over: Partial<FactUpdate> = {}): FactUpdate => ({
  id,
  taskId,
  occurredOn: D,
  recordedAt: ist(D, '18:00'),
  workPerformed: `Work ${id}`,
  result: null,
  blocker: null,
  nextStep: null,
  durationMinutes: null,
  startedAt: null,
  endedAt: null,
  correctsUpdateId: null,
  ...over,
});
const down = {
  status: 'unavailable',
  reason: 'Could not reach the source',
  fetchedAt: ist(D, '20:00').toISOString(),
} as const;
const facts = (over: Partial<EodInput>) =>
  buildEodFacts({
    staffId: S,
    reportDate: D,
    now: ist('2026-10-21', '10:00'),
    tasks: [],
    events: [],
    updates: [],
    academic: down,
    ...over,
  });

describe('A-TSK-8 EOD facts from events', () => {
  it('test 5: a task finished the next day is not completed on D; one finished on D counts once', () => {
    const tasks = [task('a', { status: 'done' }), task('b', { status: 'done', dueOn: PREV })];
    const events = [
      ev('a', 'status_changed', ist(D, '11:00'), { fromStatus: 'pending', toStatus: 'done' }),
      ev('a', 'reopened', ist(D, '12:00'), {
        fromStatus: 'done',
        toStatus: 'in_progress',
        reason: 'Missed a page',
      }),
      ev('a', 'status_changed', ist(D, '15:00'), { fromStatus: 'in_progress', toStatus: 'done' }),
      ev('b', 'status_changed', ist(NEXT, '00:30'), {
        fromStatus: 'in_progress',
        toStatus: 'done',
      }),
    ];
    const f = facts({ tasks, events });
    expect(f.completed.map((c) => c.taskId)).toEqual(['a']);
    expect(f.counts.completed).toBe(1);
    // b was still open at the end of D (replayed, not its current "done").
    expect(f.backlog.map((b) => b.taskId)).toEqual(['b']);
    expect(f.backlog[0]).toMatchObject({ status: 'in_progress', overdue: true });
  });

  it('a five-day task with updates every day is one worked task', () => {
    const updates = [upd('u1', 'a'), upd('u2', 'a'), upd('u3', 'a', { occurredOn: PREV })];
    const f = facts({ tasks: [task('a')], updates });
    expect(f.work.map((w) => w.updateId)).toEqual(['u1', 'u2']);
    expect(f.counts.worked).toBe(1);
  });

  it('test 4: start/stop work across midnight is split at the IST day boundary; late entries keep their day', () => {
    const night = upd('n', 'a', {
      occurredOn: PREV,
      startedAt: ist(PREV, '23:00'),
      endedAt: ist(D, '01:00'),
      recordedAt: ist(D, '01:05'),
    });
    const late = upd('l', 'a', { durationMinutes: 30, recordedAt: ist('2026-10-21', '09:00') });
    const onD = facts({ tasks: [task('a')], updates: [night, late] });
    expect(onD.work.map((w) => [w.updateId, w.minutes, w.enteredOn])).toEqual([
      ['n', 60, null],
      ['l', 30, '2026-10-21'],
    ]);
    expect(onD.duration.minutes).toBe(90);
    const onPrev = facts({ reportDate: PREV, tasks: [task('a')], updates: [night, late] });
    expect(onPrev.work.map((w) => [w.updateId, w.minutes])).toEqual([['n', 60]]);
  });

  it('entries recorded after the generation time are left out; corrected updates show only the correction', () => {
    const f = facts({
      now: ist(D, '17:00'),
      tasks: [task('a')],
      updates: [
        upd('old', 'a', { durationMinutes: 50, recordedAt: ist(D, '10:00') }),
        upd('fix', 'a', {
          durationMinutes: 40,
          recordedAt: ist(D, '11:00'),
          correctsUpdateId: 'old',
        }),
        upd('later', 'a', { durationMinutes: 10, recordedAt: ist(D, '18:00') }),
      ],
    });
    expect(f.work.map((w) => w.updateId)).toEqual(['fix']);
    expect(f.duration.minutes).toBe(40);
  });

  it('flags overlapping start/stop entries', () => {
    const f = facts({
      tasks: [task('a'), task('b')],
      updates: [
        upd('x', 'a', { startedAt: ist(D, '10:00'), endedAt: ist(D, '11:00') }),
        upd('y', 'b', { startedAt: ist(D, '10:30'), endedAt: ist(D, '11:30') }),
        upd('z', 'b', { startedAt: ist(D, '12:00'), endedAt: ist(D, '12:15') }),
      ],
    });
    expect(
      f.work
        .filter((w) => w.overlaps)
        .map((w) => w.updateId)
        .sort(),
    ).toEqual(['x', 'y']);
    expect(f.duration).toMatchObject({ minutes: 135, overlaps: true });
  });

  it('test 6: a day report has no attendance figure and a failed Academic call says so', () => {
    const f = facts({});
    expect(f.attendance).toBeUndefined();
    expect(f.academic).toMatchObject({
      status: 'unavailable',
      reason: 'Could not reach the source',
    });
    expect(f.noActivity).toBe(true);
    expect(f.duration.minutes).toBeNull();
    expect(
      eodPlainText(
        f,
        { summary: null, nextDayPlan: null, notes: null },
        { staffName: 'Sample A', version: null, recipient: null },
      ),
    ).toContain('No task activity recorded');
  });

  it('test 7: a task linked to an Academic session is flagged as the same activity; class time is never added', () => {
    const metric = (value: number) => ({
      status: 'ok' as const,
      value,
      definition: 'x',
      window: { from: D, to: D },
      unit: 'count' as const,
    });
    const academic = {
      status: 'available' as const,
      fetchedAt: ist(D, '20:00').toISOString(),
      data: {
        contract: 'academic.teacher_activity' as const,
        version: 1 as const,
        generatedAt: ist(D, '20:00').toISOString(),
        staffId: S as never,
        window: { from: D, to: D },
        assignments: [],
        sessions: {
          planned: metric(3),
          delivered: metric(2),
          cancelled: metric(1),
          substituted: metric(0),
        },
        logsPending: metric(1),
        attendancePending: metric(0),
        markingPending: {
          status: 'missing' as const,
          value: null,
          definition: 'x',
          window: { from: D, to: D },
          unit: 'count' as const,
        },
        reviews: { submitted: metric(0), draft: metric(1) },
        unavailability: [],
      },
    };
    const f = facts({
      tasks: [task('a', { linkedRef: 'academic:session:1234' })],
      updates: [upd('c', 'a', { durationMinutes: 60 })],
      academic: academic as never,
    });
    expect(f.work[0]).toMatchObject({ sameActivity: 'academic:session:1234', minutes: 60 });
    expect(f.duration).toMatchObject({ minutes: 60, sameActivity: 1 });
    expect(f.academic).toMatchObject({
      status: 'available',
      planned: 3,
      delivered: 2,
      markingPending: null,
    });
  });

  it('received, acknowledged, blocked and decisions come only from events inside the day, for the owner then', () => {
    const tasks = [task('r', { status: 'pending' }), task('away')];
    const events = [
      ev('r', 'created', ist(D, '09:00'), { toStaffId: S, toStatus: 'pending' }),
      ev('r', 'acknowledged', ist(D, '09:10')),
      ev('r', 'clarification_requested', ist(D, '09:20'), { reason: 'Which batch?' }),
      ev('r', 'status_changed', ist(D, '16:00'), {
        fromStatus: 'pending',
        toStatus: 'blocked',
        reason: 'Waiting for parent',
      }),
      ev('away', 'reassigned', ist(D, '10:00'), { fromStaffId: S, toStaffId: OTHER }),
      ev('away', 'acknowledged', ist(D, '11:00')),
      ev('r', 'acknowledged', ist(PREV, '23:59')),
    ];
    const f = facts({ tasks, events });
    expect(f.received.map((x) => x.taskId)).toEqual(['r']);
    expect(f.acknowledged.map((x) => x.taskId)).toEqual(['r']);
    expect(f.decisions).toEqual([
      expect.objectContaining({
        taskId: 'r',
        kind: 'clarification_requested',
        detail: 'Which batch?',
      }),
    ]);
    expect(f.blocked).toEqual([
      expect.objectContaining({ taskId: 'r', detail: 'Waiting for parent' }),
    ]);
    expect(f.backlog.map((b) => b.taskId)).toEqual(['r']);
    expect(factsMissingReasons(f)).toEqual([]);
  });

  it('taskStateAt replays owner and status; a task created later did not exist yet', () => {
    const t = task('t', {
      staffId: OTHER,
      status: 'done',
      completedAt: ist(NEXT, '10:00'),
      createdAt: ist(D, '08:00'),
    });
    const events = [
      ev('t', 'reassigned', ist(D, '12:00'), { fromStaffId: S, toStaffId: OTHER }),
      ev('t', 'status_changed', ist(NEXT, '10:00'), {
        fromStatus: 'in_progress',
        toStatus: 'done',
      }),
    ];
    expect(taskStateAt(t, events, ist(D, '07:00'))).toBeNull();
    expect(taskStateAt(t, events, ist(D, '11:00'))).toMatchObject({
      owner: S,
      status: 'in_progress',
    });
    expect(taskStateAt(t, events, ist(NEXT, '11:00'))).toMatchObject({
      owner: OTHER,
      status: 'done',
    });
  });

  it('overdue at the cut-off uses the due day replayed from due_changed events', () => {
    const t = task('m', { dueOn: '2026-10-30' });
    const moved = ev('m', 'due_changed', ist(NEXT, '09:00'), {
      data: { fromDueOn: PREV, toDueOn: '2026-10-30', fromDueTime: null, toDueTime: null },
    });
    const f = facts({ tasks: [t], events: [moved] });
    expect(f.backlog[0]).toMatchObject({ dueOn: PREV, overdue: true });
    expect(taskStateAt(t, [moved], ist('2026-10-21', '10:00'))).toMatchObject({
      dueOn: '2026-10-30',
    });
  });

  it('factsHash ignores values that change only with time (overdue, closed later)', () => {
    const f = facts({ tasks: [task('a')] });
    const later = {
      ...f,
      backlog: f.backlog.map((b) => ({ ...b, overdue: !b.overdue, closedLater: true })),
      counts: { ...f.counts, overdue: 9 },
    };
    expect(factsHash(later)).toBe(factsHash(f));
    expect(factsHash({ ...f, counts: { ...f.counts, backlog: 9 } })).not.toBe(factsHash(f));
  });

  it('an immediate re-check is not "changed": jsonb key order and the moving cut-off are ignored', () => {
    const blocked = task('b', {
      blockedAt: ist(PREV, '10:00'),
      blockedReason: 'Waiting for parent',
    });
    const at = (time: string) => facts({ tasks: [blocked], now: ist(D, time) });
    // Postgres jsonb returns object keys in its own order, not the order they were written in.
    const reorder = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reorder)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.entries(v)
                .reverse()
                .map(([k, x]) => [k, reorder(x)]),
            )
          : v;
    const submitted = reorder(JSON.parse(JSON.stringify(at('18:00')))) as EodFacts;
    expect(factsHash(at('18:01'))).toBe(factsHash(submitted));
  });

  it('decisions or help: only clarification requests, never "submitted for review"', () => {
    const events = (['clarification_requested', 'submitted_for_review'] as const).map((k, i) =>
      ev(`t${i}`, k, ist(D, '10:00')),
    );
    const f = facts({ tasks: [task('t0'), task('t1')], events });
    expect(f.decisions.map((d) => d.kind)).toEqual(['clarification_requested']);
  });
});

describe('work-report facts for a week (brief 23 Oct 2026 §13–14)', () => {
  const MON = '2026-10-19';
  const SUN = '2026-10-25';
  const week = (over: Partial<EodInput>) =>
    facts({
      reportDate: MON,
      periodKind: 'week',
      periodEnd: SUN,
      now: ist('2026-10-28', '10:00'),
      ...over,
    });

  it('submitted and approved are separate sections; approval next week is not in this week', () => {
    const tasks = [
      task('s', { status: 'done', dueOn: '2026-10-23' }),
      task('n', { status: 'done' }),
    ];
    const events = [
      ev('s', 'submitted_for_review', ist('2026-10-22', '16:00'), {
        fromStatus: 'in_progress',
        toStatus: 'in_review',
      }),
      ev('s', 'review_approved', ist('2026-10-26', '11:00'), {
        fromStatus: 'in_review',
        toStatus: 'done',
      }),
      ev('n', 'status_changed', ist('2026-10-21', '12:00'), {
        fromStatus: 'in_progress',
        toStatus: 'done',
      }),
    ];
    const f = week({ tasks, events });
    expect(f.submitted!.map((x) => x.taskId)).toEqual(['s']);
    expect(f.completed.map((x) => x.taskId)).toEqual(['n']);
    expect(f.timeliness!.rows.find((r) => r.taskId === 's')).toMatchObject({
      outcome: 'on_time',
      delivered: false,
    });
    expect(f.turnaround).toEqual({ decided: 0, waiting: 1, medianHours: null });
  });

  it('the on-time rate uses the deadline in force at the first submission and lists the change', () => {
    const t = task('m', {
      dueOn: '2026-10-24',
      originalDueOn: '2026-10-22',
      originalDueTime: null,
    });
    const events = [
      ev('m', 'submitted_for_review', ist('2026-10-23', '09:00'), { toStatus: 'in_review' }),
      ev('m', 'due_changed', ist('2026-10-23', '10:00'), {
        reason: 'Sample: extra pages',
        data: {
          fromDueOn: '2026-10-22',
          toDueOn: '2026-10-24',
          fromDueTime: null,
          toDueTime: null,
        },
      }),
    ];
    const r = week({ tasks: [t], events }).timeliness!;
    expect(r).toMatchObject({ eligible: 1, late: 1, rate: 0 });
    expect(r.revisions).toEqual([
      {
        taskId: 'm',
        title: 'Sample task m',
        from: '2026-10-22',
        to: '2026-10-24',
        reason: 'Sample: extra pages',
      },
    ]);
  });

  it('blocked is a flag replayed from blocked_set / blocked_cleared; the status is kept', () => {
    const t = task('b', { status: 'in_progress', dueOn: '2026-10-30' });
    const events = [
      ev('b', 'blocked_set', ist('2026-10-20', '10:00'), { reason: 'Sample: waiting for a file' }),
      ev('b', 'blocked_cleared', ist('2026-10-27', '10:00')),
    ];
    const f = week({ tasks: [t], events });
    expect(f.backlog[0]).toMatchObject({
      status: 'in_progress',
      blocked: true,
      reason: 'Sample: waiting for a file',
    });
    expect(taskStateAt(t, events, ist('2026-10-28', '10:00'))!.blocked).toBeNull();
    expect(taskStateAt(t, events, ist('2026-10-19', '10:00'))!.blocked).toBeNull();
  });

  it('work updates across the week count; EOD reasons are not required for a week report', () => {
    const f = week({
      tasks: [task('a', { dueOn: '2026-10-20' })],
      updates: [upd('u1', 'a', { occurredOn: '2026-10-20' }), upd('u2', 'a', { occurredOn: SUN })],
    });
    expect(f.work.map((w) => w.updateId)).toEqual(['u1', 'u2']);
    expect(factsMissingReasons(f)).toEqual([]);
  });
});

describe('drafts are not the employee’s work yet', () => {
  it('a draft is ignored while it is a draft; publishing it counts as received', () => {
    const t = task('d', { status: 'pending' });
    const events = [
      ev('d', 'created', ist(PREV, '10:00'), { toStaffId: S, toStatus: 'draft' }),
      ev('d', 'status_changed', ist(D, '11:00'), { fromStatus: 'draft', toStatus: 'pending' }),
    ];
    const onPrev = facts({ reportDate: PREV, now: ist(PREV, '20:00'), tasks: [t], events });
    expect(onPrev.received).toEqual([]);
    expect(onPrev.backlog).toEqual([]);
    expect(facts({ tasks: [t], events }).received.map((x) => x.taskId)).toEqual(['d']);
  });
});

describe('a draft cancelled before it was published', () => {
  it('never reached anyone: not received', () => {
    const t = task('x', { status: 'cancelled', reason: 'Sample: not needed' });
    const events = [
      ev('x', 'created', ist(PREV, '10:00'), { toStaffId: S, toStatus: 'draft' }),
      ev('x', 'cancelled', ist(D, '11:00'), {
        fromStatus: 'draft',
        toStatus: 'cancelled',
        reason: 'Sample: not needed',
      }),
    ];
    expect(facts({ tasks: [t], events }).received).toEqual([]);
  });
});
