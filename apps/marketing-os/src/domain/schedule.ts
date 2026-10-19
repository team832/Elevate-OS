/**
 * Schedule-conflict detection (MKT-015, MKT-016, MKT-017; docs/ALGORITHMS.md §5).
 *
 * Hard constraints (scheduling is refused):
 *   NOT_APPROVED  — the content has no valid approval for its current version (AP-001).
 *   IN_PAST       — the slot is earlier than now.
 *   CADENCE_DAY / CADENCE_WEEK with enforcement `block` (e.g. LI: max 1/day, 4/week, CH-005).
 * Warnings (scheduling proceeds, the warning is shown and returned):
 *   SLOT_COLLISION — same account, another scheduled placement within ±windowMinutes.
 *   CADENCE_DAY / CADENCE_WEEK with enforcement `warn` (proposed cadence targets, OD-007).
 *   STAGGER_SAME_DAY — same idea on another account the same IST day, not in one collab.
 */
import { istDate, weekStart } from './week';
import type { CadenceEnforcement, SettingStatus } from './vocabulary';

export interface ScheduledSlot {
  placementId: string;
  placementCode: string | null;
  ideaId: string | null;
  accountCode: string;
  at: Date;
  groupId: string | null;
}

export interface ScheduleCandidate extends ScheduledSlot {
  approval: { valid: boolean; reason?: string };
}

export interface AccountCadence {
  accountCode: string;
  maxPerDay: number | null;
  maxPerWeek: number | null;
  enforcement: CadenceEnforcement;
  status: SettingStatus;
}

export interface ScheduleConfig {
  /** Two placements on one account closer than this collide (default 60). */
  slotWindowMinutes: number;
  /** MKT-016 stagger warning on/off (default on). */
  staggerWarning: boolean;
}

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  slotWindowMinutes: 60,
  staggerWarning: true,
};

export type ConflictCode =
  | 'NOT_APPROVED'
  | 'IN_PAST'
  | 'SLOT_COLLISION'
  | 'CADENCE_DAY'
  | 'CADENCE_WEEK'
  | 'STAGGER_SAME_DAY';

export interface ScheduleConflict {
  code: ConflictCode;
  severity: 'hard' | 'warning';
  message: string;
  accountCode: string;
  relatedPlacementIds: string[];
}

export interface ScheduleCheckResult {
  hard: ScheduleConflict[];
  warnings: ScheduleConflict[];
}

export function detectScheduleConflicts(
  candidate: ScheduleCandidate,
  existing: readonly ScheduledSlot[],
  cadences: readonly AccountCadence[],
  config: ScheduleConfig = DEFAULT_SCHEDULE_CONFIG,
  now: Date | null = null,
): ScheduleCheckResult {
  if (!(config.slotWindowMinutes >= 0)) throw new RangeError('slotWindowMinutes must be ≥ 0');
  if (Number.isNaN(candidate.at.getTime())) throw new RangeError('Invalid schedule time');
  const out: ScheduleCheckResult = { hard: [], warnings: [] };
  const push = (c: ScheduleConflict) => (c.severity === 'hard' ? out.hard : out.warnings).push(c);
  const others = existing.filter((e) => e.placementId !== candidate.placementId);
  const sameAccount = others.filter((e) => e.accountCode === candidate.accountCode);
  const day = istDate(candidate.at);
  const week = weekStart(day);

  if (!candidate.approval.valid) {
    push({
      code: 'NOT_APPROVED',
      severity: 'hard',
      message:
        candidate.approval.reason ??
        'Nothing is scheduled or published without an explicit approval of the current version.',
      accountCode: candidate.accountCode,
      relatedPlacementIds: [],
    });
  }
  if (now && candidate.at.getTime() < now.getTime()) {
    push({
      code: 'IN_PAST',
      severity: 'hard',
      message: 'The publish time is in the past.',
      accountCode: candidate.accountCode,
      relatedPlacementIds: [],
    });
  }

  const windowMs = config.slotWindowMinutes * 60_000;
  const colliding = sameAccount.filter(
    (e) =>
      Math.abs(e.at.getTime() - candidate.at.getTime()) < windowMs ||
      e.at.getTime() === candidate.at.getTime(),
  );
  if (colliding.length > 0) {
    push({
      code: 'SLOT_COLLISION',
      severity: 'warning',
      message: `${colliding.length} other placement(s) on ${candidate.accountCode} within ${config.slotWindowMinutes} minutes: ${colliding.map((c) => c.placementCode ?? c.placementId).join(', ')}.`,
      accountCode: candidate.accountCode,
      relatedPlacementIds: colliding.map((c) => c.placementId),
    });
  }

  const cadence = cadences.find((c) => c.accountCode === candidate.accountCode);
  if (cadence) {
    const severity = cadence.enforcement === 'block' ? 'hard' : 'warning';
    const sameDay = sameAccount.filter((e) => istDate(e.at) === day);
    if (cadence.maxPerDay !== null && sameDay.length + 1 > cadence.maxPerDay) {
      push({
        code: 'CADENCE_DAY',
        severity,
        message: `${candidate.accountCode} would have ${sameDay.length + 1} posts on ${day} (limit ${cadence.maxPerDay}/day, ${cadence.status}).`,
        accountCode: candidate.accountCode,
        relatedPlacementIds: sameDay.map((e) => e.placementId),
      });
    }
    const sameWeek = sameAccount.filter((e) => weekStart(istDate(e.at)) === week);
    if (cadence.maxPerWeek !== null && sameWeek.length + 1 > cadence.maxPerWeek) {
      push({
        code: 'CADENCE_WEEK',
        severity,
        message: `${candidate.accountCode} would have ${sameWeek.length + 1} posts in the week of ${week} (limit ${cadence.maxPerWeek}/week, ${cadence.status}).`,
        accountCode: candidate.accountCode,
        relatedPlacementIds: sameWeek.map((e) => e.placementId),
      });
    }
  }

  if (config.staggerWarning && candidate.ideaId) {
    const sameIdeaSameDay = others.filter(
      (e) =>
        e.ideaId === candidate.ideaId &&
        e.accountCode !== candidate.accountCode &&
        istDate(e.at) === day &&
        !(candidate.groupId && e.groupId === candidate.groupId),
    );
    if (sameIdeaSameDay.length > 0) {
      push({
        code: 'STAGGER_SAME_DAY',
        severity: 'warning',
        message: `The same idea is also scheduled on ${sameIdeaSameDay.map((e) => e.accountCode).join(', ')} on ${day}; stagger it or make it a collab.`,
        accountCode: candidate.accountCode,
        relatedPlacementIds: sameIdeaSameDay.map((e) => e.placementId),
      });
    }
  }
  return out;
}

/** Conflicts for every slot in a calendar view (each slot checked against the others). */
export function calendarConflicts(
  slots: readonly ScheduleCandidate[],
  cadences: readonly AccountCadence[],
  config: ScheduleConfig = DEFAULT_SCHEDULE_CONFIG,
): Map<string, ScheduleCheckResult> {
  const map = new Map<string, ScheduleCheckResult>();
  for (const slot of slots) {
    // Only placements earlier in the same day/week count against cadence, so a full day
    // flags the posts over the limit rather than every post of that day.
    const earlier = slots.filter(
      (s) =>
        s.placementId !== slot.placementId &&
        (s.at.getTime() < slot.at.getTime() ||
          (s.at.getTime() === slot.at.getTime() && s.placementId < slot.placementId)),
    );
    const result = detectScheduleConflicts(slot, slots, cadences, config, null);
    const cadenceOnly = detectScheduleConflicts(
      { ...slot, approval: { valid: true } },
      earlier,
      cadences,
      { ...config, staggerWarning: false, slotWindowMinutes: 0 },
      null,
    );
    const keep = (c: ScheduleConflict) => c.code !== 'CADENCE_DAY' && c.code !== 'CADENCE_WEEK';
    map.set(slot.placementId, {
      hard: [...result.hard.filter(keep), ...cadenceOnly.hard.filter((c) => !keep(c))],
      warnings: [...result.warnings.filter(keep), ...cadenceOnly.warnings.filter((c) => !keep(c))],
    });
  }
  return map;
}
