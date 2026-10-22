/**
 * Student progress (ACD-021): attendance summaries, missed classes and
 * assessment trends. Missing data is reported as missing, never as zero.
 */
export type AttendanceStatus = 'present' | 'partial' | 'late' | 'absent' | 'excused';

export interface AttendanceSummary {
  heldSessions: number;
  recorded: number;
  notRecorded: number;
  present: number;
  late: number;
  partial: number;
  absent: number;
  excused: number;
  /**
   * attended ÷ (recorded − excused) × 100, 1 dp, under the AttendanceRule (default: late attends, excused left out).
   * null when nothing countable is recorded (missing, not 0 %).
   */
  ratePercent: number | null;
}

/** Setting `attendance.denominator`. */
export interface AttendanceRule {
  lateCountsAsAttended: boolean;
  excludeExcused: boolean;
}

export const DEFAULT_ATTENDANCE_RULE: AttendanceRule = { lateCountsAsAttended: true, excludeExcused: true };

/** Plain-words definition of the attendance rate under a rule (shown on screens and reports). */
export function attendanceDefinition(rule: AttendanceRule): string {
  const attended = rule.lateCountsAsAttended ? 'present, late or partial' : 'present or partial (late is not attended)';
  const excused = rule.excludeExcused ? 'Excused sessions are left out.' : 'Excused sessions count as not attended.';
  return `Attended = ${attended}, out of delivered (held) sessions with a recorded mark within the student's placement dates; cancelled and future sessions are left out. ${excused} Delivered sessions with no mark are shown as not recorded, never as absent.`;
}

/**
 * Summarise attendance for a set of HELD sessions. `marks` are the recorded
 * rows (at most one per session). Sessions without a row are `notRecorded`
 * and are excluded from the rate rather than counted as absences.
 */
export function summariseAttendance(
  heldSessionIds: readonly string[],
  marks: readonly { sessionId: string; status: AttendanceStatus }[],
  rule: AttendanceRule = DEFAULT_ATTENDANCE_RULE,
): AttendanceSummary {
  const held = new Set(heldSessionIds);
  const counted = marks.filter((m) => held.has(m.sessionId));
  const count = (s: AttendanceStatus) => counted.filter((m) => m.status === s).length;
  const present = count('present');
  const late = count('late');
  const partial = count('partial');
  const absent = count('absent');
  const excused = count('excused');
  const recorded = counted.length;
  const denominator = recorded - (rule.excludeExcused ? excused : 0);
  const attended = present + partial + (rule.lateCountsAsAttended ? late : 0);
  return {
    heldSessions: held.size,
    recorded,
    notRecorded: held.size - new Set(counted.map((m) => m.sessionId)).size,
    present,
    late,
    partial,
    absent,
    excused,
    ratePercent: denominator <= 0 ? null : Math.round((attended / denominator) * 1000) / 10,
  };
}

export interface MissedClass {
  sessionId: string;
  date: string;
  chapterId: string | null;
  reason: 'absent' | 'excused' | 'late_joiner';
}

/**
 * Classes a student missed in their batch: held sessions before the enrolment
 * start (late joiner) and held sessions marked absent or excused. Sessions with
 * no attendance row are counted in `unrecorded`, not as missed.
 */
export function findMissedClasses(
  enrolmentStart: string | null,
  heldSessions: readonly { id: string; date: string; chapterId: string | null }[],
  marks: readonly { sessionId: string; status: AttendanceStatus }[],
): { missed: MissedClass[]; unrecorded: number } {
  const byId = new Map(marks.map((m) => [m.sessionId, m.status]));
  const missed: MissedClass[] = [];
  let unrecorded = 0;
  for (const s of [...heldSessions].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    if (enrolmentStart && s.date < enrolmentStart) {
      missed.push({ sessionId: s.id, date: s.date, chapterId: s.chapterId, reason: 'late_joiner' });
      continue;
    }
    const status = byId.get(s.id);
    if (status === undefined) unrecorded += 1;
    else if (status === 'absent' || status === 'excused') {
      missed.push({ sessionId: s.id, date: s.date, chapterId: s.chapterId, reason: status });
    }
  }
  return { missed, unrecorded };
}

export interface TrendPoint {
  /** Assessment date (for ordering). */
  date: string;
  /** Score as a percentage of the maximum (0–100). */
  percent: number;
}

export interface TrendOptions {
  /** Use the most recent N results (default 5). */
  lastN: number;
  /** Fewer usable results than this → insufficient data (default 3). */
  minPoints: number;
  /** |slope| below this many percentage points per assessment is `flat` (default 1). */
  flatThreshold: number;
}

export const DEFAULT_TREND_OPTIONS: TrendOptions = { lastN: 5, minPoints: 3, flatThreshold: 1 };

export type TrendResult =
  | { status: 'insufficient_data'; reason: string; pointsUsed: number }
  | {
      status: 'ok';
      /** Least-squares slope in percentage points per assessment (2 dp). */
      slope: number;
      direction: 'improving' | 'declining' | 'flat';
      pointsUsed: number;
      /** Mean percentage of the points used (1 dp). */
      mean: number;
    };

/**
 * Least-squares slope over the last N results, x = 0…n−1 in date order (each
 * assessment is one step; calendar gaps are deliberately ignored). Absent
 * attempts are not points. With fewer than `minPoints` results, or when every
 * point has the same x, the answer is "insufficient data" — never a trend.
 */
export function assessmentTrend(
  points: readonly TrendPoint[],
  options: Partial<TrendOptions> = {},
): TrendResult {
  const opts = { ...DEFAULT_TREND_OPTIONS, ...options };
  // Negative percentages are real under negative marking; above 100 % is impossible.
  const valid = points.filter((p) => Number.isFinite(p.percent) && p.percent <= 100);
  const used = [...valid].sort((a, b) => a.date.localeCompare(b.date)).slice(-opts.lastN);
  if (used.length < opts.minPoints) {
    return {
      status: 'insufficient_data',
      reason: `${used.length} result(s); at least ${opts.minPoints} are needed for a trend.`,
      pointsUsed: used.length,
    };
  }
  const n = used.length;
  const meanX = (n - 1) / 2;
  const meanY = used.reduce((a, p) => a + p.percent, 0) / n;
  let sxy = 0;
  let sxx = 0;
  used.forEach((p, i) => {
    sxy += (i - meanX) * (p.percent - meanY);
    sxx += (i - meanX) ** 2;
  });
  if (sxx === 0) {
    return { status: 'insufficient_data', reason: 'No spread in the x values.', pointsUsed: n };
  }
  const slope = Math.round((sxy / sxx) * 100) / 100;
  const direction =
    Math.abs(slope) < opts.flatThreshold ? 'flat' : slope > 0 ? 'improving' : 'declining';
  return { status: 'ok', slope, direction, pointsUsed: n, mean: Math.round(meanY * 10) / 10 };
}

export interface SupportSignal {
  kind: 'absence_streak' | 'overdue_catch_up' | 'declining_scores';
  text: string;
}

/**
 * Transparent support indicators (brief 14): raw facts with no invented threshold.
 * - absence streak: consecutive most-recent recorded marks that are absent (unrecorded sessions skipped);
 * - overdue catch-up: open tasks past the due date staff set;
 * - declining comparable scores: the least-squares trend (setting progress.trend) over same-kind, same-max results.
 */
export function supportSignals(input: {
  delivered: readonly { date: string; status: AttendanceStatus | null }[];
  overdueCatchup: number;
  declining: { label: string; slope: number; pointsUsed: number } | null;
}): SupportSignal[] {
  const signals: SupportSignal[] = [];
  const recorded = [...input.delivered].filter((d) => d.status !== null).sort((a, b) => b.date.localeCompare(a.date));
  const streak = recorded.findIndex((d) => d.status !== 'absent');
  const n = streak === -1 ? recorded.length : streak;
  if (n > 0) signals.push({ kind: 'absence_streak', text: `Absent at the last ${n} recorded class${n === 1 ? '' : 'es'} (since ${recorded[n - 1]!.date}).` });
  if (input.overdueCatchup > 0) signals.push({ kind: 'overdue_catch_up', text: `${input.overdueCatchup} catch-up task${input.overdueCatchup === 1 ? '' : 's'} past the due date.` });
  if (input.declining) {
    signals.push({ kind: 'declining_scores', text: `Scores declining across ${input.declining.pointsUsed} comparable results (${input.declining.label}): ${input.declining.slope} percentage points per assessment.` });
  }
  return signals;
}
