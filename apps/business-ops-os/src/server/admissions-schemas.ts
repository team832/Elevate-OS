/**
 * Request schemas for the admissions-administration routes (OPS-070…079):
 * reason-coded transitions, fee records, student directory, handoff retry,
 * contact preferences, admissions report. Kept apart from ./schemas.ts (shared).
 */
import { z } from 'zod';
import { isoDateSchema } from '@elevate/shared-contracts';
import { ADMISSION_STATUSES } from '../domain';
import { FEE_DIRECTIONS, FEE_METHODS, FEE_RECORD_KINDS } from '../domain/fees';
import { DIRECTORY_STATES } from '../domain/students';

const optText = (max: number) => z.string().trim().max(max).nullish();
const reasonCode = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, { error: 'Unknown reason code' })
  .nullish();

/** POST /admissions/{id}/transitions — the shared body plus an optional reason code. */
export const codedTransitionBody = z.object({
  to: z.enum(ADMISSION_STATUSES),
  reason: optText(1000),
  reasonCode,
});

/**
 * POST /admissions/{id}/fees — exactly one of `amountPaise` (integer paise) or
 * `amountRupees` (decimal text, e.g. "1000.50", parsed without floating point).
 * The integer/positive/limit rules are checked in domain/fees.ts so every
 * problem is reported with its field path.
 */
export const feeRecordBody = z
  .object({
    kind: z.enum(FEE_RECORD_KINDS),
    direction: z.enum(FEE_DIRECTIONS).nullish(),
    amountPaise: z.number().nullish(),
    amountRupees: z.string().trim().max(20).nullish(),
    pricingReference: optText(300),
    receiptReference: optText(120),
    method: z.enum(FEE_METHODS).nullish(),
    paymentDate: isoDateSchema.nullish(),
    dueDate: isoDateSchema.nullish(),
    demoId: z.uuid().nullish(),
    notes: optText(1000),
  })
  .strict()
  .refine((b) => (b.amountPaise ?? null) !== null || Boolean(b.amountRupees), {
    error: 'Give the amount (amountPaise or amountRupees)',
    path: ['amountPaise'],
  })
  .refine((b) => !((b.amountPaise ?? null) !== null && b.amountRupees), {
    error: 'Give either amountPaise or amountRupees, not both',
    path: ['amountRupees'],
  });

export const feeListQuery = z.object({
  status: z.enum(['recorded', 'verified', 'voided']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z
    .string()
    .regex(/^FEE-\d{6}$/)
    .optional(),
});

export const studentListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  state: z.enum(DIRECTORY_STATES).optional(),
  programme: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{1,39}$/)
    .optional(),
  handoff: z.enum(['not_requested', 'pending', 'enrolled', 'rejected']).optional(),
  sort: z.enum(['newest', 'oldest', 'name']).default('newest'),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  /** Opaque offset cursor returned in meta.page.nextCursor. */
  cursor: z
    .string()
    .regex(/^\d{1,6}$/)
    .optional(),
});

export const handoffRetryBody = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();

export const contactPreferencesBody = z
  .object({
    consentStatus: z.enum(['given', 'refused', 'withdrawn']),
    consentBy: z.enum(['student', 'guardian', 'both']),
    allowedChannels: z
      .array(z.enum(['call', 'whatsapp', 'sms', 'email']))
      .max(4)
      .default([]),
    preferredContact: z.enum(['student', 'guardian']).nullish(),
    note: optText(500),
  })
  .strict();
export type ContactPreferencesInput = z.output<typeof contactPreferencesBody>;

export const admissionsReportQuery = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
