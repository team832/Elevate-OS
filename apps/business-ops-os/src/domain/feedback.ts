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
