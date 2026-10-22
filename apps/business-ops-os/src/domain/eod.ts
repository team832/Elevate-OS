/**
 * End-of-day facts (owner brief 2 §9, ruling R2). Pure.
 * A-TSK-4 "My day" grouping (from current task state, used by the day view) and A-TSK-8, the
 * EOD snapshot, built ONLY from task events and work updates dated inside the IST report day:
 * a task finished the next day is not completed today, a five-day task counts once, the open
 * backlog is replayed from events as of the cut-off (never the current status), class time from
 * Academic is never added to task time, and HR attendance is always unavailable (no HR module).
 */
import type { AcademicTeacherActivityV1, SourceResult } from '@elevate/shared-contracts';
import { addDays, istInstant, istToday, type IsoDate } from './dates';
import {
  isOverdue,
  type EodTask,
  type TaskEventKind,
  type TaskPriority,
  type TaskState,
  type TaskStatus,
} from './staff-tasks';

export interface EodItem extends TaskState {
  id: string;
  title: string;
  priority: TaskPriority;
  dueOn: string;
  dueTime: string | null;
  overdue: boolean;
}

/** "My day" view of the owner's tasks (current state). */
export interface EodSnapshot {
  reportDate: string;
  generatedAt: string;
  /** Completed on the report day. */
  done: EodItem[];
  /** Due on the report day and not done. */
  open: EodItem[];
  /** Due before the report day and still not done. */
  carried: EodItem[];
  counts: { done: number; open: number; carried: number; overdue: number };
}

const RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };
const byPriority = (
  a: { priority: TaskPriority; dueTime: string | null },
  b: { priority: TaskPriority; dueTime: string | null },
) => RANK[a.priority] - RANK[b.priority] || (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99');

/**
 * A-TSK-4: the day's tasks from the owner's current task state (the "My day" view). Overdue is
 * judged at `now`, or at the end of the day when that day is over.
 */
export function buildEodSnapshot(tasks: EodTask[], reportDate: string, now: Date): EodSnapshot {
  const endOfDay = new Date(istInstant(addDays(reportDate as IsoDate, 1)).getTime() - 1);
  const asOf = now < endOfDay ? now : endOfDay;
  const item = (t: EodTask): EodItem => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    status: t.status,
    progressPercent: t.progressPercent,
    reason: t.reason,
    dueOn: t.dueOn,
    dueTime: t.dueTime,
    overdue: isOverdue(t, asOf),
  });
  const notDone = tasks.filter((t) => t.status !== 'done').sort(byPriority);
  const done = tasks
    .filter((t) => t.completedAt && istToday(t.completedAt) === reportDate)
    .sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime())
    .map(item);
  const open = notDone.filter((t) => t.dueOn === reportDate).map(item);
  const carried = notDone.filter((t) => t.dueOn < reportDate).map(item);
  return {
    reportDate,
    generatedAt: now.toISOString(),
    done,
    open,
    carried,
    counts: {
      done: done.length,
      open: open.length,
      carried: carried.length,
      overdue: [...open, ...carried].filter((t) => t.overdue).length,
    },
  };
}

/** Tasks the day view lists as not done that still have no reason. */
export const missingReasons = (s: EodSnapshot) =>
  [...s.open, ...s.carried].filter((t) => !t.reason);

// --- A-TSK-8: event-based EOD facts ---------------------------------------------------------

export interface FactTask {
  id: string;
  title: string;
  priority: TaskPriority;
  dueOn: string;
  dueTime: string | null;
  /** Current owner, status and reason (used only where no event says otherwise). */
  staffId: string;
  status: TaskStatus;
  reason: string | null;
  linkedRef: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface FactEvent {
  taskId: string;
  kind: TaskEventKind;
  toStatus: TaskStatus | null;
  fromStatus: TaskStatus | null;
  fromStaffId: string | null;
  toStaffId: string | null;
  occurredAt: Date;
  reason: string | null;
  /** due_changed: { fromDueOn, toDueOn, fromDueTime, toDueTime }. */
  data: Record<string, unknown> | null;
}

export interface FactUpdate {
  id: string;
  taskId: string;
  occurredOn: string;
  recordedAt: Date;
  workPerformed: string;
  result: string | null;
  blocker: string | null;
  nextStep: string | null;
  durationMinutes: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
  correctsUpdateId: string | null;
}

const OWNERSHIP: readonly TaskEventKind[] = ['created', 'assigned', 'reassigned', 'imported'];
const byTime = (a: FactEvent, b: FactEvent) => a.occurredAt.getTime() - b.occurredAt.getTime();

/** Events grouped by task, oldest first (group once, then replay each task cheaply). */
export function eventsByTask(events: readonly FactEvent[]) {
  const out = new Map<string, FactEvent[]>();
  for (const e of [...events].sort(byTime)) out.set(e.taskId, [...(out.get(e.taskId) ?? []), e]);
  return out;
}

/**
 * A task's owner, status, reason and due day at instant `t`, replayed from its own events (oldest
 * first); null when it did not exist yet. Before the first event that sets a value, its `from…`
 * side holds the earlier value; a task without any status event (legacy rows) falls back to its
 * completion time and otherwise its current status.
 */
export function taskStateAt(task: FactTask, mine: readonly FactEvent[] = [], t: Date) {
  const born = Math.min(task.createdAt.getTime(), ...mine.map((e) => e.occurredAt.getTime()));
  if (born > t.getTime()) return null;
  const before = mine.filter((e) => e.occurredAt <= t);
  const after = mine.filter((e) => e.occurredAt > t);
  const owners = (list: FactEvent[]) =>
    list.filter((e) => OWNERSHIP.includes(e.kind) && e.toStaffId);
  const statuses = (list: FactEvent[]) => list.filter((e) => e.toStatus);
  const dues = (list: FactEvent[]) => list.filter((e) => e.kind === 'due_changed' && e.data);
  const lastOwner = owners(before).at(-1);
  const lastStatus = statuses(before).at(-1);
  const lastDue = dues(before).at(-1)?.data;
  const nextDue = dues(after)[0]?.data;
  const status: TaskStatus =
    lastStatus?.toStatus ??
    statuses(after)[0]?.fromStatus ??
    (task.completedAt && task.completedAt <= t
      ? 'done'
      : task.status === 'done'
        ? 'pending'
        : task.status);
  const due = (d: Record<string, unknown> | null | undefined, side: 'to' | 'from') =>
    d && typeof d[`${side}DueOn`] === 'string'
      ? {
          dueOn: d[`${side}DueOn`] as string,
          dueTime: (d[`${side}DueTime`] as string | null) ?? null,
        }
      : null;
  return {
    owner: lastOwner?.toStaffId ?? owners(after)[0]?.fromStaffId ?? task.staffId,
    status,
    reason: lastStatus?.reason ?? (task.status === status ? task.reason : null),
    since: lastStatus?.occurredAt ?? null,
    ...(due(lastDue, 'to') ?? due(nextDue, 'from') ?? { dueOn: task.dueOn, dueTime: task.dueTime }),
  };
}

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
  /** Minutes inside the report day; null = no time recorded. */
  minutes: number | null;
  /** IST day it was entered, when later than the work day. */
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
    };

export const EOD_FACTS_FORMAT = 'eod-facts/1';
export const DURATION_DEFINITION =
  'Minutes recorded on task updates for this day. Start/stop entries count only the part inside the day (IST). Shift hours and Academic class time are not included.';

export interface EodFacts {
  format: typeof EOD_FACTS_FORMAT;
  staffId: string;
  reportDate: string;
  /** IST report day as instants: [from, to). */
  window: { from: string; to: string };
  /** Backlog and overdue are judged at this instant (end of the day, or the generation time). */
  asOf: string;
  generatedAt: string;
  received: FactItem[];
  acknowledged: FactItem[];
  completed: FactItem[];
  blocked: FactItem[];
  /** Help asked for: clarification requested (sending for review is not a request for help). */
  decisions: (FactItem & { kind: TaskEventKind })[];
  work: WorkItem[];
  backlog: BacklogItem[];
  duration: { minutes: number | null; definition: string; overlaps: boolean; sameActivity: number };
  academic: AcademicFacts;
  hr: { status: 'unavailable' };
  counts: {
    received: number;
    acknowledged: number;
    worked: number;
    completed: number;
    blocked: number;
    decisions: number;
    backlog: number;
    overdue: number;
  };
  noActivity: boolean;
}

export interface EodInput {
  staffId: string;
  reportDate: string;
  now: Date;
  tasks: readonly FactTask[];
  events: readonly FactEvent[];
  /** Updates written by the staff member (the query may include neighbouring days). */
  updates: readonly FactUpdate[];
  academic: SourceResult<AcademicTeacherActivityV1>;
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

/** A-TSK-8: the EOD facts for one staff member and IST day. */
export function buildEodFacts(input: EodInput): EodFacts {
  const { staffId, reportDate: day, now } = input;
  const from = istInstant(day);
  const to = istInstant(addDays(day as IsoDate, 1));
  const asOf = now < to ? now : new Date(to.getTime() - 1);
  const task = new Map(input.tasks.map((t) => [t.id, t]));
  const byTask = eventsByTask(input.events);
  const ownerAt = (id: string, at: Date) => taskStateAt(task.get(id)!, byTask.get(id), at)?.owner;
  const inWindow = input.events
    .filter((e) => task.has(e.taskId) && e.occurredAt >= from && e.occurredAt < to)
    .filter((e) => e.occurredAt <= now)
    .sort(byTime);
  const mine = inWindow.filter((e) =>
    OWNERSHIP.includes(e.kind)
      ? e.toStaffId === staffId
      : ownerAt(e.taskId, e.occurredAt) === staffId,
  );
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
      const onDay = interval ? inside > 0 : u.occurredOn === day;
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
      enteredOn: entered > day ? entered : null,
      sameActivity: link && /^academic\b/i.test(link) ? link : null,
      overlaps: overlapping.has(u.id),
    };
  });
  const timed = work.filter((w) => w.minutes !== null);

  const backlog = input.tasks
    .flatMap((t) => {
      const s = taskStateAt(t, byTask.get(t.id), asOf);
      if (!s || s.owner !== staffId || s.status === 'done' || s.status === 'cancelled') return [];
      const b: BacklogItem = {
        taskId: t.id,
        title: t.title,
        priority: t.priority,
        status: s.status,
        reason: s.reason,
        dueOn: s.dueOn,
        dueTime: s.dueTime,
        overdue: isOverdue(s, asOf),
        closedLater: t.status === 'done' || t.status === 'cancelled',
      };
      return [b];
    })
    .sort(byPriority);

  const blockedNow = backlog
    .filter((b) => b.status === 'blocked')
    .map((b) => ({ taskId: b.taskId, title: b.title, at: asOf.toISOString(), detail: b.reason }));
  const blockers = work
    .filter((w) => w.blocker)
    .map((w) => ({ taskId: w.taskId, title: w.title, at: from.toISOString(), detail: w.blocker }));
  const facts = {
    received: section((e) => OWNERSHIP.includes(e.kind)),
    acknowledged: section((e) => e.kind === 'acknowledged'),
    completed: section((e) => e.toStatus === 'done'),
    blocked: firstPerTask([
      ...section((e) => e.toStatus === 'blocked'),
      ...blockers,
      ...blockedNow,
    ]),
    decisions: firstPerTask(
      mine
        .filter((e) => e.kind === 'clarification_requested')
        .map((e) => ({ ...item(e), kind: e.kind })),
    ),
  };
  return {
    format: EOD_FACTS_FORMAT,
    staffId,
    reportDate: day,
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
    hr: { status: 'unavailable' },
    counts: {
      received: facts.received.length,
      acknowledged: facts.acknowledged.length,
      worked: new Set(work.map((w) => w.taskId)).size,
      completed: facts.completed.length,
      blocked: facts.blocked.length,
      decisions: facts.decisions.length,
      backlog: backlog.length,
      overdue: backlog.filter((b) => b.overdue).length,
    },
    noActivity: mine.length === 0 && work.length === 0,
  };
}

/** Backlog tasks due by the report day, still open now, without a reason (submit needs one each). */
export const factsMissingReasons = (f: EodFacts) =>
  f.backlog.filter((b) => b.dueOn <= f.reportDate && !b.reason && !b.closedLater);

/** A report imported from the old task tracker (O4): history only, never sent or reviewed. */
export const isImportedReport = (s: unknown) =>
  (s as { kind?: string } | null)?.kind === 'legacy_tracker_report';

/** True for a snapshot built by buildEodFacts (older reports stored the "My day" shape). */
export const isEodFacts = (s: unknown): s is EodFacts =>
  (s as { format?: string } | null)?.format === EOD_FACTS_FORMAT;

const hm = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
export const fmtMinutes = (m: number | null) =>
  m === null ? 'Not recorded' : `${Math.floor(m / 60)} h ${m % 60} min`;

/**
 * The report as plain text for "Copy summary" (no external delivery is configured). Counts,
 * task titles and the employee's own words only; no student details.
 */
export function eodPlainText(
  f: EodFacts,
  narrative: { summary: string | null; nextDayPlan: string | null; notes: string | null },
  meta: { staffName: string; version: number | null; recipient: string | null },
) {
  const list = (title: string, items: { title: string; detail?: string | null }[]) =>
    items.length
      ? [`${title}:`, ...items.map((i) => `- ${i.title}${i.detail ? ` (${i.detail})` : ''}`)]
      : [];
  const a = f.academic;
  return [
    `End-of-day report: ${meta.staffName}, ${f.reportDate} (IST)`,
    meta.version
      ? `Version ${meta.version}${meta.recipient ? `, to ${meta.recipient}` : ''}`
      : 'Draft — not submitted',
    f.noActivity ? 'No task activity recorded on this day.' : '',
    `Completed: ${f.counts.completed} · Worked on: ${f.counts.worked} · Open at cut-off: ${f.counts.backlog} (${f.counts.overdue} overdue) · Blocked: ${f.counts.blocked}`,
    `Recorded time: ${fmtMinutes(f.duration.minutes)}`,
    ...list('Completed', f.completed),
    ...list(
      'Work done',
      f.work.map((w) => ({
        title: `${w.title}: ${w.workPerformed}`,
        detail: w.minutes ? fmtMinutes(w.minutes) : null,
      })),
    ),
    ...list('Blocked', f.blocked),
    ...list('Decisions or help needed', f.decisions),
    a.status === 'available'
      ? `Academic: ${a.delivered ?? 'not recorded'} of ${a.planned ?? 'not recorded'} planned classes delivered`
      : 'Academic OS unavailable',
    'HR attendance unavailable',
    narrative.summary ? `Summary: ${narrative.summary}` : '',
    narrative.nextDayPlan ? `Plan for next day: ${narrative.nextDayPlan}` : '',
    narrative.notes ? `Notes: ${narrative.notes}` : '',
    `Facts as of ${hm(f.asOf)} IST.`,
  ]
    .filter(Boolean)
    .join('\n');
}
