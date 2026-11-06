/** Who works on a content item (assignments) and what they say about it (comments). */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  marketingContentAssignments,
  marketingContentComments,
  staffMembers,
  type Database,
  type MarketingContentVersionId,
} from '@elevate/database';
import { ForbiddenError, ValidationError, withTransaction } from '@elevate/server-kit';
import type { UserId } from '@elevate/shared-types';
import { ASSIGNEE_ROLES } from '../domain';
import { actorCan, assertCan, type Actor } from './access';
import { memberOptions } from './campaign-members';
import { auditMarketing } from './common';
import { getContentItem, getVersion } from './content-records';
import { teamWide } from './scope';

export const assignmentBody = z
  .object({
    role: z.enum(ASSIGNEE_ROLES),
    userId: z.uuid().nullable().optional(),
    staffMemberId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine((v) => !(v.userId && v.staffMemberId), {
    error: 'Name one person: a user or a staff member.',
  });

export const commentBody = z
  .object({ body: z.string().trim().min(1).max(4000), versionId: z.uuid().optional() })
  .strict();

/** Assigning grants access to the content: only who the picker offers, active Marketing & Growth staff. */
async function assertAssignable(
  db: Database,
  { userId, staffMemberId }: z.output<typeof assignmentBody>,
) {
  if (!userId && !staffMemberId) return;
  const [byUser] = userId
    ? await db
        .select({ id: staffMembers.id })
        .from(staffMembers)
        .where(eq(staffMembers.userId, userId as UserId))
    : [];
  const staffId = staffMemberId ?? byUser?.id;
  if (!staffId || !(await memberOptions(db, staffId)).length)
    throw new ValidationError('Only active Marketing & Growth staff can be assigned to content.');
}

export async function setAssignment(
  db: Database,
  actor: Actor,
  itemId: string,
  input: z.output<typeof assignmentBody>,
  requestId?: string,
) {
  assertCan(actor, 'marketing:content:write');
  // Assigning people grants access to the content (scope.ts), so only team-wide readers may.
  if (!teamWide(actor))
    throw new ForbiddenError('Only a marketing manager assigns people to content.');
  return withTransaction(db, async (tx) => {
    const item = await getContentItem(tx, itemId, false, actor);
    await assertAssignable(tx, input);
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
    const item = await getContentItem(tx, itemId, false, actor);
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
