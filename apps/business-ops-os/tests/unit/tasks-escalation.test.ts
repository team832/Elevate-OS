import { describe, expect, it } from 'vitest';
import {
  ancestorChain,
  checkTaskTransition,
  evaluateEscalation,
  findCycle,
  findPath,
  resolveEscalationRecipient,
  taskFlags,
  wouldCreateCycle,
  type IsoDate,
} from '../../src/domain';

const d = (s: string) => s as IsoDate;

describe('dependency graph (A-07)', () => {
  const edges = [
    { from: 'A', to: 'B' },
    { from: 'B', to: 'C' },
  ];
  it('accepts an edge that keeps the graph acyclic', () => {
    expect(wouldCreateCycle(edges, 'A', 'C')).toEqual({ cycle: false });
    expect(wouldCreateCycle(edges, 'D', 'A')).toEqual({ cycle: false });
  });
  it('rejects a 3-node cycle and reports the path', () => {
    expect(wouldCreateCycle(edges, 'C', 'A')).toEqual({ cycle: true, path: ['C', 'A', 'B', 'C'] });
  });
  it('rejects a self-dependency and a 2-node cycle', () => {
    expect(wouldCreateCycle([], 'A', 'A').cycle).toBe(true);
    expect(wouldCreateCycle([{ from: 'A', to: 'B' }], 'B', 'A').cycle).toBe(true);
  });
  it('findCycle finds an existing cycle and returns null for a DAG', () => {
    expect(findCycle(edges)).toBeNull();
    expect(findCycle([...edges, { from: 'C', to: 'A' }])).toEqual(['A', 'B', 'C', 'A']);
    expect(findCycle([])).toBeNull();
  });
  it('findPath is the shortest path and deterministic', () => {
    const e = [
      { from: 'A', to: 'C' },
      { from: 'A', to: 'B' },
      { from: 'B', to: 'D' },
      { from: 'C', to: 'D' },
    ];
    expect(findPath(e, 'A', 'D')).toEqual(['A', 'B', 'D']);
    expect(findPath(e, 'D', 'A')).toBeNull();
  });
  it('ancestorChain stops on loops', () => {
    const parent: Record<string, string> = { a: 'b', b: 'c', c: 'a' };
    expect(ancestorChain('a', (n) => parent[n])).toEqual({ chain: ['a', 'b', 'c'], loop: true });
    expect(ancestorChain('x', () => null)).toEqual({ chain: ['x'], loop: false });
  });
});

describe('task status rules (A-08)', () => {
  const base = { hasOwner: true, openBlockers: [] as string[] };
  it('normal: open → in_progress → completed with a note', () => {
    expect(checkTaskTransition({ ...base, from: 'not_started', to: 'in_progress' }).ok).toBe(true);
    expect(
      checkTaskTransition({
        ...base,
        from: 'in_progress',
        to: 'completed',
        completionNote: 'Done, see register',
      }),
    ).toEqual({ ok: true, overrideUsed: false });
  });
  it.each([
    [
      'completion needs evidence (BR-OPS-11)',
      { from: 'in_progress', to: 'completed' },
      'EVIDENCE_REQUIRED',
    ],
    [
      'a blank note is no evidence',
      { from: 'in_progress', to: 'completed', completionNote: '   ' },
      'EVIDENCE_REQUIRED',
    ],
    [
      'completion needs an owner (BR-OPS-11)',
      { hasOwner: false, from: 'in_progress', to: 'completed', evidenceLink: 'https://x' },
      'OWNER_REQUIRED',
    ],
    ['cancel needs a reason', { from: 'in_progress', to: 'cancelled' }, 'REASON_REQUIRED'],
    ['block needs a reason', { from: 'in_progress', to: 'blocked' }, 'REASON_REQUIRED'],
    ['reopen only to in_progress', { from: 'completed', to: 'waiting', reason: 'x' }, 'ILLEGAL'],
    ['reopen needs a reason', { from: 'completed', to: 'in_progress' }, 'REASON_REQUIRED'],
    ['reopen with a reason', { from: 'cancelled', to: 'in_progress', reason: 'Back on' }, null],
    ['no change', { from: 'waiting', to: 'waiting' }, 'NO_CHANGE'],
  ] as const)('%s', (_, over, code) => {
    const r = checkTaskTransition({ ...base, ...over });
    expect(r.ok ? null : r.code).toBe(code);
  });
  it('cannot complete while blockers are open, unless overridden with a reason', () => {
    const blocked = {
      ...base,
      openBlockers: ['TSK-00002'],
      from: 'in_progress' as const,
      to: 'completed' as const,
      completionNote: 'x',
    };
    expect(checkTaskTransition(blocked)).toMatchObject({
      ok: false,
      code: 'BLOCKED_BY_OPEN_TASKS',
      blockers: ['TSK-00002'],
    });
    expect(
      checkTaskTransition({ ...blocked, blockerOverrideReason: 'Director accepted the risk' }),
    ).toEqual({ ok: true, overrideUsed: true });
  });
  it('flags use IST dates', () => {
    const t = { status: 'in_progress' as const, ownerStaffId: null, dueDate: d('2026-10-17') };
    expect(taskFlags(t, new Date('2026-10-17T18:29:00Z')).flags).toEqual([
      'missing_owner',
      'due_today',
    ]);
    expect(taskFlags(t, new Date('2026-10-17T18:31:00Z'))).toEqual({
      flags: ['missing_owner', 'overdue'],
      daysOverdue: 1,
    });
    expect(taskFlags({ ...t, dueDate: null }, new Date()).flags).toContain('missing_due');
    expect(
      taskFlags({ ...t, status: 'completed' }, new Date('2027-01-01T00:00:00Z')).flags,
    ).toEqual([]);
  });
});

describe('escalation rules (A-09)', () => {
  const thresholds = {
    overdueDaysL2: 2,
    overdueDaysL3: 5,
    overdueDaysL4: 10,
    blockedDaysL2: 3,
    responseDays: 1,
  };
  const task = {
    status: 'in_progress' as const,
    dueDate: d('2026-10-10'),
    blockedSince: null,
    ownerStaffId: 's1',
    raisedLevels: [] as number[],
  };
  it('boundary: overdue by exactly the threshold escalates; one day less does not', () => {
    const levels = (due: string) =>
      evaluateEscalation(
        { ...task, dueDate: d(due) },
        new Date('2026-10-18T06:00:00Z'),
        thresholds,
      ).map((p) => p.level);
    expect(levels('2026-10-16')).toEqual([2]);
    expect(levels('2026-10-17')).toEqual([]);
  });
  it('a late first evaluation raises every missing level in order, once', () => {
    const now = new Date('2026-10-22T06:00:00Z'); // 12 days overdue
    const p = evaluateEscalation(task, now, thresholds);
    expect(p.map((x) => [x.level, x.thresholdDays])).toEqual([
      [2, 2],
      [3, 5],
      [4, 10],
    ]);
    expect(p[0]?.respondBy).toBe('2026-10-23');
    expect(evaluateEscalation({ ...task, raisedLevels: [2, 3, 4] }, now, thresholds)).toEqual([]);
    expect(
      evaluateEscalation({ ...task, raisedLevels: [2] }, now, thresholds).map((x) => x.level),
    ).toEqual([3, 4]);
  });
  it('blocked for N days raises L2 even without a due date', () => {
    const p = evaluateEscalation(
      { ...task, status: 'blocked', dueDate: null, blockedSince: new Date('2026-10-14T06:00:00Z') },
      new Date('2026-10-18T06:00:00Z'),
      thresholds,
    );
    expect(p).toMatchObject([{ level: 2, trigger: 'blocked' }]);
  });
  it('closed tasks and missing due dates never escalate on overdue', () => {
    for (const over of [{ status: 'completed' as const }, { dueDate: null }])
      expect(evaluateEscalation({ ...task, ...over }, new Date('2027-01-01'), thresholds)).toEqual(
        [],
      );
  });
  const manager: Record<string, string | null> = { s1: 'm1', m1: 'd1', d1: null };
  it.each([
    ['s1', 2, 'm1', 'reporting_line'],
    ['s1', 3, 'd1', 'reporting_line'],
    ['s1', 4, 'd1', 'top_of_chain'],
    ['d1', 2, null, 'no_manager_on_record'],
    [null, 2, null, 'no_owner'],
  ] as const)('recipient of %s at L%i → %s (%s)', (owner, level, recipientStaffId, via) => {
    expect(resolveEscalationRecipient(owner, level, (id) => manager[id])).toEqual({
      recipientStaffId,
      via,
    });
  });
  it('a looping reporting line has no recipient', () => {
    expect(resolveEscalationRecipient('a', 2, (id) => ({ a: 'b', b: 'a' })[id])).toEqual({
      recipientStaffId: null,
      via: 'reporting_loop',
    });
  });
});
