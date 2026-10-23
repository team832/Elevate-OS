/**
 * Team / period report (owner brief 2 §12 C): date-aware counts replayed from task events, EOD
 * coverage per person-day, blockers and unresolved decisions, and (brief 23 Oct 2026 §14) each
 * person's submissions and on-time rate side by side — never a ranking or a combined score (R13).
 * Scope (R3): all-scope task readers see everyone; others see themselves and the people who
 * report to them now. The HR view (`hr: true`, ops:work_reports:read) covers the staff HR manages
 * (hr.staff_scope_departments). Downloads (PDF, CSV) use the same scope and are audited.
 */
import { and, eq, gte, inArray, lte, max, ne, sql, type SQL } from 'drizzle-orm';
import {
  departments,
  opsEodReports as reports,
  opsEodReviewEvents as reviewEvents,
  staffMembers,
  type Database,
} from '@elevate/database';
import type { DepartmentId, StaffMemberId } from '@elevate/shared-types';
import { addDays, daysBetween, istInstant, istToday, type IsoDate } from '../domain/dates';
import { dueTaskAt, eventsByTask, isReceipt, taskStateAt } from '../domain/eod';
import {
  isExpectedDay,
  METRIC_DEFINITIONS,
  onTimeRate,
  periodOf,
  reviewTurnaround,
} from '../domain/work-report';
import { deadlineInstant, isOverdue } from '../domain/staff-tasks';
import { accessScope, managedStaffIds, staffIdForUser, type Actor } from './context';
import { attendanceStaff, deriveDays } from './attendance';
import { taskHistory } from './eod-facts';
import { reportSettings } from './eod-reports';
import { hrScopeFor, hrScopeWhere } from './organisation';
import { fieldError } from './ops-common';

export { periodReportCsv, periodReportPdf } from './task-period-export';

export const MAX_PERIOD_DAYS = 92;

export const PERIOD_DEFINITIONS = [
  [
    'Assigned during period',
    'Tasks given to the person (created, assigned or reassigned to them, or imported) by an event dated in the period. Each task counts once.',
  ],
  ['Submitted during period', METRIC_DEFINITIONS.submitted],
  [
    'Completed during period',
    'Tasks approved, or marked done when no review is needed, by an event dated in the period. A task finished after the period is not counted; this is not the same as "currently done".',
  ],
  ['On time', METRIC_DEFINITIONS.onTime],
  [
    'Open at cut-off',
    'Tasks not done and not cancelled at the cut-off, replayed from their history (not their status today).',
  ],
  [
    'Overdue at cut-off',
    'Open at cut-off and past the due time (or the end of the due day) at the cut-off.',
  ],
  ['Blocker age', 'Whole days from when the task became blocked to the cut-off.'],
  [
    'EOD coverage',
    'Per person, on the finished days of the period that are scheduled workdays by HR attendance rules (approved holidays, approved leave and weekly offs are not expected): submitted (any version), reviewed by the manager, missing (no submitted report). With no work schedule the expectation is unknown and nothing is counted missing. A missing report is not an absence.',
  ],
  ['No ranking', 'Figures are per person, side by side. There is no combined score or ranking.'],
  ['Cut-off', 'The end of the last day of the period (IST), or now if that day has not ended.'],
] as const;

/** Who the reader may report on: undefined = everyone; the HR view = the staff HR manages. */
export async function staffScope(
  db: Database,
  actor: Actor,
  hr: boolean,
): Promise<SQL | undefined> {
  if (hr) {
    await accessScope(db, actor, 'ops:work_reports:read');
    return hrScopeWhere(await hrScopeFor(db, actor));
  }
  const access = await accessScope(db, actor, 'ops:tasks:read');
  if (access.scope === 'all') return undefined;
  const self = await staffIdForUser(db, actor.id);
  const ids = self ? [self, ...(await managedStaffIds(db, self))] : [];
  return ids.length ? inArray(staffMembers.id, ids) : sql`false`;
}

export async function periodReport(
  db: Database,
  actor: Actor,
  q: { from: string; to: string; staffId?: string; departmentId?: string },
  { hr = false } = {},
) {
  const scope = await staffScope(db, actor, hr);
  if (daysBetween(q.from as IsoDate, q.to as IsoDate) >= MAX_PERIOD_DAYS)
    throw fieldError('to', `Choose a period of ${MAX_PERIOD_DAYS} days or fewer.`);
  const now = new Date();
  const start = istInstant(q.from);
  const end = istInstant(addDays(q.to as IsoDate, 1));
  const asOf = now < end ? now : new Date(end.getTime() - 1);
  const filters: (SQL | undefined)[] = [
    scope,
    q.staffId ? eq(staffMembers.id, q.staffId as StaffMemberId) : undefined,
    q.departmentId ? eq(staffMembers.departmentId, q.departmentId as DepartmentId) : undefined,
  ];
  const staff = await db
    .select({
      staffId: staffMembers.id,
      name: staffMembers.fullName,
      status: staffMembers.status,
      hasLogin: staffMembers.userId,
      department: departments.name,
    })
    .from(staffMembers)
    .leftJoin(departments, eq(departments.id, staffMembers.departmentId))
    .where(and(...filters))
    .orderBy(staffMembers.fullName);
  const ids = staff.map((s) => s.staffId as string);
  const history = ids.length ? await taskHistory(db, ids, now) : { tasks: [], events: [] };
  const reportRows = ids.length
    ? await db
        .select({
          staffId: reports.staffId,
          id: reports.id,
          kind: reports.periodKind,
          reportDate: reports.periodStart,
          status: reports.status,
        })
        .from(reports)
        .where(
          and(
            inArray(reports.staffId, ids as StaffMemberId[]),
            gte(reports.periodStart, q.from),
            lte(reports.periodStart, q.to),
            ne(reports.status, 'draft'),
          ),
        )
    : [];
  const eodRows = reportRows.filter((r) => r.kind === 'day');

  const inPeriod = history.events.filter((e) => e.occurredAt >= start && e.occurredAt < end);
  const byId = new Map(history.tasks.map((t) => [t.id as string, t]));
  const byTask = eventsByTask(history.events);
  const stateAt = (taskId: string, t: Date) =>
    taskStateAt(byId.get(taskId)!, byTask.get(taskId), t);
  const tally = (pairs: [string, string][]) => {
    const m = new Map<string, Set<string>>();
    for (const [staffId, taskId] of pairs)
      m.set(staffId, (m.get(staffId) ?? new Set()).add(taskId));
    return m;
  };
  // Received while not a draft (a draft counts when it is published), by the owner then.
  const assigned = tally(
    inPeriod.flatMap((e) => {
      const s = stateAt(e.taskId, e.occurredAt);
      return isReceipt(e) && s && s.status !== 'draft'
        ? [[e.toStaffId ?? s.owner, e.taskId] as [string, string]]
        : [];
    }),
  );
  const completed = tally(
    inPeriod
      .filter((e) => e.toStatus === 'done')
      .map((e) => [stateAt(e.taskId, e.occurredAt)?.owner ?? '', e.taskId]),
  );
  const owned = history.tasks.flatMap((t) => {
    const at = dueTaskAt(t, byTask.get(t.id), asOf);
    return at && ids.includes(at.s.owner) ? [{ t, ...at }] : [];
  });
  const open = owned.filter(({ s }) => !['done', 'cancelled', 'draft'].includes(s.status));
  const submissions = inPeriod.filter(
    (e) =>
      e.kind === 'submitted_for_review' &&
      ids.includes(stateAt(e.taskId, e.occurredAt)?.owner ?? ''),
  );
  const submitted = tally(
    submissions.map((e) => [stateAt(e.taskId, e.occurredAt)!.owner, e.taskId]),
  );
  const timeliness = (staffId?: string) =>
    onTimeRate(
      owned.filter((o) => !staffId || o.s.owner === staffId).map((o) => o.due),
      { start: q.from, end: q.to },
    );
  const figures = ({ rows: _r, ...t }: ReturnType<typeof timeliness>) => t;
  const name = new Map(staff.map((s) => [s.staffId as string, s.name]));
  const lastDay = q.to < istToday(now) ? q.to : istToday(now);
  const days = lastDay < q.from ? 0 : daysBetween(q.from as IsoDate, lastDay as IsoDate) + 1;
  // Expected EOD days: finished days (before today) that are scheduled workdays (ATT's rules).
  const yesterday = addDays(istToday(now), -1);
  const derived = await deriveDays(
    db,
    ids.length ? await attendanceStaff(db, { ids }) : [],
    q.from as IsoDate,
    (q.to < yesterday ? q.to : yesterday) as IsoDate,
  );

  const people = staff.map((p) => {
    const mine = open.filter((o) => o.s.owner === p.staffId);
    const eod = eodRows.filter((r) => r.staffId === p.staffId);
    const mineDays = derived.get(p.staffId) ?? [];
    const note =
      p.status === 'inactive' || !p.hasLogin
        ? ('no_login' as const)
        : mineDays.length && mineDays.every((d) => d.scheduled === null)
          ? ('no_schedule' as const)
          : null;
    const expectedDays = note ? null : mineDays.filter(isExpectedDay).map((d) => d.date as string);
    return {
      staffId: p.staffId,
      name: p.name,
      department: p.department,
      assigned: assigned.get(p.staffId)?.size ?? 0,
      submitted: submitted.get(p.staffId)?.size ?? 0,
      completed: completed.get(p.staffId)?.size ?? 0,
      open: mine.length,
      overdue: mine.filter((o) => isOverdue(o.s, asOf)).length,
      blocked: mine.filter((o) => o.s.blocked).length,
      onTime: figures(timeliness(p.staffId)),
      periodic: reportRows.filter((r) => r.staffId === p.staffId && r.kind !== 'day').length,
      eod: {
        days: expectedDays?.length ?? null,
        /** Why nothing is expected: no sign-in / inactive, or no work schedule known. */
        note,
        submitted: eod.length,
        acknowledged: eod.filter((r) => r.status === 'acknowledged').length,
        missing:
          expectedDays && expectedDays.filter((d) => !eod.some((r) => r.reportDate === d)).length,
      },
    };
  });
  const blockers = open
    .flatMap(({ t, s: { blocked: b, owner } }) =>
      b
        ? [
            {
              taskId: t.id,
              title: t.title,
              owner: name.get(owner) ?? '',
              reason: b.reason,
              since: b.since?.toISOString() ?? null,
              ageDays: b.since ? daysBetween(istToday(b.since), istToday(asOf)) : null,
            },
          ]
        : [],
    )
    .sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));
  const clarifications = inPeriod.filter(
    (e) =>
      e.kind === 'clarification_requested' &&
      !(byTask.get(e.taskId) ?? []).some(
        (x) => x.kind === 'acknowledged' && x.occurredAt > e.occurredAt && x.occurredAt <= asOf,
      ),
  );
  const decisions = [
    ...open
      .filter((o) => o.s.status === 'in_review')
      .map((o) => ({
        taskId: o.t.id,
        title: o.t.title,
        owner: name.get(o.s.owner) ?? '',
        what: 'Awaiting review',
        since: o.s.since?.toISOString() ?? null,
        detail: null as string | null,
      })),
    ...clarifications.map((e) => ({
      taskId: e.taskId,
      title: byId.get(e.taskId)!.title,
      owner: name.get(stateAt(e.taskId, e.occurredAt)?.owner ?? '') ?? '',
      what: 'Clarification requested',
      since: e.occurredAt.toISOString(),
      detail: e.reason,
    })),
  ].filter((d, i, all) => all.findIndex((x) => x.taskId === d.taskId && x.what === d.what) === i);
  const pending = eodRows.filter((r) => r.status === 'revision_requested');
  const requests = pending.length
    ? await db
        .select({ reportId: reviewEvents.reportId, at: max(reviewEvents.createdAt) })
        .from(reviewEvents)
        .where(
          and(
            inArray(
              reviewEvents.reportId,
              pending.map((r) => r.id),
            ),
            eq(reviewEvents.kind, 'revision_requested'),
          ),
        )
        .groupBy(reviewEvents.reportId)
    : [];
  const revisions = pending.map((r) => ({
    reportId: r.id,
    name: name.get(r.staffId) ?? '',
    reportDate: r.reportDate,
    since: requests.find((x) => x.reportId === r.id)?.at?.toISOString() ?? null,
  }));
  const sum = (k: 'assigned' | 'submitted' | 'completed' | 'open' | 'overdue' | 'blocked') =>
    people.reduce((n, p) => n + p[k], 0);
  const all = timeliness();
  const turnaround = reviewTurnaround(
    submissions.map((e) => ({
      taskId: e.taskId,
      title: byId.get(e.taskId)!.title,
      submittedAt: e.occurredAt,
      decidedAt:
        byTask
          .get(e.taskId)!
          .find(
            (x) =>
              (x.kind === 'review_approved' || x.kind === 'changes_requested') &&
              x.occurredAt > e.occurredAt &&
              x.occurredAt <= asOf,
          )?.occurredAt ?? null,
    })),
  );
  // Weeks (from reports.week_start) when the period is longer than a month: never 90 slivers.
  const { weekStart } = await reportSettings(db);
  const bucket = (day: string) =>
    days > 31 ? periodOf('week', day as IsoDate, weekStart).start : day;
  const buckets = [
    ...new Set(
      Array.from({ length: Math.max(days, 1) }, (_, i) => bucket(addDays(q.from as IsoDate, i))),
    ),
  ];
  const series = buckets.map((b) => ({
    bucket: b,
    due: all.rows.filter((r) => bucket(r.dueOn) === b).length,
    submitted: submissions.filter((e) => bucket(istToday(e.occurredAt)) === b).length,
  }));
  return {
    window: { from: q.from, to: q.to },
    asOf: asOf.toISOString(),
    people,
    totals: {
      assigned: sum('assigned'),
      submitted: sum('submitted'),
      completed: sum('completed'),
      open: sum('open'),
      overdue: sum('overdue'),
      blocked: sum('blocked'),
      eodSubmitted: people.reduce((n, p) => n + p.eod.submitted, 0),
      eodMissing: people.reduce((n, p) => n + (p.eod.missing ?? 0), 0),
      onTime: figures(all),
      turnaround,
    },
    series,
    backlog: {
      dueNotSubmitted: all.rows.filter(
        (r) => r.outcome === 'not_submitted' && deadlineInstant(r.dueOn, r.dueTime) <= asOf,
      ).length,
      awaitingReview: open.filter((o) => o.s.status === 'in_review').length,
      changesRequested: open.filter((o) => o.s.status === 'changes_requested').length,
      reportsAwaitingReview: reportRows.filter((r) => r.status === 'submitted').length,
    },
    blockers,
    decisions,
    revisions,
  };
}
export type PeriodReport = Awaited<ReturnType<typeof periodReport>>;

/** People and departments the reader may filter the period report by (same scope as the report). */
export async function reportFilterOptions(db: Database, actor: Actor, { hr = false } = {}) {
  const scope = await staffScope(db, actor, hr);
  const [staff, depts] = await Promise.all([
    db
      .select({ value: staffMembers.id, label: staffMembers.fullName })
      .from(staffMembers)
      .where(scope)
      .orderBy(staffMembers.fullName),
    db
      .select({ value: departments.id, label: departments.name })
      .from(departments)
      .orderBy(departments.name),
  ]);
  return { staff, departments: depts };
}
