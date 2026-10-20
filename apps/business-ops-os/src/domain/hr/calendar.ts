/**
 * Calendar and timezone helpers for staff time (OPS-050…OPS-059). Pure.
 *
 * Instants are UTC `Date`s; calendar days are `YYYY-MM-DD`; wall-clock times
 * are `HH:MM` in an IANA timezone (each employee has one, default Asia/Kolkata).
 * Conversions use `Intl` only (no dependency); they are exact for zones without
 * DST (India) and resolve DST gaps/overlaps to the earlier offset.
 */
import { addDays, daysBetween, isIsoDate, type IsoDate } from '@elevate/shared-types';

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/** A validation problem reported against an input field. */
export type Issue = { path: string; message: string };

const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True for a valid `HH:MM` (24 h) wall-clock time. */
export function isHm(value: unknown): value is string {
  return typeof value === 'string' && HM_RE.test(value);
}

/** Minutes after midnight of `HH:MM` (throws on bad input). */
export function hmToMinutes(value: string): number {
  const m = HM_RE.exec(value);
  if (!m) throw new RangeError(`Not a valid HH:MM time: ${JSON.stringify(value)}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

const zoneCache = new Map<string, boolean>();
/** True when `tz` is an IANA timezone the runtime knows. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.trim() === '' || tz.length > 64) return false;
  const cached = zoneCache.get(tz);
  if (cached !== undefined) return cached;
  let ok = true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    ok = false;
  }
  zoneCache.set(tz, ok);
  return ok;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string): Intl.DateTimeFormat {
  const f =
    partsFormatters.get(tz) ??
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  partsFormatters.set(tz, f);
  return f;
}

/** Wall-clock parts of an instant in `tz`. */
export function zonedParts(
  instant: Date,
  tz: string,
): { date: IsoDate; time: string; minutes: number; seconds: number } {
  if (Number.isNaN(instant.getTime())) throw new RangeError('Invalid Date');
  const parts = Object.fromEntries(
    formatterFor(tz)
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}` as IsoDate,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    minutes: hour * 60 + minute,
    seconds: Number(parts.second),
  };
}

/** Offset of `tz` from UTC at `instant`, in minutes (Asia/Kolkata = +330). */
export function zoneOffsetMinutes(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  const [y, m, d] = p.date.split('-').map(Number) as [number, number, number];
  const asUtc = Date.UTC(y, m - 1, d, Math.floor(p.minutes / 60), p.minutes % 60, p.seconds);
  const whole = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUtc - whole) / 60_000);
}

/** The UTC instant of local `date` + `HH:MM` in `tz`. */
export function zonedToInstant(date: IsoDate, time: string, tz: string): Date {
  if (!isIsoDate(date)) throw new RangeError(`Not a valid date: ${JSON.stringify(date)}`);
  const minutes = hmToMinutes(time);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  // Two refinements settle the offset (handles zones whose offset differs across the day).
  let guess = wall - zoneOffsetMinutes(new Date(wall), tz) * 60_000;
  guess = wall - zoneOffsetMinutes(new Date(guess), tz) * 60_000;
  return new Date(guess);
}

/** The calendar date of `instant` in `tz`. */
export function zonedDate(instant: Date, tz: string): IsoDate {
  return zonedParts(instant, tz).date;
}

/** Day of week of a calendar date: 0 = Sunday … 6 = Saturday. */
export { weekdayOf as weekday } from '../dates';

/** Every date from `from` to `to` inclusive (empty when to < from; capped at `max`). */
export function eachDate(from: IsoDate, to: IsoDate, max = 400): IsoDate[] {
  const n = daysBetween(from, to);
  if (n < 0) return [];
  if (n + 1 > max) throw new RangeError(`Date range longer than ${max} days`);
  return Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}

/** `YYYY-MM` → first and last day of that month. */
export function monthRange(month: string): { from: IsoDate; to: IsoDate } {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new RangeError(`Not a valid YYYY-MM month: ${JSON.stringify(month)}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return {
    from: `${m[1]}-${m[2]}-01` as IsoDate,
    to: `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}` as IsoDate,
  };
}

export interface HolidayEntry {
  date: string;
  name: string;
  /** null = every location. */
  location: string | null;
  status: 'proposed' | 'approved' | 'withdrawn';
}

/**
 * Holidays that apply to an employee at `location` (case-insensitive match;
 * a null holiday location applies everywhere). Withdrawn entries never apply;
 * proposed entries apply only when `includeProposed`.
 */
export function holidaysFor(
  holidays: readonly HolidayEntry[],
  location: string | null,
  includeProposed: boolean,
): Map<string, HolidayEntry> {
  const loc = location?.trim().toLowerCase() || null;
  const out = new Map<string, HolidayEntry>();
  for (const h of holidays) {
    if (h.status === 'withdrawn') continue;
    if (h.status === 'proposed' && !includeProposed) continue;
    const hl = h.location?.trim().toLowerCase() || null;
    if (hl !== null && hl !== loc) continue;
    if (!out.has(h.date) || hl !== null) out.set(h.date, h);
  }
  return out;
}

/** Whole minutes between two instants (b − a). */
export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

/** Render minutes as "7 h 30 min" (negative values keep their sign). */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '—';
  const sign = minutes < 0 ? '−' : '';
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m} min`;
  return m === 0 ? `${sign}${h} h` : `${sign}${h} h ${m} min`;
}
