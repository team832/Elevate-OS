/**
 * Timetable conflict detection (ACD-012) — pure, reports only, never auto-fixes.
 *
 * HARD constraints (any one makes the timetable infeasible):
 *   TEACHER_OVERLAP, BATCH_OVERLAP, ROOM_OVERLAP, ON_EXCLUSION, CROSSES_MIDNIGHT,
 *   DURATION_MISMATCH when the class length is locked/approved,
 *   TEACHER_WORKLOAD when the configured cap says `enforcement: 'hard'`.
 * PREFERENCES (warnings; never block):
 *   DURATION_MISMATCH when the class length is provisional/proposed,
 *   CLASS_LENGTH_UNKNOWN, TEACHER_WORKLOAD under a `warning` cap.
 *
 * The result is `feasible` (no hard conflicts) or `infeasible` with reasons.
 * It never claims a timetable is optimal.
 */
import { intervalsOverlap, parseClock, weekStart } from './time';

export interface TimetableSession {
  id: string;
  batchId: string;
  teacherStaffId: string | null;
  roomId: string | null;
  date: string;
  startTime: string;
  durationMinutes: number;
  status: 'scheduled' | 'held' | 'cancelled' | 'rescheduled';
  sessionType: 'teaching' | 'practice' | 'catch_up' | 'test' | 'discussion';
}

export interface DatedExclusion {
  date: string;
  /** null = centre-wide. */
  batchId: string | null;
  kind: 'holiday' | 'school_exam' | 'exam_blackout' | 'other';
  label: string;
  status: string;
}

export interface ClassLength {
  minutes: number | null;
  status: string;
}

export interface WorkloadCap {
  maxMinutesPerDay: number | null;
  maxMinutesPerWeek: number | null;
  enforcement: 'warning' | 'hard';
}

export type ConflictCode =
  | 'TEACHER_OVERLAP'
  | 'BATCH_OVERLAP'
  | 'ROOM_OVERLAP'
  | 'ON_EXCLUSION'
  | 'CROSSES_MIDNIGHT'
  | 'INVALID_TIME'
  | 'DURATION_MISMATCH'
  | 'CLASS_LENGTH_UNKNOWN'
  | 'TEACHER_WORKLOAD';

export interface Conflict {
  code: ConflictCode;
  severity: 'hard' | 'preference';
  sessionIds: string[];
  date: string | null;
  message: string;
}

export interface TimetableCheckInput {
  sessions: readonly TimetableSession[];
  exclusions: readonly DatedExclusion[];
  /** Class length per batch (batch override → course). Missing batch = unknown. */
  classLengthByBatch: Readonly<Record<string, ClassLength>>;
  workloadCap: WorkloadCap | null;
  /** Report only conflicts that involve at least one of these sessions (e.g. new candidates). */
  onlyInvolving?: readonly string[];
}

export interface TimetableCheckResult {
  verdict: 'feasible' | 'infeasible';
  hard: Conflict[];
  preferences: Conflict[];
  checkedSessions: number;
  notes: string[];
}

const ACTIVE = new Set(['scheduled', 'held']);
const LENGTH_BOUND_TYPES = new Set(['teaching', 'practice']);
const FIRM_STATUSES = new Set(['locked', 'approved']);

export function checkTimetable(input: TimetableCheckInput): TimetableCheckResult {
  const conflicts: Conflict[] = [];
  const notes: string[] = [];
  const sessions = input.sessions.filter((s) => ACTIVE.has(s.status));
  const spans = new Map<string, { start: number; end: number }>();

  for (const s of sessions) {
    const start = parseClock(s.startTime);
    if (start === null || !Number.isInteger(s.durationMinutes) || s.durationMinutes <= 0) {
      conflicts.push({
        code: 'INVALID_TIME',
        severity: 'hard',
        sessionIds: [s.id],
        date: s.date,
        message: `Session has an invalid start time "${s.startTime}" or duration ${s.durationMinutes}.`,
      });
      continue;
    }
    const end = start + s.durationMinutes;
    if (end > 24 * 60) {
      conflicts.push({
        code: 'CROSSES_MIDNIGHT',
        severity: 'hard',
        sessionIds: [s.id],
        date: s.date,
        message: `Session starting ${s.startTime} for ${s.durationMinutes} min runs past midnight.`,
      });
    }
    spans.set(s.id, { start, end });
  }

  // Pairwise overlaps per date (half-open intervals: touching is not overlapping).
  const byDate = new Map<string, TimetableSession[]>();
  for (const s of sessions) {
    if (!spans.has(s.id)) continue;
    const list = byDate.get(s.date) ?? [];
    list.push(s);
    byDate.set(s.date, list);
  }
  for (const [date, list] of byDate) {
    list.sort((a, b) => spans.get(a.id)!.start - spans.get(b.id)!.start || a.id.localeCompare(b.id));
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i]!;
      const sa = spans.get(a.id)!;
      for (let j = i + 1; j < list.length; j += 1) {
        const b = list[j]!;
        const sb = spans.get(b.id)!;
        if (sb.start >= sa.end) break; // sorted by start: nothing later can overlap a
        if (!intervalsOverlap(sa.start, sa.end, sb.start, sb.end)) continue;
        const pair = [a.id, b.id];
        if (a.teacherStaffId && a.teacherStaffId === b.teacherStaffId) {
          conflicts.push({
            code: 'TEACHER_OVERLAP',
            severity: 'hard',
            sessionIds: pair,
            date,
            message: 'The same teacher is booked for two overlapping sessions.',
          });
        }
        if (a.batchId === b.batchId) {
          conflicts.push({
            code: 'BATCH_OVERLAP',
            severity: 'hard',
            sessionIds: pair,
            date,
            message: 'The same batch has two overlapping sessions.',
          });
        }
        if (a.roomId && a.roomId === b.roomId) {
          conflicts.push({
            code: 'ROOM_OVERLAP',
            severity: 'hard',
            sessionIds: pair,
            date,
            message: 'The same room is booked for two overlapping sessions.',
          });
        }
      }
    }
  }

  // Sessions on closures (exam blackouts apply to assessments, not classes).
  for (const s of sessions) {
    for (const x of input.exclusions) {
      if (x.kind === 'exam_blackout' || x.date !== s.date) continue;
      if (x.batchId !== null && x.batchId !== s.batchId) continue;
      conflicts.push({
        code: 'ON_EXCLUSION',
        severity: 'hard',
        sessionIds: [s.id],
        date: s.date,
        message: `Session falls on "${x.label}" (${x.kind}, ${x.status}).`,
      });
    }
  }

  // Duration vs the class length (teaching and practice classes only, BR-ACD-4).
  const unknownBatches = new Set<string>();
  for (const s of sessions) {
    if (!LENGTH_BOUND_TYPES.has(s.sessionType)) continue;
    const length = input.classLengthByBatch[s.batchId];
    if (!length || length.minutes === null) {
      unknownBatches.add(s.batchId);
      continue;
    }
    if (s.durationMinutes !== length.minutes) {
      const firm = FIRM_STATUSES.has(length.status);
      conflicts.push({
        code: 'DURATION_MISMATCH',
        severity: firm ? 'hard' : 'preference',
        sessionIds: [s.id],
        date: s.date,
        message: `Session is ${s.durationMinutes} min; the ${length.status} class length is ${length.minutes} min.`,
      });
    }
  }
  for (const batchId of unknownBatches) {
    conflicts.push({
      code: 'CLASS_LENGTH_UNKNOWN',
      severity: 'preference',
      sessionIds: sessions.filter((s) => s.batchId === batchId).map((s) => s.id),
      date: null,
      message: 'Class length is not decided for this batch, so durations were not checked.',
    });
  }

  // Teacher workload against the configured cap.
  const cap = input.workloadCap;
  if (!cap || (cap.maxMinutesPerDay === null && cap.maxMinutesPerWeek === null)) {
    notes.push('Teacher workload cap is not configured; workload was not checked.');
  } else {
    const severity = cap.enforcement === 'hard' ? 'hard' : 'preference';
    const totals = new Map<string, { minutes: number; ids: string[] }>();
    const add = (key: string, s: TimetableSession) => {
      const t = totals.get(key) ?? { minutes: 0, ids: [] };
      t.minutes += s.durationMinutes;
      t.ids.push(s.id);
      totals.set(key, t);
    };
    for (const s of sessions) {
      if (!s.teacherStaffId) continue;
      if (cap.maxMinutesPerDay !== null) add(`day|${s.teacherStaffId}|${s.date}`, s);
      if (cap.maxMinutesPerWeek !== null) add(`week|${s.teacherStaffId}|${weekStart(s.date)}`, s);
    }
    for (const [key, t] of totals) {
      const [period, , when] = key.split('|') as [string, string, string];
      const limit = period === 'day' ? cap.maxMinutesPerDay! : cap.maxMinutesPerWeek!;
      if (t.minutes > limit) {
        conflicts.push({
          code: 'TEACHER_WORKLOAD',
          severity,
          sessionIds: t.ids,
          date: when,
          message: `Teacher has ${t.minutes} min in the ${period === 'day' ? 'day' : 'week starting'} ${when}; the cap is ${limit} min (${cap.enforcement}).`,
        });
      }
    }
  }

  const filter = input.onlyInvolving ? new Set(input.onlyInvolving) : null;
  const relevant = filter ? conflicts.filter((c) => c.sessionIds.some((id) => filter.has(id))) : conflicts;
  const hard = relevant.filter((c) => c.severity === 'hard');
  const preferences = relevant.filter((c) => c.severity === 'preference');
  return {
    verdict: hard.length === 0 ? 'feasible' : 'infeasible',
    hard,
    preferences,
    checkedSessions: sessions.length,
    notes,
  };
}
