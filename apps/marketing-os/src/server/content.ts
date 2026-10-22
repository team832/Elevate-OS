/**
 * Content production and approval (MKT-009, MKT-010, MKT-011, MKT-012, PLT-004, PLT-006).
 *
 * - Versions are immutable: every edit inserts a new version; an approved version is never
 *   changed. Editing an approved/scheduled item creates a new version, voids the approval,
 *   unschedules its placements and opens a new review (re-approval needed).
 * - Approval goes through core requestApproval / decideApproval (policy below). The review
 *   row binds the approval to the exact version and its hash.
 * - Approving requires: approve permission + an approver role from policy (OD-002); not the
 *   requester (server-kit) and not the version's author (PLT-004); no blocking brand-rule
 *   flag; every checklist item acknowledged.
 */
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import {
  marketingContentAssets,
  marketingContentAssignments,
  marketingContentComments,
  marketingContentItems,
  marketingContentReviews,
  marketingContentVersions,
  marketingIdeas,
  marketingPlacements,
  userRoles,
  type Database,
  type MarketingContentVersionId,
} from '@elevate/database';
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
import type { ContentItemId, UserId } from '@elevate/shared-types';
import {
  ASSIGNEE_ROLES,
  CONTENT_FORMATS,
  RIGHTS_STATES,
  editEffect,
  evaluateApprovalEligibility,
  modulePath,
  transitionContent,
  type ContentAction,
  type ContentState,
  type RuleCheckResult,
} from '../domain';
import { actorCan, assertCan, type Actor } from './access';
import { auditMarketing, rowById } from './common';
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
    'Nothing is scheduled or published without an explicit approval of the exact version (AP-001; approver roles per OD-002).',
});

export type ContentItemRow = typeof marketingContentItems.$inferSelect;
export type ContentVersionRow = typeof marketingContentVersions.$inferSelect;

const assetSchema = z
  .object({
    fileName: z.string().trim().min(1).max(200),
    mimeType: z
      .string()
      .trim()
      .regex(/^[a-z]+\/[a-z0-9.+-]+$/i, 'A MIME type such as image/png'),
    sizeBytes: z.int().min(0).max(5_000_000_000).nullable().optional(),
    externalUrl: z
      .url({ protocol: /^https?$/ })
      .max(2000)
      .nullable()
      .optional(),
    showsStudents: z.boolean().default(false),
    rightsState: z.enum(RIGHTS_STATES).default('own'),
  })
  .strict();

export const versionBody = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    body: z.string().max(20_000),
    assets: z.array(assetSchema).max(30).default([]),
    showsStudents: z.boolean().default(false),
    consentReference: z.string().trim().max(200).nullable().optional(),
    changeNote: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
export type VersionInput = z.output<typeof versionBody>;

export const createContentItemBody = z
  .object({
    title: z.string().trim().min(1).max(300),
    format: z.enum(CONTENT_FORMATS),
    initialVersion: versionBody.optional(),
  })
  .strict();

export const decisionBody = z
  .object({
    decision: z.enum(['approve', 'request_changes']),
    comment: z.string().trim().max(2000).optional(),
    acknowledgedRuleCodes: z.array(z.string().trim().min(1).max(40)).max(100).default([]),
  })
  .strict();

export const assignmentBody = z
  .object({
    role: z.enum(ASSIGNEE_ROLES),
    userId: z.uuid().nullable().optional(),
    staffMemberId: z.uuid().nullable().optional(),
  })
  .strict();

export const commentBody = z
  .object({ body: z.string().trim().min(1).max(4000), versionId: z.uuid().optional() })
  .strict();

export const archiveBody = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

/** SHA-256 over a canonical JSON of what the approver sees. */
export function hashVersion(input: {
  title: string;
  body: string;
  showsStudents: boolean;
  consentReference: string | null;
  assets: readonly z.output<typeof assetSchema>[];
}): string {
  const canonical = JSON.stringify({
    title: input.title,
    body: input.body,
    showsStudents: input.showsStudents,
    consentReference: input.consentReference,
    assets: [...input.assets]
      .map((a) => [
        a.fileName,
        a.mimeType,
        a.sizeBytes ?? null,
        a.externalUrl ?? null,
        a.showsStudents,
        a.rightsState,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export const getContentItem = (db: Database, id: string, lock = false) =>
  rowById(db, marketingContentItems, id, 'Content item not found.', lock);

const lockItem = (db: Database, id: string) => getContentItem(db, id, true);

async function setItem(
  tx: Database,
  id: ContentItemId,
  set: Partial<typeof marketingContentItems.$inferInsert>,
) {
  const [row] = await tx
    .update(marketingContentItems)
    .set(set)
    .where(eq(marketingContentItems.id, id))
    .returning();
  return row!;
}

export const getVersion = (db: Database, id: string) =>
  rowById(db, marketingContentVersions, id, 'Version not found.');

function nextState(state: ContentState, action: ContentAction): ContentState {
  const t = transitionContent(state, action);
  if (!t.ok)
    throw new InvalidStateTransitionError(t.reason, {
      details: { from: t.from, action: t.action },
    });
  return t.to;
}

async function insertVersion(
  tx: Database,
  actor: Actor,
  item: ContentItemRow,
  input: VersionInput,
): Promise<ContentVersionRow> {
  const [last] = await tx
    .select({ n: marketingContentVersions.versionNumber })
    .from(marketingContentVersions)
    .where(eq(marketingContentVersions.contentItemId, item.id))
    .orderBy(desc(marketingContentVersions.versionNumber))
    .limit(1);
  const title = input.title ?? item.title;
  const consentReference = input.consentReference?.trim() || null;
  const [version] = await tx
    .insert(marketingContentVersions)
    .values({
      contentItemId: item.id,
      versionNumber: (last?.n ?? 0) + 1,
      title,
      body: input.body,
      contentHash: hashVersion({
        title,
        body: input.body,
        showsStudents: input.showsStudents,
        consentReference,
        assets: input.assets,
      }),
      showsStudents: input.showsStudents,
      consentReference,
      changeNote: input.changeNote ?? null,
      authorUserId: actor.id,
    })
    .returning();
  if (input.assets.length > 0) {
    await tx.insert(marketingContentAssets).values(
      input.assets.map((a) => ({
        versionId: version!.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes ?? null,
        externalUrl: a.externalUrl ?? null,
        showsStudents: a.showsStudents,
        rightsState: a.rightsState,
      })),
    );
  }
  return version!;
}

/** Users who may decide content approvals under the current policy (for notifications). */
async function approverUserIds(tx: Database, exclude: UserId): Promise<UserId[]> {
  const policy = await loadPolicy(tx);
  const rows = await tx
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(inArray(userRoles.role, policy.approverRoles));
  return [...new Set(rows.map((r) => r.userId))].filter((u) => u !== exclude);
}

async function openReview(
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

export async function createContentItem(
  db: Database,
  actor: Actor,
  ideaId: string,
  input: z.output<typeof createContentItemBody>,
  requestId?: string,
) {
  assertCan(actor, 'marketing:content:write');
  return withTransaction(db, async (tx) => {
    const idea = await rowById(tx, marketingIdeas, ideaId, 'Idea not found.');
    if (idea.quarantineState === 'quarantined' || !idea.code) {
      throw new InvalidStateTransitionError(
        'This idea is quarantined (duplicate legacy ID, OD-003); it has no code yet, so no content can be produced under it.',
      );
    }
    if (idea.status === 'archived' || idea.status === 'rejected') {
      throw new InvalidStateTransitionError(`The idea is ${idea.status}; reopen it first.`);
    }
    const [item] = await tx
      .insert(marketingContentItems)
      .values({
        ideaId: idea.id,
        title: input.title,
        format: input.format,
        state: 'draft',
        createdBy: actor.id,
      })
      .returning();
    let current: ContentItemRow = item!;
    if (input.initialVersion) {
      const version = await insertVersion(tx, actor, current, input.initialVersion);
      current = await setItem(tx, current.id, { currentVersionId: version.id });
    }
    await auditMarketing(tx, actor, {
      action: 'content_item.created',
      entityType: 'content_item',
      entityId: current.id,
      after: current,
      requestId,
    });
    return current;
  });
}

/** Save new copy/assets. Draft and changes-requested: new version. Approved/scheduled: re-review. */
export async function addVersion(
  db: Database,
  actor: Actor,
  itemId: string,
  input: VersionInput,
  requestId?: string,
) {
  assertCan(actor, 'marketing:content:write');
  return withTransaction(db, async (tx) => {
    const item = await lockItem(tx, itemId);
    const effect = editEffect(item.state);
    if (effect === 'blocked') {
      throw new InvalidStateTransitionError(
        item.state === 'in_review'
          ? 'The item is in review; withdraw it before editing.'
          : `A ${item.state} item cannot be edited; create a new content item instead.`,
        { details: { from: item.state, action: 'edit' } },
      );
    }
    const version = await insertVersion(tx, actor, item, input);
    let state = item.state;
    let check: RuleCheckResult | null = null;
    const set: Partial<typeof marketingContentItems.$inferInsert> = {
      currentVersionId: version.id,
    };
    if (effect === 'revise') {
      state = nextState(item.state, 'revise');
      set.approvedVersionId = null;
      set.approvalId = null;
      // Void the old approval's review and pull scheduled placements back to planned.
      await tx
        .update(marketingContentReviews)
        .set({ outcome: 'voided' })
        .where(
          and(
            eq(marketingContentReviews.contentItemId, item.id),
            eq(marketingContentReviews.outcome, 'approved'),
          ),
        );
      await tx
        .update(marketingPlacements)
        .set({ status: 'planned', scheduledAt: null })
        .where(
          and(
            eq(marketingPlacements.contentItemId, item.id),
            eq(marketingPlacements.status, 'scheduled'),
          ),
        );
    }
    set.state = state;
    const after = await setItem(tx, item.id, set);
    if (effect === 'revise') {
      ({ check } = await openReview(
        tx,
        actor,
        after,
        version,
        input.changeNote ?? 'Revised after approval',
        requestId,
      ));
    }
    await auditMarketing(tx, actor, {
      action:
        effect === 'revise' ? 'content_item.revised_after_approval' : 'content_version.created',
      entityType: 'content_item',
      entityId: item.id,
      before: {
        state: item.state,
        currentVersionId: item.currentVersionId,
        approvedVersionId: item.approvedVersionId,
      },
      after: {
        state,
        currentVersionId: version.id,
        versionNumber: version.versionNumber,
        contentHash: version.contentHash,
      },
      requestId,
    });
    return { item: after, version, approvalVoided: effect === 'revise', ruleCheck: check };
  });
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
    const item = await lockItem(tx, itemId);
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
    const item = await lockItem(tx, itemId);
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
        `Only ${policy.approverRoles.join(' or ')} may decide content approvals (OD-002, ${'proposed'}).`,
      );
    }
    const item = await lockItem(tx, itemId);
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

export async function archiveContentItem(
  db: Database,
  actor: Actor,
  itemId: string,
  reason: string,
  requestId?: string,
) {
  assertCan(actor, 'marketing:content:write');
  return withTransaction(db, async (tx) => {
    const item = await lockItem(tx, itemId);
    const to = nextState(item.state, 'archive');
    await tx
      .update(marketingPlacements)
      .set({
        status: 'cancelled',
        cancelledReason: `Content archived: ${reason}`,
        scheduledAt: null,
      })
      .where(
        and(
          eq(marketingPlacements.contentItemId, item.id),
          inArray(marketingPlacements.status, ['planned', 'scheduled']),
        ),
      );
    const after = await setItem(tx, item.id, { state: to, archivedReason: reason });
    await auditMarketing(tx, actor, {
      action: 'content_item.archived',
      entityType: 'content_item',
      entityId: item.id,
      before: { state: item.state },
      after: { state: to, reason },
      requestId,
    });
    return after;
  });
}

export async function setAssignment(
  db: Database,
  actor: Actor,
  itemId: string,
  input: z.output<typeof assignmentBody>,
  requestId?: string,
) {
  assertCan(actor, 'marketing:content:write');
  return withTransaction(db, async (tx) => {
    const item = await getContentItem(tx, itemId);
    const [before] = await tx
      .select()
      .from(marketingContentAssignments)
      .where(
        and(
          eq(marketingContentAssignments.contentItemId, item.id),
          eq(marketingContentAssignments.role, input.role),
        ),
      );
    let after: typeof before | null = null;
    if (!input.userId && !input.staffMemberId) {
      if (before)
        await tx
          .delete(marketingContentAssignments)
          .where(eq(marketingContentAssignments.id, before.id));
    } else {
      const values = {
        contentItemId: item.id,
        role: input.role,
        userId: (input.userId ?? null) as UserId | null,
        staffMemberId: (input.staffMemberId ?? null) as never,
        assignedBy: actor.id,
        assignedAt: new Date(),
      };
      [after] = await tx
        .insert(marketingContentAssignments)
        .values(values)
        .onConflictDoUpdate({
          target: [marketingContentAssignments.contentItemId, marketingContentAssignments.role],
          set: {
            userId: values.userId,
            staffMemberId: values.staffMemberId,
            assignedBy: actor.id,
            assignedAt: values.assignedAt,
          },
        })
        .returning();
    }
    await auditMarketing(tx, actor, {
      action: 'content_item.assignment_changed',
      entityType: 'content_item',
      entityId: item.id,
      before: before ?? null,
      after,
      requestId,
    });
    return after;
  });
}

export async function addComment(
  db: Database,
  actor: Actor,
  itemId: string,
  input: z.output<typeof commentBody>,
  requestId?: string,
) {
  if (
    !actorCan(actor, 'marketing:content:write') &&
    !actorCan(actor, 'marketing:content:approve')
  ) {
    throw new ForbiddenError('You do not have permission to comment on content.');
  }
  return withTransaction(db, async (tx) => {
    const item = await getContentItem(tx, itemId);
    if (input.versionId) {
      const v = await getVersion(tx, input.versionId);
      if (v.contentItemId !== item.id)
        throw new ValidationError('That version belongs to another item.');
    }
    const [row] = await tx
      .insert(marketingContentComments)
      .values({
        contentItemId: item.id,
        versionId: (input.versionId ??
          item.currentVersionId ??
          null) as MarketingContentVersionId | null,
        authorUserId: actor.id,
        body: input.body,
      })
      .returning();
    await auditMarketing(tx, actor, {
      action: 'content_comment.added',
      entityType: 'content_item',
      entityId: item.id,
      after: { commentId: row!.id },
      requestId,
    });
    return row!;
  });
}

/** Content items needing attention, for the dashboard and lists. */
export async function listContentItems(db: Database, filter: { state?: ContentState } = {}) {
  return db
    .select({
      item: marketingContentItems,
      ideaCode: marketingIdeas.code,
      ideaTitle: marketingIdeas.title,
    })
    .from(marketingContentItems)
    .innerJoin(marketingIdeas, eq(marketingIdeas.id, marketingContentItems.ideaId))
    .where(
      filter.state
        ? eq(marketingContentItems.state, filter.state)
        : ne(marketingContentItems.state, 'archived'),
    )
    .orderBy(desc(marketingContentItems.updatedAt))
    .limit(500);
}
