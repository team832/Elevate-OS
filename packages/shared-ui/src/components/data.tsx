import type { ReactNode } from 'react';
import type { Metric } from '@elevate/shared-contracts';
import type { FeatureStatus } from '@elevate/shared-types';
import { EmptyState } from './states';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`el-badge el-tone-${tone}`}>{children}</span>;
}

const FEATURE_TONES: Record<FeatureStatus, Tone> = {
  Proposed: 'neutral',
  Approved: 'info',
  Implemented: 'warning',
  Tested: 'success',
  Deployed: 'success',
};

/** Badge for the D-013 feature status vocabulary. */
export function FeatureStatusBadge({ status }: { status: FeatureStatus }) {
  return <StatusBadge tone={FEATURE_TONES[status]}>{status}</StatusBadge>;
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell content; defaults to `String(row[key])`. */
  render?: (row: T) => ReactNode;
  /** Right-align numbers. */
  numeric?: boolean;
}

export interface DataTableProps<T> {
  columns: readonly Column<T>[];
  /** Tighter rows for dense lists; on phones each row becomes a labelled block. */
  compact?: boolean;
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Accessible table caption (visible). */
  caption?: ReactNode;
  /** Shown instead of the table when `rows` is empty. */
  empty?: ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  empty,
  compact,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  }
  return (
    <div className="el-table-wrap">
      <table className={compact ? 'el-table el-table-compact' : 'el-table'}>
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? 'el-num' : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={c.numeric ? 'el-num' : undefined}
                  data-label={typeof c.header === 'string' ? c.header : undefined}
                >
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const numberFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });

export function formatMetricValue(metric: Pick<Metric, 'value' | 'unit'>): string {
  if (metric.value === null) return '';
  switch (metric.unit) {
    case 'percent':
      return `${numberFormat.format(metric.value)}%`;
    case 'inr':
      return `₹${numberFormat.format(metric.value)}`;
    case 'minutes':
      return `${numberFormat.format(metric.value)} min`;
    case 'hours':
      return `${numberFormat.format(metric.value)} h`;
    default:
      return numberFormat.format(metric.value);
  }
}

/**
 * One metric. MISSING IS NOT ZERO:
 * - ok        → the number (0 shows as "0")
 * - estimated → "≈ number" with an "Estimated" badge and the basis
 * - missing   → "Missing" in a dashed tile with the reason; never a number
 */
export function StatTile({
  label,
  metric,
  missingLabel = 'Missing',
}: {
  label: string;
  metric: Metric;
  /** Word shown instead of a value when the metric is missing (never 0). */
  missingLabel?: string;
}) {
  const description = `${metric.definition} (${metric.window.label ?? `${metric.window.from} to ${metric.window.to}`})`;
  if (metric.status === 'missing') {
    return (
      <div className="el-stat el-stat-missing" data-status="missing">
        <p className="el-stat-label">{label}</p>
        <p className="el-stat-value">{missingLabel}</p>
        <p className="el-stat-note">{metric.reason}</p>
        <p className="el-stat-note">{description}</p>
      </div>
    );
  }
  if (metric.status === 'estimated') {
    return (
      <div className="el-stat el-stat-estimated" data-status="estimated">
        <p className="el-stat-label">
          {label} <StatusBadge tone="warning">Estimated</StatusBadge>
        </p>
        <p className="el-stat-value">≈ {formatMetricValue(metric)}</p>
        <p className="el-stat-note">Basis: {metric.basis}</p>
        <p className="el-stat-note">{description}</p>
      </div>
    );
  }
  return (
    <div className="el-stat" data-status="ok">
      <p className="el-stat-label">{label}</p>
      <p className="el-stat-value">{formatMetricValue(metric)}</p>
      <p className="el-stat-note">{description}</p>
    </div>
  );
}

/** Where a widget's data comes from. Sample data is fictional and always labelled. */
export type DataSource = 'live' | 'sample';

/** Visible label for sample (fictional) data; renders nothing for live data. */
export function SourceBadge({ source, note }: { source: DataSource; note?: string }) {
  if (source === 'live') return null;
  return (
    <span className="el-badge el-badge-sample" data-source="sample" title={note}>
      Sample data
    </span>
  );
}

export interface MetricStripItem {
  label: string;
  metric: Metric;
  /** Short line under the value (what is counted). */
  note?: ReactNode;
  /** Where the number can be checked. */
  href?: string;
  source?: DataSource;
}

/**
 * A row of headline numbers separated by fine dividers. MISSING IS NOT ZERO:
 * a missing metric shows "Not available" and its reason, never a number.
 */
export function MetricStrip({
  items,
  label,
}: {
  items: readonly MetricStripItem[];
  label: string;
}) {
  return (
    <ul className="el-metric-strip" aria-label={label}>
      {items.map((item) => {
        const m = item.metric;
        const value =
          m.status === 'missing'
            ? 'Not available'
            : m.status === 'estimated'
              ? `≈ ${formatMetricValue(m)}`
              : formatMetricValue(m);
        return (
          <li key={item.label} className="el-metric" data-status={m.status}>
            <p className="el-metric-label">
              {item.href && m.status !== 'missing' ? (
                <a href={item.href}>{item.label}</a>
              ) : (
                item.label
              )}
              {item.source ? <SourceBadge source={item.source} /> : null}
            </p>
            <p className="el-metric-value">{value}</p>
            {m.status === 'missing' ? (
              <p className="el-metric-note">{m.reason}</p>
            ) : m.status === 'estimated' ? (
              <p className="el-metric-note">Estimated: {m.basis}</p>
            ) : item.note ? (
              <p className="el-metric-note">{item.note}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
