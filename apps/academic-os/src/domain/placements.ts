/**
 * Batch placement rules (ACD-019, owner brief §8) — pure.
 *
 * - A placement is an effective-dated batch membership of ONE enrolment; ending one never
 *   touches another enrolment of the same student.
 * - Seats: a batch with a seat limit is full when the placements holding a seat on or after
 *   the start date reach it. No limit (null) = never full.
 * - Clash: two live sessions (scheduled or held) on the same date whose
 *   [start, start + duration) intervals overlap. Only sessions on/after `from` count.
 * - Transfer: the old placement ends the day before the effective date.
 */
import { addDays, type IsoDate } from '@elevate/shared-types';
import { intervalsOverlap, parseClock } from './time';

export interface PlacementSession {
  id: string;
  batchId: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  status: string;
}

export interface SessionClash {
  date: string;
  existing: PlacementSession;
  incoming: PlacementSession;
}

export function isBatchFull(capacity: number | null, seatsTaken: number): boolean {
  return capacity !== null && seatsTaken >= capacity;
}

export function findSessionClashes(
  existing: readonly PlacementSession[],
  incoming: readonly PlacementSession[],
  from: string,
): SessionClash[] {
  const live = (s: PlacementSession) => s.date >= from && (s.status === 'scheduled' || s.status === 'held');
  const clashes: SessionClash[] = [];
  for (const a of existing.filter(live)) {
    const aStart = parseClock(a.startTime);
    for (const b of incoming.filter(live)) {
      const bStart = parseClock(b.startTime);
      if (a.date !== b.date || aStart === null || bStart === null) continue;
      if (intervalsOverlap(aStart, aStart + a.durationMinutes, bStart, bStart + b.durationMinutes)) {
        clashes.push({ date: a.date, existing: a, incoming: b });
      }
    }
  }
  return clashes;
}

/** Last day in the old batch for a transfer effective on `effectiveDate`. */
export function transferEndDate(effectiveDate: string): string {
  return addDays(effectiveDate as IsoDate, -1);
}

/** The enrolment list tab a row belongs to (a paused enrolment stays under placed/awaiting with its status shown). */
export function enrolmentView(status: string, hasOpenPlacement: boolean): 'awaiting' | 'placed' | 'ended' {
  if (status === 'withdrawn' || status === 'completed') return 'ended';
  return hasOpenPlacement ? 'placed' : 'awaiting';
}

/** Where an assignment stands on `day`, by its dates only (status is not used). */
export function assignmentPhase(startDate: string | null, endDate: string | null, day: string): 'upcoming' | 'current' | 'ended' {
  if (startDate && startDate > day) return 'upcoming';
  return endDate && endDate < day ? 'ended' : 'current';
}
