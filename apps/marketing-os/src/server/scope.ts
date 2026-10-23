/**
 * Record scope for marketing employees (brief 23 Oct 2026 §5, PROPOSED-GRANTS-2026-10-23).
 * `marketing:campaigns:read` at `all` (manager, director, auditor) = the whole module. At `own`
 * (marketing employee) = campaigns with an open membership row, and content that is theirs
 * (created by them or assigned to them) or placed in one of those campaigns. Out of scope
 * reads as "not found" (404), never 403, so ids cannot be probed.
 */
import { and, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { scopeFor } from '@elevate/authorization';
import {
  marketingCampaignMembers,
  marketingCampaigns,
  marketingContentAssignments,
  marketingContentItems,
  marketingPlacements,
  staffMembers,
  type Database,
} from '@elevate/database';
import { NotFoundError } from '@elevate/server-kit';
import type { StaffMemberId, UserId } from '@elevate/shared-types';
import type { Actor } from './access';

/** True when the actor reads every campaign and content item (managers, director, auditor). */
export const teamWide = (actor: Actor) => scopeFor(actor, 'marketing:campaigns:read') === 'all';

export async function myStaffId(db: Database, userId: UserId): Promise<StaffMemberId | null> {
  const [row] = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(eq(staffMembers.userId, userId))
    .limit(1);
  return row?.id ?? null;
}

const openCampaignIds = (db: Database, staffId: StaffMemberId) =>
  db
    .select({ id: marketingCampaignMembers.campaignId })
    .from(marketingCampaignMembers)
    .where(
      and(eq(marketingCampaignMembers.staffId, staffId), isNull(marketingCampaignMembers.toDate)),
    );

/** Campaigns the actor is a current member of, whatever their scope ("Assigned campaigns"). */
export async function myCampaignsFilter(db: Database, actor: Actor): Promise<SQL> {
  const staffId = await myStaffId(db, actor.id);
  return staffId ? inArray(marketingCampaigns.id, openCampaignIds(db, staffId)) : sql`false`;
}

/** Campaign rows the actor may read; undefined = all. */
export async function campaignFilter(db: Database, actor: Actor): Promise<SQL | undefined> {
  return teamWide(actor) ? undefined : myCampaignsFilter(db, actor);
}

/** Content the actor created or is assigned to (writer, designer, editor, presenter). */
function mineCondition(db: Database, actor: Actor, staffId: StaffMemberId | null): SQL {
  const assigned = db
    .select({ id: marketingContentAssignments.contentItemId })
    .from(marketingContentAssignments)
    .where(
      or(
        eq(marketingContentAssignments.userId, actor.id),
        staffId ? eq(marketingContentAssignments.staffMemberId, staffId) : undefined,
      ),
    );
  return or(
    eq(marketingContentItems.createdBy, actor.id),
    inArray(marketingContentItems.id, assigned),
  )!;
}

/** "My content" for My Day and Deliverables, for every marketer. */
export async function myContentFilter(db: Database, actor: Actor): Promise<SQL> {
  return mineCondition(db, actor, await myStaffId(db, actor.id));
}

/** Content rows the actor may read; undefined = all. */
export async function contentFilter(db: Database, actor: Actor): Promise<SQL | undefined> {
  if (teamWide(actor)) return undefined;
  const staffId = await myStaffId(db, actor.id);
  const inMyCampaigns = staffId
    ? inArray(
        marketingContentItems.id,
        db
          .select({ id: marketingPlacements.contentItemId })
          .from(marketingPlacements)
          .where(
            and(
              inArray(marketingPlacements.campaignId, openCampaignIds(db, staffId)),
              ne(marketingPlacements.status, 'cancelled'),
            ),
          ),
      )
    : undefined;
  return or(mineCondition(db, actor, staffId), inMyCampaigns);
}

async function assertVisible(
  db: Database,
  table: typeof marketingCampaigns | typeof marketingContentItems,
  filter: SQL | undefined,
  found: SQL,
  message: string,
) {
  if (!filter) return;
  const [row] = await db
    .select({ n: sql`1` })
    .from(table)
    .where(and(found, filter))
    .limit(1);
  if (!row) throw new NotFoundError(message);
}

/** NOT_FOUND unless the actor may read the content item. */
export async function assertContentVisible(db: Database, actor: Actor, id: string) {
  await assertVisible(
    db,
    marketingContentItems,
    await contentFilter(db, actor),
    eq(marketingContentItems.id, id as never),
    'Content item not found.',
  );
}

/**
 * A placement is in scope with its content item; an unlinked (legacy) one only for team-wide
 * readers. Out of scope throws `message`, the same words as a missing record (no existence oracle).
 */
export async function assertPlacementVisible(
  db: Database,
  actor: Actor,
  placement: { contentItemId: string | null },
  message: string,
) {
  if (teamWide(actor)) return;
  if (!placement.contentItemId) throw new NotFoundError(message);
  await assertVisible(
    db,
    marketingContentItems,
    await contentFilter(db, actor),
    eq(marketingContentItems.id, placement.contentItemId as never),
    message,
  );
}

/** NOT_FOUND unless the actor may read the campaign. */
export async function assertCampaignVisible(db: Database, actor: Actor, id: string) {
  await assertVisible(
    db,
    marketingCampaigns,
    await campaignFilter(db, actor),
    eq(marketingCampaigns.id, id as never),
    'Campaign not found.',
  );
}
