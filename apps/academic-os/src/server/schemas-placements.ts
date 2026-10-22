/** Request schemas for batch placements and assignment end dates (ACD-019, owner brief §6 and §8). */
import { z } from 'zod';
import { isoDateSchema } from './schemas';

const reason = z.string().trim().min(1).max(1000);

export const PLACEMENT_VIEWS = ['awaiting', 'placed', 'transfers', 'ended'] as const;
export const placementsQuery = z.object({ view: z.enum(PLACEMENT_VIEWS).default('awaiting') });

export const allocateBody = z
  .object({ enrolmentId: z.uuid(), batchId: z.uuid(), startDate: isoDateSchema.optional(), reason: reason.optional() })
  .strict();

export const transferBody = z
  .object({ enrolmentId: z.uuid(), toBatchId: z.uuid(), effectiveDate: isoDateSchema, reason })
  .strict();

export const endEnrolmentBody = z
  .object({
    enrolmentId: z.uuid(),
    outcome: z.enum(['completed', 'withdrawn']),
    endDate: isoDateSchema,
    reason,
    confirm: z.literal(true, { error: 'Tick the box to confirm this enrolment ends.' }),
  })
  .strict();

export const endAssignmentBody = z.object({ endDate: isoDateSchema }).strict();
