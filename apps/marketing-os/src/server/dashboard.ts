/** Dashboard counts — real counts of Elevate OS records; nothing is estimated or padded. */
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import {
  approvals,
  marketingContentItems,
  marketingIdeas,
  marketingLegacyConflicts,
  marketingPlacements,
  marketingSocialAccounts,
  type Database,
} from '@elevate/database';
import { CONTENT_STATES, type ContentState } from '../domain';
import { countByIntegrationStatus } from './accounts';

export async function loadDashboard(db: Database, now: Date = new Date()) {
  const items = await db
    .select({
      id: marketingContentItems.id,
      state: marketingContentItems.state,
      legacyRef: marketingContentItems.legacyRef,
    })
    .from(marketingContentItems);
  const byState = Object.fromEntries(CONTENT_STATES.map((s) => [s, 0])) as Record<
    ContentState,
    number
  >;
  const legacyByState = { ...byState };
  for (const i of items) {
    byState[i.state] += 1;
    if (i.legacyRef) legacyByState[i.state] += 1;
  }
  const awaiting = await db
    .select({
      id: marketingContentItems.id,
      title: marketingContentItems.title,
      updatedAt: marketingContentItems.updatedAt,
      approvalId: marketingContentItems.approvalId,
      legacyRef: marketingContentItems.legacyRef,
      ideaCode: marketingIdeas.code,
    })
    .from(marketingContentItems)
    .innerJoin(marketingIdeas, eq(marketingIdeas.id, marketingContentItems.ideaId))
    .where(eq(marketingContentItems.state, 'in_review'))
    .orderBy(asc(marketingContentItems.updatedAt));
  const pending = awaiting.length
    ? await db
        .select({ subjectId: approvals.subjectId })
        .from(approvals)
        .where(
          and(
            eq(approvals.status, 'pending'),
            eq(approvals.subjectModule, 'marketing'),
            inArray(
              approvals.subjectId,
              awaiting.map((a) => a.id),
            ),
          ),
        )
    : [];
  const pendingIds = new Set(pending.map((p) => p.subjectId));
  const horizon = new Date(now.getTime() + 7 * 86_400_000);
  const upcoming = await db
    .select({
      id: marketingPlacements.id,
      code: marketingPlacements.code,
      scheduledAt: marketingPlacements.scheduledAt,
      accountCode: marketingSocialAccounts.code,
      contentItemId: marketingPlacements.contentItemId,
      title: marketingContentItems.title,
    })
    .from(marketingPlacements)
    .innerJoin(
      marketingSocialAccounts,
      eq(marketingSocialAccounts.id, marketingPlacements.accountId),
    )
    .leftJoin(
      marketingContentItems,
      eq(marketingContentItems.id, marketingPlacements.contentItemId),
    )
    .where(
      and(
        eq(marketingPlacements.status, 'scheduled'),
        gte(marketingPlacements.scheduledAt, now),
        lt(marketingPlacements.scheduledAt, horizon),
      ),
    )
    .orderBy(asc(marketingPlacements.scheduledAt));
  const overdue = await db
    .select({
      id: marketingPlacements.id,
      code: marketingPlacements.code,
      scheduledAt: marketingPlacements.scheduledAt,
    })
    .from(marketingPlacements)
    .where(
      and(eq(marketingPlacements.status, 'scheduled'), lt(marketingPlacements.scheduledAt, now)),
    );
  const accounts = await db.select().from(marketingSocialAccounts);
  const ideas = await db
    .select({ status: marketingIdeas.status, q: marketingIdeas.quarantineState })
    .from(marketingIdeas);
  const conflicts = await db
    .select()
    .from(marketingLegacyConflicts)
    .where(eq(marketingLegacyConflicts.status, 'unreconciled'));
  return {
    asOf: now.toISOString(),
    totalItems: items.length,
    itemsByState: byState,
    legacyItemsByState: legacyByState,
    awaitingApproval: awaiting.map((a) => ({ ...a, hasApprovalRequest: pendingIds.has(a.id) })),
    upcomingScheduled: upcoming,
    overdueScheduled: overdue,
    accountsByIntegration: countByIntegrationStatus(accounts),
    accountCount: accounts.length,
    ideasTotal: ideas.length,
    ideasQuarantined: ideas.filter((i) => i.q === 'quarantined').length,
    unreconciledConflicts: conflicts,
  };
}
