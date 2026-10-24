/**
 * Draft timetable builder (ACD-029, D-111) — pure and deterministic. Fills ONE batch's week with
 * weekly slots from the classes each subject needs, then hands them back as candidates for draft
 * patterns. Every candidate is expanded into its dated occurrences (`patternDates`) and checked
 * with `checkTimetable` against the whole centre, so the clash rules live in one place (A6).
 * A candidate with any hard conflict is rejected; preferences are allowed and reported.
 * Greedy, not optimal: it reports what it placed and what it could not, with reasons.
 */
import { checkTimetable, patternDates, teachersOf, type ConflictCode, type TimetableCheckInput, type TimetableSession } from './timetable';
import { formatClock, parseClock, WEEKDAY_NAMES } from './time';

export interface BuildSubject {
  subjectId: string;
  /** Short label for notes (subject code or name — never a person). */
  label: string;
  weeklyClasses: number;
  /** From teaching assignments, preferred teacher first. Empty = no teacher assigned. */
  teacherStaffIds: readonly string[];
}

/** The rest of the centre: everything `checkTimetable` needs, with the existing sessions. */
export type CentreTimetable = Omit<TimetableCheckInput, 'sessions' | 'onlyInvolving'> & { existing: readonly TimetableSession[] };

export interface BuildInput {
  batchId: string;
  from: string;
  to: string;
  /** ISO weekdays the batch is taught on (calendar rules). Empty = unknown. */
  teachingWeekdays: readonly number[];
  /** Classes per day from the calendar rules; null = no limit recorded. */
  maxClassesPerDay: number | null;
  dayStart: string;
  dayEnd: string;
  classMinutes: number | null;
  subjects: readonly BuildSubject[];
  /** Active rooms in a stable order; empty = no rooms recorded (slots get no room). */
  roomIds: readonly string[];
  centre: CentreTimetable;
}

export type BuildReason = ConflictCode | 'NO_TEACHER' | 'NO_TEACHING_DAYS' | 'NO_START_TIMES' | 'DAILY_LIMIT' | 'NO_DATES';

export interface PlacedSlot {
  subjectId: string;
  weekday: number;
  startTime: string;
  durationMinutes: number;
  teacherStaffId: string;
  roomId: string | null;
  /** Dated classes the slot would create (closures skipped). */
  classes: number;
  /** Preference conflicts accepted with this slot (A6). */
  preferences: ConflictCode[];
}

export interface UnplacedDemand {
  subjectId: string;
  missing: number;
  reasonCodes: BuildReason[];
}

export interface BuildResult {
  placed: PlacedSlot[];
  unplaced: UnplacedDemand[];
  notes: string[];
}

/** Plain words for each reason, shown on screen, in the system summary and to the AI. */
export const BUILD_REASON_TEXT: Record<BuildReason, string> = {
  TEACHER_OVERLAP: 'the teacher already has another class then',
  BATCH_OVERLAP: 'the batch already has a class then',
  ROOM_OVERLAP: 'every room is booked then',
  STUDENT_OVERLAP: 'a student of this batch has a class in another batch then',
  TEACHER_UNAVAILABLE: 'the teacher is marked unavailable on some of those dates',
  ON_EXCLUSION: 'a holiday or closure falls on those dates',
  CROSSES_MIDNIGHT: 'the class would run past midnight',
  INVALID_TIME: 'the time is not valid',
  DURATION_MISMATCH: 'the class length does not match the decided length',
  CLASS_LENGTH_UNKNOWN: 'the class length is not decided for this batch',
  TEACHER_WORKLOAD: 'the teacher would go over the workload cap',
  NO_TEACHER: 'no teacher is assigned to this subject in this batch',
  NO_TEACHING_DAYS: 'no teaching weekdays are recorded for these dates',
  NO_START_TIMES: 'no class fits between the day start and end',
  DAILY_LIMIT: 'the batch already has its classes-per-day limit on the free days',
  NO_DATES: 'every date of the free weekdays is a holiday or closure',
};

export function buildTimetable(input: BuildInput): BuildResult {
  const { centre, classMinutes: minutes } = input;
  const { existing, ...rules } = centre;
  const notes = new Set<string>();
  const first = parseClock(input.dayStart) ?? 0;
  const last = parseClock(input.dayEnd) ?? 0;
  const starts: string[] = [];
  for (let t = first; minutes && t + minutes <= last; t += minutes) starts.push(formatClock(t));

  if (minutes === null) notes.add('The class length is not decided for this batch, so nothing was placed.');
  if (input.teachingWeekdays.length === 0) notes.add('No teaching weekdays are recorded for these dates, so nothing was placed.');
  if (minutes !== null && starts.length === 0) notes.add(`No ${minutes}-minute class fits between ${input.dayStart} and ${input.dayEnd}.`);
  if (input.roomIds.length === 0) notes.add('No active rooms are recorded, so the drafts have no room.');

  const blocker = (s: BuildSubject): BuildReason | null =>
    minutes === null ? 'CLASS_LENGTH_UNKNOWN' : input.teachingWeekdays.length === 0 ? 'NO_TEACHING_DAYS' : s.teacherStaffIds.length === 0 ? 'NO_TEACHER' : starts.length === 0 ? 'NO_START_TIMES' : null;

  const dates = new Map(
    input.teachingWeekdays.map((weekday) => [weekday, patternDates({ weekday, from: input.from, to: input.to, batchId: input.batchId }, centre.exclusions).filter((d) => !d.skipped).map((d) => d.date)]),
  );
  const placed: PlacedSlot[] = [];
  const reserved: TimetableSession[] = []; // occurrences of the slots placed so far
  const unplaced: UnplacedDemand[] = [];

  const check = (slot: Omit<PlacedSlot, 'classes' | 'preferences'>, on: readonly string[]) => {
    const candidates: TimetableSession[] = on.map((date) => ({ id: `build-${placed.length}-${date}`, batchId: input.batchId, teacherStaffId: slot.teacherStaffId, roomId: slot.roomId, date, startTime: slot.startTime, durationMinutes: slot.durationMinutes, status: 'scheduled', sessionType: 'teaching' }));
    const day = new Set(on);
    // Overlaps compare the same date only and workload counts this teacher only, so nothing else can matter.
    const others = [...existing, ...reserved].filter((s) => day.has(s.date) || teachersOf(s).includes(slot.teacherStaffId));
    const result = checkTimetable({ ...rules, sessions: [...others, ...candidates], onlyInvolving: candidates.map((c) => c.id) });
    result.notes.forEach((n) => notes.add(n));
    return { result, candidates };
  };

  const findSlot = (s: BuildSubject, reasons: Set<BuildReason>) => {
    // Spread a subject across days before doubling up; then the lightest day; then Monday first.
    const days = input.teachingWeekdays
      .map((weekday) => ({ weekday, same: placed.filter((p) => p.weekday === weekday && p.subjectId === s.subjectId).length, all: placed.filter((p) => p.weekday === weekday).length }))
      .sort((a, b) => a.same - b.same || a.all - b.all || a.weekday - b.weekday);
    for (const { weekday, all } of days) {
      if (input.maxClassesPerDay !== null && all >= input.maxClassesPerDay) {
        reasons.add('DAILY_LIMIT');
        continue;
      }
      const on = dates.get(weekday)!;
      if (on.length === 0) {
        reasons.add('NO_DATES');
        continue;
      }
      for (const startTime of starts) {
        for (const teacherStaffId of s.teacherStaffIds) {
          const base = { subjectId: s.subjectId, weekday, startTime, durationMinutes: minutes!, teacherStaffId };
          // Without a room first: a teacher, batch or student clash rules out every room at once.
          const roomless = check({ ...base, roomId: null }, on);
          roomless.result.hard.forEach((c) => reasons.add(c.code));
          if (roomless.result.hard.length) continue;
          for (const roomId of input.roomIds.length ? input.roomIds : [null]) {
            const tried = roomId ? check({ ...base, roomId }, on) : roomless;
            tried.result.hard.forEach((c) => reasons.add(c.code));
            if (tried.result.hard.length) continue;
            reserved.push(...tried.candidates);
            return { ...base, roomId, classes: on.length, preferences: [...new Set(tried.result.preferences.map((c) => c.code))] };
          }
        }
      }
    }
    return null;
  };

  // Most constrained first: fewest teachers, then most classes; ties by id so the output is stable.
  const order = [...input.subjects].sort((a, b) => a.teacherStaffIds.length - b.teacherStaffIds.length || b.weeklyClasses - a.weeklyClasses || a.subjectId.localeCompare(b.subjectId));
  for (const s of order) {
    const block = blocker(s);
    if (block) {
      unplaced.push({ subjectId: s.subjectId, missing: s.weeklyClasses, reasonCodes: [block] });
      continue;
    }
    const reasons = new Set<BuildReason>();
    let missing = 0;
    for (let k = 0; k < s.weeklyClasses; k += 1) {
      const slot = findSlot(s, reasons);
      if (slot) placed.push(slot);
      else missing += 1;
    }
    if (missing) unplaced.push({ subjectId: s.subjectId, missing, reasonCodes: [...reasons].sort() });
  }
  return { placed, unplaced, notes: [...notes] };
}

/** The rule-written summary used when the AI note is unavailable (and the facts the AI is given). */
export function summariseBuild(result: BuildResult, subjects: readonly BuildSubject[]): string {
  const label = (id: string) => subjects.find((s) => s.subjectId === id)?.label ?? 'A subject';
  const wanted = subjects.reduce((n, s) => n + s.weeklyClasses, 0);
  const lines = [`Placed ${result.placed.length} of ${wanted} weekly classes as draft patterns; nothing is published yet.`];
  const days = [...new Set(result.placed.map((p) => p.weekday))].sort().map((d) => WEEKDAY_NAMES[d - 1]);
  if (days.length) lines.push(`Classes fall on ${days.join(', ')}.`);
  for (const u of result.unplaced) lines.push(`${label(u.subjectId)}: ${u.missing} class${u.missing === 1 ? '' : 'es'} not placed because ${u.reasonCodes.map((c) => BUILD_REASON_TEXT[c]).join('; ')}.`);
  if (result.placed.some((p) => p.preferences.length)) lines.push('Some drafts carry warnings; check them before publishing.');
  return lines.join(' ');
}
