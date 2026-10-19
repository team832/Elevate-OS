/** Display helpers (Asia/Kolkata). */
import type { Tone } from '@elevate/shared-ui';

const dateTime = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const dateOnly = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function fmtDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? '—' : `${dateTime.format(d)} IST`;
}

/** A `YYYY-MM-DD` calendar date. */
export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  return dateOnly.format(new Date(`${value}T00:00:00Z`));
}

export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  return value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function decisionTone(state: string): Tone {
  switch (state) {
    case 'approved':
    case 'locked':
    case 'confirmed':
      return 'success';
    case 'open':
    case 'pending_verification':
      return 'warning';
    case 'superseded':
    case 'retired':
      return 'neutral';
    default:
      return 'info';
  }
}

export function statusTone(status: string): Tone {
  if (
    ['enrolled', 'completed', 'done', 'approved', 'resolved', 'accepted', 'attended'].includes(
      status,
    )
  )
    return 'success';
  if (['lost', 'cancelled', 'rejected', 'missed', 'no_show'].includes(status)) return 'neutral';
  if (['blocked', 'at_risk', 'overdue', 'open'].includes(status)) return 'warning';
  if (['enrolment_requested', 'pending', 'handoff_pending', 'in_review'].includes(status))
    return 'info';
  return 'neutral';
}
