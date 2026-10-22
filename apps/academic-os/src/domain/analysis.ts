/**
 * Assessment analysis (brief 16) — pure. The average uses scored students only:
 * absent, exempt, withheld and pending (no attempt) are counted beside it, never as 0.
 * Trends compare only assessments of the same kind, subject and maximum.
 */
import { formatMarks, type MarkUnits } from './marks';
import type { ResultState } from './scoring';

export interface AnalysisRow {
  state: ResultState;
  totalUnits: MarkUnits | null;
  maxUnits: MarkUnits;
}

export interface AssessmentAnalysis {
  /** Students expected to sit (active in the batch). */
  eligible: number;
  scored: number;
  absent: number;
  exempt: number;
  withheld: number;
  /** Eligible students with no result row (marking pending). */
  pending: number;
  mean: string | null;
  highest: string | null;
  lowest: string | null;
  max: string | null;
  /** mean ÷ max × 100 (1 dp); null when nobody is scored or the maximum is 0. */
  meanPercent: number | null;
}

export function analyseAssessment(rows: readonly AnalysisRow[], eligible: number): AssessmentAnalysis {
  const scored = rows.filter((r) => r.state === 'scored' && r.totalUnits !== null).map((r) => r.totalUnits!);
  const count = (state: ResultState) => rows.filter((r) => r.state === state).length;
  const maxUnits = rows[0]?.maxUnits ?? null;
  const sum = scored.reduce((a, v) => a + v, 0);
  const meanUnits = scored.length ? Math.sign(sum) * Math.floor((2 * Math.abs(sum) + scored.length) / (2 * scored.length)) : null;
  return {
    eligible,
    scored: scored.length,
    absent: count('absent'),
    exempt: count('exempt'),
    withheld: count('withheld'),
    pending: Math.max(0, eligible - rows.length),
    mean: meanUnits === null ? null : formatMarks(meanUnits),
    highest: scored.length ? formatMarks(Math.max(...scored)) : null,
    lowest: scored.length ? formatMarks(Math.min(...scored)) : null,
    max: maxUnits === null ? null : formatMarks(maxUnits),
    meanPercent: meanUnits === null || !maxUnits ? null : Math.round((meanUnits / maxUnits) * 1000) / 10,
  };
}

type Comparable = { kind: string; subjectId: string | null; maxUnits: MarkUnits };

/** Same kind, subject and maximum = comparable; everything else is shown as "not comparable". */
export function splitComparable<T extends Comparable>(current: Comparable, all: readonly T[]) {
  const same = (x: T) => x.kind === current.kind && x.subjectId === current.subjectId && x.maxUnits === current.maxUnits;
  return { comparable: all.filter(same), notComparable: all.filter((x) => !same(x)) };
}
