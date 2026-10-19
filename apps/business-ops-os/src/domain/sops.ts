/**
 * SOP lifecycle and approval requirement rules (OPS-019, PLT-004, PLT-006).
 * Pure. Algorithm documentation: docs/ALGORITHMS.md → A-11.
 */

export const SOP_STATUSES = ['not_drafted', 'draft', 'in_review', 'approved', 'retired'] as const;
export type SopStatus = (typeof SOP_STATUSES)[number];

export const SOP_STATUS_LABELS: Record<SopStatus, string> = {
  not_drafted: 'Not drafted (register entry only)',
  draft: 'Draft — proposed, not policy',
  in_review: 'In review — proposed, not policy',
  approved: 'Approved',
  retired: 'Retired',
};

export const SOP_VERSION_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'rejected',
  'superseded',
] as const;
export type SopVersionStatus = (typeof SOP_VERSION_STATUSES)[number];

/** "Proposed" for everything that is not an approved, current SOP (BR-OPS-13). */
export function sopDecisionState(status: SopStatus): 'approved' | 'proposed' | 'retired' {
  return status === 'approved' ? 'approved' : status === 'retired' ? 'retired' : 'proposed';
}

export type SopAction =
  'start_draft' | 'submit' | 'record_review' | 'approve' | 'reject' | 'retire';

/**
 * SOP status after an action, or an error. Editing an approved SOP starts a
 * new draft version while the approved version stays in force
 * (`approvedVersionId` is kept until the new version is approved).
 */
export function nextSopStatus(
  current: SopStatus,
  action: SopAction,
  context: { hasApprovedVersion: boolean },
): { ok: true; status: SopStatus } | { ok: false; message: string } {
  switch (action) {
    case 'start_draft':
      if (current === 'retired') return { ok: false, message: 'A retired SOP cannot be edited.' };
      if (current === 'in_review')
        return {
          ok: false,
          message: 'The SOP is in review; decide or withdraw that version first.',
        };
      // An approved SOP keeps status `approved` (its approved version stays in force) while a new draft exists.
      return { ok: true, status: current === 'approved' ? 'approved' : 'draft' };
    case 'submit':
      if (current === 'retired' || current === 'in_review' || current === 'not_drafted')
        return {
          ok: false,
          message: `An SOP that is ${SOP_STATUS_LABELS[current]} cannot be submitted.`,
        };
      return { ok: true, status: context.hasApprovedVersion ? 'approved' : 'in_review' };
    case 'record_review':
      return { ok: true, status: current };
    case 'approve':
      if (current === 'retired') return { ok: false, message: 'A retired SOP cannot be approved.' };
      return { ok: true, status: 'approved' };
    case 'reject':
      return { ok: true, status: context.hasApprovedVersion ? 'approved' : 'draft' };
    case 'retire':
      if (current === 'retired') return { ok: false, message: 'The SOP is already retired.' };
      return { ok: true, status: 'retired' };
  }
}

export interface SopApprovalContext {
  /** Version being decided. */
  versionStatus: SopVersionStatus;
  ownerStaffId: string | null;
  ownerUserId: string | null;
  reviewerStaffId: string | null;
  reviewerUserId: string | null;
  /** Recorded review on this version. */
  review: { byUserId: string; outcome: 'recommend_approval' | 'changes_requested' } | null;
  deciderUserId: string;
  /** Content hash at submission vs now: an approval binds to a specific version (PLT-006). */
  submittedHash: string | null;
  currentHash: string | null;
}

export type SopApprovalProblem =
  | 'version_not_in_review'
  | 'owner_missing'
  | 'reviewer_missing'
  | 'reviewer_is_owner'
  | 'review_missing'
  | 'review_not_by_reviewer'
  | 'review_requested_changes'
  | 'approver_is_owner'
  | 'content_changed_since_submission';

export const SOP_APPROVAL_PROBLEM_LABELS: Record<SopApprovalProblem, string> = {
  version_not_in_review: 'This version is not in review.',
  owner_missing: 'Name an SOP owner first.',
  reviewer_missing: 'A reviewer is required before submission and approval.',
  reviewer_is_owner: 'The reviewer cannot be the SOP owner.',
  review_missing: 'The assigned reviewer has not recorded a review of this version.',
  review_not_by_reviewer: 'The recorded review is not by the assigned reviewer.',
  review_requested_changes: 'The reviewer requested changes.',
  approver_is_owner: 'The SOP owner cannot approve their own SOP.',
  content_changed_since_submission: 'The content changed after submission; resubmit it.',
};

/** Rules checked before submission (draft → in_review). */
export function sopSubmissionProblems(ctx: {
  ownerStaffId: string | null;
  reviewerStaffId: string | null;
  contentLength: number;
}): ('owner_missing' | 'reviewer_missing' | 'reviewer_is_owner' | 'content_empty')[] {
  const problems: ('owner_missing' | 'reviewer_missing' | 'reviewer_is_owner' | 'content_empty')[] =
    [];
  if (!ctx.ownerStaffId) problems.push('owner_missing');
  if (!ctx.reviewerStaffId) problems.push('reviewer_missing');
  if (ctx.ownerStaffId && ctx.ownerStaffId === ctx.reviewerStaffId)
    problems.push('reviewer_is_owner');
  if (ctx.contentLength === 0) problems.push('content_empty');
  return problems;
}

/**
 * Approval requirement rules (in addition to the core rule that a requester
 * cannot decide their own request):
 * 1. the version is in review and unchanged since submission;
 * 2. an owner and a reviewer are named and are different people;
 * 3. the assigned reviewer has recorded a review recommending approval;
 * 4. the approver is not the SOP owner (owner cannot approve own SOP).
 * The approver must also hold `ops:sops:approve` (checked by the approval service).
 */
export function sopApprovalProblems(ctx: SopApprovalContext): SopApprovalProblem[] {
  const problems: SopApprovalProblem[] = [];
  if (ctx.versionStatus !== 'in_review') problems.push('version_not_in_review');
  if (ctx.submittedHash && ctx.currentHash && ctx.submittedHash !== ctx.currentHash)
    problems.push('content_changed_since_submission');
  if (!ctx.ownerStaffId) problems.push('owner_missing');
  if (!ctx.reviewerStaffId) problems.push('reviewer_missing');
  if (ctx.ownerStaffId && ctx.ownerStaffId === ctx.reviewerStaffId)
    problems.push('reviewer_is_owner');
  if (!ctx.review) problems.push('review_missing');
  else {
    if (!ctx.reviewerUserId || ctx.review.byUserId !== ctx.reviewerUserId)
      problems.push('review_not_by_reviewer');
    if (ctx.review.outcome !== 'recommend_approval') problems.push('review_requested_changes');
  }
  if (ctx.ownerUserId && ctx.ownerUserId === ctx.deciderUserId) problems.push('approver_is_owner');
  return problems;
}

/** Next version label: 0.1, 0.2 … while never approved; 1.0, 2.0 … for approved lines. */
export function nextVersionLabel(
  previousLabels: readonly string[],
  approvedBefore: boolean,
): string {
  const nums = previousLabels.map((l) => Number(l)).filter((n) => Number.isFinite(n));
  const max = nums.length ? Math.max(...nums) : 0;
  if (approvedBefore) return `${Math.floor(max) + 1}.0`;
  return (Math.round((max + 0.1) * 10) / 10).toFixed(1);
}
