/**
 * Shift templates, assignments and scheduled hours (OPS-053, OPS-054). Pure.
 *
 * A template is a local start/end time in the employee's timezone; a shift
 * that crosses midnight ends on the next calendar day. A day is "scheduled"
 * only when an active assignment covers it, its weekday is a working weekday
 * of the template and it is not a holiday — otherwise it is "not scheduled"
 * (never 0 hours). Timings are owner decisions (templates start `proposed`).
 */
import { addDays, type IsoDate } from '@elevate/shared-types';
import {
  eachDate,
  hmToMinutes,
  isHm,
  weekday,
  zonedToInstant,
  type HolidayEntry,
  type Issue,
} from './calendar';

export interface ShiftTemplateLike {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  unpaidBreakMinutes: number;
  workingWeekdays: readonly number[];
  status: 'proposed' | 'approved' | 'retired';
}

export interface ShiftAssignmentLike {
  id: string;
  staffId: string;
  shiftTemplateId: string;
  fromDate: string;
  toDate: string | null;
  status: 'active' | 'cancelled';
}

/** Validate a template's times, break and weekdays. Returns every problem at once. */
export function validateShiftTemplate(t: {
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  unpaidBreakMinutes: number;
  workingWeekdays: readonly number[];
}): Issue[] {
  const issues: Issue[] = [];
  if (!isHm(t.startTime)) issues.push({ path: 'startTime', message: 'Use HH:MM (24 h).' });
  if (!isHm(t.endTime)) issues.push({ path: 'endTime', message: 'Use HH:MM (24 h).' });
  if (issues.length) return issues;
  const start = hmToMinutes(t.startTime);
  const end = hmToMinutes(t.endTime);
  if (t.crossesMidnight && end > start)
    issues.push({
      path: 'endTime',
      message: 'A shift that crosses midnight must end at or before its start time.',
    });
  if (!t.crossesMidnight && end <= start)
    issues.push({
      path: 'endTime',
      message: 'End must be after start (tick "crosses midnight" for an overnight shift).',
    });
  const span = shiftSpanMinutes(t);
  if (!Number.isInteger(t.unpaidBreakMinutes) || t.unpaidBreakMinutes < 0)
    issues.push({ path: 'unpaidBreakMinutes', message: 'Break must be 0 or more minutes.' });
  else if (t.unpaidBreakMinutes >= span)
    issues.push({ path: 'unpaidBreakMinutes', message: 'Break must be shorter than the shift.' });
  const days = new Set(t.workingWeekdays);
  if (days.size === 0)
    issues.push({ path: 'workingWeekdays', message: 'Choose at least one working weekday.' });
  if ([...days].some((d) => !Number.isInteger(d) || d < 0 || d > 6))
    issues.push({ path: 'workingWeekdays', message: 'Weekdays are 0 (Sunday) … 6 (Saturday).' });
  if (days.size !== t.workingWeekdays.length)
    issues.push({ path: 'workingWeekdays', message: 'Weekdays must not repeat.' });
  return issues;
}

/** Length of the shift from start to end in minutes (break included). */
export function shiftSpanMinutes(t: {
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
}): number {
  const start = hmToMinutes(t.startTime);
  const end = hmToMinutes(t.endTime);
  return t.crossesMidnight ? 1440 - start + end : end - start;
}

/** Paid scheduled minutes of one shift (span − unpaid break). */
export function scheduledShiftMinutes(t: ShiftTemplateLike): number {
  return Math.max(0, shiftSpanMinutes(t) - t.unpaidBreakMinutes);
}

/** The UTC window of a shift that starts on local `date` in `tz`. */
export function shiftWindow(
  t: Pick<ShiftTemplateLike, 'startTime' | 'endTime' | 'crossesMidnight'>,
  date: IsoDate,
  tz: string,
): { start: Date; end: Date } {
  const start = zonedToInstant(date, t.startTime, tz);
  const end = zonedToInstant(t.crossesMidnight ? addDays(date, 1) : date, t.endTime, tz);
  return { start, end };
}

/** True when two inclusive date ranges overlap (null `to` = open-ended). */
export function rangesOverlap(
  a: { fromDate: string; toDate: string | null },
  b: { fromDate: string; toDate: string | null },
): boolean {
  const aEnd = a.toDate ?? '9999-12-31';
  const bEnd = b.toDate ?? '9999-12-31';
  return a.fromDate <= bEnd && b.fromDate <= aEnd;
}

/**
 * Conflicts of a new or changed assignment with the employee's other active
 * assignments. With split shifts allowed, overlapping dates are fine unless the
 * two shifts overlap in time on a shared working weekday.
 */
export function findAssignmentConflicts(
  candidate: { id?: string; staffId: string; fromDate: string; toDate: string | null },
  candidateTemplate: ShiftTemplateLike,
  existing: readonly ShiftAssignmentLike[],
  templates: ReadonlyMap<string, ShiftTemplateLike>,
  allowSplitShifts: boolean,
): { assignmentId: string; reason: 'dates_overlap' | 'times_overlap' }[] {
  const out: { assignmentId: string; reason: 'dates_overlap' | 'times_overlap' }[] = [];
  for (const e of existing) {
    if (e.status !== 'active' || e.staffId !== candidate.staffId) continue;
    if (candidate.id && e.id === candidate.id) continue;
    if (!rangesOverlap(candidate, e)) continue;
    if (!allowSplitShifts) {
      out.push({ assignmentId: e.id, reason: 'dates_overlap' });
      continue;
    }
    const other = templates.get(e.shiftTemplateId);
    if (!other || shiftTimesOverlap(candidateTemplate, other))
      out.push({ assignmentId: e.id, reason: 'times_overlap' });
  }
  return out;
}

/** Do two templates overlap in local time on a shared working weekday (incl. overnight spill)? */
export function shiftTimesOverlap(a: ShiftTemplateLike, b: ShiftTemplateLike): boolean {
  // Model a week as minutes 0…10080 from Sunday 00:00; compare every working-day interval.
  const intervals = (t: ShiftTemplateLike) =>
    t.workingWeekdays.map((d) => {
      const s = d * 1440 + hmToMinutes(t.startTime);
      return [s, s + shiftSpanMinutes(t)] as const;
    });
  const week = 7 * 1440;
  for (const [as, ae] of intervals(a))
    for (const [bs, be] of intervals(b))
      for (const shift of [-week, 0, week]) if (as < be + shift && bs + shift < ae) return true;
  return false;
}

export type DaySchedule =
  | {
      date: IsoDate;
      status: 'scheduled';
      minutes: number;
      templateId: string;
      templateCode: string;
      templateStatus: ShiftTemplateLike['status'];
    }
  | {
      date: IsoDate;
      status: 'not_scheduled';
      reason: 'no_assignment' | 'non_working_day' | 'holiday';
      holidayName?: string;
    };

/** The schedule of one employee for each date in a range. */
export function scheduleForRange(
  from: IsoDate,
  to: IsoDate,
  assignments: readonly ShiftAssignmentLike[],
  templates: ReadonlyMap<string, ShiftTemplateLike>,
  holidays: ReadonlyMap<string, HolidayEntry>,
): DaySchedule[] {
  const active = assignments.filter((a) => a.status === 'active');
  return eachDate(from, to).map((date): DaySchedule => {
    const covering = active
      .filter((a) => a.fromDate <= date && (a.toDate === null || a.toDate >= date))
      .map((a) => templates.get(a.shiftTemplateId))
      .filter((t): t is ShiftTemplateLike => Boolean(t) && t!.status !== 'retired');
    if (covering.length === 0) return { date, status: 'not_scheduled', reason: 'no_assignment' };
    const holiday = holidays.get(date);
    if (holiday)
      return { date, status: 'not_scheduled', reason: 'holiday', holidayName: holiday.name };
    const working = covering.filter((t) => t.workingWeekdays.includes(weekday(date)));
    if (working.length === 0) return { date, status: 'not_scheduled', reason: 'non_working_day' };
    // Split shifts: the day's schedule is the sum; the first template is reported.
    const first = working[0]!;
    return {
      date,
      status: 'scheduled',
      minutes: working.reduce((s, t) => s + scheduledShiftMinutes(t), 0),
      templateId: first.id,
      templateCode: working.map((t) => t.code).join(' + '),
      templateStatus: first.status,
    };
  });
}

/**
 * Scheduled minutes over a range: `missing` when no day in the range is
 * covered by any assignment (the employee has no schedule — not 0 hours).
 */
export function scheduledMinutesTotal(
  days: readonly DaySchedule[],
):
  { status: 'ok'; minutes: number; scheduledDays: number } | { status: 'missing'; reason: string } {
  const covered = days.filter((d) => d.status === 'scheduled' || d.reason !== 'no_assignment');
  if (covered.length === 0)
    return { status: 'missing', reason: 'No shift is assigned for this period (not scheduled).' };
  const scheduled = days.filter((d) => d.status === 'scheduled');
  return {
    status: 'ok',
    minutes: scheduled.reduce((s, d) => s + (d.status === 'scheduled' ? d.minutes : 0), 0),
    scheduledDays: scheduled.length,
  };
}

/** The template that applies to `date` (first covering active assignment on a working weekday). */
export function templateOn(
  date: IsoDate,
  assignments: readonly ShiftAssignmentLike[],
  templates: ReadonlyMap<string, ShiftTemplateLike>,
): ShiftTemplateLike | null {
  for (const a of assignments) {
    if (a.status !== 'active') continue;
    if (a.fromDate > date || (a.toDate !== null && a.toDate < date)) continue;
    const t = templates.get(a.shiftTemplateId);
    if (t && t.status !== 'retired' && t.workingWeekdays.includes(weekday(date))) return t;
  }
  return null;
}

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
