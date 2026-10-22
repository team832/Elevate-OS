/**
 * Calendar helpers for Business Ops. Every business date is an Asia/Kolkata
 * calendar day (`YYYY-MM-DD`, PLT-013); instants are UTC. Pure functions.
 */
import {
  addDays,
  daysBetween,
  isIsoDate,
  toIsoDate,
  TIMEZONE,
  type IsoDate,
} from '@elevate/shared-types';

export { addDays, daysBetween, isIsoDate, toIsoDate, TIMEZONE, type IsoDate };

/** Today's Asia/Kolkata calendar date for an instant. */
export function istToday(now: Date): IsoDate {
  return toIsoDate(now, TIMEZONE);
}

/** IST instant of a day (and optional `HH:MM[:SS]` time). */
export const istInstant = (day: string, time = '00:00') =>
  new Date(`${day}T${time.slice(0, 5)}:00+05:30`);

/** Day of week of a calendar date: 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Monday-to-Sunday IST week containing `date` (PLT-013: weeks start Monday). */
export function istWeekContaining(date: IsoDate): { from: IsoDate; to: IsoDate } {
  const offsetFromMonday = (weekdayOf(date) + 6) % 7;
  const from = addDays(date, -offsetFromMonday);
  return { from, to: addDays(from, 6) };
}

/**
 * The first date on or after `date` that is not a closed weekday. With every
 * weekday closed it returns `date` unchanged (a misconfiguration must not loop).
 */
export function nextServiceDay(date: IsoDate, closedWeekdays: readonly number[]): IsoDate {
  if (new Set(closedWeekdays).size >= 7) return date;
  let current = date;
  while (closedWeekdays.includes(weekdayOf(current))) current = addDays(current, 1);
  return current;
}

/** Human label for a window, e.g. "12 Oct 2026 – 18 Oct 2026". */
export function windowLabel(from: IsoDate, to: IsoDate): string {
  const fmt = (d: IsoDate) =>
    new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${d}T00:00:00Z`));
  return from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
}
