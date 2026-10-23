/** Read models for the content item screen and API (MKT-020 history view, partial). */
import { asc, desc, eq, inArray } from 'drizzle-orm';
import {
  marketingContentAssets,
  marketingContentAssignments,
  marketingContentComments,
  marketingContentReviews,
  marketingContentVersions,
  marketingIdeas,
  marketingPlacements,
  marketingPublishingAttempts,
  marketingPublishingRecords,
  marketingSocialAccounts,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import { listApprovalHistory } from '@elevate/server-kit';
import type { UserId } from '@elevate/shared-types';
import { allowedContentActions, editEffect } from '../domain';
import type { Actor } from './access';
import { getContentItem } from './content';
import { runRuleCheck } from './rules';

async function userNames(db: Database, ids: readonly (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (list.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .where(inArray(users.id, list as UserId[]));
  return new Map(rows.map((r) => [r.id as string, r.name]));
}

export async function getContentItemDetail(db: Database, id: string, actor?: Actor) {
  const item = await getContentItem(db, id, false, actor);
  const [idea] = await db.select().from(marketingIdeas).where(eq(marketingIdeas.id, item.ideaId));
  const versions = await db
    .select()
    .from(marketingContentVersions)
    .where(eq(marketingContentVersions.contentItemId, item.id))
    .orderBy(desc(marketingContentVersions.versionNumber));
  const assets = versions.length
    ? await db
        .select()
        .from(marketingContentAssets)
        .where(
          inArray(
            marketingContentAssets.versionId,
            versions.map((v) => v.id),
          ),
        )
    : [];
  const reviews = await db
    .select()
    .from(marketingContentReviews)
    .where(eq(marketingContentReviews.contentItemId, item.id))
    .orderBy(asc(marketingContentReviews.createdAt));
  const approvals = await listApprovalHistory(db, {
    module: 'marketing',
    subjectType: 'content_item',
    subjectId: item.id,
  });
  const comments = await db
    .select()
    .from(marketingContentComments)
    .where(eq(marketingContentComments.contentItemId, item.id))
    .orderBy(asc(marketingContentComments.createdAt));
  const assignments = await db
    .select({ a: marketingContentAssignments, staffName: staffMembers.fullName })
    .from(marketingContentAssignments)
    .leftJoin(staffMembers, eq(staffMembers.id, marketingContentAssignments.staffMemberId))
    .where(eq(marketingContentAssignments.contentItemId, item.id));
  const placements = await db
    .select({
      p: marketingPlacements,
      accountCode: marketingSocialAccounts.code,
      platform: marketingSocialAccounts.platform,
    })
    .from(marketingPlacements)
    .innerJoin(
      marketingSocialAccounts,
      eq(marketingSocialAccounts.id, marketingPlacements.accountId),
    )
    .where(eq(marketingPlacements.contentItemId, item.id))
    .orderBy(asc(marketingPlacements.code));
  const records = placements.length
    ? await db
        .select()
        .from(marketingPublishingRecords)
        .where(
          inArray(
            marketingPublishingRecords.placementId,
            placements.map((p) => p.p.id),
          ),
        )
        .orderBy(asc(marketingPublishingRecords.createdAt))
    : [];
  const attempts = records.length
    ? await db
        .select()
        .from(marketingPublishingAttempts)
        .where(
          inArray(
            marketingPublishingAttempts.recordId,
            records.map((r) => r.id),
          ),
        )
        .orderBy(asc(marketingPublishingAttempts.attemptNumber))
    : [];
  const names = await userNames(db, [
    ...versions.map((v) => v.authorUserId),
    ...approvals.flatMap((a) => [a.requestedBy, a.decidedBy]),
    ...comments.map((c) => c.authorUserId),
    ...assignments.map((a) => a.a.userId),
  ]);
  const current = versions.find((v) => v.id === item.currentVersionId) ?? null;
  const ruleCheck = current
    ? await runRuleCheck(db, { itemId: item.id, format: item.format, version: current })
    : null;
  const pendingReview = reviews.find((r) => r.outcome === 'pending') ?? null;
  return {
    item,
    idea: idea ?? null,
    currentVersion: current,
    versions: versions.map((v) => ({
      ...v,
      authorName: names.get(v.authorUserId) ?? null,
      assets: assets.filter((a) => a.versionId === v.id),
      isApproved: v.id === item.approvedVersionId,
    })),
    ruleCheck,
    pendingReview,
    reviews,
    approvals: approvals.map((a) => ({
      ...a,
      requestedByName: names.get(a.requestedBy) ?? null,
      decidedByName: a.decidedBy ? (names.get(a.decidedBy) ?? null) : null,
      review: reviews.find((r) => r.approvalId === a.id) ?? null,
    })),
    comments: comments.map((c) => ({ ...c, authorName: names.get(c.authorUserId) ?? null })),
    assignments: assignments.map((a) => ({
      ...a.a,
      userName: a.a.userId ? (names.get(a.a.userId) ?? null) : null,
      staffName: a.staffName,
    })),
    placements: placements.map((p) => ({
      ...p.p,
      accountCode: p.accountCode,
      platform: p.platform,
      publishingRecords: records
        .filter((r) => r.placementId === p.p.id)
        .map((r) => ({ ...r, attemptLog: attempts.filter((x) => x.recordId === r.id) })),
    })),
    allowedActions: allowedContentActions(item.state),
    editEffect: editEffect(item.state),
  };
}

export type ContentItemDetail = Awaited<ReturnType<typeof getContentItemDetail>>;
