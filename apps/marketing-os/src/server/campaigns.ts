/**
 * Campaign edit and status change (brief 23 Oct 2026 §9, §12): name, objective, dates, status,
 * course, audience and channels, audited with before/after. Creation stays in groups.ts.
 */
import { asc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import {
  MARKETING_CHANNELS,
  marketingCampaigns,
  programmes,
  type Database,
} from '@elevate/database';
import { InvalidStateTransitionError, ValidationError, withTransaction } from '@elevate/server-kit';
import type { ProgrammeId } from '@elevate/shared-types';
import { CAMPAIGN_STATUSES, type CampaignStatus } from '../domain';
import { assertCan, type Actor } from './access';
import { auditMarketing, rowById } from './common';

export const CHANNEL_LABELS: Record<(typeof MARKETING_CHANNELS)[number], string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  website: 'Website',
  email: 'Email',
  whatsapp: 'WhatsApp',
  online_event: 'Online event',
  in_person: 'In person',
  other: 'Other',
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);

export const updateCampaignBody = z
  .object({
    name: z.string().trim().min(2).max(200),
    objective: optionalText(1000),
    startsOn: z.iso.date().nullable(),
    endsOn: z.iso.date().nullable(),
    status: z.enum(CAMPAIGN_STATUSES),
    /** core.programmes id; null = several or all courses. */
    programmeId: z.uuid().nullable(),
    audience: optionalText(300),
    channels: z
      .array(z.enum(MARKETING_CHANNELS))
      .max(MARKETING_CHANNELS.length * 2)
      .transform((c) => [...new Set(c)]),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'Change at least one field.' });
export type UpdateCampaignInput = z.output<typeof updateCampaignBody>;

/** Status changes a campaign may make; ended and cancelled are final. */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft: ['active', 'cancelled'],
  active: ['ended', 'cancelled'],
  ended: [],
  cancelled: [],
};

/** Courses a campaign can be about (retired ones are left out). */
export function courseOptions(db: Database) {
  return db
    .select({ id: programmes.id, name: programmes.name })
    .from(programmes)
    .where(ne(programmes.status, 'retired'))
    .orderBy(asc(programmes.name));
}

export async function updateCampaign(
  db: Database,
  actor: Actor,
  id: string,
  input: UpdateCampaignInput,
  requestId?: string,
) {
  assertCan(actor, 'marketing:campaigns:write');
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, marketingCampaigns, id, 'Campaign not found.', true);
    const startsOn = input.startsOn === undefined ? before.startsOn : input.startsOn;
    const endsOn = input.endsOn === undefined ? before.endsOn : input.endsOn;
    if (startsOn && endsOn && startsOn > endsOn)
      throw new ValidationError('The start date must not be after the end date.');
    if (
      input.status &&
      input.status !== before.status &&
      !CAMPAIGN_TRANSITIONS[before.status].includes(input.status)
    )
      throw new InvalidStateTransitionError(
        `A ${before.status} campaign cannot become ${input.status}.`,
      );
    if (input.programmeId) {
      const [course] = await tx
        .select({ status: programmes.status })
        .from(programmes)
        .where(eq(programmes.id, input.programmeId as ProgrammeId));
      if (!course || course.status === 'retired')
        throw new ValidationError('Choose a course that exists and is not retired.');
    }
    const [after] = await tx
      .update(marketingCampaigns)
      .set({ ...input, programmeId: input.programmeId as ProgrammeId | null | undefined })
      .where(eq(marketingCampaigns.id, before.id))
      .returning();
    await auditMarketing(tx, actor, {
      action:
        input.status && input.status !== before.status
          ? 'campaign.status_changed'
          : 'campaign.updated',
      entityType: 'campaign',
      entityId: before.id,
      before: Object.fromEntries(
        Object.keys(input).map((k) => [k, before[k as keyof typeof before]]),
      ),
      after: input,
      requestId,
    });
    return after!;
  });
}
