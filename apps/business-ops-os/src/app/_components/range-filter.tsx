import type { ReactNode } from 'react';
import type { rangeOf } from '../../server/overview';
import { PeriodFilter } from '../admissions/overview/period';

/**
 * The overview/summary date range: From/To (+ `children` fields), quick periods keeping `keep`,
 * and why given dates were not used.
 */
export function RangeFilter({
  base,
  at,
  keep,
  children,
}: {
  base: string;
  at: ReturnType<typeof rangeOf>;
  keep?: Record<string, string | undefined>;
  children?: ReactNode;
}) {
  return (
    <>
      <PeriodFilter
        base={base}
        at={{ period: at.range, presets: at.presets, rejected: false }}
        keep={keep}
      >
        {children}
      </PeriodFilter>
      {at.rejected ? (
        <p className="el-field-hint" role="status">
          Give two real dates, From on or before To, at most a year apart. Showing this month
          instead.
        </p>
      ) : null}
    </>
  );
}
