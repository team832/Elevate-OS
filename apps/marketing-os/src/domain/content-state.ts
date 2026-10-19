/**
 * Content item state machine (MKT-009; docs/ALGORITHMS.md §3).
 *
 *   draft ──submit──▶ in_review ──approve──▶ approved ──schedule──▶ scheduled ──publish──▶ published ──archive──▶ archived
 *     ▲                 │   ▲                   │  ▲                  │
 *     └──withdraw───────┘   └──submit── changes_requested ◀─request_changes (from in_review)
 *   approved / scheduled ──revise (new version)──▶ in_review   (approval voided)
 *   scheduled ──unschedule (last scheduled placement)──▶ approved
 *   draft / changes_requested / approved / scheduled / published ──archive──▶ archived
 *
 * Pure: the service maps `{ ok: false }` to INVALID_STATE_TRANSITION.
 */
import type { ContentState } from './vocabulary';

export const CONTENT_ACTIONS = [
  'submit',
  'withdraw',
  'request_changes',
  'approve',
  'revise',
  'schedule',
  'unschedule',
  'publish',
  'archive',
] as const;
export type ContentAction = (typeof CONTENT_ACTIONS)[number];

const TRANSITIONS: Readonly<Record<ContentAction, Partial<Record<ContentState, ContentState>>>> = {
  submit: { draft: 'in_review', changes_requested: 'in_review' },
  withdraw: { in_review: 'draft' },
  request_changes: { in_review: 'changes_requested' },
  approve: { in_review: 'approved' },
  revise: { approved: 'in_review', scheduled: 'in_review' },
  schedule: { approved: 'scheduled', scheduled: 'scheduled', published: 'published' },
  unschedule: { scheduled: 'approved' },
  publish: { scheduled: 'published', published: 'published' },
  archive: {
    draft: 'archived',
    changes_requested: 'archived',
    approved: 'archived',
    scheduled: 'archived',
    published: 'archived',
  },
};

export type TransitionResult =
  | { ok: true; from: ContentState; to: ContentState }
  | { ok: false; from: ContentState; action: ContentAction; reason: string };

export function transitionContent(state: ContentState, action: ContentAction): TransitionResult {
  const to = TRANSITIONS[action]?.[state];
  if (to) return { ok: true, from: state, to };
  const allowedFrom = Object.keys(TRANSITIONS[action] ?? {}).join(', ') || 'no state';
  return {
    ok: false,
    from: state,
    action,
    reason: `Cannot ${action.replace('_', ' ')} a content item that is ${state.replace('_', ' ')} (allowed from: ${allowedFrom}).`,
  };
}

/** Actions that are legal from `state` (for screens; the server re-checks). */
export function allowedContentActions(state: ContentState): ContentAction[] {
  return CONTENT_ACTIONS.filter((a) => TRANSITIONS[a]?.[state] !== undefined);
}

/**
 * What saving new copy does in each state:
 * - `edit`: a new version, state unchanged (draft, changes requested);
 * - `revise`: a new version that voids the approval and returns the item to review;
 * - `blocked`: no edits (in review — withdraw first; published and archived are history).
 */
export function editEffect(state: ContentState): 'edit' | 'revise' | 'blocked' {
  if (state === 'draft' || state === 'changes_requested') return 'edit';
  if (state === 'approved' || state === 'scheduled') return 'revise';
  return 'blocked';
}

/** States in which a valid approval must exist for the current version. */
export function requiresValidApproval(state: ContentState): boolean {
  return state === 'approved' || state === 'scheduled' || state === 'published';
}
