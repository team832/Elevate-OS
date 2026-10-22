/** Request schemas for delivery, substitution, availability, patterns, teachers and demo attendees (A2). */
import { z } from 'zod';
import { isIsoDate } from '@elevate/shared-types';

const isoDate = z.string().refine((v: string): boolean => Boolean(isIsoDate(v)), { error: 'Expected a calendar date in YYYY-MM-DD form' });
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'Use HH:MM (24 h)' });
const reason = z.string().trim().min(1).max(1000);
const note = z.string().trim().max(2000).optional();

export const staffParams = z.object({ staffId: z.uuid() });

export const deliverBody = z
  .object({
    note,
    /** Who actually taught; default = the planned teachers (substitutes replace the original). */
    actualStaffIds: z.array(z.uuid()).min(1).max(10).optional(),
    version: z.int().min(1).optional(),
  })
  .strict();

export const reasonBody = z.object({ reason }).strict();

export const substituteBody = z.object({ staffId: z.uuid(), reason }).strict();

export const unavailabilityBody = z
  .object({ staffId: z.uuid(), fromDate: isoDate, toDate: isoDate, reason })
  .strict()
  .refine((b) => b.fromDate <= b.toDate, { error: 'fromDate must not be after toDate', path: ['toDate'] });

export const unavailabilityQuery = z.object({ staffId: z.uuid().optional() });

const patternFields = {
  subjectId: z.uuid(),
  staffId: z.uuid(),
  roomId: z.uuid().optional(),
  onlineLink: z.url().max(500).optional(),
  weekday: z.coerce.number().int().min(1).max(7),
  startTime: clock,
  durationMinutes: z.int().min(5).max(600),
};

export const patternBody = z
  .object({ batchId: z.uuid(), ...patternFields, effectiveFrom: isoDate, effectiveTo: isoDate })
  .strict()
  .refine((b) => b.effectiveFrom <= b.effectiveTo, { error: 'effectiveFrom must not be after effectiveTo', path: ['effectiveTo'] });

export const publishBody = z.object({ version: z.int().min(1) }).strict();
/** Deleting a draft: the version seen and an explicit confirmation. */
export const deleteDraftBody = z.object({ version: z.int().min(1), confirm: z.literal(true, { error: 'Tick the box to confirm.' }) }).strict();

/** Edit a draft pattern (any field; version-checked). Published patterns change through a series edit. */
export const patternUpdateBody = z
  .object({ ...patternFields, roomId: z.uuid().nullable(), onlineLink: z.url().max(500).nullable(), effectiveFrom: isoDate, effectiveTo: isoDate })
  .partial()
  .extend({ version: z.int().min(1) })
  .strict();

/** Edit a published series from `effectiveDate`: only later, undelivered occurrences change. */
export const seriesEditBody = z
  .object({
    effectiveDate: isoDate,
    staffId: patternFields.staffId.optional(),
    roomId: z.uuid().nullable().optional(),
    weekday: patternFields.weekday.optional(),
    startTime: clock.optional(),
    durationMinutes: patternFields.durationMinutes.optional(),
    reason,
    version: z.int().min(1),
  })
  .strict();

export const patternsQuery = z.object({ batchId: z.uuid().optional() });

export const rangeQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });

export const demoAttendeeBody = z.object({ sessionId: z.uuid(), opsDemoSessionId: z.uuid() }).strict();
export const demoCandidatesQuery = z.object({ sessionId: z.uuid() });

export const demoAttendanceQuery = z.object({
  ids: z
    .string()
    .transform((v) => [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))])
    .pipe(z.array(z.uuid()).min(1).max(200)),
});
