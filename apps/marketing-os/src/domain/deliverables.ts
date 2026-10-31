/**
 * Deliverables (brief 23 Oct 2026 §16): "approved" and "published externally" are two separate
 * facts. Approval comes from a task or content review; publishing only from the explicit
 * publish step (content state `published`). A task never publishes anything.
 */
import type { ContentState } from './vocabulary';

const REVIEW: Record<ContentState, string> = {
  draft: 'Not submitted',
  in_review: 'Awaiting review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  scheduled: 'Approved',
  published: 'Approved',
  archived: 'Archived',
};

export const TASK_PUBLISHED_TEXT = 'Not applicable: a task never publishes';

/** The two states a content deliverable shows. */
export const contentDeliverableStates = (state: ContentState) => ({
  review: REVIEW[state],
  published: state === 'published' ? 'Published externally' : 'Not published',
});

const DUE_DAY = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const DUE_TIME = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** A task deadline in IST, e.g. "24 Oct 2026, 5:00 pm" (no time = end of day). */
export function dueText(dueOn: string, dueTime: string | null): string {
  const at = new Date(`${dueOn}T${dueTime ?? '12:00'}+05:30`);
  const day = DUE_DAY.format(at);
  if (!dueTime) return `${day}, end of day`;
  return `${day}, ${DUE_TIME.format(at).toLowerCase()}`;
}
