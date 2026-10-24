/** zod inputs for lead stages and the call log (brief §11); services take their output types. */
import { z } from 'zod';
import { isoDateSchema } from '@elevate/shared-contracts';
import { OPS_ACTIVITY_OUTCOMES, OPS_CALL_DIRECTIONS } from '@elevate/database';
import { activityBody } from './schemas';

const reason = z.string().trim().max(500).nullish();
const label = z.string().trim().min(1).max(60);
const sortOrder = z.number().int().min(0).max(10_000);

export const stageKeyParams = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/) });
export const stageChangeBody = z.object({ stageKey: z.string().min(1).max(40), reason });
export const stageCreateBody = z.object({
  key: stageKeyParams.shape.key,
  label,
  sortOrder: sortOrder.default(500),
  kind: z.enum(['open', 'lost', 'parked']).default('open'),
  requiresReason: z.boolean().default(false),
});
export const stageUpdateBody = z
  .object({
    label: label.optional(),
    sortOrder: sortOrder.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Change at least one field.');

/** Call details staff type in; nothing is measured by the app. */
const callFields = {
  direction: z.enum(OPS_CALL_DIRECTIONS).nullish(),
  durationMinutes: z.number().int().min(0).max(1440).nullish(),
  nextAction: z.string().trim().max(300).nullish(),
  nextFollowUpOn: isoDateSchema.nullish(),
};
export const contactActivityBody = activityBody.extend(callFields);
export type ContactActivityInput = z.output<typeof contactActivityBody>;

export const callBody = contactActivityBody
  .omit({ kind: true })
  .extend({ leadId: z.uuid(), direction: z.enum(OPS_CALL_DIRECTIONS) });

export const callListQuery = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  direction: z.enum(OPS_CALL_DIRECTIONS).optional(),
  outcome: z.enum(OPS_ACTIVITY_OUTCOMES).optional(),
  staffId: z.uuid().optional(),
  leadId: z.uuid().optional(),
});
export type CallFilters = z.output<typeof callListQuery>;
