/**
 * Follow-up due rules, overdue computation and reminder selection (OPS-007,
 * BR-OPS-9). All dates are Asia/Kolkata calendar days. Pure.
 * Algorithm documentation: docs/ALGORITHMS.md → A-05 and A-06.
 */
import { addDays, daysBetween, istToday, nextServiceDay, type IsoDate } from './dates';

export const FOLLOW_UP_KINDS = [
  'first_contact',
  'counselling_followup',
  'demo_followup',
  'general',
] as const;
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number];

export const FOLLOW_UP_KIND_LABELS: Record<FollowUpKind, string> = {
  first_contact: 'First contact',
  counselling_followup: 'Counselling follow-up',
  demo_followup: 'Demo follow-up',
  general: 'Follow-up',
};

export interface DueRules {
  firstContactDays: number;
  afterCounsellingDays: number;
  afterDemoDays: number;
  upcomingWindowDays: number;
  /** 0 = Sunday … 6 = Saturday. A due date on a closed day moves to the next open day. */
  closedWeekdays: readonly number[];
}

export type FollowUpTrigger = 'lead_received' | 'counselling_completed' | 'demo_attended';

const TRIGGER_KIND: Record<FollowUpTrigger, FollowUpKind> = {
  lead_received: 'first_contact',
  counselling_completed: 'counselling_followup',
  demo_attended: 'demo_followup',
};

/**
 * The follow-up a pipeline event creates: kind and due date. `eventAt` is the
 * instant of the event; the base date is its Asia/Kolkata calendar day.
 */
export function proposeFollowUp(
  trigger: FollowUpTrigger,
  eventAt: Date,
  rules: DueRules,
): { kind: FollowUpKind; dueDate: IsoDate; title: string } {
  const offset =
    trigger === 'lead_received'
      ? rules.firstContactDays
      : trigger === 'counselling_completed'
        ? rules.afterCounsellingDays
        : rules.afterDemoDays;
  const kind = TRIGGER_KIND[trigger];
  const dueDate = nextServiceDay(addDays(istToday(eventAt), offset), rules.closedWeekdays);
  return { kind, dueDate, title: FOLLOW_UP_KIND_LABELS[kind] };
}

export interface FollowUpLike {
  status: 'open' | 'done' | 'cancelled';
  dueDate: IsoDate;
  completedAt?: Date | null;
}

export type DueState = 'overdue' | 'due_today' | 'upcoming' | 'later' | 'closed';

/**
 * Overdue computation. `today` is the Asia/Kolkata date of `now`. A follow-up
 * due on D is overdue from 00:00 IST on D+1 (i.e. 18:30 UTC on D), never
 * earlier. Done/cancelled follow-ups are `closed` and never overdue.
 */
export function followUpDueState(
  f: FollowUpLike,
  now: Date,
  upcomingWindowDays: number,
): { state: DueState; daysOverdue: number } {
  if (f.status !== 'open') return { state: 'closed', daysOverdue: 0 };
  const today = istToday(now);
  const diff = daysBetween(f.dueDate, today); // positive when due date is in the past
  if (diff > 0) return { state: 'overdue', daysOverdue: diff };
  if (diff === 0) return { state: 'due_today', daysOverdue: 0 };
  if (-diff <= upcomingWindowDays) return { state: 'upcoming', daysOverdue: 0 };
  return { state: 'later', daysOverdue: 0 };
}

/** Lead/admission-level flags (OPS-007): `missing_next_action`, `overdue`, `upcoming`. */
export function followUpFlags(
  openCaseFollowUps: readonly FollowUpLike[],
  now: Date,
  upcomingWindowDays: number,
): { missingNextAction: boolean; overdue: boolean; upcoming: boolean; dueToday: boolean } {
  const open = openCaseFollowUps.filter((f) => f.status === 'open');
  const states = open.map((f) => followUpDueState(f, now, upcomingWindowDays).state);
  return {
    missingNextAction: open.length === 0,
    overdue: states.includes('overdue'),
    dueToday: states.includes('due_today'),
    upcoming: states.includes('upcoming'),
  };
}

export interface ReminderCandidate extends FollowUpLike {
  id: string;
  lastReminderOn: IsoDate | null;
  ownerUserId: string | null;
}

export interface ReminderDecision {
  id: string;
  kind: 'followup.due_today' | 'followup.overdue';
  daysOverdue: number;
  ownerUserId: string | null;
}

/**
 * Which open follow-ups get a reminder now: due today or overdue, and not
 * already reminded today (one reminder per follow-up per IST day, so re-running
 * the job is idempotent). Owners without a login are returned with
 * `ownerUserId: null` so the caller can report them as unreachable.
 */
export function selectReminders(
  candidates: readonly ReminderCandidate[],
  now: Date,
): ReminderDecision[] {
  const today = istToday(now);
  const out: ReminderDecision[] = [];
  for (const c of candidates) {
    if (c.status !== 'open') continue;
    if (c.lastReminderOn === today) continue;
    const { state, daysOverdue } = followUpDueState(c, now, 0);
    if (state === 'due_today')
      out.push({
        id: c.id,
        kind: 'followup.due_today',
        daysOverdue: 0,
        ownerUserId: c.ownerUserId,
      });
    if (state === 'overdue')
      out.push({ id: c.id, kind: 'followup.overdue', daysOverdue, ownerUserId: c.ownerUserId });
  }
  return out.sort((a, b) => b.daysOverdue - a.daysOverdue || a.id.localeCompare(b.id));
}
