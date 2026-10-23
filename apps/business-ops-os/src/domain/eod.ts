/**
 * Work-report facts: end-of-day (owner brief 2 §9, ruling R2), weekly and monthly (brief 23 Oct
 * 2026 §13–14, R7). Pure.
 * A-TSK-4 "My day" grouping (from current task state, used by the day view) and A-TSK-8, the
 * report snapshot, built ONLY from task events and work updates dated inside the IST period: a
 * task finished after the period is not completed in it, a five-day task counts once, the open
 * backlog and the blocked flag are replayed from events as of the cut-off (never the current
 * status), and class time from Academic is never added to task time. Week and month reports add
 * the timeliness figures of domain/work-report.ts.
 */
import type { AcademicTeacherActivityV1, SourceResult } from '@elevate/shared-contracts';
import type { AttendanceSummary } from './attendance';
import { addDays, istInstant, istToday, type IsoDate } from './dates';
import { byPriority } from './eod-day';
import {
  blockOf,
  byTime,
  eventsByTask,
  isReceipt,
  OWNERSHIP,
  taskStateAt,
  type FactEvent,
  type FactTask,
  type FactUpdate,
} from './eod-replay';
import { isOverdue, type TaskEventKind, type TaskPriority, type TaskStatus } from './staff-tasks';
import {
  onTimeRate,
  reviewTurnaround,
  type DueTask,
  type PeriodKind,
  type Timeliness,
} from './work-report';
export { buildEodSnapshot, missingReasons, type EodItem, type EodSnapshot } from './eod-day';
export {
  eventsByTask,
  isReceipt,
  taskStateAt,
  type EventStatus,
  type FactEvent,
  type FactTask,
  type FactUpdate,
} from './eod-replay';
export { eodPlainText, fmtMinutes } from './eod-text';

export interface FactItem {
  taskId: string;
  title: string;
  at: string;
  detail: string | null;
}
export interface WorkItem {
  updateId: string;
  taskId: string;
  title: string;
  workPerformed: string;
  result: string | null;
  blocker: string | null;
  nextStep: string | null;
  /** Minutes inside the report period; null = no time recorded. */
  minutes: number | null;
  /** IST day it was entered, when after the report period. */
  enteredOn: string | null;
  /** The task's Academic link: the same activity as the class, never added twice. */
  sameActivity: string | null;
  overlaps: boolean;
}
export interface BacklogItem {
  taskId: string;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  reason: string | null;
  /** Blocked or on hold at the cut-off (the flag keeps the lifecycle status). */
  blocked: boolean;
  dueOn: string;
  dueTime: string | null;
  overdue: boolean;
  /** Done or cancelled since the cut-off (no reason can be added now). */
  closedLater: boolean;
}

type Metric = number | null;
export type AcademicFacts =
  | { status: 'unavailable'; reason: string; checkedAt: string }
  | {
      status: 'available';
      checkedAt: string;
      planned: Metric;
      delivered: Metric;
      cancelled: Metric;
      substituted: Metric;
      logsPending: Metric;
      markingPending: Metric;
      reviewsSubmitted: Metric;
      /** Optional in the contract (23 Oct 2026): absent = Academic did not report it. */
      topicsCovered?: AcademicTeacherActivityV1['topicsCovered'];
      assessmentsPrepared?: Metric;
      assessmentsMarked?: Metric;
    };

/** HR attendance for the period (domain/attendance.ts); never derived from tasks or classes. */
export type AttendanceFacts =
  { status: 'unavailable'; reason: string } | ({ status: 'available' } & AttendanceSummary);
export interface DevelopmentItem {
  action: string;
  dueOn: string | null;
  status: string;
}

export const EOD_FACTS_FORMAT = 'eod-facts/2';
const FORMATS = ['eod-facts/1', EOD_FACTS_FORMAT];
export const DURATION_DEFINITION =
  'Minutes recorded on task updates for this period. Start/stop entries count only the part inside the period (IST). Attendance hours and Academic class time are not included.';

export interface EodFacts {
  format: typeof EOD_FACTS_FORMAT;
  staffId: string;
  /** Day = the report day; week / month = the first day of the period. */
  reportDate: string;
  periodKind?: PeriodKind;
  periodEnd?: string;
  /** IST period as instants: [from, to). */
  window: { from: string; to: string };
  /** Backlog and overdue are judged at this instant (end of the period, or the generation time). */
  asOf: string;
  generatedAt: string;
  received: FactItem[];
  acknowledged: FactItem[];
  /** Sent for review in the period (absent in reports made before 23 Oct 2026). */
  submitted?: FactItem[];
  /** Approved, or done when no review is needed. */
  completed: FactItem[];
  blocked: FactItem[];
  /** Help asked for: clarification requested (sending for review is not a request for help). */
  decisions: (FactItem & { kind: TaskEventKind })[];
  work: WorkItem[];
  backlog: BacklogItem[];
  duration: { minutes: number | null; definition: string; overlaps: boolean; sameActivity: number };
  academic: AcademicFacts;
  timeliness?: Timeliness;
  turnaround?: ReturnType<typeof reviewTurnaround>;
  attendance?: AttendanceFacts;
  development?: DevelopmentItem[] | null;
  counts: {
    received: number;
    acknowledged: number;
    worked: number;
    submitted?: number;
    completed: number;
    blocked: number;
    decisions: number;
    backlog: number;
    overdue: number;
  };
  noActivity: boolean;
  /** Report deadline in force when this version was submitted (late is judged from it). */
  deadline?: string | null;
}

export interface EodInput {
  staffId: string;
  /** First day of the period (the report day for an EOD). */
  reportDate: string;
  periodKind?: PeriodKind;
  /** Last day of the period; default = reportDate. */
  periodEnd?: string;
  now: Date;
  tasks: readonly FactTask[];
  events: readonly FactEvent[];
  /** Updates written by the staff member (the query may include neighbouring days). */
  updates: readonly FactUpdate[];
  academic: SourceResult<AcademicTeacherActivityV1>;
  attendance?: AttendanceFacts;
  development?: DevelopmentItem[] | null;
}

const metric = (m: { status: string; value: number | null }): Metric =>
  m.status === 'missing' ? null : m.value;

export function academicFacts(r: SourceResult<AcademicTeacherActivityV1>): AcademicFacts {
  if (r.status === 'unavailable')
    return { status: 'unavailable', reason: r.reason, checkedAt: r.fetchedAt };
  const d = r.data;
  return {
    status: 'available',
    checkedAt: r.fetchedAt,
    planned: metric(d.sessions.planned),
    delivered: metric(d.sessions.delivered),
    cancelled: metric(d.sessions.cancelled),
    substituted: metric(d.sessions.substituted),
    logsPending: metric(d.logsPending),
    markingPending: metric(d.markingPending),
    reviewsSubmitted: metric(d.reviews.submitted),
    ...(d.topicsCovered ? { topicsCovered: d.topicsCovered } : {}),
    ...(d.assessments
      ? {
          assessmentsPrepared: metric(d.assessments.prepared),
          assessmentsMarked: metric(d.assessments.marked),
        }
      : {}),
  };
}

const firstPerTask = <T extends { taskId: string }>(items: T[]) =>
  items.filter((x, i) => items.findIndex((y) => y.taskId === x.taskId) === i);

/** Minutes of [start, end) inside [from, to). */
const minutesInside = (start: Date, end: Date, from: Date, to: Date) =>
  Math.max(
    0,
    Math.round(
      (Math.min(end.getTime(), to.getTime()) - Math.max(start.getTime(), from.getTime())) / 60000,
    ),
  );

const SUBMITS = (e: FactEvent) => e.kind === 'submitted_for_review' || e.toStatus === 'done';
const DECIDES = (e: FactEvent) => e.kind === 'review_approved' || e.kind === 'changes_requested';

/** A task at the cut-off: its replayed state and its A-REP-2 input (null = not created yet). */
export function dueTaskAt(t: FactTask, mine: readonly FactEvent[] = [], asOf: Date) {
  const s = taskStateAt(t, mine, asOf);
  if (!s) return null;
  const firstAt =
    mine.find((e) => SUBMITS(e) && e.occurredAt <= asOf)?.occurredAt ??
    (t.firstSubmittedAt && t.firstSubmittedAt <= asOf ? t.firstSubmittedAt : null);
  const due: DueTask = {
    taskId: t.id,
    title: t.title,
    status: s.status,
    dueOn: s.dueOn,
    dueTime: s.dueTime,
    originalDueOn: t.originalDueOn ?? s.dueOn,
    originalDueTime: t.originalDueOn ? (t.originalDueTime ?? null) : s.dueTime,
    firstSubmittedAt: firstAt,
    dueAtSubmission: firstAt && taskStateAt(t, mine, firstAt),
    dueChangeReason: s.dueChangeReason,
  };
  return { s, due };
}

/** A-TSK-8: the report facts for one staff member and IST period (an EOD by default). */
export function buildEodFacts(input: EodInput): EodFacts {
  const { staffId, reportDate: day, now } = input;
  const last = input.periodEnd ?? day;
  const from = istInstant(day);
  const to = istInstant(addDays(last as IsoDate, 1));
  const asOf = now < to ? now : new Date(to.getTime() - 1);
  const task = new Map(input.tasks.map((t) => [t.id, t]));
  const byTask = eventsByTask(input.events);
  const stateAt = (id: string, at: Date) => taskStateAt(task.get(id)!, byTask.get(id), at);
  const inWindow = input.events
    .filter((e) => task.has(e.taskId) && e.occurredAt >= from && e.occurredAt < to)
    .filter((e) => e.occurredAt <= now)
    .sort(byTime);
  // A draft is not the employee's work yet: nothing that happens while it is a draft counts.
  const mine = inWindow.filter((e) => {
    const s = stateAt(e.taskId, e.occurredAt);
    if (!s || s.status === 'draft') return false;
    return OWNERSHIP.includes(e.kind) ? e.toStaffId === staffId : s.owner === staffId;
  });
  const item = (e: FactEvent): FactItem => ({
    taskId: e.taskId,
    title: task.get(e.taskId)!.title,
    at: e.occurredAt.toISOString(),
    detail: e.reason,
  });
  const section = (keep: (e: FactEvent) => boolean) => firstPerTask(mine.filter(keep).map(item));

  const corrected = new Set(input.updates.map((u) => u.correctsUpdateId).filter(Boolean));
  const counted = input.updates
    .filter((u) => !corrected.has(u.id) && task.has(u.taskId) && u.recordedAt <= now)
    .map((u) => {
      const interval = u.startedAt && u.endedAt ? ([u.startedAt, u.endedAt] as const) : null;
      const inside = interval ? minutesInside(interval[0], interval[1], from, to) : 0;
      const onDay = interval ? inside > 0 : u.occurredOn >= day && u.occurredOn <= last;
      return { u, interval, onDay, minutes: interval ? inside : u.durationMinutes };
    })
    .filter((x) => x.onDay)
    .sort(
      (a, b) =>
        (a.interval?.[0] ?? a.u.recordedAt).getTime() -
        (b.interval?.[0] ?? b.u.recordedAt).getTime(),
    );
  const overlapping = new Set<string>();
  let latest: { id: string; end: number } | null = null;
  for (const { u, interval } of counted) {
    if (!interval) continue;
    if (latest && interval[0].getTime() < latest.end) overlapping.add(u.id).add(latest.id);
    if (!latest || interval[1].getTime() > latest.end)
      latest = { id: u.id, end: interval[1].getTime() };
  }
  const work: WorkItem[] = counted.map(({ u, minutes }) => {
    const entered = istToday(u.recordedAt);
    const link = task.get(u.taskId)!.linkedRef;
    return {
      updateId: u.id,
      taskId: u.taskId,
      title: task.get(u.taskId)!.title,
      workPerformed: u.workPerformed,
      result: u.result,
      blocker: u.blocker,
      nextStep: u.nextStep,
      minutes,
      enteredOn: entered > last ? entered : null,
      sameActivity: link && /^academic\b/i.test(link) ? link : null,
      overlaps: overlapping.has(u.id),
    };
  });
  const timed = work.filter((w) => w.minutes !== null);

  const owned = input.tasks.flatMap((t) => {
    const at = dueTaskAt(t, byTask.get(t.id), asOf);
    return at && at.s.owner === staffId ? [{ t, ...at }] : [];
  });
  const backlog = owned
    .filter(({ s }) => !['done', 'cancelled', 'draft'].includes(s.status))
    .map(({ t, s }): BacklogItem => ({
      taskId: t.id,
      title: t.title,
      priority: t.priority,
      status: s.status,
      reason: s.reason ?? s.blocked?.reason ?? null,
      blocked: Boolean(s.blocked),
      dueOn: s.dueOn,
      dueTime: s.dueTime,
      overdue: isOverdue(s, asOf),
      closedLater: t.status === 'done' || t.status === 'cancelled',
    }))
    .sort(byPriority);

  const blockedNow = backlog
    .filter((b) => b.blocked)
    .map((b) => ({ taskId: b.taskId, title: b.title, at: asOf.toISOString(), detail: b.reason }));
  const blockers = work
    .filter((w) => w.blocker)
    .map((w) => ({ taskId: w.taskId, title: w.title, at: from.toISOString(), detail: w.blocker }));
  const facts = {
    received: section(isReceipt),
    acknowledged: section((e) => e.kind === 'acknowledged'),
    submitted: section((e) => e.kind === 'submitted_for_review'),
    completed: section((e) => e.toStatus === 'done'),
    blocked: firstPerTask([...section((e) => blockOf(e)?.on === true), ...blockers, ...blockedNow]),
    decisions: firstPerTask(
      mine
        .filter((e) => e.kind === 'clarification_requested')
        .map((e) => ({ ...item(e), kind: e.kind })),
    ),
  };
  const timeliness = onTimeRate(
    owned.map((o) => o.due),
    { start: day, end: last },
  );
  const turnaround = reviewTurnaround(
    mine
      .filter((e) => e.kind === 'submitted_for_review')
      .map((e) => ({
        taskId: e.taskId,
        title: task.get(e.taskId)!.title,
        submittedAt: e.occurredAt,
        decidedAt:
          byTask
            .get(e.taskId)!
            .find((x) => DECIDES(x) && x.occurredAt > e.occurredAt && x.occurredAt <= asOf)
            ?.occurredAt ?? null,
      })),
  );
  return {
    format: EOD_FACTS_FORMAT,
    staffId,
    reportDate: day,
    periodKind: input.periodKind ?? 'day',
    periodEnd: last,
    window: { from: from.toISOString(), to: to.toISOString() },
    asOf: asOf.toISOString(),
    generatedAt: now.toISOString(),
    ...facts,
    work,
    backlog,
    duration: {
      minutes: timed.length ? timed.reduce((n, w) => n + w.minutes!, 0) : null,
      definition: DURATION_DEFINITION,
      overlaps: overlapping.size > 0,
      sameActivity: work.filter((w) => w.sameActivity).length,
    },
    academic: academicFacts(input.academic),
    timeliness,
    turnaround,
    ...(input.attendance ? { attendance: input.attendance } : {}),
    ...(input.development !== undefined ? { development: input.development } : {}),
    counts: {
      received: facts.received.length,
      acknowledged: facts.acknowledged.length,
      worked: new Set(work.map((w) => w.taskId)).size,
      submitted: facts.submitted.length,
      completed: facts.completed.length,
      blocked: facts.blocked.length,
      decisions: facts.decisions.length,
      backlog: backlog.length,
      overdue: backlog.filter((b) => b.overdue).length,
    },
    noActivity: mine.length === 0 && work.length === 0,
  };
}

/** EOD only: backlog tasks due by the report day, still open now, without a reason. */
export const factsMissingReasons = (f: EodFacts) =>
  (f.periodKind ?? 'day') === 'day'
    ? f.backlog.filter((b) => b.dueOn <= f.reportDate && !b.reason && !b.closedLater)
    : [];

/** A report imported from the old task tracker (O4): history only, never sent or reviewed. */
export const isImportedReport = (s: unknown) =>
  (s as { kind?: string } | null)?.kind === 'legacy_tracker_report';

/** True for a snapshot built by buildEodFacts (older reports stored the "My day" shape). */
export const isEodFacts = (s: unknown): s is EodFacts =>
  FORMATS.includes((s as { format?: string } | null)?.format ?? '');
