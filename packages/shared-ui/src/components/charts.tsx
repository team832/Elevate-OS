/**
 * Server-rendered charts: plain HTML/CSS bars and SVG lines/donuts, no chart library,
 * colours from the --el-chart-* tokens. Every chart has a text alternative (visible
 * values, a legend, or a "Show as table" toggle), a hover tooltip (ChartFigure) and an
 * explicit "Not enough data" state; a missing value is never drawn as 0.
 */
import type { ReactNode } from 'react';
import { ChartFigure } from './chart-figure';
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
const tip = (d: Datum, format: Format) =>
  `${d.label}: ${show(d.value, format)}${d.note ? ` (${d.note})` : ''}`;

function NotEnoughData({ text }: { text: string }) {
  return (
    <figure className="el-chart">
      <div className="el-chart-empty">
        <p className="el-chart-empty-title">Not enough data</p>
        <p>{text}</p>
      </div>
    </figure>
  );
}

function DataToggle({ label, data, format }: Required<Omit<ChartProps, 'emptyText'>>) {
  return (
    <details className="el-chart-table">
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
  max: fullScale,
}: ChartProps & {
  orientation?: 'horizontal' | 'vertical';
  /** Value that fills a bar completely (e.g. 100 for percentages); default: the largest value. */
  max?: number;
}) {
  const known = data.map((d) => d.value).filter(isKnown);
  if (!known.length) return <NotEnoughData text={emptyText} />;
  if (orientation === 'horizontal') {
    const max = fullScale ?? Math.max(...known);
    return (
      <ChartFigure>
        <ul className="el-hbars" aria-label={label}>
          {data.map((d) => (
            <li key={d.label} className="el-hbar" data-tip={tip(d, format)}>
              <span className="el-hbar-label">
                {d.href ? <a href={d.href}>{d.label}</a> : d.label}
              </span>
              <span className="el-hbar-track" aria-hidden="true">
                <span
                  className="el-hbar-fill"
                  style={{ width: `${percent(d.value, max) ?? 0}%` }}
                />
              </span>
              <span className="el-hbar-value">{show(d.value, format)}</span>
            </li>
          ))}
        </ul>
      </ChartFigure>
    );
  }
  const top = fullScale ?? niceMax(Math.max(...known));
  const max = Math.max(...known);
  const every = Math.ceil(data.length / 8);
  // Long series: values only on the highest and the latest bar, axis labels counted back
  // from the latest day, so labels never collide. A missing value always shows "–".
  const labelled = (d: Datum, i: number) =>
    data.length <= 12 || i === data.length - 1 || d.value === max;
  return (
    <ChartFigure>
      <div className="el-vbars" role="img" aria-label={summarise(label, data, format)}>
        {data.map((d, i) => (
          <div key={d.label} className="el-vbar" data-tip={tip(d, format)}>
            <span className="el-vbar-plot">
              <span className="el-vbar-value">
                {!isKnown(d.value) ? '–' : labelled(d, i) ? format(d.value) : ''}
              </span>
              <span className="el-vbar-fill" style={{ height: `${percent(d.value, top) ?? 0}%` }} />
            </span>
            <span className="el-vbar-label">
              {(data.length - 1 - i) % every === 0 ? d.label : ''}
            </span>
          </div>
        ))}
      </div>
      <DataToggle label={label} data={data} format={format} />
    </ChartFigure>
  );
}

const slotClass = (slot: number, label?: string) =>
  label === 'Other' ? 'el-c-other' : `el-c${slot + 1}`;

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
  if (!arcs) return <NotEnoughData text={emptyText} />;
  const total = arcs.reduce((a, s) => a + s.value, 0);
  const shareOf = (d: Datum) => fmtPercent(percent(d.value, total));
  const words = (d: Datum) => `${d.label} ${show(d.value, format)} (${shareOf(d)})`;
  return (
    <ChartFigure className="el-donut">
      <svg
        viewBox="0 0 42 42"
        role="img"
        aria-label={`${label}: ${folded.map(words).join(', ')}. ${totalLabel} ${format(total)}.`}
      >
        {arcs.map((a) => (
          <circle
            key={a.slot}
            className={`el-donut-arc ${slotClass(a.slot, folded[a.slot]?.label)}`}
            cx="21"
            cy="21"
            r="15.915"
            strokeDasharray={`${a.dash} ${100 - a.dash}`}
            strokeDashoffset={a.offset}
            data-tip={words(folded[a.slot] as Datum)}
          />
        ))}
        <text x="21" y="21" className="el-donut-total">
          {format(total)}
        </text>
        <text x="21" y="26.5" className="el-donut-caption">
          {totalLabel}
        </text>
      </svg>
      <ul className="el-legend" aria-hidden="true">
        {folded.map((d, i) => (
          <li key={d.label} data-tip={words(d)}>
            <span className={`el-swatch ${slotClass(i, d.label)}`} />
            <span className="el-legend-label">{d.label}</span>
            <span className="el-legend-value">{show(d.value, format)}</span>
            <span className="el-legend-share">{isKnown(d.value) ? shareOf(d) : ''}</span>
          </li>
        ))}
      </ul>
    </ChartFigure>
  );
}

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
      className="el-spark"
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <path d={d} className="el-line-path" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Trend over days/weeks: one series with a light wash under it, top and zero marked, last value labelled. */
export function LineChart({ label, data, format = fmtNumber, emptyText = EMPTY }: ChartProps) {
  const known = data.map((d) => d.value).filter(isKnown);
  if (known.length < 2)
    return (
      <NotEnoughData
        text={known.length ? 'A trend needs at least two recorded values.' : emptyText}
      />
    );
  const top = niceMax(Math.max(...known));
  const points = linePoints(
    data.map((d) => d.value),
    top,
  );
  const lastIndex = points.findLastIndex(Boolean);
  const end = points[lastIndex];
  const line = linePath(points);
  // The wash closes each drawn run down to the baseline; a gap in the line is a gap in the wash.
  const wash = line
    .split('M')
    .filter(Boolean)
    .map((run) => {
      const first = run.split('L')[0] as string;
      const last = run.split('L').at(-1) as string;
      return `M${first.split(' ')[0]} 40 L${run}L${last.split(' ')[0]} 40Z`;
    })
    .join('');
  return (
    <ChartFigure className="el-line">
      <div className="el-line-plot">
        <span className="el-line-tick el-line-top">{format(top)}</span>
        <span className="el-line-tick el-line-zero">0</span>
        <div className="el-line-area" role="img" aria-label={summarise(label, data, format)}>
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
            <path d={wash} className="el-line-wash" />
            <path d={line} className="el-line-path" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="el-line-hits" aria-hidden="true">
            {data.map((d) => (
              <span key={d.label} className="el-line-hit" data-tip={tip(d, format)} />
            ))}
          </div>
          {end ? (
            <span
              className="el-line-dot"
              style={{ left: `${end.x}%`, top: `${(end.y / 40) * 100}%` }}
            >
              <span className="el-line-end">{show(data[lastIndex]?.value ?? null, format)}</span>
            </span>
          ) : null}
        </div>
      </div>
      <div className="el-line-x" aria-hidden="true">
        <span>{data[0]?.label}</span>
        <span>{data.at(-1)?.label}</span>
      </div>
      <DataToggle label={label} data={data} format={format} />
    </ChartFigure>
  );
}

/** Stages with counts, bar width relative to the first stage, and step conversion. */
export function FunnelChart({ label, data, format = fmtNumber, emptyText = EMPTY }: ChartProps) {
  const rows = funnelRows(data);
  if (!rows) return <NotEnoughData text={emptyText} />;
  const last = rows.at(-1);
  return (
    <ChartFigure>
      <ol className="el-funnel" aria-label={label}>
        {rows.map((s, i) => (
          <li
            key={s.label}
            className="el-funnel-row"
            data-tip={`${s.label}: ${show(s.count, format)}${i ? ` (${fmtPercent(s.fromPrevious)} of previous)` : ''}`}
          >
            <span className="el-funnel-label">{s.label}</span>
            <span className="el-funnel-track" aria-hidden="true">
              <span className="el-funnel-bar" style={{ width: `${s.width ?? 0}%` }} />
            </span>
            <span className="el-funnel-count">{show(s.count, format)}</span>
            <span className="el-funnel-rate">
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
    </ChartFigure>
  );
}

/**
 * A KPI tile. `value` null shows `missingLabel` in the muted missing style (never 0). With
 * `href` the tile is a link that filters the list; `current` marks the active filter.
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
  const cls = `el-stat${value === null ? ' el-stat-missing' : ''}`;
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
    <a href={href} className={`${cls} el-kpi`} aria-current={current || undefined}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}
