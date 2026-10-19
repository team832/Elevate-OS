/**
 * Management-dashboard KPI aggregation (OPS-024). Pure: callers pass plain rows.
 * Definitions: docs/KPI_DEFINITIONS.md; algorithm: docs/ALGORITHMS.md → A-12.
 *
 * MISSING IS NOT ZERO. A rate whose denominator is 0 is `missing` (with a
 * reason), never 0 %. A cohort whose window has not elapsed is `missing`.
 * Counts from Ops' own complete tables are `ok`, and a real 0 shows as 0.
 */
import { metric, type Metric } from '@elevate/shared-contracts';
import { addDays, daysBetween, istToday, windowLabel, type IsoDate } from './dates';
import { isOpenTask, type TaskStatus } from './tasks';

export interface KpiWindow {
  from: IsoDate;
  to: IsoDate;
}

const pct = (num: number, den: number) => Math.round((num / den) * 1000) / 10;
const inWindow = (d: IsoDate, w: KpiWindow) => d >= w.from && d <= w.to;
const meta = (definition: string, w: KpiWindow, unit: Metric['unit'], label?: string) => ({
  definition,
  window: { from: w.from, to: w.to, label: label ?? windowLabel(w.from, w.to) },
  unit,
});

export const KPI_IDS = [
  'new_leads',
  'lead_to_admission_conversion',
  'followup_compliance',
  'task_completion_rate',
  'overdue_work',
  'unresolved_blockers',
] as const;

// --- K-01 new leads ------------------------------------------------------------------------------

export interface LeadKpiRow {
  receivedAt: Date;
  merged: boolean;
  /** First time the lead's admission reached `admitted` (BR-OPS-6 confirmed admission). */
  admittedAt: Date | null;
}

export function newLeads(leads: readonly LeadKpiRow[], window: KpiWindow): Metric {
  const n = leads.filter((l) => !l.merged && inWindow(istToday(l.receivedAt), window)).length;
  return metric.ok(
    n,
    meta(
      'Leads received in the window (Asia/Kolkata dates), excluding leads merged as duplicates.',
      window,
      'count',
    ),
  );
}

// --- lead → admission conversion (cohort, BR-OPS-8) ---------------------------------------------

/**
 * Cohort conversion: of the leads RECEIVED in the cohort window, the share
 * admitted within `windowDays` days of receipt. Never "this week's admissions ÷
 * this week's leads" (BR-OPS-8).
 */
export function leadToAdmissionConversion(
  leads: readonly LeadKpiRow[],
  cohort: KpiWindow,
  windowDays: number,
  asOf: Date,
): Metric {
  const m = meta(
    `Leads received in the cohort window that reached "admitted" within ${windowDays} days of receipt ÷ leads received in the cohort window (merged duplicates excluded).`,
    cohort,
    'percent',
    `Cohort ${windowLabel(cohort.from, cohort.to)}, ${windowDays}-day window`,
  );
  const today = istToday(asOf);
  if (daysBetween(cohort.to, today) < windowDays) {
    return metric.missing(
      `Window not elapsed: available from ${addDays(cohort.to, windowDays)} (cohort end + ${windowDays} days).`,
      m,
    );
  }
  const cohortLeads = leads.filter((l) => !l.merged && inWindow(istToday(l.receivedAt), cohort));
  if (cohortLeads.length === 0)
    return metric.missing('No leads were received in the cohort window.', m);
  const converted = cohortLeads.filter(
    (l) =>
      l.admittedAt && daysBetween(istToday(l.receivedAt), istToday(l.admittedAt)) <= windowDays,
  ).length;
  return metric.ok(pct(converted, cohortLeads.length), m);
}

/** The latest Monday–Sunday cohort week whose N-day window has fully elapsed by `asOf`. */
export function latestElapsedCohortWeek(asOf: Date, windowDays: number): KpiWindow {
  const today = istToday(asOf);
  const lastEligibleEnd = addDays(today, -windowDays);
  // Sunday on or before lastEligibleEnd.
  const [y, mo, d] = lastEligibleEnd.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const to = addDays(lastEligibleEnd, -weekday);
  return { from: addDays(to, -6), to };
}

// --- follow-up compliance ------------------------------------------------------------------------

export interface FollowUpKpiRow {
  kind: string;
  dueDate: IsoDate;
  status: 'open' | 'done' | 'cancelled';
  completedAt: Date | null;
}

/**
 * Counselling and demo follow-ups due in the window (and whose due date has
 * passed by as-of) that were completed on or before their due date ÷ those due.
 */
export function followUpCompliance(
  rows: readonly FollowUpKpiRow[],
  window: KpiWindow,
  asOf: Date,
): Metric {
  const today = istToday(asOf);
  const m = meta(
    'Counselling and demo follow-ups due in the window (due date already passed) completed on or before the due date ÷ such follow-ups due. Cancelled follow-ups are excluded.',
    window,
    'percent',
  );
  const due = rows.filter(
    (r) =>
      (r.kind === 'counselling_followup' || r.kind === 'demo_followup') &&
      r.status !== 'cancelled' &&
      inWindow(r.dueDate, window) &&
      r.dueDate < today,
  );
  if (due.length === 0)
    return metric.missing(
      'No counselling or demo follow-ups fell due (and passed) in the window.',
      m,
    );
  const onTime = due.filter(
    (r) => r.status === 'done' && r.completedAt && istToday(r.completedAt) <= r.dueDate,
  ).length;
  return metric.ok(pct(onTime, due.length), m);
}

// --- task completion rate ------------------------------------------------------------------------

export interface TaskKpiRow {
  status: TaskStatus;
  dueDate: IsoDate | null;
  completedAt: Date | null;
  ownerStaffId?: string | null;
}

/** Tasks due in the window (up to as-of, not cancelled) that are completed ÷ those tasks. */
export function taskCompletionRate(
  rows: readonly TaskKpiRow[],
  window: KpiWindow,
  asOf: Date,
): Metric {
  const today = istToday(asOf);
  const m = meta(
    'Tasks due in the window (due on or before as-of; cancelled excluded) that are completed ÷ those tasks.',
    window,
    'percent',
  );
  const due = rows.filter(
    (r) =>
      r.dueDate !== null &&
      r.status !== 'cancelled' &&
      inWindow(r.dueDate, window) &&
      r.dueDate <= today,
  );
  if (due.length === 0) return metric.missing('No tasks were due in the window.', m);
  const completed = due.filter((r) => r.status === 'completed').length;
  return metric.ok(pct(completed, due.length), m);
}

// --- overdue work --------------------------------------------------------------------------------

export function overdueWork(
  tasks: readonly TaskKpiRow[],
  followUps: readonly FollowUpKpiRow[],
  asOf: Date,
): { metric: Metric; tasks: number; followUps: number } {
  const today = istToday(asOf);
  const t = tasks.filter(
    (r) => isOpenTask(r.status) && r.dueDate !== null && r.dueDate < today,
  ).length;
  const f = followUps.filter((r) => r.status === 'open' && r.dueDate < today).length;
  return {
    metric: metric.ok(
      t + f,
      meta(
        'Open tasks and open follow-ups whose due date (Asia/Kolkata) is before today. Point in time.',
        { from: today, to: today },
        'count',
        `As of ${windowLabel(today, today)}`,
      ),
    ),
    tasks: t,
    followUps: f,
  };
}

// --- unresolved blockers -------------------------------------------------------------------------

export interface RiskKpiRow {
  kind: 'risk' | 'issue' | 'blocker';
  status: string;
}

export function unresolvedBlockers(
  risks: readonly RiskKpiRow[],
  tasks: readonly TaskKpiRow[],
  asOf: Date,
): { metric: Metric; registerItems: number; blockedTasks: number } {
  const today = istToday(asOf);
  const registerItems = risks.filter(
    (r) =>
      (r.kind === 'blocker' || r.kind === 'issue') &&
      (r.status === 'open' || r.status === 'mitigating'),
  ).length;
  const blockedTasks = tasks.filter((t) => t.status === 'blocked').length;
  return {
    metric: metric.ok(
      registerItems + blockedTasks,
      meta(
        'Open or mitigating issues/blockers in the risk register plus tasks with status Blocked. Point in time.',
        { from: today, to: today },
        'count',
        `As of ${windowLabel(today, today)}`,
      ),
    ),
    registerItems,
    blockedTasks,
  };
}

// --- operations dashboard (OPS-069) ----------------------------------------------------------------

const asOfMeta = (definition: string, asOf: Date, unit: Metric['unit']) => {
  const today = istToday(asOf);
  return meta(definition, { from: today, to: today }, unit, `As of ${windowLabel(today, today)}`);
};

/** A point-in-time count from Ops' own complete tables (a real 0 is 0). */
export function pointCount(n: number, definition: string, asOf: Date): Metric {
  return metric.ok(n, asOfMeta(definition, asOf, 'count'));
}

/** O-01 Open tasks: tasks whose status is open (not completed / cancelled). */
export function openTasksMetric(tasks: readonly TaskKpiRow[], asOf: Date): Metric {
  return pointCount(
    tasks.filter((t) => isOpenTask(t.status)).length,
    'Tasks whose status is Not started, In progress, Waiting, At risk or Blocked. Point in time.',
    asOf,
  );
}

/** O-02 Overdue tasks: open tasks with a due date before today (IST). */
export function overdueTasksMetric(tasks: readonly TaskKpiRow[], asOf: Date): Metric {
  const today = istToday(asOf);
  return pointCount(
    tasks.filter((t) => isOpenTask(t.status) && t.dueDate !== null && t.dueDate < today).length,
    'Open tasks whose due date (Asia/Kolkata) is before today. Tasks without a due date are not counted (flagged missing_due). Point in time.',
    asOf,
  );
}

/** O-03 Overdue share: overdue open tasks ÷ open tasks that have a due date; 0 denominator → missing. */
export function overdueTaskShare(tasks: readonly TaskKpiRow[], asOf: Date): Metric {
  const today = istToday(asOf);
  const dated = tasks.filter((t) => isOpenTask(t.status) && t.dueDate !== null);
  const m = asOfMeta(
    'Open tasks whose due date is before today ÷ open tasks that have a due date (Asia/Kolkata). Point in time.',
    asOf,
    'percent',
  );
  if (dated.length === 0) return metric.missing('No open task has a due date.', m);
  return metric.ok(
    pct(dated.filter((t) => (t.dueDate as IsoDate) < today).length, dated.length),
    m,
  );
}

export interface CapacityRow {
  key: string;
  label: string;
  open: number;
  overdue: number;
  blocked: number;
  dueNext7Days: number;
}

/**
 * Open-task capacity by a grouping key (department or owner). Rows are sorted by
 * label — a capacity view, never a ranking or score. A null key is "Not assigned".
 */
export function taskCapacity(
  tasks: readonly (TaskKpiRow & { groupKey: string | null; groupLabel: string | null })[],
  asOf: Date,
  unassignedLabel = 'Not assigned',
): CapacityRow[] {
  const today = istToday(asOf);
  const horizon = addDays(today, 7);
  const rows = new Map<string, CapacityRow>();
  for (const t of tasks) {
    if (!isOpenTask(t.status)) continue;
    const key = t.groupKey ?? '__none__';
    const row = rows.get(key) ?? {
      key,
      label: t.groupKey ? (t.groupLabel ?? 'Unknown') : unassignedLabel,
      open: 0,
      overdue: 0,
      blocked: 0,
      dueNext7Days: 0,
    };
    row.open += 1;
    if (t.status === 'blocked') row.blocked += 1;
    if (t.dueDate !== null && t.dueDate < today) row.overdue += 1;
    if (t.dueDate !== null && t.dueDate >= today && t.dueDate <= horizon) row.dueNext7Days += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) =>
    a.key === '__none__' ? 1 : b.key === '__none__' ? -1 : a.label.localeCompare(b.label),
  );
}

/** O-06 SOP acknowledgement coverage: acknowledged ÷ required (people with a login); 0 required → missing. */
export function sopAcknowledgementCoverage(
  required: number,
  acknowledged: number,
  asOf: Date,
): Metric {
  const m = asOfMeta(
    'Audience members (with a login) who acknowledged the approved SOP version in force ÷ audience members required to acknowledge it, over all active requirements. Point in time.',
    asOf,
    'percent',
  );
  if (required === 0)
    return metric.missing('No SOP version currently requires acknowledgement.', m);
  return metric.ok(pct(acknowledged, required), m);
}

export interface DeadlineItem {
  kind: 'task' | 'milestone' | 'sop_review' | 'sop_acknowledgement' | 'policy_review';
  id: string;
  title: string;
  dueDate: IsoDate;
  link: string;
}

/** Deadlines from today to today + `days` (IST), soonest first, then by title. */
export function upcomingDeadlines(
  items: readonly DeadlineItem[],
  asOf: Date,
  days = 7,
): DeadlineItem[] {
  const today = istToday(asOf);
  const until = addDays(today, days);
  return items
    .filter((i) => i.dueDate >= today && i.dueDate <= until)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));
}
