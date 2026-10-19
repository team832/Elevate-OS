/** Status badges that keep planning labels (locked/provisional/proposed) apart from delivery states. */
import { StatusBadge, type Tone } from '@elevate/shared-ui';

const PLAN_TONES: Record<string, Tone> = {
  locked: 'success',
  approved: 'success',
  provisional: 'warning',
  proposed: 'info',
  draft: 'info',
  superseded: 'neutral',
  unverified: 'danger',
  unknown: 'neutral',
};

/** Plan / label status: locked = success, provisional = warning, proposed = info, superseded = neutral. */
export function PlanBadge({ status, prefix }: { status: string | null | undefined; prefix?: string }) {
  const s = status ?? 'unknown';
  return <StatusBadge tone={PLAN_TONES[s] ?? 'neutral'}>{prefix ? `${prefix}: ${s}` : s}</StatusBadge>;
}

const STATE_TONES: Record<string, Tone> = {
  scheduled: 'info',
  held: 'success',
  cancelled: 'danger',
  rescheduled: 'warning',
  submitted: 'warning',
  verified: 'success',
  superseded: 'neutral',
  draft: 'neutral',
  conducted: 'info',
  finalised: 'success',
  final: 'success',
  active: 'success',
  planning: 'info',
  completed: 'neutral',
  paused: 'warning',
  withdrawn: 'neutral',
  open: 'warning',
  in_progress: 'info',
  done: 'success',
  resolved: 'success',
  closed: 'neutral',
  confirmed: 'success',
  rejected: 'danger',
  failed: 'warning',
  dead: 'danger',
  present: 'success',
  late: 'warning',
  partial: 'warning',
  absent: 'danger',
  excused: 'neutral',
  feasible: 'success',
  infeasible: 'danger',
  not_assessed: 'neutral',
  hard: 'danger',
  preference: 'warning',
};

export function StateBadge({ state }: { state: string | null | undefined }) {
  const s = state ?? 'unknown';
  return <StatusBadge tone={STATE_TONES[s] ?? 'neutral'}>{s.replace(/_/g, ' ')}</StatusBadge>;
}

/** A value that may be missing: shows "Missing" (never 0) when null. */
export function Maybe({ value, suffix = '' }: { value: number | string | null | undefined; suffix?: string }) {
  if (value === null || value === undefined || value === '') return <StatusBadge tone="neutral">Missing</StatusBadge>;
  return (
    <>
      {value}
      {suffix}
    </>
  );
}

export const fmtHours = (minutes: number) => `${Math.round((minutes / 60) * 100) / 100} h`;
export const fmtDateTime = (d: Date | string | null | undefined) =>
  d ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(d)) : '—';
