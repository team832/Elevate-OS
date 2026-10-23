/**
 * The two feedback directions (owner brief 20 Oct 2026 §8H, §12). Pure.
 * Algorithm documentation: docs/ALGORITHMS.md → A-MTG-3.
 * - teacher → student: written and versioned in Academic OS (owner answer 21 Oct 2026); Ops reads
 *   submitted versions and keeps its own older rows as read-only history.
 * - student/guardian → teacher: never edited by anyone; only moderated, and never by
 *   the teacher it is about.
 */
import { istToday } from './dates';

export const MODERATION_STATUSES = ['pending', 'approved', 'rejected', 'hidden'] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

export const MODERATION_ACTIONS = {
  approve: 'approved',
  reject: 'rejected',
  hide: 'hidden',
} as const satisfies Record<string, ModerationStatus>;
export type ModerationAction = keyof typeof MODERATION_ACTIONS;

const MODERATION_TRANSITIONS: Record<ModerationStatus, readonly ModerationStatus[]> = {
  pending: ['approved', 'rejected', 'hidden'],
  approved: ['hidden'],
  hidden: ['approved'],
  rejected: [],
};

export function canModerate(
  from: ModerationStatus,
  action: ModerationAction,
  moderator: { staffId: string | null },
  teacherStaffId: string,
): { ok: true; to: ModerationStatus } | { ok: false; reason: 'own_feedback' | 'illegal' } {
  if (moderator.staffId === teacherStaffId) return { ok: false, reason: 'own_feedback' };
  const to = MODERATION_ACTIONS[action];
  return MODERATION_TRANSITIONS[from].includes(to)
    ? { ok: true, to }
    : { ok: false, reason: 'illegal' };
}

/** UI words for a teacher review; "pending" is neutral, never a negative mark. */
export const REVIEW_STATE_LABELS = {
  not_due: 'No review expected',
  pending: 'Pending',
  draft: 'Draft',
  submitted: 'Submitted',
  /** Academic OS could not be read, so a missing review cannot be told from a pending one. */
  unknown: 'Source unavailable',
} as const;
export type ReviewState = keyof typeof REVIEW_STATE_LABELS;

/** A demo class counts as attended when the student was present or late. */
const ATTENDED = new Set(['present', 'late']);

/**
 * Review state per demo day per teacher, from the classes they actually taught that day
 * (substitutes included) and their current (not superseded) reviews of those classes:
 * submitted (a final review) > draft > pending (taught an attended class, no review) > not_due.
 */
export function demoReviewGrid(
  sessions: readonly {
    id: string;
    dayNumber: number;
    teacherStaffId: string | null;
    isSubstitute: boolean;
    attendance: string;
  }[],
  reviews: readonly {
    id: string;
    demoSessionId: string | null;
    teacherStaffId: string;
    status: string;
    superseded: boolean;
  }[],
) {
  const days = new Map<
    number,
    Map<string, { sessionIds: string[]; attended: boolean; isSubstitute: boolean }>
  >();
  for (const s of sessions) {
    if (!s.teacherStaffId) continue;
    const day = days.get(s.dayNumber) ?? new Map();
    const t = day.get(s.teacherStaffId) ?? { sessionIds: [], attended: false, isSubstitute: false };
    t.sessionIds.push(s.id);
    t.attended ||= ATTENDED.has(s.attendance);
    t.isSubstitute ||= s.isSubstitute;
    day.set(s.teacherStaffId, t);
    days.set(s.dayNumber, day);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a - b)
    .map(([dayNumber, teachers]) => ({
      dayNumber,
      teachers: [...teachers].map(([staffId, t]) => {
        const own = reviews.filter(
          (r) =>
            !r.superseded &&
            r.teacherStaffId === staffId &&
            r.demoSessionId !== null &&
            t.sessionIds.includes(r.demoSessionId),
        );
        const state: ReviewState = own.some((r) => r.status === 'final')
          ? 'submitted'
          : own.length
            ? 'draft'
            : t.attended
              ? 'pending'
              : 'not_due';
        return { staffId, ...t, state, reviewIds: own.map((r) => r.id) };
      }),
    }));
}

/** Academic's mark of a linked demo class (owner answer 3); `not_recorded` keeps the Ops value. */
export interface AcademicMark {
  status: string;
  teacherStaffIds: readonly string[];
  teacherNames: readonly string[];
  recordedAt: string | null;
}
export const markedAttendance = (opsValue: string, mark: AcademicMark | null | undefined) =>
  mark && mark.status !== 'not_recorded' ? mark.status : opsValue;

/** Grid rows: one per actual teacher of a linked class (Academic), else the Ops teacher of record. */
export const reviewSessions = <
  S extends { teacherStaffId: string | null; isSubstitute: boolean; academic: AcademicMark | null },
>(
  sessions: readonly S[],
) =>
  sessions.flatMap((s) =>
    s.academic?.teacherStaffIds.length
      ? s.academic.teacherStaffIds.map((t) => ({ ...s, teacherStaffId: t, isSubstitute: false }))
      : [s],
  );

/**
 * Academic demo reviews matched to Ops demo classes: by the Ops demo class id the review carries,
 * or (older reviews without it) by IST day and author. The caller passes only this student's
 * reviews. Shaped for demoReviewGrid.
 */
export function matchDemoReviews(
  sessions: readonly { id: string; startsAt: Date; teacherStaffId: string | null }[],
  reviews: readonly {
    reviewKey: string;
    version: number;
    reviewType: string;
    sessionDate: string | null;
    opsDemoSessionId: string | null;
    authorStaffId: string;
    superseded: boolean;
  }[],
) {
  return reviews.flatMap((r) => {
    const s =
      r.reviewType === 'demo_session' &&
      sessions.find((x) =>
        r.opsDemoSessionId
          ? x.id === r.opsDemoSessionId
          : x.teacherStaffId === r.authorStaffId && istToday(x.startsAt) === r.sessionDate,
      );
    return s
      ? [
          {
            id: `${r.reviewKey}:${r.version}`,
            demoSessionId: s.id,
            teacherStaffId: r.authorStaffId,
            status: 'final',
            superseded: r.superseded,
          },
        ]
      : [];
  });
}

// --- student feedback about teachers: summaries for HR and the teacher (brief 23 Oct 2026 §15) ---

/** Name of a mean: its category's label, or "Overall rating" for the overall one (code null). */
export const meanLabel = (
  code: string | null,
  categories: readonly { code: string; label: string }[],
) => (code === null ? 'Overall rating' : (categories.find((c) => c.code === code)?.label ?? code));

/** One stored figure: the mean and how many responses gave it. */
export interface MeanFigure {
  mean: number;
  n: number;
}
/** Stored per-summary figures: the overall rating apart from the categories (no key encoding). */
export interface StoredMeans {
  overall?: MeanFigure;
  categories: Record<string, MeanFigure>;
}

const figure = (sum: number, n: number): MeanFigure => ({
  mean: Math.round((sum / n) * 100) / 100,
  n,
});

/**
 * Mean rating and count per category and overall, over rows on the summary's scale, to 2
 * decimals. Rows on another scale are left out (their count is returned); a category nobody
 * rated is absent, never 0.
 */
export function categoryMeans(
  rows: readonly {
    ratingScaleMax: number;
    rating: number | null;
    categoryRatings: Record<string, number> | null;
  }[],
  scaleMax: number,
): { means: StoredMeans; otherScale: number } {
  const onScale = rows.filter((r) => r.ratingScaleMax === scaleMax);
  const sums = new Map<string, { sum: number; n: number }>();
  for (const r of onScale)
    for (const [k, v] of Object.entries(r.categoryRatings ?? {})) {
      const s = sums.get(k) ?? { sum: 0, n: 0 };
      sums.set(k, { sum: s.sum + v, n: s.n + 1 });
    }
  const rated = onScale.flatMap((r) => (r.rating === null ? [] : [r.rating]));
  return {
    means: {
      ...(rated.length
        ? {
            overall: figure(
              rated.reduce((a, b) => a + b, 0),
              rated.length,
            ),
          }
        : {}),
      categories: Object.fromEntries([...sums].map(([k, s]) => [k, figure(s.sum, s.n)])),
    },
    otherScale: rows.length - onScale.length,
  };
}

const isFigure = (v: unknown): v is MeanFigure =>
  typeof v === 'object' &&
  v !== null &&
  Number.isFinite((v as MeanFigure).mean) &&
  Number.isInteger((v as MeanFigure).n);

/** Stored figures as rows (`code` null = overall); anything malformed is left out, never guessed. */
export function readMeans(stored: unknown): { code: string | null; mean: number; n: number }[] {
  const s = (stored ?? {}) as { overall?: unknown; categories?: unknown };
  const cats = typeof s.categories === 'object' && s.categories !== null ? s.categories : {};
  return [
    ...(isFigure(s.overall) ? [{ code: null, ...s.overall }] : []),
    ...Object.entries(cats).flatMap(([code, v]) =>
      isFigure(v) ? [{ code, mean: v.mean, n: v.n }] : [],
    ),
  ];
}

/**
 * What a teacher sees of an approved summary (setting feedback.teacher_visibility). Below the
 * minimum group size no figure, strength, area or comment is shown — only that there were too
 * few responses; a single mean rated by fewer than that many is dropped too, so no mean can be
 * one student's rating. Raw rows and student identities are never part of it.
 */
export function teacherFacing<
  S extends {
    id: string;
    periodStart: string;
    periodEnd: string;
    responseCount: number;
    eligiblePopulation: number | null;
    ratingScaleMax: number;
    categoryMeans: unknown;
    strengths: string | null;
    areasToImprove: string | null;
    summaryText: string | null;
    approvedAt: Date | null;
  },
>(s: S, policy: { minGroupSize: number; showComments: boolean }) {
  const enough = s.responseCount >= policy.minGroupSize;
  const shown = readMeans(s.categoryMeans).filter((m) => m.n >= policy.minGroupSize);
  return {
    id: s.id,
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
    approvedAt: s.approvedAt,
    ratingScaleMax: s.ratingScaleMax,
    enough,
    minGroupSize: policy.minGroupSize,
    responseCount: enough ? s.responseCount : null,
    eligiblePopulation: enough ? s.eligiblePopulation : null,
    categoryMeans: enough
      ? {
          overall: shown.find((m) => m.code === null)?.mean ?? null,
          categories: Object.fromEntries(
            shown.flatMap((m) => (m.code === null ? [] : [[m.code, m.mean]])),
          ),
        }
      : null,
    strengths: enough ? s.strengths : null,
    areasToImprove: enough ? s.areasToImprove : null,
    summaryText: enough && policy.showComments ? s.summaryText : null,
  };
}
export type TeacherFacingSummary = ReturnType<typeof teacherFacing>;
