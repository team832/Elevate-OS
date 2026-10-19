/**
 * Exact marks arithmetic (no floating point).
 *
 * A mark value is held as an integer number of UNITS, where 1 mark = 10 000
 * units. Every value Elevate's scoring rules use (+1, −0.25, +4, −1, 0.5, a
 * quarter-mark cap) is an exact multiple of a unit, so sums of thousands of
 * answers never drift (0.1 + 0.2 problems cannot happen). Values with more than
 * four decimal places are rejected rather than rounded.
 */
export const UNITS_PER_MARK = 10_000;
export type MarkUnits = number;

const DECIMAL_RE = /^([+-])?(\d{1,6})(?:\.(\d{1,4}))?$/;

/** Parse a decimal mark (`"-0.25"`, `"1"`, `0.5`) into units; null/undefined/'' → null. Throws on invalid input. */
export function parseMarks(value: string | number | null | undefined): MarkUnits | null {
  if (value === null || value === undefined || value === '') return null;
  const text = typeof value === 'number' ? numberToPlainString(value) : value.trim();
  const m = DECIMAL_RE.exec(text);
  if (!m) throw new RangeError(`Not an exact mark value (max 4 decimal places): ${String(value)}`);
  const sign = m[1] === '-' ? -1 : 1;
  const whole = Number(m[2]);
  const frac = Number((m[3] ?? '').padEnd(4, '0'));
  const units = sign * (whole * UNITS_PER_MARK + frac);
  return units === 0 ? 0 : units; // normalise -0
}

/** True when `value` parses as an exact mark value. */
export function isExactMark(value: string | number): boolean {
  try {
    return parseMarks(value) !== null;
  } catch {
    return false;
  }
}

function numberToPlainString(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError('Mark value must be finite');
  // Up to 4 decimals exactly; reject values that need more.
  const fixed = value.toFixed(4);
  if (Number(fixed) !== value) throw new RangeError(`Mark value has more than 4 decimals: ${value}`);
  return fixed;
}

/** Human form: trailing zeros trimmed (`12.75`, `-0.5`, `12`). */
export function formatMarks(units: MarkUnits): string {
  const sign = units < 0 ? '-' : '';
  const abs = Math.abs(units);
  const whole = Math.floor(abs / UNITS_PER_MARK);
  const frac = String(abs % UNITS_PER_MARK)
    .padStart(4, '0')
    .replace(/0+$/, '');
  return `${sign}${whole}${frac ? `.${frac}` : ''}`;
}

/** Database form for `numeric(10,4)`: always four decimals. */
export function toNumericString(units: MarkUnits): string {
  const sign = units < 0 ? '-' : '';
  const abs = Math.abs(units);
  return `${sign}${Math.floor(abs / UNITS_PER_MARK)}.${String(abs % UNITS_PER_MARK).padStart(4, '0')}`;
}

/** Multiply a per-question value by a whole count (exact). */
export function timesCount(units: MarkUnits, count: number): MarkUnits {
  if (!Number.isInteger(count) || count < 0) throw new RangeError('count must be a whole number ≥ 0');
  return units * count;
}

/**
 * Canonical form of a numeric (short-answer) response or key so `12.5`,
 * `12.50` and `+12.5` compare equal; null when not a number.
 */
export function canonicalNumber(value: string): string | null {
  const m = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) return null;
  const whole = (m[2] ?? '0').replace(/^0+(?=\d)/, '');
  const frac = (m[3] ?? '').replace(/0+$/, '');
  const isZero = /^0+$/.test(whole) && frac === '';
  const sign = m[1] === '-' && !isZero ? '-' : '';
  return `${sign}${whole}${frac ? `.${frac}` : ''}`;
}
