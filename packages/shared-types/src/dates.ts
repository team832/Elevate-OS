/**
 * Date helpers. Elevate operates in India: every calendar date (class day,
 * deadline, report window) is interpreted in Asia/Kolkata. Timestamps are
 * stored as UTC instants (`timestamptz`) and only converted for display or
 * when deriving a calendar date.
 */
export const TIMEZONE = 'Asia/Kolkata' as const;

/** `YYYY-MM-DD` calendar date. */
export type IsoDate = string & { readonly __isoDate: true };
/** ISO 8601 instant, e.g. `2026-10-17T05:30:00.000Z`. */
export type IsoDateTime = string & { readonly __isoDateTime: true };

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `value` is a real calendar date in `YYYY-MM-DD` form (rejects 2026-02-30). */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function parseIsoDate(value: string): IsoDate {
  if (!isIsoDate(value)) throw new RangeError(`Not a valid YYYY-MM-DD date: ${JSON.stringify(value)}`);
  return value;
}

/** The calendar date of `instant` in `timeZone` (default Asia/Kolkata). */
export function toIsoDate(instant: Date = new Date(), timeZone: string = TIMEZONE): IsoDate {
  if (Number.isNaN(instant.getTime())) throw new RangeError('Invalid Date');
  // en-CA formats as YYYY-MM-DD.
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  return formatted as IsoDate;
}

export function toIsoDateTime(instant: Date = new Date()): IsoDateTime {
  if (Number.isNaN(instant.getTime())) throw new RangeError('Invalid Date');
  return instant.toISOString() as IsoDateTime;
}

export function nowIso(): IsoDateTime {
  return toIsoDateTime(new Date());
}

/** Add whole days to a calendar date (no timezone involved). */
export function addDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) throw new RangeError('days must be an integer');
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10) as IsoDate;
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const toUtc = (s: IsoDate) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** Compare two calendar dates: negative, zero or positive. */
export function compareIsoDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
