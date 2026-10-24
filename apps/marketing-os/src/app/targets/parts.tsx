import { Fragment } from 'react';
import type { Metric } from '@elevate/shared-contracts';
import { BarChart, type Datum } from '@elevate/shared-ui';
import { modulePath } from '../../domain';
import {
  ADMISSION_CREDIT_LABELS,
  NO_CALL_TARGET,
  TARGET_METRICS,
  TARGET_METRIC_KEYS,
  formatPeriod,
} from '../../domain/metrics';
import type { TargetVsActualRow } from '../../server/targets';
import { ProposedBadge } from '../../ui/badges';

type Row = Pick<TargetVsActualRow, 'target' | 'staffName' | 'campaignCode' | 'campaignName'>;

export const whoOf = (r: Row) =>
  r.target.scope === 'employee'
    ? (r.staffName ?? 'Staff member')
    : r.target.scope === 'campaign'
      ? `${r.campaignCode} ${r.campaignName}`
      : 'Marketing team';

export const targetLabel = (r: Row) => `${TARGET_METRICS[r.target.metricKey].label}: ${whoOf(r)}`;

/** A count, or "Not available" when the source cannot be read (never 0). */
export const actualText = (m: Metric) => (m.value === null ? 'Not available' : String(m.value));

/**
 * Target vs actual as % of target reached, one bar per target, linking to its drill-down. Targets
 * whose actual is not available are left out of the chart (said below it), never drawn as 0.
 */
export function TargetChart({ rows, period }: { rows: TargetVsActualRow[]; period: string }) {
  const known = rows.filter((r) => r.actual.value !== null);
  const data: Datum[] = known.map((r) => ({
    label: `${targetLabel(r)} (${formatPeriod(r.target.periodStart, r.target.periodEnd)})`,
    value: (r.actual.value! / r.target.targetValue) * 100,
    note: `${r.actual.value} of ${r.target.targetValue} ${TARGET_METRICS[r.target.metricKey].unit}`,
    href: modulePath(`targets/${r.target.id}`),
  }));
  const top = Math.max(100, ...data.map((d) => d.value ?? 0));
  return (
    <>
      <BarChart
        label={`Target reached, per cent, ${period}`}
        data={data}
        max={top}
        format={(n) => `${Math.round(n)}%`}
        emptyText="No target in this period has an actual that can be counted yet."
      />
      {rows.length > known.length ? (
        <p>
          Not in the chart: {rows.length - known.length} target
          {rows.length - known.length === 1 ? '' : 's'} whose source is not available (see the
          table).
        </p>
      ) : null}
    </>
  );
}

/** Every metric that can be a target, what it counts and where the count comes from. */
export function MetricDefinitions({
  credit,
}: {
  credit: { key: string; value: string; status: string };
}) {
  return (
    <>
      <dl className="mkt-facts">
        {TARGET_METRIC_KEYS.map((k) => (
          <Fragment key={k}>
            <dt>{TARGET_METRICS[k].label}</dt>
            <dd>
              {TARGET_METRICS[k].definition} Source: {TARGET_METRICS[k].sourceLabel}.
            </dd>
          </Fragment>
        ))}
      </dl>
      <p>{NO_CALL_TARGET}</p>
      <p>
        Admission credit rule (setting {credit.key}):{' '}
        {ADMISSION_CREDIT_LABELS[credit.value] ?? credit.value}.{' '}
        <ProposedBadge status={credit.status} />
      </p>
    </>
  );
}
