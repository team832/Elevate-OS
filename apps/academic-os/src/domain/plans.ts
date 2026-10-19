/**
 * Curriculum plan versions (ACD-004, PLT-007) — status rules.
 *
 *   proposed ──approval──▶ provisional ──approval──▶ locked
 *   proposed ──approval──▶ locked
 *   locked / provisional ──(a successor is approved)──▶ superseded
 *   proposed ──withdrawn by the coordinator──▶ superseded
 *
 * Only `proposed` plans may change their items. Locked and provisional plans are
 * immutable; a change is a new version that `supersedes` its predecessor and
 * goes through a core approval (no self-approval). Nothing here records delivery.
 */
export const PLAN_STATUSES = ['locked', 'provisional', 'proposed', 'superseded'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** Statuses an approval may move a plan to. */
export const APPROVAL_TARGETS = ['locked', 'provisional'] as const;
export type ApprovalTarget = (typeof APPROVAL_TARGETS)[number];

const ALLOWED: Record<PlanStatus, readonly PlanStatus[]> = {
  proposed: ['provisional', 'locked', 'superseded'],
  provisional: ['locked', 'superseded'],
  locked: ['superseded'],
  superseded: [],
};

export function canTransitionPlan(from: PlanStatus, to: PlanStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function canEditPlanItems(status: PlanStatus): boolean {
  return status === 'proposed';
}

/** Can an approval to `target` be requested for a plan in `status`? */
export function canRequestApproval(status: PlanStatus, target: ApprovalTarget): boolean {
  return canTransitionPlan(status, target);
}

export interface PlanRef {
  id: string;
  courseId: string;
  batchId: string | null;
  status: PlanStatus;
}

/**
 * Check that `successor` may supersede `predecessor`: same course and same
 * batch scope (a batch override never replaces the course template, BR-ACD-6),
 * and the predecessor is still current (locked or provisional).
 */
export function supersessionProblem(successor: PlanRef, predecessor: PlanRef): string | null {
  if (successor.id === predecessor.id) return 'A plan cannot supersede itself.';
  if (successor.courseId !== predecessor.courseId) {
    return 'A plan can only supersede a plan of the same course.';
  }
  if ((successor.batchId ?? null) !== (predecessor.batchId ?? null)) {
    return 'A batch-scoped plan can only supersede a plan with the same batch scope.';
  }
  if (predecessor.status !== 'locked' && predecessor.status !== 'provisional') {
    return `Only a locked or provisional plan can be superseded (it is ${predecessor.status}).`;
  }
  return null;
}

/** Planned hours = classes × minutes ÷ 60 (ACD-005), exact to 2 dp for display. */
export function plannedHours(totalMinutes: number): number {
  return Math.round((totalMinutes / 60) * 100) / 100;
}
