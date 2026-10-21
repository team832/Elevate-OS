/**
 * OWNER: Marketing OS team (see docs/BUILD_PLAN.md — file ownership).
 *
 * Contracts that Marketing OS publishes for other modules: its integration
 * events (add `defineEvent(...)` entries to `marketingEvents`; type names start
 * with `marketing.`) and any shared request/response shapes for its internal
 * APIs. The marketing summary contract `MarketingSummaryV1` lives in
 * `../summaries.ts` (Foundation-owned) because Ops and the platform consume it.
 *
 * Do not import other modules' files from here.
 */
import { z } from 'zod';
import type { EventDefinition } from '../events/define';
import { defineEvent } from '../events/define';
import { isoDateTimeSchema, phoneSchema } from '../ids';

/**
 * `marketing.lead.handed_off` v1 — CONSUMER-DEFINED CONTRACT: declared here at the owner's
 * direction (20 Oct 2026) by the Business Ops build so Ops can consume it; the Marketing
 * producer is NOT built (IR row IR-MKT-OPS-HANDOFF in apps/marketing-os/docs/INTEGRATION_REQUESTS.md).
 * Ops consumer `ops.lead-intake` processes it idempotently (one Ops lead per marketingLeadId).
 * Only contacts Marketing may share go in `contacts`; campaign data only where permitted.
 * Idempotency key: `marketingLeadHandoffKey(marketingLeadId)`. Test/dev data must be fictional.
 */
const shortText = (max: number) => z.string().trim().min(1).max(max);

export const marketingLeadHandedOffV1Payload = z.object({
  /** Marketing's stable lead id (never reused). */
  marketingLeadId: z.uuid(),
  /** Lead source as an Ops lead-source code (e.g. INSTAGRAM, WEBINAR), plus the channel/account. */
  source: z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
    channel: shortText(120).optional(),
  }),
  /** Campaign reference/name — only when Marketing may share it. */
  campaign: z.object({ ref: shortText(120), name: shortText(200).optional() }).nullable(),
  contacts: z
    .object({
      studentName: shortText(200),
      studentPhone: phoneSchema.optional(),
      studentEmail: z.email().optional(),
      guardianName: shortText(200).optional(),
      guardianRelationship: z.enum(['mother', 'father', 'guardian', 'other']).optional(),
      guardianPhone: phoneSchema.optional(),
      guardianEmail: z.email().optional(),
    })
    .refine(
      (c) => Boolean(c.studentPhone || c.studentEmail || c.guardianPhone || c.guardianEmail),
      { error: 'At least one permitted contact is required' },
    ),
  /** Course/programme interest as the person gave it (Ops maps it to a programme code when it matches). */
  courseInterest: shortText(200).nullable(),
  consent: z.object({
    status: z.enum(['given', 'refused', 'withdrawn']),
    by: z.enum(['student', 'guardian', 'both']),
    allowedChannels: z.array(z.enum(['call', 'whatsapp', 'sms', 'email'])).max(4),
    preferredContact: z.enum(['student', 'guardian']).optional(),
  }),
  capturedAt: isoDateTimeSchema,
  /** Where Marketing captured it (form id, landing page, event) — free text. */
  sourceReference: shortText(300).nullable(),
});

export const marketingLeadHandoffKey = (marketingLeadId: string) =>
  `lead-handoff:${marketingLeadId}`;

export const marketingEvents = [
  defineEvent({
    type: 'marketing.lead.handed_off',
    version: 1,
    producer: 'marketing',
    consumers: ['ops'],
    description:
      'A Marketing lead is handed to Business Ops admissions (consumer-defined; producer not built).',
    payload: marketingLeadHandedOffV1Payload,
  }),
] as const satisfies readonly EventDefinition[];
