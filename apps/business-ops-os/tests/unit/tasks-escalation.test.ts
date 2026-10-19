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
  it('completion needs evidence and an owner (BR-OPS-11)', () => {
    expect(checkTaskTransition({ ...base, from: 'in_progress', to: 'completed' })).toMatchObject({
      code: 'EVIDENCE_REQUIRED',
    });
    expect(
      checkTaskTransition({ ...base, from: 'in_progress', to: 'completed', completionNote: '   ' }),
    ).toMatchObject({ code: 'EVIDENCE_REQUIRED' });
    expect(
      checkTaskTransition({
        ...base,
        hasOwner: false,
        from: 'in_progress',
        to: 'completed',
        evidenceLink: 'https://x',
      }),
    ).toMatchObject({ code: 'OWNER_REQUIRED' });
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
  it('cancel and block need a reason; reopen only to in_progress with a reason', () => {
    expect(checkTaskTransition({ ...base, from: 'in_progress', to: 'cancelled' })).toMatchObject({
      code: 'REASON_REQUIRED',
    });
    expect(checkTaskTransition({ ...base, from: 'in_progress', to: 'blocked' })).toMatchObject({
      code: 'REASON_REQUIRED',
    });
    expect(
      checkTaskTransition({ ...base, from: 'completed', to: 'waiting', reason: 'x' }),
    ).toMatchObject({ code: 'ILLEGAL' });
    expect(checkTaskTransition({ ...base, from: 'completed', to: 'in_progress' })).toMatchObject({
      code: 'REASON_REQUIRED',
    });
    expect(
      checkTaskTransition({ ...base, from: 'cancelled', to: 'in_progress', reason: 'Back on' }).ok,
    ).toBe(true);
    expect(checkTaskTransition({ ...base, from: 'waiting', to: 'waiting' })).toMatchObject({
      code: 'NO_CHANGE',
    });
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
    expect(
      evaluateEscalation(
        { ...task, dueDate: d('2026-10-16') },
        new Date('2026-10-18T06:00:00Z'),
        thresholds,
      ).map((p) => p.level),
    ).toEqual([2]);
    expect(
      evaluateEscalation(
        { ...task, dueDate: d('2026-10-17') },
        new Date('2026-10-18T06:00:00Z'),
        thresholds,
      ),
    ).toEqual([]);
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
    expect(
      evaluateEscalation({ ...task, status: 'completed' }, new Date('2027-01-01'), thresholds),
    ).toEqual([]);
    expect(
      evaluateEscalation({ ...task, dueDate: null }, new Date('2027-01-01'), thresholds),
    ).toEqual([]);
  });
  it('recipients follow the reporting line', () => {
    const manager: Record<string, string | null> = { s1: 'm1', m1: 'd1', d1: null };
    const of = (id: string) => manager[id];
    expect(resolveEscalationRecipient('s1', 2, of)).toEqual({
      recipientStaffId: 'm1',
      via: 'reporting_line',
    });
    expect(resolveEscalationRecipient('s1', 3, of)).toEqual({
      recipientStaffId: 'd1',
      via: 'reporting_line',
    });
    expect(resolveEscalationRecipient('s1', 4, of)).toEqual({
      recipientStaffId: 'd1',
      via: 'top_of_chain',
    });
    expect(resolveEscalationRecipient('d1', 2, of)).toEqual({
      recipientStaffId: null,
      via: 'no_manager_on_record',
    });
    expect(resolveEscalationRecipient(null, 2, of)).toEqual({
      recipientStaffId: null,
      via: 'no_owner',
    });
    expect(resolveEscalationRecipient('a', 2, (id) => ({ a: 'b', b: 'a' })[id])).toEqual({
      recipientStaffId: null,
      via: 'reporting_loop',
    });
  });
});
