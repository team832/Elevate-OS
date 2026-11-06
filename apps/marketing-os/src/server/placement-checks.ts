/** Placement reads plus the approval and state checks shared by scheduling and publishing. */
import { eq } from 'drizzle-orm';
import {
  approvals,
  marketingContentItems,
  marketingPlacements,
  marketingSocialAccounts,
  type Database,
} from '@elevate/database';
import { InvalidStateTransitionError } from '@elevate/server-kit';
import { checkPublishEligibility, transitionContent } from '../domain';
import { rowById } from './common';
import type { ContentItemRow } from './content';

export type PlacementRow = typeof marketingPlacements.$inferSelect;

export const lockPlacement = (db: Database, id: string) =>
  rowById(db, marketingPlacements, id, 'Placement not found.', true);

export const accountOf = (db: Database, placement: PlacementRow) =>
  rowById(db, marketingSocialAccounts, placement.accountId, 'Account not found.');

/** Valid approval = approved state family + approved version is current + core approval approved. */
export async function approvalValidity(
  db: Database,
  item: ContentItemRow,
): Promise<{ valid: boolean; reason?: string }> {
  if (!['approved', 'scheduled', 'published'].includes(item.state)) {
    return {
      valid: false,
      reason: `The content item is ${item.state.replace('_', ' ')}, not approved (AP-001).`,
    };
  }
  if (!item.approvalId || !item.approvedVersionId) {
    return {
      valid: false,
      reason: 'No approval record exists in Elevate OS for this item (legacy state only).',
    };
  }
  if (item.approvedVersionId !== item.currentVersionId) {
    return {
      valid: false,
      reason: 'The current version is not the approved one; it needs re-approval.',
    };
  }
  const [a] = await db
    .select({ status: approvals.status })
    .from(approvals)
    .where(eq(approvals.id, item.approvalId));
  if (a?.status !== 'approved')
    return { valid: false, reason: 'The approval record is not in the approved state.' };
  return { valid: true };
}

/** Refuses publishing unless the placement and its approved, current version allow it. */
export async function assertPublishable(
  tx: Database,
  placement: PlacementRow,
  item: ContentItemRow,
) {
  const eligibility = checkPublishEligibility({
    placementStatus: placement.status,
    contentState: item.state,
    approvalApproved: (await approvalValidity(tx, item)).valid,
    approvedVersionId: item.approvedVersionId,
    currentVersionId: item.currentVersionId,
  });
  if (!eligibility.ok)
    throw new InvalidStateTransitionError(eligibility.message, {
      details: { reason: eligibility.code },
    });
}

export async function itemTransition(
  tx: Database,
  item: ContentItemRow,
  action: 'schedule' | 'unschedule' | 'publish',
) {
  const t = transitionContent(item.state, action);
  if (!t.ok) throw new InvalidStateTransitionError(t.reason);
  if (t.to !== item.state) {
    await tx
      .update(marketingContentItems)
      .set({ state: t.to })
      .where(eq(marketingContentItems.id, item.id));
  }
  return t.to;
}
