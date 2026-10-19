/**
 * Assignment and escalation rules (OPS-017, BR-OPS-10). Pure.
 * Algorithm documentation: docs/ALGORITHMS.md → A-09.
 *
 * Levels: L1 owner (no record), L2 the owner's manager, L3 the manager's
 * manager (or an operations lead), L4 leadership. Recipients come from the
 * staff reporting lines (core.staff_members.manager_id). The task owner keeps
 * the task; escalation adds a recipient, a reason and a response date.
 */
import { addDays, daysBetween, istToday, type IsoDate } from './dates';
import { ancestorChain } from './graph';
import { isOpenTask, type TaskStatus } from './tasks';

export interface EscalationThresholds {
  overdueDaysL2: number;
  overdueDaysL3: number;
  overdueDaysL4: number;
  blockedDaysL2: number;
  responseDays: number;
}

export const DEFAULT_ESCALATION_THRESHOLDS: EscalationThresholds = {
  overdueDaysL2: 2,
  overdueDaysL3: 5,
  overdueDaysL4: 10,
  blockedDaysL2: 3,
  responseDays: 1,
};

export type EscalationLevel = 2 | 3 | 4;

export interface EscalationTaskInput {
  status: TaskStatus;
  dueDate: IsoDate | null;
  /** When the task entered `blocked`. */
  blockedSince: Date | null;
  ownerStaffId: string | null;
  /** Levels already raised for this task. */
  raisedLevels: readonly number[];
}

export interface EscalationProposal {
  level: EscalationLevel;
  trigger: 'overdue' | 'blocked';
  daysOverdue: number | null;
  thresholdDays: number;
  reason: string;
  respondBy: IsoDate;
}

/**
 * Levels to raise now. Each level is raised at most once per task; when a task
 * is first evaluated late (e.g. 12 days overdue), every missing level up to the
 * target is raised in order so the trail shows each step.
 */
export function evaluateEscalation(
  task: EscalationTaskInput,
  now: Date,
  thresholds: EscalationThresholds = DEFAULT_ESCALATION_THRESHOLDS,
): EscalationProposal[] {
  if (!isOpenTask(task.status)) return [];
  const today = istToday(now);
  const respondBy = addDays(today, thresholds.responseDays);
  const proposals: EscalationProposal[] = [];
  const raised = new Set(task.raisedLevels);

  const daysOverdue = task.dueDate ? daysBetween(task.dueDate, today) : 0;
  const levels: [EscalationLevel, number][] = [
    [2, thresholds.overdueDaysL2],
    [3, thresholds.overdueDaysL3],
    [4, thresholds.overdueDaysL4],
  ];
  if (task.dueDate && daysOverdue > 0) {
    for (const [level, threshold] of levels) {
      if (daysOverdue >= threshold && !raised.has(level)) {
        proposals.push({
          level,
          trigger: 'overdue',
          daysOverdue,
          thresholdDays: threshold,
          reason: `Overdue by ${daysOverdue} day(s) (L${level} threshold: ${threshold} day(s)).`,
          respondBy,
        });
        raised.add(level);
      }
    }
  }
  if (task.status === 'blocked' && task.blockedSince && !raised.has(2)) {
    const blockedDays = daysBetween(istToday(task.blockedSince), today);
    if (blockedDays >= thresholds.blockedDaysL2) {
      proposals.push({
        level: 2,
        trigger: 'blocked',
        daysOverdue: task.dueDate && daysOverdue > 0 ? daysOverdue : null,
        thresholdDays: thresholds.blockedDaysL2,
        reason: `Blocked for ${blockedDays} day(s) (threshold: ${thresholds.blockedDaysL2} day(s)).`,
        respondBy,
      });
    }
  }
  return proposals.sort((a, b) => a.level - b.level);
}

export type RecipientResolution =
  | { recipientStaffId: string; via: 'reporting_line' | 'top_of_chain' }
  | { recipientStaffId: null; via: 'no_owner' | 'no_manager_on_record' | 'reporting_loop' };

/**
 * Recipient for level L: the (L-1)th ancestor of the owner in the reporting
 * line. When the chain is shorter, the top of the chain is used if it is above
 * the owner; otherwise no recipient (the service routes it to operations
 * managers). A looping reporting line is reported, never followed.
 */
export function resolveEscalationRecipient(
  ownerStaffId: string | null,
  level: EscalationLevel,
  managerOf: (staffId: string) => string | null | undefined,
): RecipientResolution {
  if (!ownerStaffId) return { recipientStaffId: null, via: 'no_owner' };
  const { chain, loop } = ancestorChain(ownerStaffId, managerOf);
  if (loop) return { recipientStaffId: null, via: 'reporting_loop' };
  const wanted = chain[level - 1];
  if (wanted) return { recipientStaffId: wanted, via: 'reporting_line' };
  if (chain.length > 1)
    return { recipientStaffId: chain[chain.length - 1] as string, via: 'top_of_chain' };
  return { recipientStaffId: null, via: 'no_manager_on_record' };
}
