import { and, asc, eq } from 'drizzle-orm';
import { requirePermission, type Permission, type Principal } from '@elevate/authorization';
import { approvals, isUniqueViolation, type Database } from '@elevate/database';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
} from '@elevate/shared-contracts';
import type { ApprovalId, ModuleKey } from '@elevate/shared-types';
import { recordAudit } from './transaction';

/**
 * Approval policies say who may decide what. Each module defines its own:
 *
 *   export const publishPolicy = defineApprovalPolicy({
 *     key: 'marketing.content.publish', module: 'marketing', subjectType: 'content_item',
 *     deciderPermission: 'marketing:content:approve', allowSelfApproval: false,
 *     description: 'Nothing is published without the owner’s explicit yes.',
 *   });
 */
export interface ApprovalPolicy {
  /** Unique key stored on every request, e.g. `ops.sop.publish`. */
  readonly key: string;
  readonly module: ModuleKey;
  readonly subjectType: string;
  /** Permission the decider must hold. */
  readonly deciderPermission: Permission;
  /** Permission the requester must hold (optional). */
  readonly requesterPermission?: Permission;
  /** May the requester decide their own request? Default false. */
  readonly allowSelfApproval: boolean;
  /** Rejections must carry a comment. Default true. */
  readonly requireCommentOnReject?: boolean;
  readonly description: string;
}

export function defineApprovalPolicy(policy: ApprovalPolicy): ApprovalPolicy {
  if (!/^[a-z]+\.[a-z0-9_.]+$/.test(policy.key) || !policy.key.startsWith(`${policy.module}.`)) {
    throw new Error(
      `Approval policy key "${policy.key}" must start with "${policy.module}." and be lower-case`,
    );
  }
  return policy;
}

export type ApprovalRow = typeof approvals.$inferSelect;

export interface RequestApprovalInput {
  policy: ApprovalPolicy;
  subjectId: string;
  requestedBy: Principal;
  comment?: string | null;
  requestId?: string | null;
}

/** Open a pending approval request. Only one pending request per subject and policy (else CONFLICT). */
export async function requestApproval(
  db: Database,
  input: RequestApprovalInput,
): Promise<ApprovalRow> {
  const { policy } = input;
  if (policy.requesterPermission) requirePermission(input.requestedBy, policy.requesterPermission);
  try {
    const [row] = await db
      .insert(approvals)
      .values({
        subjectModule: policy.module,
        subjectType: policy.subjectType,
        subjectId: input.subjectId,
        policy: policy.key,
        status: 'pending',
        requestedBy: input.requestedBy.id,
        requestComment: input.comment ?? null,
      })
      .returning();
    if (!row) throw new Error('approval insert returned no row');
    await recordAudit(db, {
      actorUserId: input.requestedBy.id,
      module: policy.module,
      action: 'approval.requested',
      entityType: 'approval',
      entityId: row.id,
      after: row,
      requestId: input.requestId,
      metadata: { policy: policy.key, subjectType: policy.subjectType, subjectId: input.subjectId },
    });
    return row;
  } catch (error) {
    if (isUniqueViolation(error, 'approvals_one_pending_per_subject')) {
      throw new ConflictError('An approval request for this item is already pending.');
    }
    throw error;
  }
}

export interface DecideApprovalInput {
  policy: ApprovalPolicy;
  approvalId: ApprovalId;
  decider: Principal;
  decision: 'approved' | 'rejected';
  comment?: string | null;
  requestId?: string | null;
}

/**
 * Approve or reject a pending request. Enforces: the decider holds the
 * policy's permission; the requester cannot decide their own request unless
 * the policy allows self-approval; only pending requests can be decided.
 * The row keeps the request AND the decision; nothing is deleted.
 */
export async function decideApproval(
  db: Database,
  input: DecideApprovalInput,
): Promise<ApprovalRow> {
  const { policy } = input;
  const [current] = await db
    .select()
    .from(approvals)
    .where(eq(approvals.id, input.approvalId))
    .for('update')
    .limit(1);
  if (!current) throw new NotFoundError('Approval request not found.');
  if (current.policy !== policy.key) {
    throw new ValidationError(
      `This approval belongs to policy "${current.policy}", not "${policy.key}".`,
    );
  }
  if (current.status !== 'pending') {
    throw new InvalidStateTransitionError(`This request is already ${current.status}.`);
  }
  requirePermission(input.decider, policy.deciderPermission);
  if (current.requestedBy === input.decider.id && !policy.allowSelfApproval) {
    throw new ForbiddenError(
      'You cannot decide your own approval request; another approver must do it.',
    );
  }
  const comment = input.comment?.trim() || null;
  if (input.decision === 'rejected' && (policy.requireCommentOnReject ?? true) && !comment) {
    throw new ValidationError('Give a reason when rejecting.');
  }
  const [updated] = await db
    .update(approvals)
    .set({ status: input.decision, decidedBy: input.decider.id, decidedAt: new Date(), comment })
    .where(and(eq(approvals.id, current.id), eq(approvals.status, 'pending')))
    .returning();
  if (!updated)
    throw new InvalidStateTransitionError('This request was decided by someone else just now.');
  await recordAudit(db, {
    actorUserId: input.decider.id,
    module: policy.module,
    action: 'approval.decided',
    entityType: 'approval',
    entityId: updated.id,
    before: current,
    after: updated,
    requestId: input.requestId,
    metadata: { policy: policy.key, decision: input.decision },
  });
  return updated;
}

/** The requester withdraws their own pending request. */
export async function withdrawApproval(
  db: Database,
  input: {
    policy: ApprovalPolicy;
    approvalId: ApprovalId;
    actor: Principal;
    requestId?: string | null;
  },
): Promise<ApprovalRow> {
  const [current] = await db
    .select()
    .from(approvals)
    .where(eq(approvals.id, input.approvalId))
    .for('update')
    .limit(1);
  if (!current || current.policy !== input.policy.key)
    throw new NotFoundError('Approval request not found.');
  if (current.requestedBy !== input.actor.id)
    throw new ForbiddenError('Only the requester can withdraw a request.');
  if (current.status !== 'pending')
    throw new InvalidStateTransitionError(`This request is already ${current.status}.`);
  const [updated] = await db
    .update(approvals)
    .set({ status: 'withdrawn', decidedAt: new Date() })
    .where(eq(approvals.id, current.id))
    .returning();
  await recordAudit(db, {
    actorUserId: input.actor.id,
    module: input.policy.module,
    action: 'approval.withdrawn',
    entityType: 'approval',
    entityId: current.id,
    before: current,
    after: updated,
    requestId: input.requestId,
  });
  return updated!;
}

/** Full request/decision history for one subject, oldest first. */
export async function listApprovalHistory(
  db: Database,
  subject: { module: ModuleKey; subjectType: string; subjectId: string },
): Promise<ApprovalRow[]> {
  return db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.subjectModule, subject.module),
        eq(approvals.subjectType, subject.subjectType),
        eq(approvals.subjectId, subject.subjectId),
      ),
    )
    .orderBy(asc(approvals.requestedAt), asc(approvals.id));
}

/** The pending request for a subject under a policy, if any. */
export async function findPendingApproval(
  db: Database,
  policy: ApprovalPolicy,
  subjectId: string,
): Promise<ApprovalRow | undefined> {
  const [row] = await db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.policy, policy.key),
        eq(approvals.subjectId, subjectId),
        eq(approvals.status, 'pending'),
      ),
    )
    .limit(1);
  return row;
}
