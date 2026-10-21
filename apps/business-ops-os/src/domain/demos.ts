/**
 * Demo students (owner brief 21 Oct 2026 §5): a demo is N demo days (setting
 * `admissions.demo.day_count`, D-038), each with one or more classes; day summary and
 * progress, Current / Upcoming / Previous views on Asia/Kolkata calendar days, attendance
 * corrections, extra days, mock status, the checklist and the demo fee from the ledger.
 * Pure. Rule documentation: docs/parts/admissions-demos.md (D-1 … D-9).
 */
import { daysBetween, istToday, type IsoDate } from './dates';
import { summariseFees, type FeeRecordLike } from './fees';
import { followUpDueState, type DueState, type FollowUpLike } from './follow-ups';
import type { AdmissionStatus } from './pipeline';

// Mirrors of the vocabularies in packages/database/src/schema/ops*.ts (a unit test keeps them equal).
export const DEMO_OUTCOMES = [
  'open',
  'converted',
  'declined',
  'withdrawn',
  'not_converted',
  'cancelled',
  'no_show',
] as const;
export const DEMO_ATTENDANCE = [
  'scheduled',
  'present',
  'absent',
  'rescheduled',
  'cancelled',
  'not_recorded',
  'late',
  'excused',
] as const;
export const MOCK_STATUSES = [
  'not_required',
  'pending',
  'prepared',
  'scheduled',
  'completed',
] as const;
export const CHECKLIST_STATUSES = ['complete', 'pending', 'waived', 'not_applicable'] as const;
export const DEMO_VIEWS = ['current', 'upcoming', 'previous'] as const;
/** Outcomes staff set by hand; `converted` comes only from Convert to admission. */
export const MANUAL_OUTCOMES = [
  'not_converted',
  'cancelled',
  'no_show',
  'declined',
  'withdrawn',
] as const;
/** Class / category on the lead (`current_stage`): Class 11, Class 12 and Dropper first (brief §5). */
export const CLASS_CATEGORY_LABELS: Record<string, string> = {
  class_11: 'Class 11',
  class_12: 'Class 12',
  gap_year: 'Dropper',
  class_9: 'Class 9',
  class_10: 'Class 10',
  graduate: 'Graduate',
  other: 'Other',
};
export const CLASS_CATEGORY_OPTIONS = Object.entries(CLASS_CATEGORY_LABELS).map(
  ([value, label]) => ({ value, label }),
);
/** What staff record for a class (besides `not_recorded`, and `scheduled` to undo a record). */
export const RECORDABLE_ATTENDANCE = ['present', 'late', 'absent', 'excused'] as const;

export type DemoOutcome = (typeof DEMO_OUTCOMES)[number];
export type Attendance = (typeof DEMO_ATTENDANCE)[number];
export type MockStatus = (typeof MOCK_STATUSES)[number];
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];
export type DemoView = (typeof DEMO_VIEWS)[number];

export const ATTENDANCE_LABELS: Record<Attendance, string> = {
  scheduled: 'Scheduled',
  present: 'Present',
  absent: 'Absent',
  rescheduled: 'Rescheduled',
  cancelled: 'Cancelled',
  not_recorded: 'Not recorded',
  late: 'Late',
  excused: 'Excused',
};

export const MOCK_LABELS: Record<MockStatus, string> = {
  not_required: 'Not planned',
  pending: 'Pending (not scheduled)',
  prepared: 'Prepared',
  scheduled: 'Scheduled',
  completed: 'Completed',
};

export interface SessionLike {
  sessionNumber: number;
  dayNumber: number;
  startsAt: Date;
  attendance: string;
  mockStatus: string;
  mockAttemptRef?: string | null;
  teacherStaffId?: string | null;
  subject?: string | null;
}

/** Waiting to happen (or to be recorded): scheduled or moved to a new time. */
const PENDING: readonly string[] = ['scheduled', 'rescheduled'];
const RECORDED: readonly string[] = [...RECORDABLE_ATTENDANCE, 'not_recorded'];
export const isPending = (s: Pick<SessionLike, 'attendance'>) => PENDING.includes(s.attendance);
/** A class counts as attended when the student was present or late. */
export const isAttended = (s: Pick<SessionLike, 'attendance'>) =>
  s.attendance === 'present' || s.attendance === 'late';
const live = <S extends Pick<SessionLike, 'attendance'>>(sessions: readonly S[]) =>
  sessions.filter((s) => s.attendance !== 'cancelled');

export const DAY_STATES = [
  'attended',
  'absent',
  'excused',
  'scheduled',
  'not_recorded',
  'cancelled',
  'not_scheduled',
] as const;
export type DayState = (typeof DAY_STATES)[number];
export const DAY_STATE_LABELS: Record<DayState, string> = {
  attended: 'Attended',
  absent: 'Absent',
  excused: 'Excused',
  scheduled: 'Not held or not recorded yet',
  not_recorded: 'Not recorded',
  cancelled: 'Cancelled',
  not_scheduled: 'No class booked',
};

/**
 * D-1 Day summary from the day's classes (cancelled ones ignored); the first rule that
 * applies: attended = a class present or late · scheduled = a class still to come or to
 * record · absent = a class absent (also when another class that day was excused) ·
 * excused = only excused classes · not_recorded = only classes nobody recorded ·
 * cancelled = every class cancelled · not_scheduled = no class. Only `attended` counts.
 */
export function dayState(sessions: readonly Pick<SessionLike, 'attendance'>[]): DayState {
  if (sessions.length === 0) return 'not_scheduled';
  const held = live(sessions);
  if (held.some(isAttended)) return 'attended';
  if (held.some(isPending)) return 'scheduled';
  if (held.some((s) => s.attendance === 'absent')) return 'absent';
  if (held.some((s) => s.attendance === 'excused')) return 'excused';
  return held.length ? 'not_recorded' : 'cancelled';
}

type DaySession = Pick<SessionLike, 'dayNumber' | 'attendance' | 'startsAt'>;

/** Days 1..max(planned, last booked day): classes in start order, IST dates of live classes, summary. */
export function demoDays<S extends DaySession>(sessions: readonly S[], plannedDays: number) {
  const last = Math.max(plannedDays, ...sessions.map((s) => s.dayNumber));
  return Array.from({ length: last }, (_, i) => {
    const day = i + 1;
    const own = sessions
      .filter((s) => s.dayNumber === day)
      .sort((a, b) => +a.startsAt - +b.startsAt);
    return {
      day,
      extra: day > plannedDays,
      sessions: own,
      dates: [...new Set(live(own).map((s) => istToday(s.startsAt)))],
      state: dayState(own),
    };
  });
}

/**
 * D-1 Progress = days attended out of the planned days ("2 of 3 days attended"); days
 * scheduled (with a live class) and classes attended are kept separately.
 */
export function demoProgress(sessions: readonly DaySession[], planned: number) {
  const days = demoDays(sessions, planned);
  const attended = days.filter((d) => d.state === 'attended').length;
  const held = live(sessions);
  const sessionsAttended = held.filter(isAttended).length;
  return {
    attended,
    planned,
    daysScheduled: days.filter((d) => d.dates.length > 0).length,
    sessionsAttended,
    liveSessions: held.length,
    label: `${attended} of ${planned} days attended`,
    sessionsLabel: `${sessionsAttended} of ${held.length} classes attended`,
  };
}

/**
 * D-2 View. Previous = outcome decided. Otherwise Current from 00:00 IST on the
 * calendar day of the earliest session that is not cancelled; before that (or with
 * no live session) Upcoming.
 */
export function demoView(
  demo: { outcome: string; sessions: readonly Pick<SessionLike, 'startsAt' | 'attendance'>[] },
  now: Date,
): DemoView {
  if (demo.outcome !== 'open') return 'previous';
  const live = demo.sessions.filter((s) => s.attendance !== 'cancelled');
  if (live.length === 0) return 'upcoming';
  const first = Math.min(...live.map((s) => s.startsAt.getTime()));
  return istToday(new Date(first)) <= istToday(now) ? 'current' : 'upcoming';
}

/** D-3 Next class: the earliest pending session that has not started; plus pending ones already past. */
export function nextSession<S extends SessionLike>(sessions: readonly S[], now: Date) {
  const pending = sessions.filter(isPending).sort((a, b) => +a.startsAt - +b.startsAt);
  return {
    next: pending.find((s) => s.startsAt >= now) ?? null,
    awaitingRecord: pending.filter((s) => s.startsAt < now),
  };
}

/** The furthest mock stage across the sessions (`not_required` when none is planned). */
export function demoMockStatus(sessions: readonly Pick<SessionLike, 'mockStatus'>[]): MockStatus {
  return sessions.reduce<MockStatus>((best, s) => {
    const i = MOCK_STATUSES.indexOf(s.mockStatus as MockStatus);
    return i > MOCK_STATUSES.indexOf(best) ? (s.mockStatus as MockStatus) : best;
  }, 'not_required');
}

/** IST class days (sorted) and subjects (in session order) of a demo, from its sessions. */
export function demoDaysAndSubjects(
  sessions: readonly { startsAt: Date; subject: string | null }[],
): { days: IsoDate[]; subjects: string[] } {
  return {
    days: [...new Set(sessions.map((s) => istToday(s.startsAt)))].sort(),
    subjects: [...new Set(sessions.flatMap((s) => (s.subject ? [s.subject] : [])))],
  };
}

/** One-word summary of a demo's sessions (derived, never stored): scheduled, attended, missed or cancelled. */
export function demoAttendanceStatus(
  outcome: string,
  sessions: readonly Pick<SessionLike, 'attendance'>[],
): 'scheduled' | 'attended' | 'missed' | 'cancelled' {
  if (outcome === 'cancelled') return 'cancelled';
  if (sessions.some(isPending)) return 'scheduled';
  if (!sessions.some((s) => s.attendance !== 'cancelled')) return 'cancelled';
  return sessions.some(isAttended) ? 'attended' : 'missed';
}

type Check = { ok: true } | { ok: false; message: string };
const fail = (message: string): Check => ({ ok: false, message });
const OK: Check = { ok: true };

/**
 * D-4 Legal attendance updates. Present/late/absent/excused/not recorded only once the
 * class has started; a cancelled class must be rescheduled first; changing an already
 * recorded value is a correction and needs a reason (and ops:leads:write on the demo).
 */
export function checkAttendance(
  session: Pick<SessionLike, 'attendance' | 'startsAt'>,
  next: (typeof RECORDABLE_ATTENDANCE)[number] | 'not_recorded' | 'scheduled',
  reason: string | null | undefined,
  now: Date,
): Check & { correction?: boolean } {
  if (session.attendance === next) return fail(`Attendance is already ${ATTENDANCE_LABELS[next]}.`);
  if (session.attendance === 'cancelled')
    return fail('This session is cancelled. Reschedule it before recording attendance.');
  const correction = RECORDED.includes(session.attendance);
  if (next === 'scheduled' && !correction) return fail('This session has not been recorded yet.');
  if (next !== 'scheduled' && session.startsAt > now)
    return fail('Attendance can be recorded once the session has started.');
  if (correction && !reason?.trim())
    return fail('Give a reason: this changes attendance that was already recorded.');
  return { ok: true, correction };
}

/** D-5 Reschedule (any session except one attended) and cancel (pending sessions only); reason always required. */
export function checkSessionChange(
  session: Pick<SessionLike, 'attendance'>,
  action: 'reschedule' | 'cancel',
  reason: string | null | undefined,
): Check {
  if (!reason?.trim()) return fail('Give a reason.');
  if (action === 'cancel' && !isPending(session))
    return fail(`Only a scheduled session can be cancelled (this one is ${session.attendance}).`);
  if (action === 'reschedule' && isAttended(session))
    return fail('An attended class cannot be rescheduled.');
  return OK;
}

/**
 * D-9 Day dates: a demo day is one IST date. A class added to a day, or moved within it, goes on
 * the date of the day's other live classes; moving the whole day (`moving` = all its classes)
 * may pick a new date (not necessarily in day order: days need not be consecutive). Either way
 * no two days share a date — so a missed day is never "made up" by a class on a later date
 * outside the extra-day setting.
 */
export function checkDayDate(
  days: readonly {
    day: number;
    dates: readonly IsoDate[];
    sessions: readonly (Pick<SessionLike, 'attendance' | 'startsAt'> & { id: string })[];
  }[],
  dayNumber: number,
  date: IsoDate,
  moving: readonly string[] = [],
): Check {
  const staying = live(days.find((d) => d.day === dayNumber)?.sessions ?? []).filter(
    (s) => !moving.includes(s.id),
  );
  const fixed = staying.map((s) => istToday(s.startsAt)).find((d) => d !== date);
  if (fixed)
    return fail(
      `Day ${dayNumber} is on ${fixed}: its classes stay on that date. To move the day, reschedule the whole day with a reason.`,
    );
  const taken = days.find((d) => d.day !== dayNumber && d.dates.includes(date));
  return taken ? fail(`${date} is already demo day ${taken.day}; each day has its own date.`) : OK;
}

/**
 * D-5 Teacher of record: once a class is recorded, its teacher and substitute flag change
 * only as a correction with a reason (kept in the change history, never rewritten).
 */
export const checkTeacherChange = (
  session: Pick<SessionLike, 'attendance'>,
  reason: string | null | undefined,
): Check =>
  RECORDED.includes(session.attendance) && !reason?.trim()
    ? fail('Give a reason: this class was already recorded with its teacher.')
    : OK;

/**
 * D-9 Extra demo day (beyond the booked day count): refused unless the setting "Extra demo
 * days" is on, within its limit, with a reason. Who may: anyone with demo write rights.
 */
export function checkExtraDay(
  dayNumber: number,
  plannedDays: number,
  extension: { allowed: boolean; maxExtraDays: number },
  reason: string | null | undefined,
  lastBookedDay = plannedDays,
): Check {
  if (dayNumber > lastBookedDay + 1) return fail(`Book day ${lastBookedDay + 1} first.`);
  if (dayNumber <= plannedDays) return OK;
  if (!extension.allowed)
    return fail(
      `A demo has ${plannedDays} demo day(s). Day ${dayNumber} needs the setting "Extra demo days", which is off.`,
    );
  if (dayNumber > plannedDays + extension.maxExtraDays)
    return fail(`At most ${extension.maxExtraDays} extra demo day(s) under "Extra demo days".`);
  return reason?.trim() ? OK : fail('Give a reason for the extra demo day.');
}

/** D-5 A mock result is linked only to a completed mock. */
export const checkMock = (status: MockStatus, ref: string | null | undefined): Check =>
  ref && status !== 'completed'
    ? fail('A mock result reference needs the mock status "Completed".')
    : OK;

/** D-6 Outcome: from open only, to a manual outcome, with a reason. */
export function checkOutcome(current: string, reason: string | null | undefined): Check {
  if (current !== 'open') return fail(`This demo is already closed (${current}).`);
  return reason?.trim() ? OK : fail('Give a reason for the outcome.');
}

/** D-6 Closing a demo: a past pending session nobody recorded stays "not recorded"; a future one is cancelled. */
export const closingAttendance = (s: Pick<SessionLike, 'startsAt'>, now: Date): Attendance =>
  s.startsAt <= now ? 'not_recorded' : 'cancelled';

/** D-6 Outcomes that return a demo_scheduled case to Counselled so a new demo can be booked. */
export const REOPENING_OUTCOMES: readonly string[] = ['cancelled', 'not_converted', 'no_show'];

/** Case statuses a demo can be booked from (after counselling). */
export const DEMO_BOOKABLE_STATUSES: readonly AdmissionStatus[] = ['counselled', 'demo_scheduled'];

/**
 * Booking plan (classes sorted by start): exactly days 1..N (N = setting "Demo days per
 * student"), each day one IST date with one or more classes, days in date order, no
 * overlaps, each class ending after it starts; the OPEN demo limits (OD-012) apply only
 * once the owner sets them.
 */
export function checkDemoPlan(
  sessions: readonly { dayNumber: number; startsAt: Date; endsAt: Date; subject: string }[],
  count: number,
  limits: { subjectCap: number | null; maxConsecutiveDays: number | null },
): string[] {
  const dates = sessions.map((s) => istToday(s.startsAt));
  const days = new Set(sessions.map((s) => s.dayNumber));
  const dayDates = new Set(sessions.map((s, i) => `${s.dayNumber}|${dates[i]}`));
  return [
    (days.size !== count || [...days].some((d) => d < 1 || d > count)) &&
      `A demo has ${count} demo day(s) under the setting "Demo days per student", each with at least one class.`,
    (dayDates.size !== days.size ||
      new Set(dates).size !== days.size ||
      sessions.some((s, i) => i > 0 && s.dayNumber < sessions[i - 1]!.dayNumber)) &&
      'Each demo day is one date, and the days follow in date order.',
    sessions.some((s, i) => i > 0 && s.startsAt < sessions[i - 1]!.endsAt) &&
      'Classes must not overlap.',
    sessions.some((s) => s.endsAt <= s.startsAt) && 'Each class must end after it starts.',
    limits.subjectCap !== null &&
      new Set(sessions.map((s) => s.subject)).size > limits.subjectCap &&
      `At most ${limits.subjectCap} subject(s) per demo.`,
    limits.maxConsecutiveDays !== null &&
      dates.length > 1 &&
      daysBetween(dates[0]!, dates.at(-1)!) + 1 > limits.maxConsecutiveDays &&
      `Classes must fall within ${limits.maxConsecutiveDays} consecutive day(s).`,
  ].filter((p): p is string => typeof p === 'string');
}

// --- checklist (D-7) ---------------------------------------------------------------------------

/** Items derived from the sessions are read-only here; the rest are recorded by staff. */
export const DEMO_CHECKLIST_ITEMS = [
  { key: 'sessions_recorded', label: 'All demo classes scheduled and recorded', derived: true },
  { key: 'mock_prepared', label: 'Mock test prepared', derived: true },
  { key: 'mock_result_linked', label: 'Mock result linked', derived: true },
  {
    key: 'programme_batch_discussed',
    label: 'Programme and target batch discussed',
    derived: false,
  },
  { key: 'fee_structure_explained', label: 'Fee structure explained', derived: false },
  { key: 'instalment_terms_discussed', label: 'Instalment terms discussed', derived: false },
  { key: 'admission_process_explained', label: 'Admission process explained', derived: false },
  { key: 'student_feedback', label: 'Student feedback recorded', derived: false },
  { key: 'guardian_feedback', label: 'Guardian feedback recorded', derived: false },
  { key: 'next_action_follow_up', label: 'Next action and follow-up date set', derived: false },
  {
    key: 'conversion_decision',
    label: 'Conversion decision and responsible staff',
    derived: false,
  },
] as const;
export type DemoChecklistKey = (typeof DEMO_CHECKLIST_ITEMS)[number]['key'];

export interface ChecklistEntryLike {
  itemKey: string;
  status: string;
  reason: string | null;
  at: Date;
  actorUserId?: string;
}

export function checkChecklistEntry(input: {
  itemKey: string;
  status: ChecklistStatus;
  reason?: string | null;
}): Check {
  const item = DEMO_CHECKLIST_ITEMS.find((i) => i.key === input.itemKey);
  if (!item) return fail(`Unknown checklist item "${input.itemKey}".`);
  if (item.derived)
    return fail(`"${item.label}" follows the session records; update the sessions.`);
  if (input.status === 'waived' && !input.reason?.trim()) return fail('A waiver needs a reason.');
  return OK;
}

/** Latest entry per item (entries are append-only; ties keep the later one in the list). */
export function latestEntries<E extends ChecklistEntryLike>(entries: readonly E[]): Map<string, E> {
  const out = new Map<string, E>();
  for (const e of entries) {
    const prev = out.get(e.itemKey);
    if (!prev || +e.at >= +prev.at) out.set(e.itemKey, e);
  }
  return out;
}

function derivedStatus(key: string, sessions: readonly SessionLike[]): ChecklistStatus {
  const mock = demoMockStatus(sessions);
  if (key === 'sessions_recorded')
    return sessions.length > 0 && !sessions.some(isPending) ? 'complete' : 'pending';
  if (mock === 'not_required') return 'not_applicable';
  if (key === 'mock_prepared') return mock === 'pending' ? 'pending' : 'complete';
  return sessions.some((s) => s.mockAttemptRef) ? 'complete' : 'pending';
}

/** The checklist as shown: each item's current status (no entry = pending) and how many are resolved. */
export function demoChecklist<E extends ChecklistEntryLike>(
  entries: readonly E[],
  sessions: readonly SessionLike[],
) {
  const latest = latestEntries(entries);
  const items = DEMO_CHECKLIST_ITEMS.map((item) => {
    const entry = item.derived ? undefined : latest.get(item.key);
    const status = item.derived
      ? derivedStatus(item.key, sessions)
      : ((entry?.status as ChecklistStatus | undefined) ?? 'pending');
    return { ...item, status, entry: entry ?? null, recorded: item.derived || Boolean(entry) };
  });
  const done = items.filter((i) => i.status !== 'pending').length;
  return { items, done, total: items.length, label: `${done} of ${items.length} done` };
}

// --- follow-ups and setup (D-8) ----------------------------------------------------------------

/** The case's earliest open follow-up and its urgency (A-06 rules), or null when none is open. */
export function demoFollowUp<F extends { status: string; dueDate: string }>(
  followUps: readonly F[],
  now: Date,
  upcomingWindowDays: number,
): (F & { state: DueState; daysOverdue: number }) | null {
  const first = followUps
    .filter((f) => f.status === 'open')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  return first
    ? { ...first, ...followUpDueState(first as unknown as FollowUpLike, now, upcomingWindowDays) }
    : null;
}

/** What still has to be arranged before the demo can run. */
export function setupGaps(
  demo: { plannedDayCount: number; counsellorStaffId: string | null },
  sessions: readonly SessionLike[],
): string[] {
  const held = live(sessions);
  const gaps: string[] = [];
  const empty = demo.plannedDayCount - new Set(held.map((s) => s.dayNumber)).size;
  if (empty > 0) gaps.push(`${empty} demo day(s) without a class`);
  const noTeacher = held.filter((s) => !s.teacherStaffId).length;
  if (noTeacher) gaps.push(`teacher not assigned for ${noTeacher} class(es)`);
  const noSubject = held.filter((s) => !s.subject).length;
  if (noSubject) gaps.push(`subject missing for ${noSubject} class(es)`);
  if (!demo.counsellorStaffId) gaps.push('no counsellor');
  return gaps;
}

// --- demo fee from the ledger (brief §5) -----------------------------------

export const DEMO_FEE_STATES = [
  'not_assessed',
  'unpaid',
  'part_paid',
  'paid',
  'waived',
  'refunded',
] as const;
export type DemoFeeState = (typeof DEMO_FEE_STATES)[number];
export const DEMO_FEE_LABELS: Record<DemoFeeState, string> = {
  not_assessed: 'No amount due recorded',
  unpaid: 'Unpaid',
  part_paid: 'Partly paid',
  paid: 'Paid (as recorded)',
  waived: 'Waived',
  refunded: 'Refunded',
};

/**
 * Demo fee from its ledger rows (charge category `demo`; voided rows ignored), never a
 * checkbox. Assessed = amount due; paid = received − refunded; balance = due − waivers,
 * discounts and credits − paid (null = no amount due recorded). First rule that applies:
 * not_assessed (no due row) · refunded (refunds took back everything received) · paid
 * (settled with money) · waived (settled without money) · part_paid · unpaid.
 */
export function demoFeeStatus(records: readonly FeeRecordLike[]) {
  const f = summariseFees(records);
  const paid = f.netReceivedPaise;
  const balance = f.balancePaise;
  const state: DemoFeeState =
    balance === null
      ? 'not_assessed'
      : f.refundedPaise > 0 && paid <= 0
        ? 'refunded'
        : balance <= 0
          ? paid > 0
            ? 'paid'
            : 'waived'
          : paid > 0
            ? 'part_paid'
            : 'unpaid';
  return {
    state,
    assessedPaise: f.duePaise,
    paidPaise: paid,
    balancePaise: balance,
    waivedPaise: f.creditAdjustmentsPaise,
    refundedPaise: f.refundedPaise,
    unverifiedCount: f.unverifiedCount,
  };
}

/** True when any session falls on an IST date within [from, to] (either bound optional). */
export function sessionsInRange(
  sessions: readonly Pick<SessionLike, 'startsAt'>[],
  from?: IsoDate,
  to?: IsoDate,
): boolean {
  if (!from && !to) return true;
  return sessions.some((s) => {
    const d = istToday(s.startsAt);
    return (!from || d >= from) && (!to || d <= to);
  });
}
