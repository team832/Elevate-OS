/**
 * A marketer's own work (brief 23 Oct 2026 §16): My day, Assigned campaigns and Deliverables.
 * The same queries for every marketer; scope comes from who is signed in, never from the URL.
 */
import { and, asc, count, desc, eq, isNull, ne } from 'drizzle-orm';
import {
  marketingCampaignMembers,
  marketingCampaigns,
  marketingContentItems,
  marketingIdeas,
  type Database,
} from '@elevate/database';
import { CONTENT_STATES, type ContentState } from '../domain';
import type { Actor } from './access';
import { myContentFilter, myStaffId } from './scope';

export const MY_PAGE_SIZE = 25;

/** My non-archived content items by state (every state present, 0 when none). */
export async function myContentByState(db: Database, actor: Actor) {
  const rows = await db
    .select({ state: marketingContentItems.state, n: count() })
    .from(marketingContentItems)
    .where(and(await myContentFilter(db, actor), ne(marketingContentItems.state, 'archived')))
    .groupBy(marketingContentItems.state);
  const by = Object.fromEntries(CONTENT_STATES.map((s) => [s, 0])) as Record<ContentState, number>;
  for (const r of rows) by[r.state] = r.n;
  return by;
}

/** My content items (created by me or assigned to me), most recently changed first. */
export async function myContentItems(db: Database, actor: Actor, page = 1) {
  const where = await myContentFilter(db, actor);
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: marketingContentItems.id,
        title: marketingContentItems.title,
        state: marketingContentItems.state,
        updatedAt: marketingContentItems.updatedAt,
        ideaCode: marketingIdeas.code,
      })
      .from(marketingContentItems)
      .innerJoin(marketingIdeas, eq(marketingIdeas.id, marketingContentItems.ideaId))
      .where(where)
      .orderBy(desc(marketingContentItems.updatedAt))
      .limit(MY_PAGE_SIZE)
      .offset((page - 1) * MY_PAGE_SIZE),
    db.select({ n: count() }).from(marketingContentItems).where(where),
  ]);
  return { rows, total: total?.n ?? 0, page, pageSize: MY_PAGE_SIZE };
}

/** Campaigns I am currently on, with my role (null without a staff record). */
export async function myCampaigns(db: Database, actor: Actor) {
  const staffId = await myStaffId(db, actor.id);
  if (!staffId) return null;
  return db
    .select({
      campaign: marketingCampaigns,
      role: marketingCampaignMembers.role,
      fromDate: marketingCampaignMembers.fromDate,
    })
    .from(marketingCampaignMembers)
    .innerJoin(marketingCampaigns, eq(marketingCampaigns.id, marketingCampaignMembers.campaignId))
    .where(
      and(eq(marketingCampaignMembers.staffId, staffId), isNull(marketingCampaignMembers.toDate)),
    )
    .orderBy(asc(marketingCampaigns.code))
    .limit(200);
}
