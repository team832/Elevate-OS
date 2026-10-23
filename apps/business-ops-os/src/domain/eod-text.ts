/** A work report as plain text for "Copy summary" and downloads. Pure. */
import type { EodFacts } from './eod';

const hm = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
export const fmtMinutes = (m: number | null) =>
  m === null ? 'Not recorded' : `${Math.floor(m / 60)} h ${m % 60} min`;

/**
 * The report as plain text for "Copy summary" (no external delivery is configured). Counts,
 * task titles and the employee's own words only; no student details.
 */
export function eodPlainText(
  f: EodFacts,
  narrative: { summary: string | null; nextDayPlan: string | null; notes: string | null },
  meta: { staffName: string; version: number | null; recipient: string | null; period?: string },
) {
  const list = (title: string, items: { title: string; detail?: string | null }[]) =>
    items.length
      ? [`${title}:`, ...items.map((i) => `- ${i.title}${i.detail ? ` (${i.detail})` : ''}`)]
      : [];
  const a = f.academic;
  return [
    `Work report: ${meta.staffName}, ${meta.period ?? f.reportDate} (IST)`,
    meta.version
      ? `Version ${meta.version}${meta.recipient ? `, to ${meta.recipient}` : ''}`
      : 'Draft — not submitted',
    f.noActivity ? 'No task activity recorded in this period.' : '',
    `Submitted: ${f.counts.submitted ?? 'Not recorded'} · Approved or done: ${f.counts.completed} · Worked on: ${f.counts.worked} · Open at cut-off: ${f.counts.backlog} (${f.counts.overdue} overdue) · Blocked: ${f.counts.blocked}`,
    `Recorded time: ${fmtMinutes(f.duration.minutes)}`,
    ...list('Submitted', f.submitted ?? []),
    ...list('Approved or done', f.completed),
    ...list(
      'Work done',
      f.work.map((w) => ({
        title: `${w.title}: ${w.workPerformed}`,
        detail: w.minutes ? fmtMinutes(w.minutes) : null,
      })),
    ),
    ...list('Blocked', f.blocked),
    ...list('Decisions or help needed', f.decisions),
    a.status === 'available'
      ? `Academic: ${a.delivered ?? 'not recorded'} of ${a.planned ?? 'not recorded'} planned classes delivered`
      : 'Academic OS unavailable',
    narrative.summary ? `Summary (self-reported): ${narrative.summary}` : '',
    narrative.notes ? `Blockers and notes: ${narrative.notes}` : '',
    narrative.nextDayPlan ? `Plan: ${narrative.nextDayPlan}` : '',
    `Facts as of ${hm(f.asOf)} IST.`,
  ]
    .filter(Boolean)
    .join('\n');
}
