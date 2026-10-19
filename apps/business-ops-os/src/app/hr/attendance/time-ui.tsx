/**
 * Small display helpers shared by the HR time screens (attendance, shifts,
 * leave, timesheets). Server components only; Ops design system classes.
 */
import type { ReactNode } from 'react';
import { can } from '@elevate/authorization';
import { StatusBadge, type Tone } from '@elevate/shared-ui';
import { formatMinutes, zonedParts } from '../../../domain/hr/calendar';
import type { Measured } from '../../../domain/hr/timesheets';
import { WEEKDAY_LABELS } from '../../../domain/hr/shifts';

/** Time of an instant in the employee's zone, e.g. "09:05" (+ date when it differs). */
export function localTime(at: Date | string | null, tz: string, workDate?: string): string {
  if (!at) return '—';
  const p = zonedParts(typeof at === 'string' ? new Date(at) : at, tz);
  const zone = tz === 'Asia/Kolkata' ? 'IST' : tz;
  return workDate && p.date !== workDate ? `${p.time} (${p.date}) ${zone}` : `${p.time} ${zone}`;
}

export function minutes(m: number | null | undefined): string {
  return m === null || m === undefined ? '—' : formatMinutes(m);
}

/** A measured value: hours, or "missing" with its reason (never 0 for missing). */
export function MeasuredHours({ value }: { value: Measured }) {
  if (value.status === 'missing')
    return (
      <span title={value.reason}>
        <StatusBadge tone="neutral">Missing</StatusBadge>
      </span>
    );
  return <>{formatMinutes(value.value)}</>;
}

const SESSION_TONES: Record<string, Tone> = {
  open: 'info',
  closed: 'success',
  superseded: 'neutral',
};
export function SessionStatus({
  status,
  missingClockOut,
}: {
  status: string;
  missingClockOut?: boolean;
}) {
  if (status === 'open' && missingClockOut)
    return <StatusBadge tone="warning">Missing clock-out</StatusBadge>;
  const label =
    status === 'open' ? 'Clocked in' : status === 'superseded' ? 'Superseded (kept)' : 'Closed';
  return <StatusBadge tone={SESSION_TONES[status] ?? 'neutral'}>{label}</StatusBadge>;
}

export const SOURCE_LABELS: Record<string, string> = {
  self: 'Self',
  manual: 'Manual entry',
  csv_import: 'CSV import',
  provider: 'Provider',
  correction: 'Approved correction',
};

const REQUEST_TONES: Record<string, Tone> = {
  pending: 'info',
  approved: 'success',
  rejected: 'neutral',
  withdrawn: 'neutral',
  cancelled: 'neutral',
};
export function RequestStatus({ status }: { status: string }) {
  const label =
    status === 'pending' ? 'Pending decision' : status.replace(/^\w/, (c) => c.toUpperCase());
  return <StatusBadge tone={REQUEST_TONES[status] ?? 'neutral'}>{label}</StatusBadge>;
}

/** Decision state of a template, leave type or holiday (owner decision OD-026). */
export function DecisionBadge({ state }: { state: string }) {
  const tone: Tone =
    state === 'approved' ? 'success' : state === 'proposed' ? 'warning' : 'neutral';
  const label =
    state === 'proposed' ? 'Proposed — not approved' : state.replace(/^\w/, (c) => c.toUpperCase());
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

export function weekdays(days: readonly number[]): string {
  return [...days]
    .sort()
    .map((d) => WEEKDAY_LABELS[d])
    .join(', ');
}

/** Previous / next links that keep the current filters. */
export function Pager({
  base,
  params,
  page,
  pageSize,
  total,
}: {
  base: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== 'page') q.set(k, v);
    q.set('page', String(p));
    return `${base}?${q.toString()}`;
  };
  return (
    <nav className="el-subnav" aria-label="Pages">
      {page > 1 ? <a href={href(page - 1)}>Previous page</a> : null}
      <span>
        Page {page} of {pages} ({total} records)
      </span>
      {page < pages ? <a href={href(page + 1)}>Next page</a> : null}
    </nav>
  );
}

/** A GET filter form (works without JavaScript). */
export function FilterForm({
  action,
  children,
  submitLabel = 'Apply filters',
}: {
  action: string;
  children: ReactNode;
  submitLabel?: string;
}) {
  return (
    <form method="get" action={action} className="el-inline-form" aria-label="Filters">
      {children}
      <button type="submit" className="el-button el-button-secondary">
        {submitLabel}
      </button>
      <a href={action}>Clear</a>
    </form>
  );
}

export function FilterSelect({
  name,
  label,
  value,
  options,
  anyLabel = 'Any',
}: {
  name: string;
  label: string;
  value?: string;
  options: readonly { value: string; label: string }[];
  anyLabel?: string;
}) {
  return (
    <div className="el-field">
      <label htmlFor={`flt-${name}`}>{label}</label>
      <select id={`flt-${name}`} name={name} className="el-select" defaultValue={value ?? ''}>
        <option value="">{anyLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function FilterDate({
  name,
  label,
  value,
}: {
  name: string;
  label: string;
  value?: string;
}) {
  return (
    <div className="el-field">
      <label htmlFor={`flt-${name}`}>{label}</label>
      <input id={`flt-${name}`} name={name} type="date" className="el-input" defaultValue={value} />
    </div>
  );
}

/** Sub-navigation between the HR time screens the user can open. */
export function TimeNav({
  current,
  items,
}: {
  current: string;
  items: readonly { href: string; label: string; show: boolean }[];
}) {
  return (
    <nav className="el-subnav" aria-label="Attendance and leave">
      {items
        .filter((i) => i.show)
        .map((i) => (
          <a key={i.href} href={i.href} aria-current={i.href === current ? 'page' : undefined}>
            {i.label}
          </a>
        ))}
    </nav>
  );
}

export const HM_HINT = '24-hour HH:MM in the employee’s timezone, e.g. 09:30';

export function isIso(v: string | undefined): v is string {
  return Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
}

/** The standard sub-navigation for a user (each entry only when its permission is held). */
export function timeNavItems(user: Parameters<typeof can>[0]) {
  return [
    {
      href: '/ops/hr/attendance/me',
      label: 'My attendance & leave',
      show: can(user, 'ops:attendance:record'),
    },
    { href: '/ops/hr/attendance', label: 'Attendance', show: can(user, 'ops:attendance:read') },
    {
      href: '/ops/hr/attendance/corrections',
      label: 'Corrections',
      show: can(user, 'ops:attendance:read'),
    },
    {
      href: '/ops/hr/attendance/import',
      label: 'CSV import',
      show: can(user, 'ops:attendance:manage'),
    },
    { href: '/ops/hr/shifts', label: 'Shifts & holidays', show: can(user, 'ops:shifts:read') },
    { href: '/ops/hr/leave', label: 'Leave', show: can(user, 'ops:leave:read') },
    { href: '/ops/hr/leave/balances', label: 'Leave balances', show: can(user, 'ops:leave:read') },
    {
      href: '/ops/hr/leave/availability',
      label: 'Team availability',
      show: can(user, 'ops:leave:read'),
    },
    { href: '/ops/hr/timesheets', label: 'Timesheets', show: can(user, 'ops:hr_reports:read') },
  ];
}
