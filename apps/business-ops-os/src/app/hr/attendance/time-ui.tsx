/**
 * Small display helpers shared by the HR time screens (attendance, shifts,
 * leave, timesheets). Server components only; Ops design system classes.
 */
import type { ReactNode } from 'react';
import { can, type Permission } from '@elevate/authorization';
import { Alert, Card, StatusBadge, type Column, type Tone } from '@elevate/shared-ui';
import { formatMinutes, zonedParts } from '../../../domain/hr/calendar';
import type { Measured } from '../../../domain/hr/timesheets';
import { WEEKDAY_LABELS } from '../../../domain/hr/shifts';
import { getAttendanceProvider } from '../../../server/adapters/attendance-provider';
import { ActionForm, type FieldSpec } from '../../../ui/action-form';

export type Sp = Record<string, string | undefined>;

/** Page number from the query string (1 when missing or invalid). */
export const pageOf = (sp: Sp) => Math.max(1, Number(sp.page) || 1);

/** `value` when it is one of the options, else undefined. */
export function oneOf<T = string>(options: readonly { value: string }[], value?: string) {
  return options.some((o) => o.value === value) ? (value as T) : undefined;
}

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

type MeasuredSet = Record<
  'scheduledMinutes' | 'workedMinutes' | 'unapprovedDifferenceMinutes',
  Measured
>;

/** Scheduled / worked / unapproved-difference columns of a period summary. */
export function measuredColumns<T>(get: (row: T) => MeasuredSet): Column<T>[] {
  return (
    [
      ['scheduledMinutes', 'Scheduled'],
      ['workedMinutes', 'Worked'],
      ['unapprovedDifferenceMinutes', 'Unapproved difference'],
    ] as const
  ).map(([k, header]) => ({ key: k, header, render: (r) => <MeasuredHours value={get(r)[k]} /> }));
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

interface SessionLike {
  clockInAt: Date;
  clockOutAt: Date | null;
  workDate: string;
  breakMinutes: number;
  workedMinutes: number | null;
  source: string;
  status: string;
  lateMinutes: number | null;
  earlyDepartureMinutes: number | null;
  flags: { late: boolean; early: boolean; missingClockOut: boolean };
}

/** The standard session columns, by key (times shown in `tz(row)`). */
export function sessionColumns<T extends SessionLike>(tz: (s: T) => string) {
  const col = (key: string, header: string, render: (s: T) => ReactNode): Column<T> => ({
    key,
    header,
    render,
  });
  return {
    in: col('in', 'In', (s) => localTime(s.clockInAt, tz(s), s.workDate)),
    out: col('out', 'Out', (s) => localTime(s.clockOutAt, tz(s), s.workDate)),
    break: col('break', 'Break', (s) => minutes(s.breakMinutes)),
    worked: col('worked', 'Worked', (s) => minutes(s.workedMinutes)),
    source: col('source', 'Source', (s) => SOURCE_LABELS[s.source] ?? s.source),
    status: col('status', 'Status', (s) => (
      <SessionStatus status={s.status} missingClockOut={s.flags.missingClockOut} />
    )),
  };
}

/** Late / early badges of a session. */
export function LateEarly({ s }: { s: SessionLike }) {
  return (
    <>
      {s.flags.late ? (
        <StatusBadge tone="warning">Late {minutes(s.lateMinutes)}</StatusBadge>
      ) : null}
      {s.flags.early ? (
        <StatusBadge tone="warning">Left {minutes(s.earlyDepartureMinutes)} early</StatusBadge>
      ) : null}
    </>
  );
}

/** Shown while no attendance device or provider is connected. */
export async function ProviderNotice({ children }: { children?: ReactNode }) {
  const provider = await getAttendanceProvider().status();
  return provider.connection !== 'connected' ? (
    <Alert tone="info" title="No attendance device or provider is connected; manual and CSV only.">
      {children}
    </Alert>
  ) : null;
}

const REQUEST_TONES: Record<string, Tone> = {
  pending: 'info',
  approved: 'success',
  rejected: 'neutral',
  withdrawn: 'neutral',
  cancelled: 'neutral',
};
const capitalise = (s: string) => s.replace(/^\w/, (c) => c.toUpperCase());

export function RequestStatus({ status }: { status: string }) {
  const label = status === 'pending' ? 'Pending decision' : capitalise(status);
  return <StatusBadge tone={REQUEST_TONES[status] ?? 'neutral'}>{label}</StatusBadge>;
}

/** Decision state of a template, leave type or holiday (owner decision OD-026). */
export function DecisionBadge({ state }: { state: string }) {
  const tone: Tone =
    state === 'approved' ? 'success' : state === 'proposed' ? 'warning' : 'neutral';
  const label = state === 'proposed' ? 'Proposed — not approved' : capitalise(state);
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

/** Compact PATCH buttons that set `status` (each only when `show` is not false). */
export function StatusButtons({
  action,
  buttons,
}: {
  action: string;
  buttons: readonly {
    label: string;
    status: string;
    variant?: 'primary' | 'secondary' | 'danger';
    show?: boolean;
  }[];
}) {
  return (
    <div className="el-inline-form">
      {buttons
        .filter((b) => b.show !== false)
        .map((b) => (
          <ActionForm
            key={b.status}
            action={action}
            method="PATCH"
            submitLabel={b.label}
            extra={{ status: b.status }}
            variant={b.variant}
            compact
          />
        ))}
    </div>
  );
}

/** Approve and reject cards for a pending request (the reject note is required). */
export function DecisionCards({
  action,
  noun,
  approveDescription,
  rejectDescription,
}: {
  action: string;
  noun: string;
  approveDescription?: string;
  rejectDescription?: string;
}) {
  return (
    <div className="el-grid">
      <Card title="Approve" description={approveDescription}>
        <ActionForm
          action={action}
          submitLabel={`Approve ${noun}`}
          extra={{ decision: 'approve' }}
          fields={[{ name: 'note', label: 'Note (optional)' }]}
        />
      </Card>
      <Card title="Reject" description={rejectDescription}>
        <ActionForm
          action={action}
          submitLabel={`Reject ${noun}`}
          variant="danger"
          extra={{ decision: 'reject' }}
          fields={[{ name: 'note', label: 'Reason for rejecting', required: true }]}
        />
      </Card>
    </div>
  );
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
  list: { page, pageSize, total },
}: {
  base: string;
  params: Sp;
  list: { page: number; pageSize: number; total: number };
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

type FilterProps = { name: string; label: string; value?: string };

export function FilterSelect({
  name,
  label,
  value,
  options,
  anyLabel = 'Any',
}: FilterProps & { options: readonly { value: string; label: string }[]; anyLabel?: string }) {
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

export function FilterDate({ name, label, value }: FilterProps) {
  return (
    <div className="el-field">
      <label htmlFor={`flt-${name}`}>{label}</label>
      <input id={`flt-${name}`} name={name} type="date" className="el-input" defaultValue={value} />
    </div>
  );
}

type Person = { staffId: string; fullName: string; employeeCode?: string | null };

export const personOptions = (people: readonly Person[], withCode = false) =>
  people.map((p) => ({
    value: p.staffId,
    label: withCode && p.employeeCode ? `${p.fullName} (${p.employeeCode})` : p.fullName,
  }));

/** The "Employee" filter over the people in scope. */
export function EmployeeFilter({
  people,
  value,
  withCode,
}: {
  people: readonly Person[];
  value?: string;
  withCode?: boolean;
}) {
  return (
    <FilterSelect
      name="staffId"
      label="Employee"
      value={value}
      anyLabel="Everyone in scope"
      options={personOptions(people, withCode)}
    />
  );
}

/** A sub-navigation of links (only those with `show` not false). */
export function SubNav({
  label,
  current,
  items,
}: {
  label: string;
  current?: string;
  items: readonly { href: string; label: string; show?: boolean }[];
}) {
  return (
    <nav className="el-subnav" aria-label={label}>
      {items
        .filter((i) => i.show !== false)
        .map((i) => (
          <a key={i.href} href={i.href} aria-current={i.href === current ? 'page' : undefined}>
            {i.label}
          </a>
        ))}
    </nav>
  );
}

const TIME_NAV: readonly [href: string, label: string, permission: Permission][] = [
  ['/ops/hr/attendance/me', 'My attendance & leave', 'ops:attendance:record'],
  ['/ops/hr/attendance', 'Attendance', 'ops:attendance:read'],
  ['/ops/hr/attendance/corrections', 'Corrections', 'ops:attendance:read'],
  ['/ops/hr/attendance/import', 'CSV import', 'ops:attendance:manage'],
  ['/ops/hr/shifts', 'Shifts & holidays', 'ops:shifts:read'],
  ['/ops/hr/leave', 'Leave', 'ops:leave:read'],
  ['/ops/hr/leave/balances', 'Leave balances', 'ops:leave:read'],
  ['/ops/hr/leave/availability', 'Team availability', 'ops:leave:read'],
  ['/ops/hr/timesheets', 'Timesheets', 'ops:hr_reports:read'],
];

/** Sub-navigation between the HR time screens the user can open. */
export function TimeNav({ current, user }: { current?: string; user: Parameters<typeof can>[0] }) {
  return (
    <SubNav
      label="Attendance and leave"
      current={current}
      items={TIME_NAV.map(([href, label, p]) => ({ href, label, show: can(user, p) }))}
    />
  );
}

export const HM_HINT = '24-hour HH:MM in the employee’s timezone, e.g. 09:30';

/** Clock-out date and unpaid break fields shared by manual entries and corrections. */
export const sessionTailFields = (breakDefault = '0'): FieldSpec[] => [
  { name: 'clockOutDate', label: 'Clock-out date (only if after midnight)', type: 'date' },
  {
    name: 'breakMinutes',
    label: 'Unpaid break (minutes)',
    type: 'number',
    defaultValue: breakDefault,
  },
];

export function isIso(v: string | undefined): v is string {
  return Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
}
