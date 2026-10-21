/**
 * The two feedback directions (owner brief 20 Oct 2026 §8H, §12). Pure.
 * Algorithm documentation: docs/ALGORITHMS.md → A-MTG-3.
 * - teacher → student: the author (or a feedback manager) edits; a draft is edited in
 *   place, a final row is never changed — the edit becomes a new version.
 * - student/guardian → teacher: never edited by anyone; only moderated, and never by
 *   the teacher it is about.
 */

export const FEEDBACK_STATUSES = ['draft', 'final'] as const;
export const MODERATION_STATUSES = ['pending', 'approved', 'rejected', 'hidden'] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

export type FeedbackEdit =
  | { ok: true; mode: 'in_place' | 'new_version' }
  | { ok: false; reason: 'not_author' | 'superseded' };

export function teacherFeedbackEdit(
  row: { teacherStaffId: string; status: string; superseded: boolean },
  actor: { staffId: string | null; canManage: boolean },
): FeedbackEdit {
  if (!actor.canManage && actor.staffId !== row.teacherStaffId)
    return { ok: false, reason: 'not_author' };
  if (row.superseded) return { ok: false, reason: 'superseded' };
  return { ok: true, mode: row.status === 'final' ? 'new_version' : 'in_place' };
}

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
