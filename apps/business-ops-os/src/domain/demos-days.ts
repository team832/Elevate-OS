/**
 * Demo sessions and days (docs/parts/admissions-demos.md D-1 … D-3): vocabularies, day summary,
 * progress, views, next class and mock status. Pure; re-exported by domain/demos.ts.
 */
import { istToday, type IsoDate } from './dates';

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
export const RECORDED: readonly string[] = [...RECORDABLE_ATTENDANCE, 'not_recorded'];
export const isPending = (s: Pick<SessionLike, 'attendance'>) => PENDING.includes(s.attendance);
/** A class counts as attended when the student was present or late. */
export const isAttended = (s: Pick<SessionLike, 'attendance'>) =>
  s.attendance === 'present' || s.attendance === 'late';
export const live = <S extends Pick<SessionLike, 'attendance'>>(sessions: readonly S[]) =>
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
