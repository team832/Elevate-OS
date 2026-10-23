/**
 * Pure chart maths for the server-rendered charts in charts.tsx. MISSING IS NOT
 * ZERO: a null value is "not recorded" everywhere, never drawn as 0, and a
 * percentage that cannot be computed is null (shown as "—"), never 0%.
 */
export interface Datum {
  label: string;
  value: number | null;
  /** Link to the filtered list behind this value (horizontal bars and donut segments). */
  href?: string;
  /** Extra words for the tooltip, e.g. "4 of 10 chapters". */
  note?: string;
}

export const isKnown = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const numberFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
export const fmtNumber = (n: number) => numberFormat.format(n);

/** part / whole × 100, or null when either is missing or the whole is not positive. */
export function percent(part: number | null, whole: number | null): number | null {
  return isKnown(part) && isKnown(whole) && whole > 0 ? (part / whole) * 100 : null;
}

export function fmtPercent(p: number | null): string {
  if (p === null) return '—';
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
}

/**
 * Each value's share of the known positive total as words that add up to 100%: one
 * largest-remainder rounding, "<1%" for a share that rounds to 0 and ">99%" for one that rounds
 * to 100 without being everything. "—" when the share cannot be computed.
 */
export function shareLabels(values: readonly (number | null)[]): string[] {
  const parts = values.map((v) => (isKnown(v) && v > 0 ? v : 0));
  const total = parts.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => '—');
  const exact = parts.map((v) => (v * 100) / total);
  const whole = exact.map(Math.floor);
  const order = [...exact.keys()].sort((a, b) => exact[b]! - whole[b]! - (exact[a]! - whole[a]!));
  for (const i of order.slice(0, 100 - whole.reduce((a, b) => a + b, 0))) whole[i]! += 1;
  return values.map((v, i) => {
    if (!isKnown(v)) return '—';
    const [e, w] = [exact[i]!, whole[i]!];
    return e > 0 && w === 0 ? '<1%' : e < 100 && w === 100 ? '>99%' : `${w}%`;
  });
}

/** Axis top: the smallest 1, 2, 2.5, 5 or 10 × 10^k at or above `max` (1 when max ≤ 0). */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  return ([1, 2, 2.5, 5].find((m) => m * pow >= max) ?? 10) * pow;
}

/** At most `max` entries; the rest (kept in input order) fold into one "Other". */
export function foldOther(data: readonly Datum[], max = 6): Datum[] {
  if (data.length <= max) return [...data];
  const rest = data
    .slice(max - 1)
    .map((d) => d.value)
    .filter(isKnown);
  const other = rest.length ? rest.reduce((a, b) => a + b, 0) : null;
  return [...data.slice(0, max - 1), { label: 'Other', value: other }];
}

export interface Arc {
  /** Index in the input, so a segment keeps its colour when others change. */
  slot: number;
  label: string;
  value: number;
  share: number;
  dash: number;
  offset: number;
}

/**
 * Donut segments on a circle of the given circumference, starting at 12 o'clock,
 * with `gap` units of surface between neighbours. Null when nothing positive is known.
 */
export function donutArcs(data: readonly Datum[], circumference = 100, gap = 0.8): Arc[] | null {
  const parts = data.flatMap((d, slot) =>
    isKnown(d.value) && d.value > 0 ? [{ slot, label: d.label, value: d.value }] : [],
  );
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (total <= 0) return null;
  let start = 0;
  return parts.map((p) => {
    const length = (p.value / total) * circumference;
    const dash = parts.length > 1 ? Math.max(length - gap, Math.min(length, 0.5)) : length;
    const arc = { ...p, share: (p.value / total) * 100, dash, offset: circumference / 4 - start };
    start += length;
    return arc;
  });
}

const r = (n: number) => Math.round(n * 100) / 100;

/** x/y (0–100 / 0–height, 0 at the bottom) of each value; null values stay null. */
export function linePoints(values: readonly (number | null)[], max: number, height = 40) {
  const step = values.length > 1 ? 100 / (values.length - 1) : 0;
  return values.map((v, i) =>
    isKnown(v) ? { x: r(i * step), y: r(height - (v / max) * height) } : null,
  );
}

/** SVG path through the points; a null value breaks the line instead of dropping to 0. */
export function linePath(points: ReturnType<typeof linePoints>): string {
  let d = '';
  let pen = false;
  for (const p of points) {
    if (!p) pen = false;
    else {
      d += `${pen ? 'L' : 'M'}${p.x} ${p.y}`;
      pen = true;
    }
  }
  return d;
}

export interface FunnelRow {
  label: string;
  count: number | null;
  /** Bar width as % of the first stage. */
  width: number | null;
  fromPrevious: number | null;
}

/** Stage widths and step conversion; null when the first stage is missing or 0. */
export function funnelRows(stages: readonly Datum[]): FunnelRow[] | null {
  const top = stages[0]?.value ?? null;
  if (!isKnown(top) || top <= 0) return null;
  return stages.map((s, i) => ({
    label: s.label,
    count: s.value,
    width: percent(s.value, top),
    fromPrevious: i === 0 ? null : percent(s.value, stages[i - 1]?.value ?? null),
  }));
}

/** One-sentence text alternative: every value for short series, the shape for long ones. */
export function summarise(label: string, data: readonly Datum[], format = fmtNumber): string {
  const say = (d: Datum) => `${d.label} ${isKnown(d.value) ? format(d.value) : 'not recorded'}`;
  if (data.length <= 12) return `${label}: ${data.map(say).join(', ')}.`;
  const known = data.map((d) => d.value).filter(isKnown);
  const high = data.find((d) => d.value === Math.max(...known));
  const first = data[0] as Datum;
  const last = data[data.length - 1] as Datum;
  return `${label}: ${data.length} points from ${first.label} to ${last.label}; first ${say(first)}, last ${say(last)}${high ? `, highest ${say(high)}` : ''}.`;
}
