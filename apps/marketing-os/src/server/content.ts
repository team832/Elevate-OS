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
import { and, desc, eq, inArray, ne, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  marketingContentItems,
  marketingContentReviews,
  marketingIdeas,
  marketingPlacements,
  type Database,
} from '@elevate/database';
import { InvalidStateTransitionError, ValidationError, withTransaction } from '@elevate/server-kit';
import { CONTENT_FORMATS, editEffect, type ContentState, type RuleCheckResult } from '../domain';
import { assertCan, type Actor } from './access';
import { auditMarketing, rowById } from './common';
import {
  insertVersion,
  lockItem,
  nextState,
  setItem,
  versionBody,
  type ContentItemRow,
  type VersionInput,
} from './content-records';
import { openReview } from './content-review';

export {
  getContentItem,
  getVersion,
  hashVersion,
  versionBody,
  type ContentItemRow,
  type ContentVersionRow,
  type VersionInput,
} from './content-records';
export {
  contentApprovalPolicy,
  decideContent,
  decisionBody,
  submitForReview,
  withdrawFromReview,
} from './content-review';
export * from './content-collaboration';

export const createContentItemBody = z
  .object({
    title: z.string().trim().min(1).max(300),
    format: z.enum(CONTENT_FORMATS),
    initialVersion: versionBody.optional(),
  })
  .strict();

export const archiveBody = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

/** The rule for a reason, in the service: the REST route and the server action both arrive here. */
export function checkedReason(reason: string): string {
  const r = archiveBody.safeParse({ reason });
  if (!r.success) throw new ValidationError('Give a reason of at least 3 characters.');
  return r.data.reason;
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
        'This idea is quarantined (its legacy ID was used twice); it has no code yet, so no content can be produced under it.',
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
    const item = await lockItem(tx, itemId, actor);
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

export async function archiveContentItem(
  db: Database,
  actor: Actor,
  itemId: string,
  reason: string,
  requestId?: string,
) {
  assertCan(actor, 'marketing:content:write');
  checkedReason(reason);
  return withTransaction(db, async (tx) => {
    const item = await lockItem(tx, itemId, actor);
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

/** Content items needing attention, for the dashboard and lists. */
export async function listContentItems(
  db: Database,
  filter: { state?: ContentState } = {},
  scope?: SQL,
) {
  return db
    .select({
      item: marketingContentItems,
      ideaCode: marketingIdeas.code,
      ideaTitle: marketingIdeas.title,
    })
    .from(marketingContentItems)
    .innerJoin(marketingIdeas, eq(marketingIdeas.id, marketingContentItems.ideaId))
    .where(
      and(
        filter.state
          ? eq(marketingContentItems.state, filter.state)
          : ne(marketingContentItems.state, 'archived'),
        scope,
      ),
    )
    .orderBy(desc(marketingContentItems.updatedAt))
    .limit(500);
}
