/**
 * Catch-up prioritisation (ACD-020) — deterministic, explainable integer scores.
 *
 * score = wRecency × recency + wChapter × chapterWeight + wAssessment × assessmentUrgency
 *   recency            3 if missed ≤ 7 days ago, 2 if ≤ 21, 1 if ≤ 60, else 0
 *                      (recent gaps first: next lessons build on them)
 *   chapterWeight      the chapter's weight 1–10 (1 when unknown)
 *   assessmentUrgency  for the nearest upcoming assessment that covers the chapter:
 *                      3 if within 3 days, 2 if within 7, 1 if within the horizon, else 0
 * Ties: earlier missed date first, then task id. Only open / in-progress tasks
 * are ranked. Every factor is returned so the order can be explained.
 */
import { daysBetween, type IsoDate } from '@elevate/shared-types';

export interface CatchupTaskInput {
  id: string;
  studentId: string;
  sessionDate: string;
  chapterId: string | null;
  chapterWeight: number | null;
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
}

export interface UpcomingAssessment {
  id: string;
  label: string;
  date: string;
  chapterIds: readonly string[];
}

export interface CatchupWeights {
  recency: number;
  chapter: number;
  assessment: number;
  /** Days ahead in which an assessment counts as upcoming. */
  horizonDays: number;
}

/** Proposed defaults (stored as an `academic.settings` row with status `proposed`). */
export const DEFAULT_CATCHUP_WEIGHTS: CatchupWeights = {
  recency: 2,
  chapter: 1,
  assessment: 3,
  horizonDays: 14,
};

export interface RankedCatchupTask {
  taskId: string;
  studentId: string;
  score: number;
  rank: number;
  factors: {
    daysSinceMissed: number;
    recencyPoints: number;
    chapterWeight: number;
    upcomingAssessment: { id: string; label: string; date: string; daysUntil: number } | null;
    assessmentPoints: number;
  };
  explanation: string;
}

function recencyPoints(days: number): number {
  if (days <= 7) return 3;
  if (days <= 21) return 2;
  if (days <= 60) return 1;
  return 0;
}

function urgencyPoints(daysUntil: number, horizon: number): number {
  if (daysUntil < 0 || daysUntil > horizon) return 0;
  if (daysUntil <= 3) return 3;
  if (daysUntil <= 7) return 2;
  return 1;
}

export function prioritiseCatchup(
  tasks: readonly CatchupTaskInput[],
  upcoming: readonly UpcomingAssessment[],
  asOf: string,
  weights: CatchupWeights = DEFAULT_CATCHUP_WEIGHTS,
): RankedCatchupTask[] {
  const scored = tasks
    .filter((t) => t.status === 'open' || t.status === 'in_progress')
    .map((t) => {
      const daysSince = Math.max(0, daysBetween(t.sessionDate as IsoDate, asOf as IsoDate));
      const rec = recencyPoints(daysSince);
      const chapterWeight = Math.min(10, Math.max(1, t.chapterWeight ?? 1));
      let nearest: RankedCatchupTask['factors']['upcomingAssessment'] = null;
      if (t.chapterId) {
        for (const a of upcoming) {
          if (!a.chapterIds.includes(t.chapterId)) continue;
          const daysUntil = daysBetween(asOf as IsoDate, a.date as IsoDate);
          if (daysUntil < 0 || daysUntil > weights.horizonDays) continue;
          if (!nearest || daysUntil < nearest.daysUntil || (daysUntil === nearest.daysUntil && a.id < nearest.id)) {
            nearest = { id: a.id, label: a.label, date: a.date, daysUntil };
          }
        }
      }
      const urgency = nearest ? urgencyPoints(nearest.daysUntil, weights.horizonDays) : 0;
      const score = weights.recency * rec + weights.chapter * chapterWeight + weights.assessment * urgency;
      const parts = [
        `missed ${daysSince} day(s) ago → recency ${rec} × ${weights.recency}`,
        `chapter weight ${chapterWeight} × ${weights.chapter}`,
        nearest
          ? `${nearest.label} in ${nearest.daysUntil} day(s) → urgency ${urgency} × ${weights.assessment}`
          : 'no assessment on this chapter within the horizon',
      ];
      return {
        task: t,
        score,
        factors: {
          daysSinceMissed: daysSince,
          recencyPoints: rec,
          chapterWeight,
          upcomingAssessment: nearest,
          assessmentPoints: urgency,
        },
        explanation: `Score ${score}: ${parts.join('; ')}.`,
      };
    });
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.task.sessionDate.localeCompare(b.task.sessionDate) ||
      a.task.id.localeCompare(b.task.id),
  );
  return scored.map((s, i) => ({
    taskId: s.task.id,
    studentId: s.task.studentId,
    score: s.score,
    rank: i + 1,
    factors: s.factors,
    explanation: s.explanation,
  }));
}
