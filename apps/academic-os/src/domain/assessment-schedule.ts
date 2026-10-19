/**
 * Assessment scheduling constraints (ACD-012, ACD-016, ACD-024, ACD-026) — pure.
 *
 * For each candidate assessment (test day + optional discussion day) it reports:
 *   HARD  CLASS_CLASH        overlaps a class of the same batch (times known)
 *   HARD  ASSESSMENT_CLASH   overlaps another assessment of the batch (times known)
 *   HARD  BLACKOUT           test or discussion day inside a blackout window
 *                            (exam date, mock phase, closure) — `unverified`
 *                            is carried through so a provisional exam date stays flagged
 *   HARD  BEFORE_PREREQUISITE test on/before its prerequisites' planned completion
 *   MIN_GAP                  closer than the configured minimum gap (hard or warning per config)
 *   PREF  SAME_DAY_TIME_UNKNOWN another class/assessment the same day, times not set
 * Verdict: `feasible` (no hard conflicts) or `infeasible`. Never "optimal".
 */
import { daysBetween, isIsoDate, type IsoDate } from '@elevate/shared-types';
import { intervalsOverlap, parseClock } from './time';

export interface ScheduledItem {
  id: string;
  label: string;
  date: string;
  startTime: string | null;
  durationMinutes: number | null;
}

export interface AssessmentCandidate extends ScheduledItem {
  /** Discussion day (e.g. the Sunday after a Saturday test); null = none. */
  discussionDate: string | null;
  /** Latest planned completion date of the prerequisite lessons; null = unknown. */
  prerequisiteCompletion: string | null;
}

export interface BlackoutWindow {
  label: string;
  kind: 'exam' | 'mock_phase' | 'closure' | 'other';
  from: string;
  to: string;
  /** e.g. `unverified`, `proposed`, `provisional`, `official`. */
  status: string;
}

export interface GapRule {
  minDays: number;
  enforcement: 'warning' | 'hard';
}

export interface AssessmentScheduleInput {
  candidates: readonly AssessmentCandidate[];
  /** Other assessments of the same batch already scheduled (not the candidates themselves). */
  otherAssessments: readonly ScheduledItem[];
  /** Classes of the same batch (scheduled or held). */
  classes: readonly ScheduledItem[];
  blackouts: readonly BlackoutWindow[];
  minGap: GapRule | null;
}

export type ScheduleCode =
  | 'CLASS_CLASH'
  | 'ASSESSMENT_CLASH'
  | 'BLACKOUT'
  | 'BEFORE_PREREQUISITE'
  | 'MIN_GAP'
  | 'SAME_DAY_TIME_UNKNOWN'
  | 'INVALID_DATE';

export interface ScheduleConflict {
  code: ScheduleCode;
  severity: 'hard' | 'preference';
  candidateId: string;
  otherId: string | null;
  date: string;
  /** True when the conflict rests on an unverified date (e.g. a provisional exam date). */
  unverified: boolean;
  message: string;
}

export interface AssessmentScheduleResult {
  verdict: 'feasible' | 'infeasible';
  hard: ScheduleConflict[];
  preferences: ScheduleConflict[];
  /** Candidate ids with at least one hard conflict. */
  conflictingCandidates: string[];
}

function span(item: ScheduledItem): { start: number; end: number } | null {
  const start = parseClock(item.startTime);
  if (start === null || item.durationMinutes === null) return null;
  return { start, end: start + item.durationMinutes };
}

export function checkAssessmentSchedule(input: AssessmentScheduleInput): AssessmentScheduleResult {
  const out: ScheduleConflict[] = [];
  const push = (c: Omit<ScheduleConflict, 'unverified'> & { unverified?: boolean }) =>
    out.push({ unverified: false, ...c });

  const everyOther: ScheduledItem[] = [...input.otherAssessments];
  for (const cand of input.candidates) {
    if (!isIsoDate(cand.date) || (cand.discussionDate !== null && !isIsoDate(cand.discussionDate))) {
      push({ code: 'INVALID_DATE', severity: 'hard', candidateId: cand.id, otherId: null, date: cand.date, message: 'Invalid test or discussion date.' });
      continue;
    }
    const mine = span(cand);

    // Clashes with classes and other assessments on the same day.
    const sameDay = (items: readonly ScheduledItem[], code: 'CLASS_CLASH' | 'ASSESSMENT_CLASH') => {
      for (const other of items) {
        if (other.id === cand.id || other.date !== cand.date) continue;
        const theirs = span(other);
        if (mine && theirs) {
          if (intervalsOverlap(mine.start, mine.end, theirs.start, theirs.end)) {
            push({ code, severity: 'hard', candidateId: cand.id, otherId: other.id, date: cand.date, message: `${cand.label} overlaps ${other.label} on ${cand.date}.` });
          }
        } else {
          push({ code: 'SAME_DAY_TIME_UNKNOWN', severity: 'preference', candidateId: cand.id, otherId: other.id, date: cand.date, message: `${cand.label} and ${other.label} are on ${cand.date}; clock times are not set, so an overlap cannot be ruled out.` });
        }
      }
    };
    sameDay(input.classes, 'CLASS_CLASH');
    // Candidates are also checked against each other (a weekend map is a set of
    // candidates); each candidate pair is reported once.
    sameDay(
      [...everyOther, ...input.candidates.filter((c) => c.id > cand.id)],
      'ASSESSMENT_CLASH',
    );

    // Blackouts on the test day or the discussion day.
    const days = [cand.date, ...(cand.discussionDate ? [cand.discussionDate] : [])];
    for (const b of input.blackouts) {
      for (const d of days) {
        if (d >= b.from && d <= b.to) {
          const unverified = b.status === 'unverified' || b.status === 'assumed';
          push({
            code: 'BLACKOUT',
            severity: 'hard',
            candidateId: cand.id,
            otherId: null,
            date: d,
            unverified,
            message: `${cand.label} ${d === cand.date ? 'test' : 'discussion'} on ${d} falls in "${b.label}" (${b.kind}, ${b.status}${unverified ? ' — date not verified' : ''}).`,
          });
        }
      }
    }

    // Prerequisites must be complete (as planned) before the test day.
    if (cand.prerequisiteCompletion && cand.date <= cand.prerequisiteCompletion) {
      push({ code: 'BEFORE_PREREQUISITE', severity: 'hard', candidateId: cand.id, otherId: null, date: cand.date, message: `${cand.label} on ${cand.date} is not after its prerequisites' planned completion (${cand.prerequisiteCompletion}).` });
    }

    // Minimum gap to other assessments (configurable).
    if (input.minGap && input.minGap.minDays > 0) {
      const severity = input.minGap.enforcement === 'hard' ? 'hard' : 'preference';
      const others = [...everyOther, ...input.candidates.filter((c) => c.id > cand.id)];
      for (const other of others) {
        if (!isIsoDate(other.date)) continue;
        const gap = Math.abs(daysBetween(cand.date as IsoDate, other.date as IsoDate));
        if (gap < input.minGap.minDays) {
          push({ code: 'MIN_GAP', severity, candidateId: cand.id, otherId: other.id, date: cand.date, message: `${cand.label} is ${gap} day(s) from ${other.label}; the minimum gap is ${input.minGap.minDays} (${input.minGap.enforcement}).` });
        }
      }
    }
  }

  const hard = out.filter((c) => c.severity === 'hard');
  const candidateIds = new Set(input.candidates.map((c) => c.id));
  const conflicting = new Set<string>();
  for (const c of hard) {
    conflicting.add(c.candidateId);
    if (c.otherId && candidateIds.has(c.otherId)) conflicting.add(c.otherId);
  }
  return {
    verdict: hard.length === 0 ? 'feasible' : 'infeasible',
    hard,
    preferences: out.filter((c) => c.severity === 'preference'),
    conflictingCandidates: [...conflicting].sort(),
  };
}
