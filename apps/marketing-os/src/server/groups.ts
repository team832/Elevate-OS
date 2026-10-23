/** Collab placement groups (BR-MKT-4, CH-006) and campaigns (MKT-018, organic only). */
import { and, asc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  isUniqueViolation,
  marketingCampaigns,
  marketingIdeas,
  marketingPlacementGroups,
  marketingPlacements,
  marketingSocialAccounts,
  type Database,
  type MarketingPlacementId,
} from '@elevate/database';
import {
  ConflictError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
  withTransaction,
} from '@elevate/server-kit';
import type { CampaignId } from '@elevate/shared-types';
import {
  CAMPAIGN_STATUSES,
  isCampaignCode,
  validateCollabGroup,
  type CollabValidation,
} from '../domain';
import { assertCan, type Actor } from './access';
import { auditMarketing, rowById } from './common';
import { assertPlacementVisible, teamWide } from './scope';

export const createGroupBody = z
  .object({
    ideaId: z.uuid(),
    platform: z.enum(['instagram', 'youtube']),
    placementIds: z.array(z.uuid()).min(2).max(10),
  })
  .strict();

async function membersOf(db: Database, placementIds: readonly string[]) {
  return db
    .select({
      placement: marketingPlacements,
      accountCode: marketingSocialAccounts.code,
      platform: marketingSocialAccounts.platform,
      scope: marketingSocialAccounts.scope,
      examPrefixes: marketingSocialAccounts.examPrefixes,
    })
    .from(marketingPlacements)
    .innerJoin(
      marketingSocialAccounts,
      eq(marketingSocialAccounts.id, marketingPlacements.accountId),
    )
    .where(inArray(marketingPlacements.id, placementIds as MarketingPlacementId[]));
}

export async function createPlacementGroup(
  db: Database,
  actor: Actor,
  input: z.output<typeof createGroupBody>,
  requestId?: string,
): Promise<{ group: typeof marketingPlacementGroups.$inferSelect; validation: CollabValidation }> {
  assertCan(actor, 'marketing:schedule:manage');
  return withTransaction(db, async (tx) => {
    const [idea] = await tx
      .select()
      .from(marketingIdeas)
      .where(eq(marketingIdeas.id, input.ideaId as never));
    if (!idea?.code) throw new NotFoundError('Idea not found (or quarantined without a code).');
    const members = await membersOf(tx, input.placementIds);
    if (members.length !== new Set(input.placementIds).size)
      throw new NotFoundError('One or more placements were not found.');
    for (const m of members) {
      if (m.placement.ideaId !== idea.id)
        throw new ValidationError(`${m.placement.code} belongs to another idea.`);
      if (m.placement.status === 'cancelled' || m.placement.status === 'published') {
        throw new InvalidStateTransitionError(`${m.placement.code} is ${m.placement.status}.`);
      }
      if (m.placement.placementGroupId)
        throw new ConflictError(`${m.placement.code} is already in a collab.`);
    }
    const validation = validateCollabGroup(
      { code: idea.code, scope: idea.scope, scopePrefixes: idea.scopePrefixes },
      input.platform,
      members.map((m) => ({
        placementId: m.placement.id,
        accountCode: m.accountCode,
        platform: m.platform,
        scope: m.scope,
        examPrefixes: m.examPrefixes,
      })),
    );
    if (!validation.valid) {
      throw new ValidationError('This collab breaks the collab rule (BR-MKT-4).', {
        details: validation,
      });
    }
    const code = `${idea.code}-COLLAB-${input.platform === 'instagram' ? 'IG' : 'YT'}`;
    try {
      const [group] = await tx
        .insert(marketingPlacementGroups)
        .values({ code, ideaId: idea.id, platform: input.platform, createdBy: actor.id })
        .returning();
      await tx
        .update(marketingPlacements)
        .set({ placementGroupId: group!.id })
        .where(
          and(
            inArray(marketingPlacements.id, input.placementIds as MarketingPlacementId[]),
            isNull(marketingPlacements.placementGroupId),
          ),
        );
      await auditMarketing(tx, actor, {
        action: 'placement_group.created',
        entityType: 'placement_group',
        entityId: group!.id,
        after: {
          ...group,
          members: members.map((m) => m.placement.code),
          warnings: validation.warnings,
        },
        requestId,
      });
      return { group: group!, validation };
    } catch (error) {
      if (isUniqueViolation(error, 'placement_groups_code_key')) {
        throw new ConflictError(`${code} already exists for this idea and platform.`);
      }
      throw error;
    }
  });
}

const NO_GROUP = 'Collab group not found.';

/** The group with its placements; NOT_FOUND unless every placement is in the actor's scope. */
export async function getPlacementGroup(db: Database, id: string, actor: Actor) {
  const group = await rowById(db, marketingPlacementGroups, id, NO_GROUP);
  const [idea] = await db.select().from(marketingIdeas).where(eq(marketingIdeas.id, group.ideaId));
  const ids = (
    await db
      .select({ id: marketingPlacements.id })
      .from(marketingPlacements)
      .where(eq(marketingPlacements.placementGroupId, group.id))
  ).map((r) => r.id);
  const members = ids.length ? await membersOf(db, ids) : [];
  if (!teamWide(actor)) {
    // Empty or out-of-scope groups read exactly like a missing one.
    if (!members.length) throw new NotFoundError(NO_GROUP);
    for (const m of members) await assertPlacementVisible(db, actor, m.placement, NO_GROUP);
  }
  const validation = validateCollabGroup(
    { code: idea!.code, scope: idea!.scope, scopePrefixes: idea!.scopePrefixes },
    group.platform,
    members.map((m) => ({
      accountCode: m.accountCode,
      platform: m.platform,
      scope: m.scope,
      examPrefixes: m.examPrefixes,
    })),
  );
  return {
    group,
    members: members.map((m) => ({ ...m.placement, accountCode: m.accountCode })),
    validation,
  };
}

export const createCampaignBody = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .refine(isCampaignCode, 'Use upper-case letters, digits and dashes (2–40).'),
    name: z.string().trim().min(2).max(200),
    objective: z.string().trim().max(1000).nullable().optional(),
    startsOn: z.iso.date().nullable().optional(),
    endsOn: z.iso.date().nullable().optional(),
    status: z.enum(CAMPAIGN_STATUSES).default('draft'),
  })
  .strict()
  .refine((v) => !v.startsOn || !v.endsOn || v.startsOn <= v.endsOn, {
    error: 'startsOn must not be after endsOn',
  });

export const placementCampaignBody = z.object({ campaignId: z.uuid().nullable() }).strict();

/** Campaigns, narrowed by `scope` (scope.ts campaignFilter) when given. */
export async function listCampaigns(db: Database, scope?: SQL) {
  return db.select().from(marketingCampaigns).where(scope).orderBy(asc(marketingCampaigns.code));
}

export async function createCampaign(
  db: Database,
  actor: Actor,
  input: z.output<typeof createCampaignBody>,
  requestId?: string,
) {
  assertCan(actor, 'marketing:campaigns:write');
  return withTransaction(db, async (tx) => {
    try {
      const [row] = await tx
        .insert(marketingCampaigns)
        .values({
          code: input.code,
          name: input.name,
          objective: input.objective ?? null,
          startsOn: input.startsOn ?? null,
          endsOn: input.endsOn ?? null,
          status: input.status,
          createdBy: actor.id,
        })
        .returning();
      await auditMarketing(tx, actor, {
        action: 'campaign.created',
        entityType: 'campaign',
        entityId: row!.id,
        after: row,
        requestId,
      });
      return row!;
    } catch (error) {
      if (isUniqueViolation(error, 'campaigns_code_key'))
        throw new ConflictError(`Campaign ${input.code} already exists.`);
      throw error;
    }
  });
}

export async function setPlacementCampaign(
  db: Database,
  actor: Actor,
  placementId: string,
  campaignId: string | null,
  requestId?: string,
) {
  assertCan(actor, 'marketing:campaigns:write');
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, marketingPlacements, placementId, 'Placement not found.');
    if (campaignId) await rowById(tx, marketingCampaigns, campaignId, 'Campaign not found.');
    const [after] = await tx
      .update(marketingPlacements)
      .set({ campaignId: campaignId as CampaignId | null })
      .where(eq(marketingPlacements.id, before.id))
      .returning();
    await auditMarketing(tx, actor, {
      action: 'placement.campaign_changed',
      entityType: 'placement',
      entityId: before.id,
      before: { campaignId: before.campaignId },
      after: { campaignId },
      requestId,
    });
    return after!;
  });
}
