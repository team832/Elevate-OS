/**
 * Team / period report (owner brief 2 §12 C): date-aware counts replayed from task events, EOD
 * coverage per person-day, blockers and unresolved decisions. Scope (R3): all-scope task readers
 * see everyone; others see themselves and the people who report to them now. Downloads (PDF,
 * CSV) use the same scope and are audited.
 */
import { and, eq, gte, inArray, lte, max, ne, sql, type SQL } from 'drizzle-orm';
import {
  departments,
  opsEodReports as reports,
  opsEodReviewEvents as reviewEvents,
  staffMembers,
  type Database,
} from '@elevate/database';
import { recordAudit, toCsv } from '@elevate/server-kit';
import type { DepartmentId, StaffMemberId } from '@elevate/shared-types';
import { addDays, daysBetween, istInstant, istToday, type IsoDate } from '../domain/dates';
import { eventsByTask, taskStateAt } from '../domain/eod';
import { isOverdue } from '../domain/staff-tasks';
import { fmtDate, fmtDateTime } from '../ui/format';
import { accessScope, managedStaffIds, staffIdForUser, type Actor } from './context';
import { taskHistory } from './eod-facts';
import { fieldError } from './ops-common';
import { createPdf } from './pdf/document';

export const MAX_PERIOD_DAYS = 92;

export const PERIOD_DEFINITIONS = [
  [
    'Assigned during period',
    'Tasks given to the person (created, assigned or reassigned to them, or imported) by an event dated in the period. Each task counts once.',
  ],
  [
    'Completed during period',
    'Tasks marked done by an event dated in the period. A task finished after the period is not counted; this is not the same as "currently done".',
  ],
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
    'Per person and calendar day up to today (no working-days policy exists): submitted (any version), acknowledged by the manager, missing (no submitted report). A missing report is not absence; there is no HR attendance source.',
  ],
  ['Cut-off', 'The end of the last day of the period (IST), or now if that day has not ended.'],
] as const;

export async function periodReport(
  db: Database,
  actor: Actor,
  q: { from: string; to: string; staffId?: string; departmentId?: string },
) {
  const access = await accessScope(db, actor, 'ops:tasks:read');
  if (daysBetween(q.from as IsoDate, q.to as IsoDate) >= MAX_PERIOD_DAYS)
    throw fieldError('to', `Choose a period of ${MAX_PERIOD_DAYS} days or fewer.`);
  const self = await staffIdForUser(db, actor.id);
  const scope =
    access.scope === 'all' ? null : self ? [self, ...(await managedStaffIds(db, self))] : [];
  const now = new Date();
  const start = istInstant(q.from);
  const end = istInstant(addDays(q.to as IsoDate, 1));
  const asOf = now < end ? now : new Date(end.getTime() - 1);
  const filters: (SQL | undefined)[] = [
    scope ? (scope.length ? inArray(staffMembers.id, scope) : sql`false`) : undefined,
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
  const eodRows = ids.length
    ? await db
        .select({
          staffId: reports.staffId,
          id: reports.id,
          reportDate: reports.reportDate,
          status: reports.status,
        })
        .from(reports)
        .where(
          and(
            inArray(reports.staffId, ids as StaffMemberId[]),
            gte(reports.reportDate, q.from),
            lte(reports.reportDate, q.to),
            ne(reports.status, 'draft'),
          ),
        )
    : [];

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
  const assigned = tally(
    inPeriod
      .filter(
        (e) => ['created', 'assigned', 'reassigned', 'imported'].includes(e.kind) && e.toStaffId,
      )
      .map((e) => [e.toStaffId!, e.taskId]),
  );
  const completed = tally(
    inPeriod
      .filter((e) => e.toStatus === 'done')
      .map((e) => [stateAt(e.taskId, e.occurredAt)?.owner ?? '', e.taskId]),
  );
  const open = history.tasks.flatMap((t) => {
    const s = stateAt(t.id, asOf);
    return s && ids.includes(s.owner) && s.status !== 'done' && s.status !== 'cancelled'
      ? [{ t, s }]
      : [];
  });
  const name = new Map(staff.map((s) => [s.staffId as string, s.name]));
  const lastDay = q.to < istToday(now) ? q.to : istToday(now);
  const days = lastDay < q.from ? 0 : daysBetween(q.from as IsoDate, lastDay as IsoDate) + 1;

  const people = staff.map((p) => {
    const mine = open.filter((o) => o.s.owner === p.staffId);
    const eod = eodRows.filter((r) => r.staffId === p.staffId);
    const expected = p.status !== 'inactive' && p.hasLogin ? days : null;
    return {
      staffId: p.staffId,
      name: p.name,
      department: p.department,
      assigned: assigned.get(p.staffId)?.size ?? 0,
      completed: completed.get(p.staffId)?.size ?? 0,
      open: mine.length,
      overdue: mine.filter((o) => isOverdue(o.s, asOf)).length,
      blocked: mine.filter((o) => o.s.status === 'blocked').length,
      eod: {
        days: expected,
        submitted: eod.length,
        acknowledged: eod.filter((r) => r.status === 'acknowledged').length,
        missing: expected === null ? null : Math.max(0, expected - eod.length),
      },
    };
  });
  const blockers = open
    .filter((o) => o.s.status === 'blocked')
    .map((o) => ({
      taskId: o.t.id,
      title: o.t.title,
      owner: name.get(o.s.owner) ?? '',
      reason: o.s.reason,
      since: o.s.since?.toISOString() ?? null,
      ageDays: o.s.since ? daysBetween(istToday(o.s.since), istToday(asOf)) : null,
    }))
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
  const sum = (k: 'assigned' | 'completed' | 'open' | 'overdue' | 'blocked') =>
    people.reduce((n, p) => n + p[k], 0);
  return {
    window: { from: q.from, to: q.to },
    asOf: asOf.toISOString(),
    people,
    totals: {
      assigned: sum('assigned'),
      completed: sum('completed'),
      open: sum('open'),
      overdue: sum('overdue'),
      blocked: sum('blocked'),
      eodSubmitted: people.reduce((n, p) => n + p.eod.submitted, 0),
      eodMissing: people.reduce((n, p) => n + (p.eod.missing ?? 0), 0),
    },
    blockers,
    decisions,
    revisions,
  };
}
export type PeriodReport = Awaited<ReturnType<typeof periodReport>>;

const filterLine = (r: PeriodReport, q: { staffId?: string; departmentId?: string }) =>
  `${fmtDate(r.window.from)} – ${fmtDate(r.window.to)} · cut-off ${fmtDateTime(r.asOf)}${q.staffId ? ' · one person' : ''}${q.departmentId ? ' · one department' : ''}`;

const PEOPLE_HEADER = [
  'Person',
  'Department',
  'Assigned',
  'Completed',
  'Open at cut-off',
  'Overdue at cut-off',
  'Blocked',
  'EOD calendar days',
  'EOD submitted',
  'EOD acknowledged',
  'EOD missing',
];
const personRow = (p: PeriodReport['people'][number]) => [
  p.name,
  p.department,
  p.assigned,
  p.completed,
  p.open,
  p.overdue,
  p.blocked,
  p.eod.days,
  p.eod.submitted,
  p.eod.acknowledged,
  p.eod.missing,
];

async function exported(db: Database, actor: Actor, format: string, q: object) {
  await recordAudit(db, {
    actorUserId: actor.id,
    module: 'ops',
    action: 'task_report.exported',
    entityType: 'task_report',
    entityId: null,
    metadata: { format, ...q },
  });
}

export async function periodReportCsv(
  db: Database,
  actor: Actor,
  q: Parameters<typeof periodReport>[2],
) {
  const r = await periodReport(db, actor, q);
  await exported(db, actor, 'csv', q);
  const blank = PEOPLE_HEADER.map(() => '');
  return {
    csv: toCsv(PEOPLE_HEADER, [
      ...r.people.map(personRow),
      blank,
      ['Blocked task', 'Owner', 'Blocked since', 'Age (days)', 'Reason'],
      ...r.blockers.map((b) => [
        b.title,
        b.owner,
        b.since ? fmtDateTime(b.since) : '',
        b.ageDays,
        b.reason,
      ]),
      blank,
      ['Unresolved decision', 'Owner', 'What', 'Since', 'Detail'],
      ...r.decisions.map((d) => [
        d.title,
        d.owner,
        d.what,
        d.since ? fmtDateTime(d.since) : '',
        d.detail,
      ]),
      blank,
      ['EOD revision requested', 'Report day', 'Since'],
      ...r.revisions.map((x) => [x.name, x.reportDate, fmtDateTime(x.since)]),
    ]),
    filename: `task-report-${q.from}-to-${q.to}.csv`,
  };
}

export async function periodReportPdf(
  db: Database,
  actor: Actor,
  q: Parameters<typeof periodReport>[2],
) {
  const r = await periodReport(db, actor, q);
  const pdf = await createPdf({
    title: 'Task and EOD report',
    reference: filterLine(r, q),
    templateVersion: 'task-period-report v1',
  });
  pdf.keyValues([
    ['Period', `${fmtDate(r.window.from)} – ${fmtDate(r.window.to)} (IST)`],
    ['Cut-off', fmtDateTime(r.asOf)],
    ['People', r.people.length],
    [
      'Source',
      'Task events and work updates; EOD reports in Business Ops. HR attendance unavailable.',
    ],
  ]);
  pdf.heading('By person');
  pdf.table(
    PEOPLE_HEADER.filter((h) => h !== 'Department').map((header, i) => ({
      header,
      width: i === 0 ? 0.28 : 0.08,
      align: i ? ('right' as const) : undefined,
    })),
    r.people.map((p) => personRow(p).filter((_, i) => i !== 1)),
  );
  pdf.heading(`Blocked at cut-off (${r.blockers.length})`);
  if (r.blockers.length)
    pdf.table(
      [
        { header: 'Task', width: 0.35 },
        { header: 'Owner', width: 0.2 },
        { header: 'Age (days)', width: 0.12, align: 'right' },
        { header: 'Reason', width: 0.33 },
      ],
      r.blockers.map((b) => [b.title, b.owner, b.ageDays, b.reason]),
    );
  else pdf.paragraph('None.', { muted: true });
  pdf.heading(`Unresolved decisions (${r.decisions.length})`);
  if (r.decisions.length)
    pdf.table(
      [
        { header: 'Task', width: 0.35 },
        { header: 'Owner', width: 0.2 },
        { header: 'What', width: 0.2 },
        { header: 'Detail', width: 0.25 },
      ],
      r.decisions.map((d) => [d.title, d.owner, d.what, d.detail]),
    );
  else pdf.paragraph('None.', { muted: true });
  pdf.heading(`EOD revisions requested (${r.revisions.length})`);
  if (r.revisions.length)
    pdf.table(
      [
        { header: 'Person', width: 0.5 },
        { header: 'Report day', width: 0.5 },
      ],
      r.revisions.map((x) => [x.name, fmtDate(x.reportDate)]),
    );
  else pdf.paragraph('None.', { muted: true });
  pdf.heading('How these are counted');
  pdf.keyValues(PERIOD_DEFINITIONS.map(([k, v]) => [k, v]));
  await exported(db, actor, 'pdf', q);
  return { bytes: await pdf.finish(), filename: `task-report-${q.from}-to-${q.to}.pdf` };
}

/** People and departments the reader may filter the period report by (same scope as the report). */
export async function reportFilterOptions(db: Database, actor: Actor) {
  const access = await accessScope(db, actor, 'ops:tasks:read');
  const self = await staffIdForUser(db, actor.id);
  const scope =
    access.scope === 'all' ? null : self ? [self, ...(await managedStaffIds(db, self))] : [];
  const [staff, depts] = await Promise.all([
    db
      .select({ value: staffMembers.id, label: staffMembers.fullName })
      .from(staffMembers)
      .where(scope ? (scope.length ? inArray(staffMembers.id, scope) : sql`false`) : undefined)
      .orderBy(staffMembers.fullName),
    db
      .select({ value: departments.id, label: departments.name })
      .from(departments)
      .orderBy(departments.name),
  ]);
  return { staff, departments: depts };
}
