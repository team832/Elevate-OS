/**
 * Server-rendered charts: plain HTML/CSS bars and SVG lines/donuts, no chart
 * library, colours from the --ops-chart-* tokens. Every chart has a text
 * alternative (visible values, a legend, or a "Show as table" toggle) and an
 * explicit "Not enough data" state; a missing value is never drawn as 0.
 */
import type { ReactNode } from 'react';
import {
  donutArcs,
  fmtNumber,
  fmtPercent,
  foldOther,
  funnelRows,
  isKnown,
  linePath,
  linePoints,
  niceMax,
  percent,
  summarise,
  type Datum,
} from './chart-math';

export type { Datum } from './chart-math';
type Format = (n: number) => string;

interface ChartProps {
  /** What is plotted ("Demos booked per day"): the accessible name and table caption. */
  label: string;
  data: readonly Datum[];
  format?: Format;
  /** Why there is nothing to draw, e.g. "No demos were booked in this period." */
  emptyText?: string;
}

const EMPTY = 'Nothing has been recorded for this period yet.';
const show = (v: number | null, format: Format) => (isKnown(v) ? format(v) : 'Not recorded');

function NotEnoughData({ text }: { text: string }) {
  return (
    <div className="ops-chart-empty">
      <p className="ops-chart-empty-title">Not enough data</p>
      <p>{text}</p>
    </div>
  );
}

function DataToggle({ label, data, format }: Required<Omit<ChartProps, 'emptyText'>>) {
  return (
    <details className="ops-chart-table">
      <summary>Show as table</summary>
      <div className="el-table-wrap">
        <table className="el-table">
          <caption className="el-visually-hidden">{label}</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className="el-num">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <th scope="row">{d.label}</th>
                <td className="el-num">{show(d.value, format)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * Bars with a value on each. `horizontal` (default) for categories with long
 * names: a labelled list, rows can link to the filtered list. `vertical` for
 * short ordered labels (days, months).
 */
export function BarChart({
  label,
  data,
  format = fmtNumber,
  emptyText = EMPTY,
  orientation = 'horizontal',
}: ChartProps & { orientation?: 'horizontal' | 'vertical' }) {
  const known = data.map((d) => d.value).filter(isKnown);
  if (!known.length)
    return (
      <figure className="ops-chart">
        <NotEnoughData text={emptyText} />
      </figure>
    );
  if (orientation === 'horizontal') {
    const max = Math.max(...known);
    return (
      <figure className="ops-chart">
        <ul className="ops-hbars" aria-label={label}>
          {data.map((d) => (
            <li key={d.label} className="ops-hbar">
              <span className="ops-hbar-label">
                {d.href ? <a href={d.href}>{d.label}</a> : d.label}
              </span>
              <span className="ops-hbar-track" aria-hidden="true">
                <span
                  className="ops-hbar-fill"
                  style={{ width: `${percent(d.value, max) ?? 0}%` }}
                />
              </span>
              <span className="ops-hbar-value">{show(d.value, format)}</span>
            </li>
          ))}
        </ul>
      </figure>
    );
  }
  const top = niceMax(Math.max(...known));
  const max = Math.max(...known);
  const every = Math.ceil(data.length / 8);
  // Long series: values only on the highest and the latest bar, axis labels counted back
  // from the latest day, so labels never collide. A missing value always shows "–".
  const labelled = (d: Datum, i: number) =>
    data.length <= 12 || i === data.length - 1 || d.value === max;
  return (
    <figure className="ops-chart">
      <div className="ops-vbars" role="img" aria-label={summarise(label, data, format)}>
        {data.map((d, i) => (
          <div key={d.label} className="ops-vbar" title={`${d.label}: ${show(d.value, format)}`}>
            <span className="ops-vbar-plot">
              <span className="ops-vbar-value">
                {!isKnown(d.value) ? '–' : labelled(d, i) ? format(d.value) : ''}
              </span>
              <span
                className="ops-vbar-fill"
                style={{ height: `${percent(d.value, top) ?? 0}%` }}
              />
            </span>
            <span className="ops-vbar-label">
              {(data.length - 1 - i) % every === 0 ? d.label : ''}
            </span>
          </div>
        ))}
      </div>
      <DataToggle label={label} data={data} format={format} />
    </figure>
  );
}

/** Share of a whole, at most 6 segments (the rest fold into "Other"), total in the centre. */
export function DonutChart({
  label,
  data,
  format = fmtNumber,
  emptyText = EMPTY,
  totalLabel = 'Total',
}: ChartProps & { totalLabel?: string }) {
  const folded = foldOther(data);
  const arcs = donutArcs(folded);
  if (!arcs)
    return (
      <figure className="ops-chart">
        <NotEnoughData text={emptyText} />
      </figure>
    );
  const total = arcs.reduce((a, s) => a + s.value, 0);
  const shareOf = (d: Datum) => fmtPercent(percent(d.value, total));
  return (
    <figure className="ops-chart ops-donut">
      <svg
        viewBox="0 0 42 42"
        role="img"
        aria-label={`${label}: ${folded.map((d) => `${d.label} ${show(d.value, format)} (${shareOf(d)})`).join(', ')}. ${totalLabel} ${format(total)}.`}
      >
        {arcs.map((a) => (
          <circle
            key={a.slot}
            className={`ops-donut-arc ${slotClass(a.slot, folded[a.slot]?.label)}`}
            cx="21"
            cy="21"
            r="15.915"
            strokeDasharray={`${a.dash} ${100 - a.dash}`}
            strokeDashoffset={a.offset}
          />
        ))}
        <text x="21" y="21" className="ops-donut-total">
          {format(total)}
        </text>
        <text x="21" y="26.5" className="ops-donut-caption">
          {totalLabel}
        </text>
      </svg>
      <ul className="ops-legend" aria-hidden="true">
        {folded.map((d, i) => (
          <li key={d.label}>
            <span className={`ops-swatch ${slotClass(i, d.label)}`} />
            <span className="ops-legend-label">{d.label}</span>
            <span className="ops-legend-value">{show(d.value, format)}</span>
            <span className="ops-legend-share">{isKnown(d.value) ? shareOf(d) : ''}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

const slotClass = (slot: number, label?: string) =>
  label === 'Other' ? 'ops-c-other' : `ops-c${slot + 1}`;

/** Tiny trend line without axes (KPI cards, table cells). Gaps where values are missing. */
export function Sparkline({
  values,
  label,
}: {
  values: readonly (number | null)[];
  /** Accessible summary; leave out when the surrounding text already says it (decorative). */
  label?: string;
}) {
  const known = values.filter(isKnown);
  if (known.length < 2)
    return label ? <span className="el-field-hint">Not enough data for a trend</span> : null;
  const d = linePath(linePoints(values, niceMax(Math.max(...known))));
  return (
    <svg
      className="ops-spark"
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <path d={d} className="ops-line-path" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Trend over days/weeks: one series, top and zero marked, last value labelled at its dot. */
export function LineChart({ label, data, format = fmtNumber, emptyText = EMPTY }: ChartProps) {
  const known = data.map((d) => d.value).filter(isKnown);
  if (known.length < 2)
    return (
      <figure className="ops-chart">
        <NotEnoughData
          text={known.length ? 'A trend needs at least two recorded values.' : emptyText}
        />
      </figure>
    );
  const top = niceMax(Math.max(...known));
  const points = linePoints(
    data.map((d) => d.value),
    top,
  );
  const lastIndex = points.findLastIndex(Boolean);
  const end = points[lastIndex];
  return (
    <figure className="ops-chart ops-line">
      <div className="ops-line-plot">
        <span className="ops-line-tick ops-line-top">{format(top)}</span>
        <span className="ops-line-tick ops-line-zero">0</span>
        <div className="ops-line-area" role="img" aria-label={summarise(label, data, format)}>
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
            <path
              d={linePath(points)}
              className="ops-line-path"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {end ? (
            <span
              className="ops-line-dot"
              style={{ left: `${end.x}%`, top: `${(end.y / 40) * 100}%` }}
            >
              <span className="ops-line-end">{show(data[lastIndex]?.value ?? null, format)}</span>
            </span>
          ) : null}
        </div>
      </div>
      <div className="ops-line-x" aria-hidden="true">
        <span>{data[0]?.label}</span>
        <span>{data.at(-1)?.label}</span>
      </div>
      <DataToggle label={label} data={data} format={format} />
    </figure>
  );
}

/** Stages with counts, bar width relative to the first stage, and step conversion. */
export function FunnelChart({ label, data, format = fmtNumber, emptyText = EMPTY }: ChartProps) {
  const rows = funnelRows(data);
  if (!rows)
    return (
      <figure className="ops-chart">
        <NotEnoughData text={emptyText} />
      </figure>
    );
  const last = rows.at(-1);
  return (
    <figure className="ops-chart">
      <ol className="ops-funnel" aria-label={label}>
        {rows.map((s, i) => (
          <li key={s.label} className="ops-funnel-row">
            <span className="ops-funnel-label">{s.label}</span>
            <span className="ops-funnel-track" aria-hidden="true">
              <span className="ops-funnel-bar" style={{ width: `${s.width ?? 0}%` }} />
            </span>
            <span className="ops-funnel-count">{show(s.count, format)}</span>
            <span className="ops-funnel-rate">
              {i === 0 ? 'Start' : `${fmtPercent(s.fromPrevious)} of previous`}
            </span>
          </li>
        ))}
      </ol>
      {rows.length > 2 && last ? (
        <figcaption className="el-field-hint">
          {rows[0]?.label} to {last.label}: {fmtPercent(last.width)}
        </figcaption>
      ) : null}
    </figure>
  );
}

/**
 * A KPI on a raised card. `value` null shows `missingLabel` in the muted missing style (never 0). With
 * `href` the card is a link that filters the list; `current` marks the active filter.
 */
export function StatCard({
  label,
  value,
  note,
  href,
  current,
  trend,
  format = fmtNumber,
  missingLabel = 'Not recorded',
}: {
  label: string;
  value: number | string | null;
  /** Words shown when `value` is null, e.g. "Not enough data". */
  missingLabel?: string;
  note?: ReactNode;
  href?: string;
  current?: boolean;
  /** Recent values, oldest first; drawn as a sparkline under the value. */
  trend?: readonly (number | null)[];
  format?: Format;
}) {
  const cls = `el-stat ops-stat${value === null ? ' el-stat-missing' : ''}`;
  const body = (
    <>
      <span className="el-stat-label">{label}</span>
      <span className="el-stat-value">
        {value === null ? missingLabel : typeof value === 'number' ? format(value) : value}
      </span>
      {note ? <span className="el-stat-note">{note}</span> : null}
      {trend ? <Sparkline values={trend} /> : null}
    </>
  );
  return href ? (
    <a href={href} className={`${cls} ops-kpi`} aria-current={current || undefined}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}
