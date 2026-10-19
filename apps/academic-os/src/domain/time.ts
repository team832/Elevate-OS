/**
 * Calendar and clock helpers for the academic domain (pure). Calendar dates are
 * `YYYY-MM-DD` Asia/Kolkata days; clock times are local `HH:MM`.
 */
import { addDays, isIsoDate, type IsoDate } from '@elevate/shared-types';

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes after midnight for `HH:MM`, or null when the string is not a valid time. */
export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = HHMM_RE.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** `HH:MM` for minutes after midnight (0–1439). */
export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
}

/** Every calendar date from `from` to `to` inclusive (empty when from > to). */
export function eachDate(from: string, to: string): string[] {
  if (!isIsoDate(from) || !isIsoDate(to)) throw new RangeError('eachDate needs YYYY-MM-DD dates');
  const out: string[] = [];
  for (let d: IsoDate = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** `YYYY-MM` of a calendar date. */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** Monday of the ISO week containing `date` (weeks run Monday–Sunday, PRD 0.1 rule 8). */
export function weekStart(date: string): string {
  if (!isIsoDate(date)) throw new RangeError('weekStart needs a YYYY-MM-DD date');
  return addDays(date, 1 - isoWeekday(date));
}

/** Half-open interval overlap: touching intervals ([a,b) and [b,c)) do NOT overlap. */
export function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}
