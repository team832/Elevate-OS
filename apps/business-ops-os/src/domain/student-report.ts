/**
 * Student reports (owner brief §10, acceptance 17 + 21; two owner kinds, 23 Oct 2026, D-078). Pure.
 * - A report KIND is its audience: the PTM report (`guardian`) and the internal report (`internal`)
 *   are the owner's kinds; `student` and `admin_dossier` stay. Sections depend on the kind and the
 *   author's permissions. Family kinds never get internal remarks, KYC, guardians, status history
 *   or private payments; a fee statement (totals only) appears only when explicitly requested by
 *   someone who may read fees.
 * - The snapshot is built once from structured records and rendered later without re-reading
 *   live data. Marks are copied as recorded: absent stays absent (never 0); comparisons only
 *   inside one assessment and its cohort; trends need 2+ scored results of the same exam type.
 * - The constructive summary is deterministic (no AI): measured evidence, the teacher's shareable
 *   strengths / areas / next steps (never the raw observation), empty-state sentences instead of
 *   invented strengths. The affirmative tone (PTM) leads with the strongest measured positive and
 *   frames gaps as things to work on; the neutral tone (internal) states them plainly.
 */
import type { AcademicStudentSummaryV1 } from '@elevate/shared-contracts';
import { istToday } from './dates';

export const REPORT_TEMPLATE_VERSION = 'progress-report/2';
export const REPORT_SECTIONS = [
  'overview',
  'kyc',
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
export type ReportTone = 'affirmative' | 'neutral';
export const NEXT_STEP_LABEL = 'Proposed next step — not yet agreed with the teacher';

/** Kind labels (D-078), the owner's two kinds first: used on screens and as the PDF title. */
export const REPORT_KIND_LABELS: Record<ReportAudience, string> = {
  guardian: 'PTM report (for parents)',
  internal: 'Internal report (KYC, student details, scores, reviews)',
  student: 'Student report',
  admin_dossier: 'Administration dossier',
};
/** Kinds offered on the screen: owner kinds first, limited to the enabled setting. */
export const reportKinds = (enabled: readonly ReportAudience[]) =>
  (Object.keys(REPORT_KIND_LABELS) as ReportAudience[]).filter((k) => enabled.includes(k));

/** Headings per tone; the PTM report frames gaps as things to work on (owner, 23 Oct 2026). */
export const REPORT_HEADINGS = {
  neutral: {
    strengths: 'Strengths',
    areas: 'Areas for improvement',
    nextSteps: NEXT_STEP_LABEL,
    reviewAreas: 'Areas needing support',
    reviewNext: 'Suggested next step',
  },
  affirmative: {
    strengths: 'Strengths',
    areas: 'Where to work on',
    nextSteps: 'Next steps',
    reviewAreas: 'Where to work on',
    reviewNext: 'Next steps',
  },
} as const satisfies Record<ReportTone, Record<string, string>>;

export interface ReportPermissions {
  fees: boolean;
  privateData: boolean;
  feedback: boolean;
}

export const isFamily = (a: ReportAudience) => a === 'guardian' || a === 'student';
export const toneOf = (a: ReportAudience): ReportTone => (isFamily(a) ? 'affirmative' : 'neutral');

/** Sections each kind may hold (ruling 23 Oct 2026); programmes and KYC fold into the overview. */
const KIND_SECTIONS: Record<ReportAudience, readonly ReportSection[]> = {
  internal: ['overview', 'kyc', 'results', 'attendance', 'feedback', 'fees', 'summary'],
  admin_dossier: [
    'overview',
    'programmes',
    'results',
    'attendance',
    'feedback',
    'fees',
    'guardians',
  ],
  guardian: ['overview', 'results', 'attendance', 'feedback', 'fees', 'summary'],
  student: ['overview', 'results', 'attendance', 'feedback', 'fees', 'summary'],
};
const NEEDS: Partial<Record<ReportSection, keyof ReportPermissions>> = {
  fees: 'fees',
  kyc: 'privateData',
  guardians: 'privateData',
  feedback: 'feedback',
};
const permitted = (s: ReportSection, can: ReportPermissions) => {
  const need = NEEDS[s];
  return !need || can[need];
};

/**
 * Sections a report holds: by kind, author permissions and (optionally) the requested subset.
 * A family fee statement must be asked for explicitly.
 */
export function reportSections(
  audience: ReportAudience,
  can: ReportPermissions,
  requested?: readonly ReportSection[],
): ReportSection[] {
  return REPORT_SECTIONS.filter(
    (s) =>
      KIND_SECTIONS[audience].includes(s) &&
      permitted(s, can) &&
      (requested ? requested.includes(s) : !(s === 'fees' && isFamily(audience))),
  );
}

/** Sections the CURRENT reader may still see (a report never shows more than their permissions). */
export const readableSections = (sections: readonly ReportSection[], can: ReportPermissions) =>
  sections.filter((s) => permitted(s, can));

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

/** Attended = present + late + partial. The rate is Academic's own, under its `attendance.denominator` setting; Ops never recomputes it. */
export function attendanceFacts(
  // shortcut: ratePercent/definition typed here until the contract carries them (WP-A); drop the intersection then.
  a: Summary['attendance'] & { ratePercent?: number | null; definition?: string },
) {
  const recorded = a.present + a.partial + a.late + a.absent + a.excused;
  return {
    ...a,
    recorded,
    notRecorded: Math.max(a.held - recorded, 0),
    attended: a.present + a.partial + a.late,
    ratePercent: a.ratePercent ?? null,
    definition: a.definition ?? null,
  };
}
export type AttendanceFacts = ReturnType<typeof attendanceFacts>;

/** Academic's rate with its definition; an absent rate is "Not recorded", never a figure Ops derives. */
export const attendanceRateText = (a: Pick<AttendanceFacts, 'ratePercent' | 'definition'>) =>
  a.ratePercent === null
    ? 'Not recorded'
    : `${a.ratePercent}%${a.definition ? ` (${a.definition})` : ''}`;

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
        delta: null,
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
      delta,
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

const WORDING = {
  neutral: {
    missed: 'missed (absent, not counted as zero)',
    none: {
      strengths: 'No strengths recorded for this period.',
      areas: 'No areas for improvement recorded for this period.',
      nextSteps: 'No next step recorded for this period.',
    },
  },
  affirmative: {
    missed: 'not attempted (not counted as zero)',
    none: {
      strengths: 'No strengths recorded yet.',
      areas: 'Nothing to work on recorded yet.',
      nextSteps: 'No next step recorded yet.',
    },
  },
} as const;

export function constructiveSummary(
  input: {
    attendance: AttendanceFacts | null;
    results: readonly Result[] | null;
    /** null = the reviews could not be read (Academic OS unreachable or no feedback access). */
    feedback: readonly ShareableFeedback[] | null;
  },
  { tone = 'neutral' }: { tone?: ReportTone } = {},
) {
  const a = input.attendance;
  const w = WORDING[tone];
  const affirmative = tone === 'affirmative';
  // Affirmative: measured positives (attendance ≥ 75%, rising trends) lead; absence counts are never listed.
  const lines: { text: string; positive?: boolean }[] = [
    !a
      ? { text: 'Attendance: not available for this period.' }
      : !a.recorded
        ? { text: 'Attendance: no classes recorded in this period.' }
        : {
            text: `Attendance rate: ${attendanceRateText(a)}. ${a.attended} of ${a.recorded} recorded classes attended${affirmative ? '' : `; ${a.excused} excused, ${a.notRecorded} held but not recorded`}.`,
            positive: (a.ratePercent ?? 0) >= 75,
          },
  ];
  if (!input.results) lines.push({ text: 'Results: not available for this period.' });
  else if (!input.results.length)
    lines.push({ text: 'Results: no assessment results in this period.' });
  else {
    const absent = input.results.filter((r) => r.state === 'absent').length;
    const scored = input.results.length - absent;
    lines.push({
      text: `Results: ${scored} assessment${scored === 1 ? '' : 's'} scored${absent ? `, ${absent} ${w.missed}` : ''}.`,
    });
    const trends = scoreTrends(input.results);
    if (affirmative) trends.sort((x, y) => (y.delta ?? -Infinity) - (x.delta ?? -Infinity));
    lines.push(
      ...trends.map((t) => ({
        text: `Trend — ${t.label}: ${t.text}.`,
        positive: (t.delta ?? 0) >= 1,
      })),
    );
  }
  if (!input.feedback) lines.push({ text: 'Teacher reviews: not available for this period.' });
  const ordered = affirmative
    ? [...lines.filter((l) => l.positive), ...lines.filter((l) => !l.positive)]
    : lines;
  const pick = (k: keyof Omit<ShareableFeedback, 'subject'>) =>
    (input.feedback ?? []).filter((f) => f[k]?.trim()).map((f) => `${f.subject}: ${f[k]!.trim()}`);
  const or = (picked: string[], none: string) =>
    picked.length ? picked : [input.feedback ? none : 'Not available for this period.'];
  return {
    evidence: ordered.map((l) => l.text),
    strengths: or(pick('strengths'), w.none.strengths),
    areas: or(pick('areasToImprove'), w.none.areas),
    nextSteps: or(pick('actionPlan'), w.none.nextSteps),
  };
}
export type ConstructiveSummary = ReturnType<typeof constructiveSummary>;
