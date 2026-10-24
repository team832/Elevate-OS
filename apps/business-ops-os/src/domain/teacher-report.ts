/**
 * Teacher report (owner brief 22 Oct 2026): one internal folio of a teacher for Business
 * Operations (BDM meetings, analysis). Pure.
 * - Every figure keeps the sentence that defines it (Academic's own metric definitions, the task
 *   report's definitions). A metric Academic reports as missing stays null: printed in words,
 *   never 0.
 * - "Where to work on" lists only measured, non-zero counts, in neutral words.
 * - The summary is deterministic evidence (no AI rewriting, no invented adjectives), in the
 *   style of the student report's constructiveSummary.
 */
import type { AcademicTeacherActivityV1, Metric } from '@elevate/shared-contracts';
import { windowLabel, type IsoDate } from './dates';

/** /2 (D-111): adds the overall comment a person writes or edits from an AI draft. */
export const TEACHER_REPORT_TEMPLATE_VERSION = 'teacher-report/2';

/** A count with its definition; `value` null = not measured. `text` overrides how it prints. */
export interface Figure {
  label: string;
  value: number | null;
  definition: string;
  text?: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const fig = (label: string, m: Metric): Figure => ({
  label,
  value: m.value,
  definition: m.status === 'missing' ? `${m.definition} Not reported: ${m.reason}.` : m.definition,
});

/** Delivery figures as Academic reports them; the share needs both counts and a planned class. */
export function deliveryFacts(a: AcademicTeacherActivityV1) {
  const { planned, delivered, cancelled } = a.sessions;
  const share =
    planned.value && delivered.value !== null
      ? round1((delivered.value / planned.value) * 100)
      : null;
  return {
    classes: [
      fig('Classes planned', planned),
      fig('Delivered', delivered),
      fig('Cancelled', cancelled),
    ],
    deliveredShare: {
      label: 'Delivered share',
      value: share,
      text: share === null ? undefined : `${share}%`,
      definition:
        'Delivered as a share of planned classes; not computable without both counts and a planned class.',
    } satisfies Figure,
    pending: [
      fig('Teaching logs pending', a.logsPending),
      fig('Attendance not recorded', a.attendancePending),
      fig('Marking pending', a.markingPending),
    ],
    reviewsSubmitted: fig('Student reviews submitted', a.reviews.submitted),
  };
}
export type DeliveryFacts = ReturnType<typeof deliveryFacts>;

/** One person's row of the task period report (server/task-period-report.ts). */
export interface WorkFacts {
  assigned: number;
  completed: number;
  open: number;
  overdue: number;
  eod: { days: number | null; submitted: number; acknowledged: number; missing: number | null };
}

export interface ReviewFacts {
  shareable: number;
  internal: number;
  /** Day of the latest review in the period (IST). */
  latest: IsoDate | null;
}

/** Measured, non-zero counts only; absent data never becomes an item. */
export function workOn(delivery: DeliveryFacts | null, work: WorkFacts | null): string[] {
  const items: [string, number | null][] = [];
  if (delivery)
    items.push(
      ['teaching logs pending', delivery.pending[0]!.value],
      ['classes without attendance recorded', delivery.pending[1]!.value],
      ['assessments pending marking', delivery.pending[2]!.value],
      ['classes cancelled', delivery.classes[2]!.value],
    );
  if (work) items.push(['expected workdays without an EOD report', work.eod.missing]);
  const out = items.filter(([, n]) => n).map(([what, n]) => `${n} ${what}`);
  return out.length ? out : ['Nothing pending in this period.'];
}

const count = (f: Figure) => (f.value === null ? `${f.label.toLowerCase()} not reported` : null);

/** Evidence sentences, one per source; a source that could not be read says so. */
export function teacherSummary(input: {
  delivery: DeliveryFacts | null;
  /** When Academic OS was tried, formatted, when `delivery` is null. */
  unavailableAt: string | null;
  reviews: ReviewFacts | null;
  work: WorkFacts | null;
}): string[] {
  const d = input.delivery;
  const out: string[] = [];
  if (!d)
    out.push(
      `Class delivery: not available for this period (Academic OS unavailable at ${input.unavailableAt ?? 'an unknown time'}).`,
    );
  else {
    const [planned, delivered, cancelled] = d.classes as [Figure, Figure, Figure];
    const gaps = [planned, delivered, cancelled].map(count).filter(Boolean);
    out.push(
      planned.value === null || delivered.value === null
        ? `Class delivery: ${gaps.join(', ')} by Academic OS for this period.`
        : `Class delivery: ${delivered.value} of ${planned.value} planned classes delivered${d.deliveredShare.value === null ? '' : ` (${d.deliveredShare.value}%)`}; ${cancelled.value === null ? 'cancellations not reported' : `${cancelled.value} cancelled`}.`,
    );
    const measured = d.pending.filter((p) => p.value !== null);
    out.push(
      measured.length
        ? `Pending in Academic OS: ${measured.map((p) => `${p.value} ${p.label.toLowerCase()}`).join(', ')}.`
        : 'Pending work in Academic OS: not reported for this period.',
    );
  }
  const r = input.reviews;
  out.push(
    !r
      ? 'Student reviews: not available for this period.'
      : r.shareable + r.internal === 0
        ? 'Student reviews: none submitted in this period.'
        : `Student reviews: ${r.shareable + r.internal} submitted in this period (${r.shareable} shareable, ${r.internal} internal); latest ${windowLabel(r.latest!, r.latest!)}.`,
  );
  const w = input.work;
  out.push(
    !w
      ? 'Tasks and EOD reports: not included.'
      : `Tasks: ${w.completed} completed of ${w.assigned} assigned in the period; ${w.open} open and ${w.overdue} overdue at the cut-off. EOD reports: ${w.eod.days === null ? `${w.eod.submitted} submitted (no expected days: no sign-in, inactive or no work schedule)` : `${w.eod.submitted} submitted; ${w.eod.missing} of ${w.eod.days} expected workdays missing`}.`,
  );
  return out;
}
