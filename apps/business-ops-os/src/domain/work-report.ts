/**
 * Work reports for a period (owner brief 23 Oct 2026 §13–14, ruling R7). Pure.
 * A-REP-1 period bounds, deadlines and where a report stands; A-REP-2 the on-time submission
 * rate; A-REP-3 reviewer turnaround (kept apart from the employee's timeliness). No figure ranks
 * staff (R13): every result is per person, never a combined score.
 */
import { addDays, istInstant, weekdayOf, windowLabel, type IsoDate } from './dates';
import { deadlineInstant } from './staff-tasks';

export const PERIOD_KINDS = ['day', 'week', 'month'] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];
export const KIND_LABELS: Record<PeriodKind, string> = {
  day: 'End-of-day',
  week: 'Weekly',
  month: 'Monthly',
};
export const REPORT_STATUS_LABELS = {
  draft: 'Draft',
  submitted: 'Submitted',
  acknowledged: 'Reviewed',
  revision_requested: 'Changes requested',
} as const;
export type ReportStatus = keyof typeof REPORT_STATUS_LABELS;

const WEEKDAY_NUMBERS = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
} as const;
export type Weekday = keyof typeof WEEKDAY_NUMBERS;

export interface Period {
  kind: PeriodKind;
  start: IsoDate;
  end: IsoDate;
}

/** A-REP-1: the day, the week (from `weekStart`) or the calendar month containing `day`. */
export function periodOf(kind: PeriodKind, day: IsoDate, weekStart: Weekday = 'monday'): Period {
  if (kind === 'day') return { kind, start: day, end: day };
  if (kind === 'week') {
    const start = addDays(day, -((weekdayOf(day) - WEEKDAY_NUMBERS[weekStart] + 7) % 7));
    return { kind, start, end: addDays(start, 6) };
  }
  const [y, m] = day.split('-').map(Number) as [number, number];
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10) as IsoDate;
  return { kind, start: `${day.slice(0, 7)}-01` as IsoDate, end: addDays(next, -1) };
}

const monthYear = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
});
export const periodLabel = (p: Period) =>
  p.kind === 'month'
    ? monthYear.format(new Date(`${p.start}T00:00:00Z`))
    : p.kind === 'week'
      ? `Week ${windowLabel(p.start, p.end)}`
      : windowLabel(p.start, p.start);

/** The instant the period is over (00:00 IST of the next day). */
export const periodEndsAt = (p: Pick<Period, 'end'>) => istInstant(addDays(p.end, 1));

export interface DeadlineSettings {
  /** eod.submission_deadline `HH:MM`, on the report day. */
  day: string | null;
  /** reports.weekly_deadline: the first such weekday on or after the week's last day. */
  week: { day: Weekday; time: string } | null;
  /** reports.monthly_deadline: that day of the next month. */
  month: { dayOfNextMonth: number; time: string } | null;
}

/** A-REP-1: when a period's report is due (IST); null = no deadline is set. */
export function reportDeadline(p: Period, s: DeadlineSettings): Date | null {
  if (p.kind === 'day') return s.day ? istInstant(p.start, s.day) : null;
  if (p.kind === 'week') {
    if (!s.week) return null;
    const shift = (WEEKDAY_NUMBERS[s.week.day] - weekdayOf(p.end) + 7) % 7;
    return istInstant(addDays(p.end, shift), s.week.time);
  }
  return s.month ? istInstant(addDays(p.end, s.month.dayOfNextMonth), s.month.time) : null;
}

export type Standing = ReportStatus | 'missing' | 'not_started' | 'not_expected' | 'no_schedule';
export const STANDING_LABELS: Record<Standing, string> = {
  ...REPORT_STATUS_LABELS,
  missing: 'Missing',
  not_started: 'Not started',
  not_expected: 'Not expected (leave, holiday or weekly off)',
  no_schedule: 'No work schedule',
};

/** A scheduled workday by HR attendance rules: in the schedule, not a holiday, not on leave. */
export const isExpectedDay = (d: { scheduled: boolean | null; status: string }) =>
  d.scheduled === true && d.status !== 'holiday' && d.status !== 'on_leave';

/**
 * Is a report expected for a period: true = at least one scheduled workday in it, false =
 * none (leave, holidays, weekly offs), null = no work schedule known (never counted Missing).
 */
export const expectation = (days: readonly { scheduled: boolean | null; status: string }[]) =>
  days.some(isExpectedDay)
    ? true
    : days.length && days.every((d) => d.scheduled === null)
      ? null
      : false;

/**
 * A-REP-1: a report is due once its deadline passes (no deadline: once the period is over);
 * due, expected and never submitted = Missing. Late = first submission after the deadline in
 * force when it was submitted (`deadlineAtSubmit`, stored on version 1; a day report without a
 * deadline: after the day ended). A later revision or a later settings change never moves it.
 */
export function reportStanding(
  r: {
    status: ReportStatus;
    firstSubmittedAt: Date | null;
    /** null = no deadline was set; undefined = not stored (older versions): use `deadline`. */
    deadlineAtSubmit: Date | null | undefined;
  } | null,
  p: Period,
  deadline: Date | null,
  now: Date,
  expected: boolean | null = true,
): { standing: Standing; late: boolean } {
  if (r && r.status !== 'draft') {
    const by =
      (r.deadlineAtSubmit === undefined ? deadline : r.deadlineAtSubmit) ??
      (p.kind === 'day' ? periodEndsAt(p) : null);
    return {
      standing: r.status,
      late: Boolean(by && r.firstSubmittedAt && r.firstSubmittedAt > by),
    };
  }
  if (expected === null) return { standing: 'no_schedule', late: false };
  if (!expected) return { standing: 'not_expected', late: false };
  if (now >= (deadline ?? periodEndsAt(p))) return { standing: 'missing', late: false };
  return { standing: r ? 'draft' : 'not_started', late: false };
}

// --- A-REP-2 on-time submission rate ----------------------------------------------------------

export interface DueTask {
  taskId: string;
  title: string;
  /** Lifecycle status at the cut-off. */
  status: string;
  /** Deadline in force at the cut-off. */
  dueOn: string;
  dueTime: string | null;
  originalDueOn: string;
  originalDueTime: string | null;
  /** First submission for review (or completion, when no review is needed) up to the cut-off. */
  firstSubmittedAt: Date | null;
  /** Deadline in force at the moment of that first submission. */
  dueAtSubmission: { dueOn: string; dueTime: string | null } | null;
  /** Reason of the latest deadline change. */
  dueChangeReason: string | null;
}

export type Outcome = 'on_time' | 'late' | 'not_submitted';
const dueText = (day: string, time: string | null) => `${day}${time ? ` ${time.slice(0, 5)}` : ''}`;

/**
 * A-REP-2: eligible = due in the period (deadline in force at the cut-off), not cancelled or
 * draft. On time = first submission ≤ the deadline in force at that moment; a task never
 * submitted stays in the denominator. Approval time never changes the result.
 */
export function onTimeRate(tasks: readonly DueTask[], p: { start: string; end: string }) {
  const due = tasks.filter((t) => t.dueOn >= p.start && t.dueOn <= p.end);
  const skip = (t: DueTask) => t.status === 'cancelled' || t.status === 'draft';
  const rows = due
    .filter((t) => !skip(t))
    .map((t) => {
      const at = t.dueAtSubmission ?? t;
      const outcome: Outcome = !t.firstSubmittedAt
        ? 'not_submitted'
        : t.firstSubmittedAt <= deadlineInstant(at.dueOn, at.dueTime)
          ? 'on_time'
          : 'late';
      return {
        taskId: t.taskId,
        title: t.title,
        dueOn: t.dueOn,
        dueTime: t.dueTime,
        submittedAt: t.firstSubmittedAt?.toISOString() ?? null,
        delivered: t.status === 'done',
        outcome,
      };
    });
  const n = (o: Outcome) => rows.filter((r) => r.outcome === o).length;
  return {
    eligible: rows.length,
    delivered: rows.filter((r) => r.delivered).length,
    onTime: n('on_time'),
    late: n('late'),
    notSubmitted: n('not_submitted'),
    rate: rows.length ? n('on_time') / rows.length : null,
    rows,
    excluded: due.filter(skip).map((t) => ({
      taskId: t.taskId,
      title: t.title,
      why: t.status === 'cancelled' ? 'Cancelled' : 'Draft, not assigned',
    })),
    revisions: due
      .filter((t) => dueText(t.dueOn, t.dueTime) !== dueText(t.originalDueOn, t.originalDueTime))
      .map((t) => ({
        taskId: t.taskId,
        title: t.title,
        from: dueText(t.originalDueOn, t.originalDueTime),
        to: dueText(t.dueOn, t.dueTime),
        reason: t.dueChangeReason,
      })),
  };
}
export type Timeliness = ReturnType<typeof onTimeRate>;

// --- A-REP-3 reviewer turnaround ---------------------------------------------------------------

export interface ReviewPair {
  taskId: string;
  title: string;
  submittedAt: Date;
  /** The reviewer's decision up to the cut-off; null = still waiting. */
  decidedAt: Date | null;
}

/** A-REP-3: hours from each submission in the period to its decision (median), and how many wait. */
export function reviewTurnaround(pairs: readonly ReviewPair[]) {
  const hours = pairs
    .filter((x) => x.decidedAt)
    .map((x) => (x.decidedAt!.getTime() - x.submittedAt.getTime()) / 3_600_000)
    .sort((a, b) => a - b);
  const mid = hours.length >> 1;
  return {
    decided: hours.length,
    waiting: pairs.length - hours.length,
    medianHours: hours.length
      ? Math.round((hours.length % 2 ? hours[mid]! : (hours[mid - 1]! + hours[mid]!) / 2) * 10) / 10
      : null,
  };
}

/** What the employee writes, per report kind (stored in summary / notes / next_day_plan). */
export const NARRATIVE_FIELDS: Record<
  PeriodKind,
  readonly { key: 'summary' | 'notes' | 'nextDayPlan'; label: string; hint: string }[]
> = {
  day: [
    {
      key: 'summary',
      label: 'Progress and deliverables',
      hint: 'What moved forward today, including teaching or marketing work that is not a task.',
    },
    { key: 'notes', label: 'Blockers', hint: 'What is stopping you, and who can help.' },
    { key: 'nextDayPlan', label: 'Plan for the next working day', hint: 'Your first priorities.' },
  ],
  week: [
    {
      key: 'summary',
      label: 'Department outcomes',
      hint: 'What your work achieved for your department this week.',
    },
    {
      key: 'notes',
      label: 'Blockers and support needed',
      hint: 'What held work back, and the help you need.',
    },
    { key: 'nextDayPlan', label: 'Plan for next week', hint: 'The work you will deliver.' },
  ],
  month: [
    {
      key: 'summary',
      label: 'Work, deliverables and activity',
      hint: 'The month in your words, including academic or marketing activity.',
    },
    { key: 'notes', label: 'Carry-forward', hint: 'What moves to next month, and why.' },
    { key: 'nextDayPlan', label: 'Plan for next month', hint: 'Priorities and deliverables.' },
  ],
};

/** Shown next to each figure (brief §14). */
export const METRIC_DEFINITIONS = {
  planned:
    'Planned: tasks due in the period (the deadline in force at the cut-off), not counting cancelled or draft tasks. Delivered: of those, approved or done by the cut-off.',
  submitted:
    'Submitted: tasks sent for review by an event dated in the period. Each task counts once.',
  approved:
    'Approved or done: tasks approved by their reviewer, or marked done when no review is needed, by an event dated in the period. A task submitted in one period can be approved in a later one.',
  outstanding:
    'Open at the cut-off: assigned and not approved, done or cancelled at the cut-off (drafts not yet assigned are left out), replayed from each task’s history (not its status today).',
  onTime:
    'On-time submission rate = eligible tasks due in the period whose first submission came by the deadline in force at that moment ÷ all eligible tasks due in the period. Cancelled and draft tasks are left out and listed. A task never submitted stays in the count as not on time. A later approval, or a deadline moved after the first submission, never changes the result; deadline changes are listed.',
  turnaround:
    'Reviewer turnaround: time from a submission in the period to the reviewer’s decision (approved or changes requested). It measures the review, not the employee, and is shown apart from the employee’s timeliness.',
  attendance:
    'From HR attendance: scheduled workdays, leave, holidays, confirmed absences and days not yet marked. An unmarked day is not an absence.',
} as const;
