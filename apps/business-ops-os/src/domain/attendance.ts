/**
 * Staff attendance (owner brief 23 Oct 2026 §12, §14). Pure: one day's status from the raw
 * records — weekly schedule, holiday, approved leave, punches and an HR decision.
 * No data is never absence: a scheduled workday with no punches and no HR decision is `unmarked`;
 * `absent` comes only from an HR decision (or an approved correction). Class delivery and teaching
 * logs (Academic) are not inputs, on purpose (scenario 10: present ≠ classes delivered).
 */
import { addDays, istInstant, toIsoDate, weekdayOf, type IsoDate } from './dates';
import { parseCsv } from './feedback-import';

export const ATTENDANCE_STATUSES = [
  'present',
  'half_day',
  'absent',
  'unmarked',
  'on_leave',
  'holiday',
  'weekly_off',
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  half_day: 'Half day',
  absent: 'Absent',
  unmarked: 'Unmarked',
  on_leave: 'On leave',
  holiday: 'Holiday',
  weekly_off: 'Weekly off',
};
/** Statuses an employee may ask HR to set in a correction. */
export const REQUESTABLE_STATUSES = ['present', 'half_day', 'absent'] as const;

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAY_KEYS)[number];
/** Working hours per weekday (IST `HH:MM`); null = weekly off. Mirrors ops.work_schedules. */
export type WeeklyPattern = Record<Weekday, { start: string; end: string } | null>;

export interface Punch {
  at: Date;
  direction: 'in' | 'out';
}

/** HR settings hr.attendance.* (proposed until the owner approves them). */
export interface DayRules {
  graceMinutes: number;
  halfDayHours: number;
  fullDayHours: number;
}

export interface DayInput {
  date: IsoDate;
  /** The staff member's weekly pattern; null = no schedule known. */
  pattern: WeeklyPattern | null;
  /** The schedule's own grace; 0 or absent = the HR setting. */
  graceMinutes?: number;
  /** An approved (or locked) holiday; a proposed one never changes the day. */
  holiday: boolean;
  /** A holiday that is still only proposed: shown, not applied. */
  proposedHoliday?: boolean;
  /** The day is over (before today IST): a missing check-out can no longer be "still at work". */
  finished?: boolean;
  onLeave: boolean;
  /** Punches attributed to this day (see punchesByDay). */
  punches: readonly Punch[];
  decision?: { status: AttendanceStatus; note: string | null } | null;
}

export interface DerivedDay {
  date: IsoDate;
  status: AttendanceStatus;
  basis: 'computed' | 'hr_decision';
  note: string | null;
  /** true = a working day in the schedule, false = weekly off, null = no schedule known. */
  scheduled: boolean | null;
  holiday: boolean;
  proposedHoliday: boolean;
  firstIn: Date | null;
  lastOut: Date | null;
  /** Minutes after the scheduled start, once past the grace; null = no start or no check-in. */
  lateMinutes: number | null;
  missingCheckout: boolean;
}

const HOUR = 3_600_000;

export function deriveDay(input: DayInput, rules: DayRules): DerivedDay {
  const hours = input.pattern ? input.pattern[WEEKDAY_KEYS[weekdayOf(input.date)]!] : undefined;
  const time = (d: Punch) => d.at.getTime();
  const ins = input.punches.filter((x) => x.direction === 'in').map(time);
  const first = ins.length ? Math.min(...ins) : null;
  const outs = input.punches.filter(
    (x) => x.direction === 'out' && first !== null && time(x) >= first,
  );
  const last = outs.length ? Math.max(...outs.map(time)) : null;
  const grace = input.graceMinutes || rules.graceMinutes;
  const late =
    hours && first !== null
      ? Math.floor((first - istInstant(input.date, hours.start).getTime()) / 60_000)
      : null;
  const worked = first !== null && last !== null ? (last - first) / HOUR : null;
  const computed = ((): AttendanceStatus => {
    if (input.holiday) return 'holiday';
    if (hours === null) return 'weekly_off';
    if (input.onLeave) return 'on_leave';
    if (first === null) return 'unmarked';
    // No check-out: still at work today; on a past day it is HR's call, never guessed.
    if (worked === null) return input.finished ? 'unmarked' : 'present';
    if (worked >= rules.fullDayHours) return 'present';
    // A short day is HR's call too, never an automatic absence.
    return worked >= rules.halfDayHours ? 'half_day' : 'unmarked';
  })();
  return {
    date: input.date,
    status: input.decision?.status ?? computed,
    basis: input.decision ? 'hr_decision' : 'computed',
    note: input.decision?.note ?? null,
    scheduled: hours === undefined ? null : hours !== null,
    holiday: input.holiday,
    proposedHoliday: !input.holiday && Boolean(input.proposedHoliday),
    firstIn: first === null ? null : new Date(first),
    lastOut: last === null ? null : new Date(last),
    lateMinutes: late === null || input.holiday ? null : late > grace ? late : 0,
    missingCheckout: first !== null && last === null,
  };
}

/** An out-punch within this many hours of the last check-in closes that check-in's day. */
export const OVERNIGHT_HOURS = 16;

/**
 * Punches by IST work day. A check-out after midnight (no check-in yet that day, within
 * OVERNIGHT_HOURS of the last check-in) belongs to the day of that check-in.
 */
export function punchesByDay<P extends Punch>(punches: readonly P[]): Map<IsoDate, P[]> {
  const out = new Map<IsoDate, P[]>();
  let lastIn: { day: IsoDate; at: number } | null = null;
  for (const p of [...punches].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    let day = toIsoDate(p.at);
    if (p.direction === 'in') lastIn = { day, at: p.at.getTime() };
    else if (lastIn && lastIn.day !== day && p.at.getTime() - lastIn.at <= OVERNIGHT_HOURS * HOUR)
      day = lastIn.day;
    out.set(day, [...(out.get(day) ?? []), p]);
  }
  return out;
}

export type ReviewReason = 'unmarked' | 'missing_checkout';
export const REVIEW_REASON_LABELS: Record<ReviewReason, string> = {
  unmarked: 'Unmarked scheduled day',
  missing_checkout: 'Missing check-out',
};

/** Why HR should look at a finished day (before `today`); an HR-decided day needs nothing more. */
export function reviewReasons(d: DerivedDay, today: IsoDate): ReviewReason[] {
  if (d.basis === 'hr_decision' || d.date >= today) return [];
  const out: ReviewReason[] = [];
  if (d.status === 'unmarked' && d.scheduled === true && !d.missingCheckout) out.push('unmarked');
  if (d.missingCheckout && !d.holiday) out.push('missing_checkout');
  return out;
}

export interface AttendanceSummary {
  /** Working days in the schedule, holidays excluded (leave days included); null = no schedule known for any day. */
  scheduledWorkdays: number | null;
  present: number;
  halfDays: number;
  leave: number;
  holidays: number;
  confirmedAbsences: number;
  unmarked: number;
  /** Days for which no work schedule was known. */
  noSchedule: number;
}

/** Brief §14 attendance figures. Counts only; never a score or a ranking (R13). */
export function summariseDays(days: readonly DerivedDay[]): AttendanceSummary {
  const n = (f: (d: DerivedDay) => boolean) => days.filter(f).length;
  return {
    scheduledWorkdays:
      days.length && days.every((d) => d.scheduled === null)
        ? null
        : n((d) => d.scheduled === true && d.status !== 'holiday'),
    present: n((d) => d.status === 'present'),
    halfDays: n((d) => d.status === 'half_day'),
    leave: n((d) => d.status === 'on_leave'),
    holidays: n((d) => d.status === 'holiday'),
    confirmedAbsences: n((d) => d.status === 'absent'),
    unmarked: n((d) => d.status === 'unmarked' && d.scheduled === true),
    noSchedule: n((d) => d.scheduled === null),
  };
}

/** First and last day of a `YYYY-MM` month. */
export function monthRange(month: string): { from: IsoDate; to: IsoDate } {
  const from = `${month}-01` as IsoDate;
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = `${m === 12 ? y + 1 : y}-${String((m % 12) + 1).padStart(2, '0')}-01` as IsoDate;
  return { from, to: addDays(next, -1) };
}

/** Every date from `from` to `to`, inclusive. */
export function datesBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// --- CSV import of punches (R12: a file, never a device connection) ---------------------------

export const MAX_PUNCH_CSV_CHARS = 2_000_000;
export interface PunchCsvRow {
  line: number;
  staffCode: string;
  /** ISO instant, or null when unreadable. */
  at: string | null;
  direction: Punch['direction'] | null;
  errors: string[];
}

/** One CSV line's cells, trimmed. */
const cells = (line: string) => (parseCsv(line)[0] ?? []).map((c) => c.trim());
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const COLUMNS = { staffCode: 'staffcode', at: 'datetime', direction: 'direction' } as const;

/** `YYYY-MM-DD HH:MM[:SS]` read as IST, or an ISO instant with its own offset. */
function readInstant(v: string): string | null {
  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?$/.exec(v);
  const d = local
    ? new Date(`${local[1]}T${local[2]}${local[3] ?? ':00'}+05:30`)
    : /^\d{4}-\d{2}-\d{2}T.+(Z|[+-]\d{2}:\d{2})$/.test(v)
      ? new Date(v)
      : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

/** Parse a punch file (header row: Staff code, Date-time, Direction; any column order). */
export function parsePunchCsv(
  text: string,
): { ok: true; rows: PunchCsvRow[] } | { ok: false; error: string } {
  const lines = text.replace(/^\s+/, '').split(/\r?\n/); // \s covers a spreadsheet's BOM
  if (!lines[0]?.trim()) return { ok: false, error: 'The file is empty.' };
  const header = cells(lines[0]).map(norm);
  const at = (key: keyof typeof COLUMNS) => header.indexOf(COLUMNS[key]);
  if (Object.keys(COLUMNS).some((k) => at(k as keyof typeof COLUMNS) < 0))
    return {
      ok: false,
      error: 'The first row must name the columns: Staff code, Date-time, Direction.',
    };
  const rows: PunchCsvRow[] = [];
  lines.slice(1).forEach((raw, i) => {
    if (!raw.trim()) return;
    const c = cells(raw);
    const staffCode = c[at('staffCode')] ?? '';
    const instant = readInstant(c[at('at')] ?? '');
    const dir = (c[at('direction')] ?? '').toLowerCase();
    const direction = dir === 'in' || dir === 'out' ? dir : null;
    rows.push({
      line: i + 2,
      staffCode,
      at: instant,
      direction,
      errors: [
        ...(staffCode ? [] : ['Staff code is empty']),
        ...(instant ? [] : ['Date-time must look like 2026-10-19 09:30 (IST)']),
        ...(direction ? [] : ['Direction must be in or out']),
      ],
    });
  });
  return { ok: true, rows };
}
