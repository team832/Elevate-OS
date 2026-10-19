import { describe, expect, it } from 'vitest';
import {
  acknowledgementStatus,
  acknowledgeProblems,
  checkCommentHide,
  checkMitigationTransition,
  checkTaskReviewDecision,
  describeTaskActivity,
  formatCode,
  inAckAudience,
  incidentSla,
  isSettingKey,
  nextPolicyStatus,
  openTasksMetric,
  overdueTasksMetric,
  overdueTaskShare,
  policyApprovalProblems,
  policyProposalProblems,
  projectBlockReasons,
  resolveSettings,
  reviewDueFlag,
  sopAcknowledgementCoverage,
  sopPublicationState,
  sopScheduleProblems,
  taskCapacity,
  taskRemindersDue,
  taskReviewState,
  upcomingDeadlines,
  type IsoDate,
  type TaskStatus,
} from '../../src/domain';

/** 19 Oct 2026 20:00 UTC = 20 Oct 2026 01:30 IST — the IST date is the 20th. */
const LATE_UTC = new Date('2026-10-19T20:00:00Z');
const NOON_IST = new Date('2026-10-20T06:30:00Z');
const TODAY = '2026-10-20' as IsoDate;

describe('comment hiding (append-only comments)', () => {
  const base = {
    actorUserId: 'u1',
    authorUserId: 'u1',
    actorIsManager: false,
    alreadyHidden: false,
    reason: 'Wrong task',
  };
  it.each([
    ['author with a reason', {}, null],
    ['manager hides another person’s comment', { actorUserId: 'u2', actorIsManager: true }, null],
    ['blank reason', { reason: '  ' }, 'REASON_REQUIRED'],
    ['someone else', { actorUserId: 'u2' }, 'NOT_ALLOWED'],
    ['already hidden', { alreadyHidden: true }, 'ALREADY_HIDDEN'],
  ])('%s', (_, over, code) => {
    const r = checkCommentHide({ ...base, ...over });
    expect(r.ok ? null : r.code).toBe(code);
  });
});

describe('supervisor review decision', () => {
  const base = {
    status: 'pending' as const,
    decision: 'accept' as const,
    deciderUserId: 'rev',
    submitterUserId: 'owner',
    ownerUserId: 'owner',
    reviewerUserId: 'rev' as string | null,
    accountableUserId: 'acc',
    deciderIsManager: false,
  };
  it.each([
    ['named reviewer accepts', {}, null],
    [
      'completer cannot, even as manager',
      { deciderUserId: 'owner', deciderIsManager: true },
      'SELF_REVIEW',
    ],
    [
      'owner cannot',
      { submitterUserId: 'mgr', deciderUserId: 'owner', deciderIsManager: true },
      'OWNER_REVIEW',
    ],
    [
      'accountable reviews when nobody is named',
      { reviewerUserId: null, deciderUserId: 'acc' },
      null,
    ],
    ['accountable is not the named reviewer', { deciderUserId: 'acc' }, 'NOT_REVIEWER'],
    ['a manager may review', { deciderUserId: 'x', deciderIsManager: true }, null],
    ['return needs a note', { decision: 'return' as const }, 'NOTE_REQUIRED'],
    ['only pending reviews', { status: 'accepted' as const }, 'NOT_PENDING'],
  ])('%s', (_, over, code) => {
    const r = checkTaskReviewDecision({ ...base, ...over });
    expect(r.ok ? null : r.code).toBe(code);
  });
  it.each([
    [false, null, 'not_required'],
    [true, null, 'required_not_submitted'],
    [true, 'pending', 'awaiting_review'],
    [true, 'returned', 'returned'],
    [false, 'accepted', 'accepted'],
  ] as const)('state: required=%s latest=%s → %s', (required, latest, state) => {
    expect(taskReviewState({ required, latest: latest ? { status: latest } : null })).toBe(state);
  });
});

describe('task reminders (IST: late UTC evening is the next IST day)', () => {
  const s = { leadDays: 1, notifyBackupWhenOverdue: true };
  it.each([
    ['due tomorrow (IST)', '2026-10-21', 'in_progress', s, [], ['due_soon']],
    ['due today', '2026-10-20', 'in_progress', s, [], ['due_soon']],
    ['due in two days', '2026-10-22', 'in_progress', s, [], []],
    ['overdue', '2026-10-19', 'blocked', s, [], ['overdue']],
    [
      'already reminded for this due date',
      '2026-10-21',
      'in_progress',
      s,
      [{ kind: 'due_soon', dueDate: '2026-10-21' }],
      [],
    ],
    [
      'due date changed since the reminder',
      '2026-10-20',
      'in_progress',
      s,
      [{ kind: 'due_soon', dueDate: '2026-10-21' }],
      ['due_soon'],
    ],
    [
      'overdue reminder sent once',
      '2026-10-19',
      'in_progress',
      s,
      [{ kind: 'overdue', dueDate: '2026-10-19' }],
      [],
    ],
    ['closed task', '2026-10-19', 'completed', s, [], []],
    ['no due date', null, 'in_progress', s, [], []],
    ['lead 0 = due day only', '2026-10-21', 'in_progress', { ...s, leadDays: 0 }, [], []],
  ] as const)('%s', (_, dueDate, status, settings, sent, expected) => {
    expect(
      taskRemindersDue(
        { status: status as TaskStatus, dueDate: dueDate as IsoDate | null },
        LATE_UTC,
        settings,
        sent,
      ),
    ).toEqual(expected);
  });
});

describe('task activity lines', () => {
  const names = (id: string) => ({ s1: 'Asha (fictional)', s2: 'Ravi (fictional)' })[id] ?? null;
  it.each([
    [
      'task.updated',
      { ownerStaffId: 's1' },
      { ownerStaffId: 's2' },
      'reassignment',
      'Reassigned — owner: Asha (fictional) → Ravi (fictional).',
    ],
    [
      'task.updated',
      { dueDate: '2026-10-01' },
      { dueDate: '2026-10-05' },
      'edit',
      'Edited due date.',
    ],
    [
      'task.status_changed',
      { status: 'in_progress' },
      { status: 'blocked', reason: 'Waiting for forms' },
      'status',
      'Status In progress → Blocked. Reason: Waiting for forms',
    ],
    [
      'task.dependency_added',
      null,
      { blockedBy: 'TSK-00001' },
      'dependency',
      'Now blocked by TSK-00001.',
    ],
    [
      'task.review_returned',
      null,
      { decisionNote: 'Add the receipt' },
      'review',
      'Returned by the reviewer and reopened: Add the receipt',
    ],
    [
      'task.reminder_sent',
      null,
      { kind: 'overdue', dueDate: '2026-10-19' },
      'reminder',
      'Overdue reminder sent (due 2026-10-19).',
    ],
    ['x.unknown', null, null, 'other', 'x.unknown'],
  ])('%s → %s', (action, before, after, kind, summary) => {
    expect(describeTaskActivity({ action, before, after }, names)).toEqual({ kind, summary });
  });
});

describe('SOP publication, review due and schedule', () => {
  const approved = { status: 'approved' as const, hasApprovedVersion: true, archived: false };
  it.each([
    [
      'approved, no effective date',
      { ...approved, effectiveDate: null },
      'approved_no_effective_date',
    ],
    [
      'approved, effective tomorrow',
      { ...approved, effectiveDate: '2026-10-21' },
      'approved_not_yet_effective',
    ],
    ['approved, effective today', { ...approved, effectiveDate: '2026-10-20' }, 'published'],
    [
      'draft with a date (e.g. coordinator SOP) is never published',
      {
        status: 'draft' as const,
        hasApprovedVersion: false,
        effectiveDate: '2026-01-01',
        archived: false,
      },
      'not_approved',
    ],
    [
      'retired',
      { ...approved, status: 'retired' as const, effectiveDate: '2026-01-01' },
      'retired',
    ],
    [
      'archived',
      { ...approved, status: 'retired' as const, effectiveDate: '2026-01-01', archived: true },
      'archived',
    ],
  ])('%s', (_, input, state) => {
    expect(sopPublicationState(input, TODAY)).toBe(state);
  });
  it.each([
    [null, 'not_set'],
    ['2026-10-19', 'overdue'],
    ['2026-10-20', 'due_soon'],
    ['2026-11-19', 'due_soon'],
    ['2026-11-20', 'ok'],
  ])('review date %s → %s (30-day window)', (date, flag) => {
    expect(reviewDueFlag(date, TODAY, 30)).toBe(flag);
  });
  const ok = {
    sopStatus: 'approved' as const,
    versionStatus: 'approved' as const,
    isVersionInForce: true,
    effectiveDate: '2026-10-20',
    nextReviewDate: '2027-10-20',
  };
  it.each([
    [{}, []],
    [{ versionStatus: 'draft' as const }, ['version_not_approved']],
    [{ isVersionInForce: false }, ['version_not_in_force']],
    [{ nextReviewDate: '2026-01-01' }, ['review_before_effective']],
    [{ sopStatus: 'retired' as const }, ['sop_retired']],
  ])('schedule problems %o', (over, problems) => {
    expect(sopScheduleProblems({ ...ok, ...over })).toEqual(problems);
  });
});

describe('SOP acknowledgements', () => {
  const dept = { id: 'r1', audienceType: 'department' as const, departmentId: 'd1', role: null };
  const role = { id: 'r2', audienceType: 'role' as const, departmentId: null, role: 'teacher' };
  it.each([
    [dept, { departmentId: 'd1', roles: [] }, true],
    [dept, { departmentId: 'd2', roles: ['teacher'] }, false],
    [role, { departmentId: null, roles: ['teacher'] }, true],
    [role, { departmentId: 'd1', roles: ['employee'] }, false],
  ])('audience %#', (req, person, inAudience) => {
    expect(inAckAudience(req, person)).toBe(inAudience);
  });
  it('splits acknowledged / outstanding / no login, sorted by name', () => {
    const split = acknowledgementStatus(
      [
        { staffId: 's2', userId: 'u2', name: 'Zara (fictional)' },
        { staffId: 's1', userId: 'u1', name: 'Asha (fictional)' },
        { staffId: 's3', userId: null, name: 'Mohan (fictional)' },
      ],
      new Set(['u2']),
    );
    expect(
      [split.acknowledged, split.outstanding, split.noLogin].map((l) => l.map((m) => m.name)),
    ).toEqual([['Zara (fictional)'], ['Asha (fictional)'], ['Mohan (fictional)']]);
  });
  const may = {
    versionInForce: true,
    inAudience: true,
    alreadyAcknowledged: false,
    readOnly: false,
  };
  it.each([
    [{}, []],
    [{ readOnly: true }, ['read_only_role']],
    [{ versionInForce: false }, ['no_version_in_force']],
    [{ inAudience: false }, ['not_in_audience']],
    [{ alreadyAcknowledged: true }, ['already_acknowledged']],
  ])('acknowledge problems %o', (over, problems) => {
    expect(acknowledgeProblems({ ...may, ...over })).toEqual(problems);
  });
});

describe('incident resolution targets (IST)', () => {
  const sla = { lowDays: 14, mediumDays: 7, highDays: 2 };
  const at = (iso: string) => new Date(iso);
  it.each([
    [
      'high, target day',
      {
        status: 'open',
        severity: 'high',
        occurredAt: at('2026-10-17T10:00:00Z'),
        resolvedAt: null,
      },
      at('2026-10-19T06:00:00Z'),
      'due_today',
    ],
    [
      'high, past target (IST next day)',
      {
        status: 'open',
        severity: 'high',
        occurredAt: at('2026-10-17T10:00:00Z'),
        resolvedAt: null,
      },
      LATE_UTC,
      'breached',
    ],
    [
      'medium, resolved in time',
      {
        status: 'resolved',
        severity: 'medium',
        occurredAt: at('2026-10-01T05:00:00Z'),
        resolvedAt: at('2026-10-05T05:00:00Z'),
      },
      NOON_IST,
      'resolved_within',
    ],
    [
      'medium, resolved late',
      {
        status: 'closed',
        severity: 'medium',
        occurredAt: at('2026-10-01T05:00:00Z'),
        resolvedAt: at('2026-10-12T05:00:00Z'),
      },
      NOON_IST,
      'resolved_late',
    ],
    [
      'unknown severity',
      { status: 'open', severity: 'x', occurredAt: at('2026-10-01T05:00:00Z'), resolvedAt: null },
      NOON_IST,
      'unrated',
    ],
  ])('%s', (_, incident, now, state) => {
    expect(incidentSla(incident, now, sla).state).toBe(state);
  });
  it('target date is the IST occurred date + N days', () => {
    expect(
      incidentSla(
        {
          status: 'open',
          severity: 'high',
          occurredAt: at('2026-10-17T20:00:00Z'),
          resolvedAt: null,
        },
        NOON_IST,
        sla,
      ).targetDate,
    ).toBe('2026-10-20');
  });
});

describe('mitigations and blocked projects', () => {
  it.each([
    ['planned', 'in_progress', null, true],
    ['planned', 'dropped', '', false],
    ['in_progress', 'dropped', 'Not needed after all', true],
    ['done', 'planned', null, false],
  ] as const)('%s → %s', (from, to, outcome, ok) => {
    expect(checkMitigationTransition(from, to, outcome).ok).toBe(ok);
  });
  const ms = [
    { id: 'm1', status: 'planned', dueDate: '2026-10-01', dependsOn: [] },
    { id: 'm2', status: 'planned', dueDate: '2026-11-01', dependsOn: ['m1'] },
  ];
  it.each([
    [
      'active, waiting on an overdue dependency',
      'active',
      ms,
      0,
      0,
      ['milestone_waiting_on_overdue_dependency'],
    ],
    [
      'on hold with blocked tasks and blockers',
      'on_hold',
      [],
      1,
      2,
      ['on_hold', 'blocked_tasks', 'open_blockers'],
    ],
    ['missed milestone', 'planned', [{ ...ms[0]!, status: 'missed' }], 0, 0, ['missed_milestone']],
    ['completed projects are never blocked', 'completed', ms, 3, 0, []],
  ])('%s', (_, status, milestones, blockedTasks, openBlockers, reasons) => {
    expect(
      projectBlockReasons({ status }, milestones, { blockedTasks, openBlockers }, TODAY),
    ).toEqual(reasons);
  });
});

describe('policies & compliance register', () => {
  it('POL codes', () => {
    expect(formatCode('policy', 7)).toBe('POL-0007');
  });
  it.each([
    ['draft', 'propose', false, 'proposed'],
    ['approved', 'save_draft', true, 'approved'],
    ['approved', 'propose', true, 'approved'],
    ['proposed', 'reject', false, 'draft'],
    ['proposed', 'approve', false, 'approved'],
    ['approved', 'retire', true, 'retired'],
    ['retired', 'save_draft', true, null],
    ['proposed', 'save_draft', false, null],
  ] as const)('%s + %s (approved version: %s) → %s', (from, action, hasApprovedVersion, to) => {
    const r = nextPolicyStatus(from, action, { hasApprovedVersion });
    expect(r.ok ? r.status : null).toBe(to);
  });
  it('proposal problems, incl. unknown setting keys (isSettingKey)', () => {
    expect(isSettingKey('tasks.reminders')).toBe(true);
    expect(
      policyProposalProblems({
        requirementText: '',
        accountableStaffId: null,
        effectiveDate: '2026-10-20',
        nextReviewDate: '2026-10-01',
        linkedSettingKeys: ['tasks.reminders', 'no.such.key'],
        isSettingKey,
      }),
    ).toEqual([
      'requirement_text_missing',
      'accountable_missing',
      'review_before_effective',
      'unknown_setting_key',
    ]);
  });
  it.each([
    ['u1', 'u1', ['self_approval']],
    ['u1', 'u2', []],
  ])('proposed by %s, decided by %s', (proposedByUserId, deciderUserId, problems) => {
    expect(
      policyApprovalProblems({ versionStatus: 'proposed', proposedByUserId, deciderUserId }),
    ).toEqual(problems);
  });
});

describe('operations KPIs: missing is not zero', () => {
  const task = (status: TaskStatus, dueDate: string | null) => ({
    status,
    dueDate: dueDate as IsoDate | null,
    completedAt: null,
  });
  const rows = [
    task('in_progress', '2026-10-19'),
    task('in_progress', '2026-10-25'),
    task('blocked', null),
    task('completed', '2026-10-01'),
  ];
  it.each([
    ['open tasks, empty', openTasksMetric([], NOON_IST), 'ok', 0],
    ['overdue share, empty', overdueTaskShare([], NOON_IST), 'missing', null],
    ['ack coverage, nothing required', sopAcknowledgementCoverage(0, 0, NOON_IST), 'missing', null],
    ['open tasks', openTasksMetric(rows, NOON_IST), 'ok', 3],
    ['overdue tasks', overdueTasksMetric(rows, NOON_IST), 'ok', 1],
    ['overdue share uses dated open tasks only', overdueTaskShare(rows, NOON_IST), 'ok', 50],
    ['ack coverage', sopAcknowledgementCoverage(3, 1, NOON_IST), 'ok', 33.3],
  ])('%s', (_, m, status, value) => {
    expect(m).toMatchObject({ status, value });
  });
  it('capacity rows: alphabetical, "Not assigned" last (not a ranking)', () => {
    const cap = taskCapacity(
      [
        { ...task('in_progress', '2026-10-19'), groupKey: 'b', groupLabel: 'Zara (fictional)' },
        { ...task('blocked', '2026-10-22'), groupKey: 'a', groupLabel: 'Asha (fictional)' },
        { ...task('in_progress', null), groupKey: null, groupLabel: null },
        { ...task('completed', null), groupKey: 'a', groupLabel: 'Asha (fictional)' },
      ],
      NOON_IST,
    );
    expect(cap.map((r) => [r.label, r.open, r.overdue, r.blocked, r.dueNext7Days])).toEqual([
      ['Asha (fictional)', 1, 0, 1, 1],
      ['Zara (fictional)', 1, 1, 0, 0],
      ['Not assigned', 1, 0, 0, 0],
    ]);
  });
  it('deadlines: today … today+7, soonest first', () => {
    const items = ['2026-10-19', '2026-10-20', '2026-10-27', '2026-10-28'].map((d, i) => ({
      kind: 'task' as const,
      id: String(i),
      title: `T${i}`,
      dueDate: d as IsoDate,
      link: '/ops/tasks',
    }));
    expect(upcomingDeadlines(items, NOON_IST).map((i) => i.dueDate)).toEqual([
      '2026-10-20',
      '2026-10-27',
    ]);
  });
  it.each(['tasks.reminders', 'incidents.resolution_sla', 'registers.review_due'] as const)(
    'new setting %s defaults to proposed',
    (key) => {
      expect(resolveSettings([])[key].decisionState).toBe('proposed');
    },
  );
});
