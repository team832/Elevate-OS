/**
 * Marketing calendar (brief 23 Oct 2026 §12): vocabularies (mirrors of the schema lists, checked by
 * tests/unit/calendar.test.ts), the workflow and the view windows. Pure.
 *
 *   idea → planned → in_production → submitted → approved → scheduled → published
 *   submitted → changes_requested → in_production | submitted;  approved → published (manual)
 *   every open state → cancelled (with a reason)
 *
 * Approval and publication are separate actions; moving the date is not a status change.
 */
import { addDays, type IsoDate } from '@elevate/shared-types';
import { isOneOf } from './vocabulary';
import { weekRange } from './week';

export const CALENDAR_ITEM_TYPES = [
  'social_post',
  'short_video',
  'article',
  'webinar',
  'seminar',
  'admission_campaign',
  'email_draft',
  'landing_page_update',
] as const;
export type CalendarItemType = (typeof CALENDAR_ITEM_TYPES)[number];

export const CALENDAR_STATUSES = [
  'idea',
  'planned',
  'in_production',
  'submitted',
  'approved',
  'scheduled',
  'published',
  'changes_requested',
  'cancelled',
] as const;
export type CalendarStatus = (typeof CALENDAR_STATUSES)[number];

export const CHANNELS = [
  'instagram',
  'youtube',
  'linkedin',
  'website',
  'email',
  'whatsapp',
  'online_event',
  'in_person',
  'other',
] as const;
export type Channel = (typeof CHANNELS)[number];

export const EFFORT_SIZES = ['s', 'm', 'l'] as const;
export type EffortSize = (typeof EFFORT_SIZES)[number];

export const ITEM_TYPE_LABELS: Record<CalendarItemType, string> = {
  social_post: 'Social post',
  short_video: 'Short video',
  article: 'Article',
  webinar: 'Webinar',
  seminar: 'Seminar',
  admission_campaign: 'Admission campaign',
  email_draft: 'Email draft',
  landing_page_update: 'Landing-page update',
};

export const CALENDAR_STATUS_LABELS: Record<CalendarStatus, string> = {
  idea: 'Idea',
  planned: 'Planned',
  in_production: 'In production',
  submitted: 'Submitted for review',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  changes_requested: 'Changes requested',
  cancelled: 'Cancelled',
};

export const CHANNEL_LABELS: Record<Channel, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  website: 'Website',
  email: 'Email',
  whatsapp: 'WhatsApp',
  online_event: 'Online event',
  in_person: 'In person',
  other: 'Other',
};

export const EFFORT_LABELS: Record<EffortSize, string> = {
  s: 'Small (under a day)',
  m: 'Medium (a few days)',
  l: 'Large (a week or more)',
};

export const CALENDAR_ACTIONS = [
  'plan',
  'start',
  'submit',
  'approve',
  'request_changes',
  'schedule',
  'publish',
  'cancel',
] as const;
export type CalendarAction = (typeof CALENDAR_ACTIONS)[number];
export const isCalendarAction = (v: unknown): v is CalendarAction => isOneOf(CALENDAR_ACTIONS, v);

const OPEN: CalendarStatus[] = [
  'idea',
  'planned',
  'in_production',
  'submitted',
  'approved',
  'scheduled',
  'changes_requested',
];
const TRANSITIONS: Record<CalendarAction, Partial<Record<CalendarStatus, CalendarStatus>>> = {
  plan: { idea: 'planned' },
  start: { planned: 'in_production', changes_requested: 'in_production' },
  submit: { in_production: 'submitted', changes_requested: 'submitted' },
  approve: { submitted: 'approved' },
  request_changes: { submitted: 'changes_requested' },
  schedule: { approved: 'scheduled' },
  publish: { approved: 'published', scheduled: 'published' },
  cancel: Object.fromEntries(OPEN.map((s) => [s, 'cancelled'])),
};

/** The status an action leads to from `status`, or null when it is not allowed. */
export function nextCalendarStatus(
  status: CalendarStatus,
  action: CalendarAction,
): CalendarStatus | null {
  return TRANSITIONS[action][status] ?? null;
}

/** Actions open from `status` (for buttons; the server re-checks). */
export const calendarActionsFrom = (status: CalendarStatus): CalendarAction[] =>
  CALENDAR_ACTIONS.filter((a) => nextCalendarStatus(status, a) !== null);

/** Button text and the past-tense audit verb (`calendar_item.<event>`). */
export const CALENDAR_ACTION_TEXT: Record<CalendarAction, { button: string; event: string }> = {
  plan: { button: 'Plan', event: 'planned' },
  start: { button: 'Start production', event: 'production_started' },
  submit: { button: 'Submit for review', event: 'submitted' },
  approve: { button: 'Approve', event: 'approved' },
  request_changes: { button: 'Request changes', event: 'changes_requested' },
  schedule: { button: 'Schedule', event: 'scheduled' },
  publish: { button: 'Mark published', event: 'published' },
  cancel: { button: 'Cancel item', event: 'cancelled' },
};

/** Content fields may change only before review and after changes are requested. */
export const calendarEditable = (status: CalendarStatus) =>
  ['idea', 'planned', 'in_production', 'changes_requested'].includes(status);

/** The date can move while the item is still open. */
export const calendarMovable = (status: CalendarStatus) => OPEN.includes(status);

/** Review and publication shown as two separate facts, both derived from the status. */
export function calendarStates(status: CalendarStatus): { review: string; publication: string } {
  const review =
    status === 'submitted'
      ? 'Awaiting review'
      : status === 'changes_requested'
        ? 'Changes requested'
        : ['approved', 'scheduled', 'published'].includes(status)
          ? 'Approved'
          : status === 'cancelled'
            ? 'Cancelled'
            : 'Not submitted';
  const publication =
    status === 'published'
      ? 'Published'
      : status === 'scheduled'
        ? 'Scheduled, not yet published'
        : 'Not published';
  return { review, publication };
}

export const CALENDAR_VIEWS = ['month', 'week', 'list'] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

const iso = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) as IsoDate;

/** The days a view shows around `date` (inclusive) and where Previous / Next lead. */
export function calendarWindow(
  view: CalendarView,
  date: IsoDate,
): { from: IsoDate; to: IsoDate; prev: IsoDate; next: IsoDate } {
  if (view === 'week') {
    const { from, to } = weekRange(date);
    return { from, to, prev: addDays(from, -7), next: addDays(from, 7) };
  }
  const [y, m] = date.split('-').map(Number) as [number, number];
  return {
    from: iso(y, m, 1),
    to: iso(y, m + 1, 0),
    prev: iso(y, m - 1, 1),
    next: iso(y, m + 1, 1),
  };
}

/** IST `HH:MM` of an instant (a moved card keeps its time of day). */
export const istTime = (instant: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);

/** Form validation issues as one line for the page notice. */
export const issuesText = (e: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}) => e.issues.map((i) => `${i.path.join('.') || 'form'}: ${i.message}`).join('; ');
