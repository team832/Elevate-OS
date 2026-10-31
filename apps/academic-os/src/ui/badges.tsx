/** Status badges that keep planning labels (locked/provisional/proposed) apart from delivery states. */
import { fmtDay, StatusBadge, type Tone } from '@elevate/shared-ui';
import { fmtClock } from '../domain/time';
import { FIRM_STATUSES } from '../domain/timetable';

/** A stored value in words: `class_12` reads "Class 12", `class11_two_year` "Class 11 two year". */
export const words = (s: string) =>
  (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ').replace(/([a-z])(\d)/g, '$1 $2');

export { programmeName } from '@elevate/shared-types';

/** Options for a select of stored values, each shown in words. */
export const wordOptions = (values: readonly string[]) => values.map((v) => ({ value: v, label: words(v) }));
export const MODE_OPTIONS = wordOptions(['offline', 'online', 'hybrid']);
export const modeLabel = (mode: string | null | undefined) => (mode ? words(mode) : 'Not recorded');

const PLAN_TONES: Record<string, Tone> = {
  locked: 'success',
  approved: 'success',
  provisional: 'warning',
  proposed: 'info',
  draft: 'info',
  superseded: 'neutral',
  unverified: 'danger',
  unknown: 'neutral',
};

/** Plan / label status: locked = success, provisional = warning, proposed = info, superseded = neutral. */
export function PlanBadge({ status, prefix }: { status: string | null | undefined; prefix?: string }) {
  const s = status ?? 'unknown';
  return <StatusBadge tone={PLAN_TONES[s] ?? 'neutral'}>{words(prefix ? `${prefix}: ${s}` : s)}</StatusBadge>;
}

const STATE_TONES: Record<string, Tone> = {
  scheduled: 'info',
  held: 'success',
  delivered: 'success',
  cancelled: 'danger',
  rescheduled: 'warning',
  submitted: 'warning',
  verified: 'success',
  superseded: 'neutral',
  draft: 'neutral',
  conducted: 'info',
  finalised: 'success',
  final: 'success',
  active: 'success',
  planning: 'info',
  completed: 'neutral',
  paused: 'warning',
  withdrawn: 'neutral',
  open: 'warning',
  in_progress: 'info',
  done: 'success',
  resolved: 'success',
  closed: 'neutral',
  confirmed: 'success',
  rejected: 'danger',
  failed: 'warning',
  dead: 'danger',
  present: 'success',
  late: 'warning',
  partial: 'warning',
  absent: 'danger',
  excused: 'neutral',
  feasible: 'success',
  infeasible: 'danger',
  not_assessed: 'neutral',
  hard: 'danger',
  preference: 'warning',
};

/** Class length with the label that belongs to it ("75 min, Length: locked"), which governs only this length; not decided is said, never assumed. */
export function ClassLength({ minutes, status, note }: { minutes: number | null; status: string; note?: boolean }) {
  if (minutes === null) return <StatusBadge tone="neutral">Not decided</StatusBadge>;
  return (
    <>
      {minutes} min <PlanBadge status={status} prefix="length" />
      {note ? <> {FIRM_STATUSES.has(status) ? 'A class of any other length is refused.' : 'A class of another length only gets a warning.'}</> : null}
    </>
  );
}

export function StateBadge({ state }: { state: string | null | undefined }) {
  const s = state ?? 'unknown';
  return <StatusBadge tone={STATE_TONES[s] ?? 'neutral'}>{words(s)}</StatusBadge>;
}

/** A value that may be missing: shows "Missing" (never 0) when null. */
export function Maybe({ value, suffix = '' }: { value: number | string | null | undefined; suffix?: string }) {
  if (value === null || value === undefined || value === '') return <StatusBadge tone="neutral">Missing</StatusBadge>;
  return (
    <>
      {value}
      {suffix}
    </>
  );
}

/** "1 Oct 2026" or "1 Oct 2026 to 7 Oct 2026". */
export const fmtRange = (r: { from: string; to: string }) => (r.from === r.to ? fmtDay(r.from) : `${fmtDay(r.from)} to ${fmtDay(r.to)}`);
/** A span that may have no end: "1 Oct 2026 to 7 Oct 2026", "From 1 Oct 2026 · ongoing", "Until 7 Oct 2026", "Dates not set". */
export function fmtSpan(from: string | null | undefined, to: string | null | undefined, noEnd = 'ongoing') {
  if (from && to) return `${fmtDay(from)} to ${fmtDay(to)}`;
  if (from) return `From ${fmtDay(from)} · ${noEnd}`;
  return to ? `Until ${fmtDay(to)}` : 'Dates not set';
}
export { fmtClock };
/** "2 Nov 2026, 4:30 pm", the same shape as `fmtDateTime`. */
export const fmtSlot = (date: string, clock: string) => `${fmtDay(date)}, ${fmtClock(clock)}`;
export const fmtHours = (minutes: number) => `${Math.round((minutes / 60) * 100) / 100} h`;
const DATE_TIME = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
export const fmtDateTime = (d: Date | string | null | undefined) => (d ? DATE_TIME.format(new Date(d)) : '—');
