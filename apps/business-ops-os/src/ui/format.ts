/** Display helpers (Asia/Kolkata). */
import type { Tone } from '@elevate/shared-ui';
import { formatPaise } from '../domain/fees';

/**
 * Router path of a browser path: Next adds the app's basePath itself (D-022), and the shared
 * task and lead screens run under /ops, /academic and /marketing (D-073).
 */
export const routerPath = (path: string) =>
  path.replace(/^\/(?:ops|academic|marketing)(?=[/?]|$)/, '') || '/';

/** "1 student", "3 students". */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Money on screens: "₹1,00,000" for whole rupees, "₹1,500.50" otherwise. PDFs keep `formatPaise` ("₹1,00,000.00"). */
export const fmtPaise = (paise: number | null | undefined) =>
  formatPaise(paise).replace(/\.00$/, '');

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

const monthYear = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
});

/** A `YYYY-MM` month, e.g. "October 2026". */
export const fmtMonth = (value: string) => monthYear.format(new Date(`${value}-01T00:00:00Z`));

/** Words with their own spelling (channel and payment codes). */
const WORDS: Record<string, string> = { upi: 'UPI', whatsapp: 'WhatsApp', sms: 'SMS' };

export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .split('_')
    .map((w) => WORDS[w] ?? w)
    .join(' ')
    .replace(/^\w/, (c) => c.toUpperCase());
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
