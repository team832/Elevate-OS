/** Scheduling placements: schedule or reschedule (conflict checks), unschedule, cancel. */
import { and, eq, gte, lt, ne } from 'drizzle-orm';
import { z } from 'zod';
import {
  marketingPlacements,
  marketingSocialAccounts,
  type Database,
  type MarketingPlacementId,
} from '@elevate/database';
import { InvalidStateTransitionError, withTransaction } from '@elevate/server-kit';
import { detectScheduleConflicts, type ScheduleCandidate, type ScheduleConflict } from '../domain';
import { assertCan, type Actor } from './access';
import { auditMarketing } from './common';
import { cadenceOf } from './accounts';
import { checkedReason, getContentItem, getVersion, type ContentItemRow } from './content';
import { accountOf, approvalValidity, itemTransition, lockPlacement } from './placement-checks';
import { loadPolicy } from './policy';
import { runRuleCheck } from './rules';
import { assertPlacementVisible } from './scope';

export const scheduleBody = z.object({ publishAt: z.iso.datetime({ offset: true }) }).strict();
export const cancelBody = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

async function scheduledSlotsAround(tx: Database, at: Date, excludeId: string) {
  const from = new Date(at.getTime() - 8 * 86_400_000);
  const to = new Date(at.getTime() + 8 * 86_400_000);
  const rows = await tx
    .select({
      id: marketingPlacements.id,
      code: marketingPlacements.code,
      ideaId: marketingPlacements.ideaId,
      at: marketingPlacements.scheduledAt,
      groupId: marketingPlacements.placementGroupId,
      accountCode: marketingSocialAccounts.code,
    })
    .from(marketingPlacements)
    .innerJoin(
      marketingSocialAccounts,
      eq(marketingSocialAccounts.id, marketingPlacements.accountId),
    )
    .where(
      and(
        eq(marketingPlacements.status, 'scheduled'),
        gte(marketingPlacements.scheduledAt, from),
        lt(marketingPlacements.scheduledAt, to),
        ne(marketingPlacements.id, excludeId as MarketingPlacementId),
      ),
    );
  return rows.map((r) => ({
    placementId: r.id as string,
    placementCode: r.code,
    ideaId: r.ideaId,
    accountCode: r.accountCode,
    at: r.at!,
    groupId: r.groupId,
  }));
}

export async function schedulePlacement(
  db: Database,
  actor: Actor,
  placementId: string,
  input: z.output<typeof scheduleBody>,
  requestId?: string,
  now: Date = new Date(),
) {
  assertCan(actor, 'marketing:schedule:manage');
  const at = new Date(input.publishAt);
  return withTransaction(db, async (tx) => {
    const placement = await lockPlacement(tx, placementId);
    if (placement.status !== 'planned' && placement.status !== 'scheduled') {
      throw new InvalidStateTransitionError(`A ${placement.status} placement cannot be scheduled.`);
    }
    if (!placement.contentItemId)
      throw new InvalidStateTransitionError('This legacy placement is not linked to content.');
    const item = await getContentItem(tx, placement.contentItemId);
    const account = await accountOf(tx, placement);
    const policy = await loadPolicy(tx);
    const approval = await approvalValidity(tx, item);
    const hard: ScheduleConflict[] = [];
    if (approval.valid && item.approvedVersionId) {
      const version = await getVersion(tx, item.approvedVersionId);
      const check = await runRuleCheck(tx, {
        itemId: item.id,
        format: item.format,
        version,
        accountCodes: [account.code],
      });
      for (const b of check.blocking) {
        hard.push({
          code: 'NOT_APPROVED',
          severity: 'hard',
          message: `Brand rule ${b.ruleCode} blocks this version on ${account.code}: ${b.description}`,
          accountCode: account.code,
          relatedPlacementIds: [],
        });
      }
    }
    const candidate: ScheduleCandidate = {
      placementId: placement.id,
      placementCode: placement.code,
      ideaId: placement.ideaId,
      accountCode: account.code,
      at,
      groupId: placement.placementGroupId,
      approval,
    };
    const result = detectScheduleConflicts(
      candidate,
      await scheduledSlotsAround(tx, at, placement.id),
      [cadenceOf(account)],
      policy,
      now,
    );
    result.hard.push(...hard);
    if (result.hard.length > 0) {
      throw new InvalidStateTransitionError('Scheduling is blocked.', {
        details: { hard: result.hard, warnings: result.warnings },
      });
    }
    const [after] = await tx
      .update(marketingPlacements)
      .set({
        status: 'scheduled',
        scheduledAt: at,
        originalPublishAt: placement.originalPublishAt ?? at,
      })
      .where(eq(marketingPlacements.id, placement.id))
      .returning();
    const itemState = await itemTransition(tx, item, 'schedule');
    await auditMarketing(tx, actor, {
      action: placement.status === 'scheduled' ? 'placement.rescheduled' : 'placement.scheduled',
      entityType: 'placement',
      entityId: placement.id,
      before: { status: placement.status, scheduledAt: placement.scheduledAt },
      after: { status: 'scheduled', scheduledAt: at, itemState },
      requestId,
      metadata: { warnings: result.warnings.map((w) => w.code) },
    });
    return { placement: after!, warnings: result.warnings };
  });
}

async function afterPlacementLeavesSchedule(
  tx: Database,
  item: ContentItemRow,
  placementId: string,
) {
  if (item.state !== 'scheduled') return item.state;
  const others = await tx
    .select({ id: marketingPlacements.id })
    .from(marketingPlacements)
    .where(
      and(
        eq(marketingPlacements.contentItemId, item.id),
        eq(marketingPlacements.status, 'scheduled'),
        ne(marketingPlacements.id, placementId as MarketingPlacementId),
      ),
    );
  if (others.length > 0) return item.state;
  return itemTransition(tx, item, 'unschedule');
}

export async function unschedulePlacement(
  db: Database,
  actor: Actor,
  placementId: string,
  requestId?: string,
) {
  assertCan(actor, 'marketing:schedule:manage');
  return withTransaction(db, async (tx) => {
    const placement = await lockPlacement(tx, placementId);
    if (placement.status !== 'scheduled')
      throw new InvalidStateTransitionError('Only scheduled placements can be unscheduled.');
    const [after] = await tx
      .update(marketingPlacements)
      .set({ status: 'planned', scheduledAt: null })
      .where(eq(marketingPlacements.id, placement.id))
      .returning();
    const itemState = placement.contentItemId
      ? await afterPlacementLeavesSchedule(
          tx,
          await getContentItem(tx, placement.contentItemId),
          placement.id,
        )
      : null;
    await auditMarketing(tx, actor, {
      action: 'placement.unscheduled',
      entityType: 'placement',
      entityId: placement.id,
      before: { status: 'scheduled', scheduledAt: placement.scheduledAt },
      after: { status: 'planned', itemState },
      requestId,
    });
    return after!;
  });
}

export async function cancelPlacement(
  db: Database,
  actor: Actor,
  placementId: string,
  reason: string,
  requestId?: string,
) {
  checkedReason(reason);
  return withTransaction(db, async (tx) => {
    const placement = await lockPlacement(tx, placementId);
    await assertPlacementVisible(tx, actor, placement, 'Placement not found.');
    assertCan(
      actor,
      placement.status === 'scheduled' ? 'marketing:schedule:manage' : 'marketing:content:write',
    );
    if (placement.status !== 'planned' && placement.status !== 'scheduled') {
      throw new InvalidStateTransitionError(`A ${placement.status} placement cannot be cancelled.`);
    }
    const [after] = await tx
      .update(marketingPlacements)
      .set({ status: 'cancelled', cancelledReason: reason, scheduledAt: null })
      .where(eq(marketingPlacements.id, placement.id))
      .returning();
    if (placement.status === 'scheduled' && placement.contentItemId) {
      await afterPlacementLeavesSchedule(
        tx,
        await getContentItem(tx, placement.contentItemId),
        placement.id,
      );
    }
    await auditMarketing(tx, actor, {
      action: 'placement.cancelled',
      entityType: 'placement',
      entityId: placement.id,
      before: { status: placement.status },
      after: { status: 'cancelled', reason },
      requestId,
    });
    return after!;
  });
}
