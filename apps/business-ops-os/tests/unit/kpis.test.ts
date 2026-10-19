import { describe, expect, it } from 'vitest';
import {
  followUpCompliance,
  latestElapsedCohortWeek,
  leadToAdmissionConversion,
  newLeads,
  overdueWork,
  taskCompletionRate,
  unresolvedBlockers,
  workloadPerStaff,
  type IsoDate,
  type KpiWindow,
} from '../../src/domain';

const d = (s: string) => s as IsoDate;
const week: KpiWindow = { from: d('2026-10-12'), to: d('2026-10-18') };
const asOf = new Date('2026-10-18T10:00:00Z');

describe('new leads', () => {
  it('counts by IST receipt date and excludes merged duplicates; a real zero is 0, not missing', () => {
    const leads = [
      { receivedAt: new Date('2026-10-11T18:31:00Z'), merged: false, admittedAt: null }, // 12 Oct 00:01 IST → in
      { receivedAt: new Date('2026-10-11T18:29:00Z'), merged: false, admittedAt: null }, // 11 Oct IST → out
      { receivedAt: new Date('2026-10-13T06:00:00Z'), merged: true, admittedAt: null },
    ];
    expect(newLeads(leads, week)).toMatchObject({ status: 'ok', value: 1, unit: 'count' });
    expect(newLeads([], week)).toMatchObject({ status: 'ok', value: 0 });
  });
});

describe('lead → admission conversion (cohort, BR-OPS-8)', () => {
  const cohort: KpiWindow = { from: d('2026-09-07'), to: d('2026-09-13') };
  const lead = (received: string, admitted: string | null, merged = false) => ({
    receivedAt: new Date(received),
    admittedAt: admitted ? new Date(admitted) : null,
    merged,
  });
  it('normal: admitted within the window / cohort size', () => {
    const leads = [
      lead('2026-09-08T06:00:00Z', '2026-09-20T06:00:00Z'),
      lead('2026-09-09T06:00:00Z', '2026-10-30T06:00:00Z'), // admitted after 30 days → not counted
      lead('2026-09-10T06:00:00Z', null),
      lead('2026-09-11T06:00:00Z', null),
      lead('2026-09-12T06:00:00Z', '2026-09-12T08:00:00Z', true), // merged → excluded
      lead('2026-09-20T06:00:00Z', '2026-09-21T06:00:00Z'), // other cohort
    ];
    expect(leadToAdmissionConversion(leads, cohort, 30, asOf)).toMatchObject({
      status: 'ok',
      value: 25,
      unit: 'percent',
    });
  });
  it('boundary: admitted exactly N days after receipt counts', () => {
    expect(
      leadToAdmissionConversion(
        [lead('2026-09-08T06:00:00Z', '2026-10-08T06:00:00Z')],
        cohort,
        30,
        asOf,
      ).value,
    ).toBe(100);
  });
  it('denominator zero → missing, never 0 %', () => {
    const m = leadToAdmissionConversion([], cohort, 30, asOf);
    expect(m.status).toBe('missing');
    expect(m.value).toBeNull();
  });
  it('window not elapsed → missing with the date it becomes available', () => {
    const m = leadToAdmissionConversion([lead('2026-10-13T06:00:00Z', null)], week, 30, asOf);
    expect(m).toMatchObject({ status: 'missing', value: null });
    if (m.status === 'missing') expect(m.reason).toContain('2026-11-17');
  });
  it('latestElapsedCohortWeek picks the last Mon–Sun week whose N days have passed', () => {
    expect(latestElapsedCohortWeek(asOf, 30)).toEqual({ from: '2026-09-07', to: '2026-09-13' });
    expect(latestElapsedCohortWeek(new Date('2026-10-13T06:00:00Z'), 30)).toEqual({
      from: '2026-09-07',
      to: '2026-09-13',
    });
    expect(latestElapsedCohortWeek(new Date('2026-10-12T06:00:00Z'), 7)).toEqual({
      from: '2026-09-28',
      to: '2026-10-04',
    });
  });
});

describe('follow-up compliance', () => {
  const row = (
    kind: string,
    dueDate: string,
    status: 'open' | 'done' | 'cancelled',
    completedAt: string | null,
  ) => ({
    kind,
    dueDate: d(dueDate),
    status,
    completedAt: completedAt ? new Date(completedAt) : null,
  });
  it('on-time completions of counselling/demo follow-ups whose due date passed', () => {
    const rows = [
      row('counselling_followup', '2026-10-13', 'done', '2026-10-13T12:00:00Z'), // on time
      row('demo_followup', '2026-10-14', 'done', '2026-10-15T04:00:00Z'), // late
      row('demo_followup', '2026-10-15', 'open', null), // missed
      row('counselling_followup', '2026-10-16', 'cancelled', null), // excluded
      row('first_contact', '2026-10-13', 'done', '2026-10-13T12:00:00Z'), // other kind
      row('demo_followup', '2026-10-18', 'open', null), // due today: not judged yet
    ];
    expect(followUpCompliance(rows, week, asOf)).toMatchObject({ status: 'ok', value: 33.3 });
  });
  it('IST: completion at 23:50 IST on the due date is on time', () => {
    const rows = [row('demo_followup', '2026-10-13', 'done', '2026-10-13T18:20:00Z')];
    expect(followUpCompliance(rows, week, asOf).value).toBe(100);
  });
  it('denominator zero → missing', () => {
    expect(followUpCompliance([], week, asOf)).toMatchObject({ status: 'missing', value: null });
  });
});

describe('task completion rate', () => {
  it('completed ÷ due in window (cancelled excluded, future due excluded)', () => {
    const rows = [
      {
        status: 'completed' as const,
        dueDate: d('2026-10-13'),
        completedAt: new Date('2026-10-13'),
      },
      { status: 'in_progress' as const, dueDate: d('2026-10-14'), completedAt: null },
      { status: 'cancelled' as const, dueDate: d('2026-10-14'), completedAt: null },
      { status: 'not_started' as const, dueDate: null, completedAt: null },
    ];
    expect(taskCompletionRate(rows, week, asOf)).toMatchObject({ status: 'ok', value: 50 });
  });
  it('denominator zero → missing', () => {
    expect(
      taskCompletionRate(
        [{ status: 'cancelled', dueDate: d('2026-10-14'), completedAt: null }],
        week,
        asOf,
      ).status,
    ).toBe('missing');
  });
});

describe('overdue work and blockers (point in time)', () => {
  it('counts open overdue tasks and follow-ups', () => {
    const r = overdueWork(
      [
        { status: 'in_progress', dueDate: d('2026-10-17'), completedAt: null },
        { status: 'completed', dueDate: d('2026-10-01'), completedAt: new Date() },
        { status: 'waiting', dueDate: d('2026-10-18'), completedAt: null },
      ],
      [{ kind: 'general', dueDate: d('2026-10-10'), status: 'open', completedAt: null }],
      asOf,
    );
    expect(r).toMatchObject({ tasks: 1, followUps: 1 });
    expect(r.metric).toMatchObject({ status: 'ok', value: 2 });
  });
  it('unresolved blockers = open issues/blockers + blocked tasks; risks and resolved items excluded', () => {
    const r = unresolvedBlockers(
      [
        { kind: 'blocker', status: 'open' },
        { kind: 'issue', status: 'mitigating' },
        { kind: 'risk', status: 'open' },
        { kind: 'blocker', status: 'resolved' },
      ],
      [{ status: 'blocked', dueDate: null, completedAt: null }],
      asOf,
    );
    expect(r).toMatchObject({ registerItems: 2, blockedTasks: 1 });
    expect(r.metric.value).toBe(3);
  });
});

describe('workload per staff (not a score)', () => {
  it('counts assigned open items, sorts by name (never by load), skips inactive staff', () => {
    const w = workloadPerStaff({
      staff: [
        { id: 's2', fullName: 'Zara (fictional)', status: 'active' },
        { id: 's1', fullName: 'Asha (fictional)', status: 'active' },
        { id: 's3', fullName: 'Inactive (fictional)', status: 'inactive' },
      ],
      openTaskOwners: ['s2', 's2', 's2', null],
      openFollowUpOwners: ['s1'],
      openAdmissionCounsellors: ['s2', 's3'],
    });
    expect(w.rows.map((r) => [r.fullName, r.totalOpenItems])).toEqual([
      ['Asha (fictional)', 1],
      ['Zara (fictional)', 4],
    ]);
    expect(w.unassigned).toBe(1);
  });
});
