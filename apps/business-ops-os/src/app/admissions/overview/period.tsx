/** Report period from the URL (Asia/Kolkata calendar days) and its GET form with quick periods. */
import type { ReactNode } from 'react';
import { addDays, istToday, istWeekContaining } from '../../../domain';
import { admissionsReportQuery } from '../../../server/admissions-schemas';
import { fmtDate } from '../../../ui/format';
import { listHref } from '../../../ui/list-controls';
import '../admissions.css';

type Params = Record<string, string | undefined>;
export type Period = { from: string; to: string };

/** `from`/`to` when both are valid and in order; otherwise the last 30 days (`rejected` = dates were given). */
export function periodOf(sp: Params, now = new Date()) {
  const today = istToday(now);
  const presets: [string, Period][] = [
    ['Last 30 days', { from: addDays(today, -29), to: today }],
    ['This week', istWeekContaining(today)],
    ['This month', { from: `${today.slice(0, 7)}-01`, to: today }],
  ];
  const parsed = admissionsReportQuery.safeParse({
    from: sp.from || undefined,
    to: sp.to || undefined,
  });
  const valid =
    parsed.success && parsed.data.from && parsed.data.to && parsed.data.from <= parsed.data.to;
  const period: Period = valid
    ? { from: parsed.data.from as string, to: parsed.data.to as string }
    : presets[0]![1];
  return { period, presets, rejected: Boolean((sp.from || sp.to) && !valid) };
}

/** The report period as one toolbar row: From/To (+ `children` fields), Show, and quick-period links keeping `keep`. */
export function PeriodFilter({
  base,
  at,
  keep = {},
  children,
}: {
  base: string;
  at: ReturnType<typeof periodOf>;
  keep?: Params;
  children?: ReactNode;
}) {
  const { period, presets, rejected } = at;
  return (
    <div className="ops-admissions-period">
      <form method="get" action={base} className="el-inline-form" aria-label="Report period">
        {(['from', 'to'] as const).map((name) => (
          <div key={name} className="el-field">
            <label htmlFor={`report-${name}`}>{name === 'from' ? 'From' : 'To'}</label>
            <input
              id={`report-${name}`}
              name={name}
              type="date"
              className="el-input"
              defaultValue={period[name]}
            />
          </div>
        ))}
        {children}
        <button type="submit" className="el-button el-button-secondary">
          Show this period
        </button>
      </form>
      <ul
        className="ops-presets"
        aria-label={`Quick periods (showing ${fmtDate(period.from)} – ${fmtDate(period.to)})`}
      >
        {presets.map(([label, p]) => (
          <li key={label}>
            <a
              href={listHref(base, keep, p)}
              aria-current={p.from === period.from && p.to === period.to ? 'true' : undefined}
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
      {rejected ? (
        <p className="el-field-hint" role="status">
          Give both dates, with From on or before To. Showing the last 30 days instead.
        </p>
      ) : null}
    </div>
  );
}
