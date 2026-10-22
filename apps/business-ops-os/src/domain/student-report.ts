/**
 * Student progress reports (owner brief §10, acceptance 17 + 21). Pure.
 * - Sections depend on the AUDIENCE and the author's permissions. Guardian and student reports
 *   never get raw teacher feedback, guardians, status history or private payments; a fee
 *   statement (totals only) appears only when explicitly requested by someone who may read fees.
 * - The snapshot is built once from structured records and rendered later without re-reading
 *   live data. Marks are copied as recorded: absent stays absent (never 0); comparisons only
 *   inside one assessment and its cohort; trends need 2+ scored results of the same exam type.
 * - The constructive summary is deterministic: measured evidence, the teacher's shareable
 *   strengths / areas / next steps (never the raw observation), and empty-state sentences
 *   instead of invented strengths. No AI rewriting.
 */
import type { AcademicStudentSummaryV1 } from '@elevate/shared-contracts';
import { istToday } from './dates';

export const REPORT_TEMPLATE_VERSION = 'progress-report/1';
export const REPORT_SECTIONS = [
  'overview',
  'programmes',
  'results',
  'attendance',
  'feedback',
  'fees',
  'guardians',
  'summary',
] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];
export type ReportAudience = 'internal' | 'guardian' | 'student' | 'admin_dossier';
export const NEXT_STEP_LABEL = 'Proposed next step — not yet agreed with the teacher';

export interface ReportPermissions {
  fees: boolean;
  privateData: boolean;
  feedback: boolean;
}

const FAMILY: readonly ReportSection[] = [
  'overview',
  'programmes',
  'results',
  'attendance',
  'summary',
];
const isFamily = (a: ReportAudience) => a === 'guardian' || a === 'student';

/** Sections a report holds: by audience, author permissions and (optionally) the requested subset. */
export function reportSections(
  audience: ReportAudience,
  can: ReportPermissions,
  requested?: readonly ReportSection[],
): ReportSection[] {
  const allowed = (s: ReportSection) =>
    (s !== 'fees' || can.fees) &&
    (s !== 'guardians' || can.privateData) &&
    (s !== 'feedback' || can.feedback);
  return REPORT_SECTIONS.filter((s) =>
    isFamily(audience)
      ? (FAMILY.includes(s) && (!requested || requested.includes(s))) ||
        (s === 'fees' && can.fees && !!requested?.includes('fees'))
      : s !== 'summary' && allowed(s) && (!requested || requested.includes(s)),
  );
}

/** Sections the CURRENT reader may still see (a report never shows more than their permissions). */
export const readableSections = (sections: readonly ReportSection[], can: ReportPermissions) =>
  sections.filter(
    (s) =>
      (s !== 'fees' || can.fees) &&
      (s !== 'guardians' || can.privateData) &&
      (s !== 'feedback' || can.feedback),
  );

export type ReportStatus = 'draft' | 'reviewed' | 'final';
export type ReportMove =
  | { ok: true }
  | { ok: false; reason: 'illegal' | 'needs_reviewer' | 'own_report' | 'review_first' };

/**
 * draft → reviewed (a reviewer who is not the creator) → final. With review off, draft → final
 * skips the second person but still needs the review (finalise) permission.
 */
export function reportTransition(
  from: ReportStatus,
  to: 'reviewed' | 'final',
  p: { isCreator: boolean; canReview: boolean; reviewBeforeFinal: boolean },
): ReportMove {
  if (to === 'reviewed') {
    if (from !== 'draft') return { ok: false, reason: 'illegal' };
    if (!p.canReview) return { ok: false, reason: 'needs_reviewer' };
    return p.isCreator ? { ok: false, reason: 'own_report' } : { ok: true };
  }
  if (from === 'reviewed')
    return p.canReview ? { ok: true } : { ok: false, reason: 'needs_reviewer' };
  if (from === 'draft')
    return !p.canReview
      ? { ok: false, reason: 'needs_reviewer' }
      : p.reviewBeforeFinal
        ? { ok: false, reason: 'review_first' }
        : { ok: true };
  return { ok: false, reason: 'illegal' };
}

/** "In the period" uses the IST calendar day of an instant (not the UTC day). */
export const inIstPeriod = (at: Date | string, from: string, to: string) => {
  const day = istToday(new Date(at));
  return day >= from && day <= to;
};

// --- measured evidence -----------------------------------------------------------------------

type Summary = AcademicStudentSummaryV1;
type Result = Summary['results'][number];
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Attended = present + late + partial; rate over recorded classes minus excused; null = nothing countable. */
export function attendanceFacts(a: Summary['attendance']) {
  const recorded = a.present + a.partial + a.late + a.absent + a.excused;
  const attended = a.present + a.partial + a.late;
  const countable = recorded - a.excused;
  return {
    ...a,
    recorded,
    notRecorded: Math.max(a.held - recorded, 0),
    attended,
    ratePercent: countable > 0 ? round1((attended / countable) * 100) : null,
  };
}
export type AttendanceFacts = ReturnType<typeof attendanceFacts>;

/** Position within the SAME assessment and its cohort only; never across assessments. */
export function cohortComparison(r: Result): string {
  if (r.state === 'absent') return 'Absent — not scored, not compared';
  // Academic omits rank/percentile unless the setting allows them (A4): absent = not shown.
  const percentile = r.percentile ?? null;
  if (percentile === null || r.cohort.scored < 2)
    return `Insufficient data (${r.cohort.scored} scored in ${r.cohort.label})`;
  const rank = (r.rank ?? null) === null ? '' : `, rank ${r.rank}`;
  return `Percentile ${round1(percentile)}${rank} of ${r.cohort.scored} scored in ${r.cohort.label}`;
}

export const resultFacts = (r: Result) => ({
  ...r,
  percent: r.score === null ? null : round1((r.score / r.maxScore) * 100),
  comparison: cohortComparison(r),
  rescored: r.resultVersion > 1,
});
export type ResultFacts = ReturnType<typeof resultFacts>;

/**
 * Per subject and exam type (never across subjects): first → last scored percentage; absent
 * results are not points; < 2 scored → insufficient; different maximum marks are labelled.
 */
export function scoreTrends(results: readonly Result[]) {
  const groups = new Map<string, Result[]>();
  for (const r of results) {
    const key = `${r.subject ?? 'Subject not recorded'} ${r.examType.replace(/_/g, ' ')}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups].map(([label, rows]) => {
    const scored = rows
      .filter((r) => r.score !== null)
      .sort((a, b) => (a.heldOn ?? '').localeCompare(b.heldOn ?? ''));
    if (scored.length < 2)
      return {
        label,
        status: 'insufficient' as const,
        text: `insufficient data (${scored.length} scored result${scored.length === 1 ? '' : 's'})`,
      };
    const pct = scored.map((r) => round1((r.score! / r.maxScore) * 100));
    const delta = round1(pct.at(-1)! - pct[0]!);
    const dir = Math.abs(delta) < 1 ? 'level' : delta > 0 ? `up ${delta}` : `down ${-delta}`;
    const scales = [...new Set(scored.map((r) => r.maxScore))];
    const formats =
      scales.length > 1
        ? `; formats differ (out of ${scales.join(', ')}), compared as percentages`
        : '';
    return {
      label,
      status: 'ok' as const,
      text: `${scored.length} scored results, ${pct[0]}% to ${pct.at(-1)}% (${dir}${dir === 'level' ? '' : ' points'})${formats}`,
    };
  });
}

// --- constructive summary --------------------------------------------------------------------

export interface ShareableFeedback {
  subject: string;
  strengths: string | null;
  areasToImprove: string | null;
  actionPlan: string | null;
}

export function constructiveSummary(input: {
  attendance: AttendanceFacts | null;
  results: readonly Result[] | null;
  /** null = the reviews could not be read (Academic OS unreachable or no feedback access). */
  feedback: readonly ShareableFeedback[] | null;
}) {
  const a = input.attendance;
  const evidence = [
    !a
      ? 'Attendance: not available for this period.'
      : a.ratePercent === null
        ? 'Attendance: no classes recorded in this period.'
        : `Attendance: ${a.attended} of ${a.recorded - a.excused} recorded classes attended (${a.ratePercent}%); ${a.excused} excused, ${a.notRecorded} not recorded.`,
  ];
  if (!input.results) evidence.push('Results: not available for this period.');
  else if (!input.results.length) evidence.push('Results: no assessment results in this period.');
  else {
    const absent = input.results.filter((r) => r.state === 'absent').length;
    evidence.push(
      `Results: ${input.results.length - absent} assessment${input.results.length - absent === 1 ? '' : 's'} scored${absent ? `, ${absent} missed (absent, not counted as zero)` : ''}.`,
      ...scoreTrends(input.results).map((t) => `Trend — ${t.label}: ${t.text}.`),
    );
  }
  if (!input.feedback) evidence.push('Teacher reviews: not available for this period.');
  const pick = (k: keyof Omit<ShareableFeedback, 'subject'>) =>
    (input.feedback ?? []).filter((f) => f[k]?.trim()).map((f) => `${f.subject}: ${f[k]!.trim()}`);
  const strengths = pick('strengths');
  const areas = pick('areasToImprove');
  const nextSteps = pick('actionPlan');
  const or = (picked: string[], none: string) =>
    picked.length ? picked : [input.feedback ? none : 'Not available for this period.'];
  return {
    evidence,
    strengths: or(strengths, 'No strengths recorded for this period.'),
    areas: or(areas, 'No areas for improvement recorded for this period.'),
    nextSteps: or(nextSteps, 'No next step recorded for this period.'),
  };
}
export type ConstructiveSummary = ReturnType<typeof constructiveSummary>;
