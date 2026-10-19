/**
 * IST calendar helpers (PLT-013): business dates are Asia/Kolkata days; weeks run
 * Monday to Sunday. Pure (uses only @elevate/shared-types date maths).
 */
import { addDays, isIsoDate, toIsoDate, type IsoDate } from '@elevate/shared-types';

/** The IST calendar date of an instant. */
export function istDate(instant: Date): IsoDate {
  return toIsoDate(instant, 'Asia/Kolkata');
}

/** 0 = Monday … 6 = Sunday for a calendar date. */
export function weekdayIndex(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return (js + 6) % 7;
}

/** Monday of the IST week containing `date`. */
export function weekStart(date: IsoDate): IsoDate {
  return addDays(date, -weekdayIndex(date));
}

export function weekRange(start: IsoDate): { from: IsoDate; to: IsoDate } {
  const monday = weekStart(start);
  return { from: monday, to: addDays(monday, 6) };
}

/** `YYYY-MM-DD` → the UTC instant of 00:00 IST that day. */
export function istMidnightUtc(date: IsoDate): Date {
  if (!isIsoDate(date)) throw new RangeError(`Not a calendar date: ${date}`);
  return new Date(`${date}T00:00:00+05:30`);
}

/** Label such as "Week of Mon 12 Oct 2026 (IST)". */
export function weekLabel(start: IsoDate): string {
  const d = istMidnightUtc(weekStart(start));
  const label = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
  return `Week of ${label} (IST)`;
}

/** Format an instant in IST for screens, e.g. "17 Oct 2026, 19:00 IST". */
export function formatIst(instant: Date | string | null | undefined): string {
  if (!instant) return '—';
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) return '—';
  return `${new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d)} IST`;
}
