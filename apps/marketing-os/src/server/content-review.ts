/** Review and approval of a content version: request, withdraw, decide (see content.ts). */
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { marketingContentReviews, userRoles, type Database } from '@elevate/database';
import { notify } from '@elevate/notifications';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
  decideApproval,
  defineApprovalPolicy,
  findPendingApproval,
  requestApproval,
  withTransaction,
  withdrawApproval,
} from '@elevate/server-kit';
import type { UserId } from '@elevate/shared-types';
import {
  evaluateApprovalEligibility,
  modulePath,
  type ContentAction,
  type RuleCheckResult,
} from '../domain';
import { assertCan, type Actor } from './access';
import { auditMarketing } from './common';
import {
  getVersion,
  lockItem,
  nextState,
  setItem,
  type ContentItemRow,
  type ContentVersionRow,
} from './content-records';
import { loadPolicy } from './policy';
import { runRuleCheck } from './rules';

export const contentApprovalPolicy = defineApprovalPolicy({
  key: 'marketing.content.approval',
  module: 'marketing',
  subjectType: 'content_item',
  deciderPermission: 'marketing:content:approve',
  requesterPermission: 'marketing:content:write',
  allowSelfApproval: false,
  requireCommentOnReject: true,
  description:
    'Nothing is scheduled or published without an explicit approval of the exact version; who approves is still a proposal for the owner.',
});

export const decisionBody = z
  .object({
    decision: z.enum(['approve', 'request_changes']),
    comment: z.string().trim().max(2000).optional(),
    acknowledgedRuleCodes: z.array(z.string().trim().min(1).max(40)).max(100).default([]),
  })
  .strict();

/** Users who may decide content approvals under the current policy (for notifications). */
async function approverUserIds(tx: Database, exclude: UserId): Promise<UserId[]> {
  const policy = await loadPolicy(tx);
  const rows = await tx
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(inArray(userRoles.role, policy.approverRoles));
  return [...new Set(rows.map((r) => r.userId))].filter((u) => u !== exclude);
}

export async function openReview(
  tx: Database,
  actor: Actor,
  item: ContentItemRow,
  version: ContentVersionRow,
  comment: string | null,
  requestId?: string,
): Promise<{ check: RuleCheckResult }> {
  const check = await runRuleCheck(tx, { itemId: item.id, format: item.format, version });
  const approval = await requestApproval(tx, {
    policy: contentApprovalPolicy,
    subjectId: item.id,
    requestedBy: actor,
    comment: comment ?? `Review version ${version.versionNumber}`,
    requestId,
  });
  await tx.insert(marketingContentReviews).values({
    contentItemId: item.id,
    versionId: version.id,
    versionHash: version.contentHash,
    approvalId: approval.id,
    ruleCheck: check as unknown as object,
  });
  await notify(tx, {
    userIds: await approverUserIds(tx, actor.id),
    module: 'marketing',
    kind: 'content.review_requested',
    title: `Review requested: ${item.title} (v${version.versionNumber})`,
    body: check.blocking.length
      ? `${check.blocking.length} blocking brand-rule flag(s) must be fixed before approval.`
      : `${check.checklist.length} checklist item(s) to confirm.`,
    link: modulePath(`content/${item.id}`),
  });
  return { check };
}

export async function submitForReview(
  db: Database,
  actor: Actor,
  itemId: string,
  comment: string | null,
  requestId?: string,
) {
  assertCan(actor, 'marketing:content:write');
  return withTransaction(db, async (tx) => {
    const item = await lockItem(tx, itemId, actor);
    const to = nextState(item.state, 'submit');
    if (!item.currentVersionId)
      throw new ValidationError('Add a version (copy) before submitting for review.');
    const version = await getVersion(tx, item.currentVersionId);
    const after = await setItem(tx, item.id, { state: to });
    const { check } = await openReview(tx, actor, after, version, comment, requestId);
    await auditMarketing(tx, actor, {
      action: 'content_item.submitted',
      entityType: 'content_item',
      entityId: item.id,
      before: { state: item.state },
      after: { state: to, versionId: version.id, versionHash: version.contentHash },
      requestId,
    });
    return { item: after, ruleCheck: check };
  });
}

export async function withdrawFromReview(
  db: Database,
  actor: Actor,
  itemId: string,
  requestId?: string,
) {
  assertCan(actor, 'marketing:content:write');
  return withTransaction(db, async (tx) => {
    const item = await lockItem(tx, itemId, actor);
    const to = nextState(item.state, 'withdraw');
    const pending = await findPendingApproval(tx, contentApprovalPolicy, item.id);
    if (pending) {
      await withdrawApproval(tx, {
        policy: contentApprovalPolicy,
        approvalId: pending.id,
        actor,
        requestId,
      });
      await tx
        .update(marketingContentReviews)
        .set({ outcome: 'withdrawn' })
        .where(eq(marketingContentReviews.approvalId, pending.id));
    }
    const after = await setItem(tx, item.id, { state: to });
    await auditMarketing(tx, actor, {
      action: 'content_item.withdrawn',
      entityType: 'content_item',
      entityId: item.id,
      before: { state: item.state },
      after: { state: to },
      requestId,
    });
    return after;
  });
}

export async function decideContent(
  db: Database,
  actor: Actor,
  itemId: string,
  input: z.output<typeof decisionBody>,
  requestId?: string,
) {
  assertCan(actor, 'marketing:content:approve');
  return withTransaction(db, async (tx) => {
    const policy = await loadPolicy(tx);
    if (!actor.roles.some((r) => policy.approverRoles.includes(r))) {
      throw new ForbiddenError(
        `Only ${policy.approverRoles.map((r) => r.replaceAll('_', ' ')).join(' or ')} may decide content approvals (proposed; the owner has not confirmed this).`,
      );
    }
    const item = await lockItem(tx, itemId, actor);
    const action: ContentAction = input.decision === 'approve' ? 'approve' : 'request_changes';
    const to = nextState(item.state, action);
    const pending = await findPendingApproval(tx, contentApprovalPolicy, item.id);
    if (!pending) {
      throw new InvalidStateTransitionError(
        'This item has no open approval request (e.g. it was imported as "in review" from the legacy tracker). Withdraw it and submit again.',
      );
    }
    const [review] = await tx
      .select()
      .from(marketingContentReviews)
      .where(eq(marketingContentReviews.approvalId, pending.id));
    if (!review || review.versionId !== item.currentVersionId) {
      throw new InvalidStateTransitionError(
        'The version under review is no longer the current version.',
      );
    }
    const version = await getVersion(tx, review.versionId);
    if (version.contentHash !== review.versionHash) {
      throw new ConflictError('The version changed after it was submitted; it cannot be approved.');
    }
    let check = review.ruleCheck as unknown as RuleCheckResult;
    if (input.decision === 'approve') {
      if (version.authorUserId === actor.id) {
        throw new ForbiddenError(
          'You wrote this version; another approver must approve it (no self-approval, PLT-004).',
        );
      }
      if (pending.requestedBy === actor.id) {
        throw new ForbiddenError(
          'You cannot decide your own approval request; another approver must do it.',
        );
      }
      check = await runRuleCheck(tx, { itemId: item.id, format: item.format, version });
      const eligibility = evaluateApprovalEligibility(check, input.acknowledgedRuleCodes);
      if (eligibility.blocking.length > 0) {
        throw new InvalidStateTransitionError(
          'Brand rules block this version; edit it to remove the flagged text.',
          {
            details: { reason: 'BRAND_RULE_BLOCK', blocking: check.blocking },
          },
        );
      }
      if (eligibility.missingAcknowledgements.length > 0) {
        throw new ValidationError('Confirm every checklist item before approving.', {
          details: {
            reason: 'CHECKLIST_NOT_ACKNOWLEDGED',
            missing: eligibility.missingAcknowledgements,
          },
        });
      }
    }
    const decided = await decideApproval(tx, {
      policy: contentApprovalPolicy,
      approvalId: pending.id,
      decider: actor,
      decision: input.decision === 'approve' ? 'approved' : 'rejected',
      comment: input.comment ?? null,
      requestId,
    });
    await tx
      .update(marketingContentReviews)
      .set({
        outcome: input.decision === 'approve' ? 'approved' : 'changes_requested',
        acknowledgedRuleCodes: input.acknowledgedRuleCodes,
        ruleCheck: check as unknown as object,
      })
      .where(eq(marketingContentReviews.id, review.id));
    const after = await setItem(
      tx,
      item.id,
      input.decision === 'approve'
        ? { state: to, approvedVersionId: version.id, approvalId: decided.id }
        : { state: to },
    );
    await notify(tx, {
      userIds: [pending.requestedBy],
      module: 'marketing',
      kind: input.decision === 'approve' ? 'content.approved' : 'content.changes_requested',
      title: `${input.decision === 'approve' ? 'Approved' : 'Changes requested'}: ${item.title} (v${version.versionNumber})`,
      body: input.comment ?? null,
      link: modulePath(`content/${item.id}`),
    });
    await auditMarketing(tx, actor, {
      action:
        input.decision === 'approve' ? 'content_item.approved' : 'content_item.changes_requested',
      entityType: 'content_item',
      entityId: item.id,
      before: { state: item.state },
      after: {
        state: to,
        versionId: version.id,
        versionHash: version.contentHash,
        approvalId: decided.id,
      },
      requestId,
      metadata: { acknowledged: input.acknowledgedRuleCodes },
    });
    return { item: after, approval: decided, ruleCheck: check };
  });
}
