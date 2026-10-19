/**
 * SOP lifecycle and approval requirement rules (OPS-019, PLT-004, PLT-006).
 * Pure. Algorithm documentation: docs/ALGORITHMS.md → A-11.
 */
import { addDays, type IsoDate } from './dates';

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

// --- publication, review-due and archive (OPS-064) ---------------------------------------------

/**
 * Derived publication state. The stored SOP status stays draft / in_review /
 * approved / retired; "published" is never stored: it means the approved version
 * in force has an effective date that has been reached (Asia/Kolkata).
 */
export type SopPublicationState =
  | 'not_approved'
  | 'approved_no_effective_date'
  | 'approved_not_yet_effective'
  | 'published'
  | 'retired'
  | 'archived';

export const SOP_PUBLICATION_LABELS: Record<SopPublicationState, string> = {
  not_approved: 'Not approved — proposed, not policy',
  approved_no_effective_date: 'Approved — effective date not set (not published)',
  approved_not_yet_effective: 'Approved — not yet effective',
  published: 'Published (approved and effective)',
  retired: 'Retired',
  archived: 'Archived',
};

export function sopPublicationState(
  input: {
    status: SopStatus;
    hasApprovedVersion: boolean;
    effectiveDate: string | null;
    archived: boolean;
  },
  today: IsoDate,
): SopPublicationState {
  if (input.archived) return 'archived';
  if (input.status === 'retired') return 'retired';
  if (!input.hasApprovedVersion) return 'not_approved';
  if (!input.effectiveDate) return 'approved_no_effective_date';
  if (input.effectiveDate > today) return 'approved_not_yet_effective';
  return 'published';
}

export type ReviewDueFlag = 'not_set' | 'overdue' | 'due_soon' | 'ok';

/** Review-due flag on IST dates (SOP versions and company policies): overdue after the date, due soon within N days. */
export function reviewDueFlag(
  nextReviewDate: string | null,
  today: IsoDate,
  dueSoonDays: number,
): ReviewDueFlag {
  if (!nextReviewDate) return 'not_set';
  if (nextReviewDate < today) return 'overdue';
  return nextReviewDate <= addDays(today, Math.max(0, dueSoonDays)) ? 'due_soon' : 'ok';
}

export type SopScheduleProblem =
  'version_not_approved' | 'version_not_in_force' | 'review_before_effective' | 'sop_retired';

/** An effective / next review date is set only on the approved version in force. */
export function sopScheduleProblems(input: {
  sopStatus: SopStatus;
  versionStatus: SopVersionStatus;
  isVersionInForce: boolean;
  effectiveDate: string;
  nextReviewDate: string | null;
}): SopScheduleProblem[] {
  const problems: SopScheduleProblem[] = [];
  if (input.sopStatus === 'retired') problems.push('sop_retired');
  if (input.versionStatus !== 'approved') problems.push('version_not_approved');
  else if (!input.isVersionInForce) problems.push('version_not_in_force');
  if (input.nextReviewDate && input.nextReviewDate < input.effectiveDate)
    problems.push('review_before_effective');
  return problems;
}

// --- required acknowledgements (OPS-065) --------------------------------------------------------

export interface AckAudienceMember {
  staffId: string | null;
  userId: string | null;
  name: string;
}

export interface AckRequirementLike {
  id: string;
  audienceType: 'department' | 'role';
  departmentId: string | null;
  role: string | null;
}

/** Is a person (staff department + login roles) in the requirement's audience? */
export function inAckAudience(
  requirement: AckRequirementLike,
  person: { departmentId: string | null; roles: readonly string[] },
): boolean {
  if (requirement.audienceType === 'department')
    return requirement.departmentId !== null && person.departmentId === requirement.departmentId;
  return requirement.role !== null && person.roles.includes(requirement.role);
}

/**
 * Outstanding-acknowledgement split for one requirement: who acknowledged the
 * version, who still has to, and who cannot (no login — reported, never counted
 * as acknowledged). Rows are sorted by name (a list, not a ranking).
 */
export function acknowledgementStatus(
  audience: readonly AckAudienceMember[],
  acknowledgedUserIds: ReadonlySet<string>,
): {
  acknowledged: AckAudienceMember[];
  outstanding: AckAudienceMember[];
  noLogin: AckAudienceMember[];
} {
  const sorted = [...audience].sort((a, b) => a.name.localeCompare(b.name));
  return {
    acknowledged: sorted.filter((m) => m.userId && acknowledgedUserIds.has(m.userId)),
    outstanding: sorted.filter((m) => m.userId && !acknowledgedUserIds.has(m.userId)),
    noLogin: sorted.filter((m) => !m.userId),
  };
}

export type AcknowledgeProblem =
  'no_version_in_force' | 'not_in_audience' | 'already_acknowledged' | 'read_only_role';

/**
 * Who may acknowledge: a person in an active requirement's audience on the
 * approved version in force, once per version. Read-only roles (auditor) never write.
 */
export function acknowledgeProblems(input: {
  versionInForce: boolean;
  inAudience: boolean;
  alreadyAcknowledged: boolean;
  readOnly: boolean;
}): AcknowledgeProblem[] {
  const problems: AcknowledgeProblem[] = [];
  if (input.readOnly) problems.push('read_only_role');
  if (!input.versionInForce) problems.push('no_version_in_force');
  if (!input.inAudience) problems.push('not_in_audience');
  if (input.alreadyAcknowledged) problems.push('already_acknowledged');
  return problems;
}

export const ACKNOWLEDGE_PROBLEM_LABELS: Record<AcknowledgeProblem, string> = {
  no_version_in_force: 'Only the approved version in force can be acknowledged.',
  not_in_audience: 'This SOP version does not require your acknowledgement.',
  already_acknowledged: 'You have already acknowledged this version.',
  read_only_role: 'Read-only roles cannot record acknowledgements.',
};

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
