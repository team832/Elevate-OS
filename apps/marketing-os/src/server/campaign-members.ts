/**
 * Campaign owner and members over time (brief 23 Oct 2026 §5/§16): a marketing manager adds
 * people and ends their membership; rows are never deleted, so history stays. Audited.
 */
import { and, asc, desc, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import {
  MARKETING_CAMPAIGN_MEMBER_ROLES,
  departments,
  isUniqueViolation,
  marketingCampaignMembers,
  marketingCampaigns,
  staffMembers,
  type Database,
} from '@elevate/database';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  withTransaction,
} from '@elevate/server-kit';
import { toIsoDate } from '@elevate/shared-types';
import { assertCan, type Actor } from './access';
import { auditMarketing, rowById } from './common';

export const CAMPAIGN_MEMBER_ROLE_LABELS = { owner: 'Owner', member: 'Member' } as const;

/** Membership dates take effect at once (scope reads open rows), so none may be in the future. */
const pastOrToday = z.iso
  .date()
  .refine((d) => d <= toIsoDate(), 'The date cannot be in the future (IST).')
  .optional();

export const addMemberBody = z
  .object({
    staffId: z.uuid(),
    role: z.enum(MARKETING_CAMPAIGN_MEMBER_ROLES).default('member'),
    /** Omitted: today (IST). */
    fromDate: pastOrToday,
  })
  .strict();

export const endMemberBody = z
  .object({ /** Omitted: today (IST). */ toDate: pastOrToday })
  .strict();

/** Current members first, then past ones, newest first. */
export async function listCampaignMembers(db: Database, campaignId: string) {
  return db
    .select({
      id: marketingCampaignMembers.id,
      staffId: marketingCampaignMembers.staffId,
      staffName: staffMembers.fullName,
      role: marketingCampaignMembers.role,
      fromDate: marketingCampaignMembers.fromDate,
      toDate: marketingCampaignMembers.toDate,
    })
    .from(marketingCampaignMembers)
    .innerJoin(staffMembers, eq(staffMembers.id, marketingCampaignMembers.staffId))
    .where(eq(marketingCampaignMembers.campaignId, campaignId as never))
    .orderBy(
      desc(isNull(marketingCampaignMembers.toDate)),
      desc(marketingCampaignMembers.fromDate),
      asc(staffMembers.fullName),
    );
}

/** People who can be added: active staff in Marketing & Growth (a short list, not all staff). */
export async function memberOptions(db: Database, staffId?: string) {
  return db
    .select({ id: staffMembers.id, name: staffMembers.fullName })
    .from(staffMembers)
    .innerJoin(departments, eq(departments.id, staffMembers.departmentId))
    .where(
      and(
        eq(departments.code, 'MARKETING_GROWTH'),
        ne(staffMembers.status, 'inactive'),
        staffId ? eq(staffMembers.id, staffId as never) : undefined,
      ),
    )
    .orderBy(asc(staffMembers.fullName))
    .limit(200);
}

export async function addCampaignMember(
  db: Database,
  actor: Actor,
  campaignId: string,
  input: z.output<typeof addMemberBody>,
  requestId?: string,
) {
  assertCan(actor, 'marketing:campaigns:write');
  return withTransaction(db, async (tx) => {
    const campaign = await rowById(tx, marketingCampaigns, campaignId, 'Campaign not found.');
    const [staff] = await memberOptions(tx, input.staffId);
    if (!staff)
      throw new ValidationError('Only active Marketing & Growth staff can join a campaign.');
    try {
      const [row] = await tx
        .insert(marketingCampaignMembers)
        .values({
          campaignId: campaign.id,
          staffId: staff.id,
          role: input.role,
          fromDate: input.fromDate ?? toIsoDate(),
          addedBy: actor.id,
        })
        .returning();
      await auditMarketing(tx, actor, {
        action: 'campaign.member_added',
        entityType: 'campaign',
        entityId: campaign.id,
        after: row,
        requestId,
      });
      return row!;
    } catch (error) {
      if (isUniqueViolation(error, 'campaign_members_active_key'))
        throw new ConflictError(`${staff.name} is already on ${campaign.code}.`);
      throw error;
    }
  });
}

export async function endCampaignMember(
  db: Database,
  actor: Actor,
  campaignId: string,
  memberId: string,
  input: z.output<typeof endMemberBody>,
  requestId?: string,
) {
  assertCan(actor, 'marketing:campaigns:write');
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, marketingCampaignMembers, memberId, 'Member not found.', true);
    if (before.campaignId !== campaignId) throw new NotFoundError('Member not found.');
    if (before.toDate) throw new ConflictError('This membership has already ended.');
    const toDate = input.toDate ?? toIsoDate();
    if (toDate < before.fromDate)
      throw new ValidationError('The end date cannot be before the start date.');
    const [after] = await tx
      .update(marketingCampaignMembers)
      .set({ toDate })
      .where(eq(marketingCampaignMembers.id, before.id))
      .returning();
    await auditMarketing(tx, actor, {
      action: 'campaign.member_ended',
      entityType: 'campaign',
      entityId: before.campaignId,
      before,
      after,
      requestId,
    });
    return after!;
  });
}
