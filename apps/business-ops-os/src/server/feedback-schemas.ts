/** zod schemas for student feedback about teachers (brief 23 Oct 2026 §15). */
import { z } from 'zod';
import { isoDateSchema } from '@elevate/shared-contracts';
import { OPS_DEVELOPMENT_ACTION_STATUSES } from '@elevate/database';
import { MAX_FEEDBACK_CSV_CHARS } from '../domain/feedback-import';

const text = (max: number) => z.string().trim().max(max);
const optText = (max = 4000) => text(max).nullish();

/** Structured entry by HR; `batch` is a value from the teacher's batch options. */
export const feedbackEntryBody = z
  .object({
    teacherStaffId: z.uuid(),
    studentId: z.uuid().nullish(),
    /** Identifies the student instead of `studentId` (as on admission records). */
    admissionNumber: optText(40),
    submittedByKind: z.enum(['student', 'guardian']),
    /** Free text, kept for entries without an Academic batch. */
    subjectRef: optText(200),
    /** "BATCH-CODE" or "BATCH-CODE|Subject name" (checked against Academic OS). */
    batch: optText(240),
    feedbackOn: isoDateSchema,
    periodStart: isoDateSchema.nullish(),
    periodEnd: isoDateSchema.nullish(),
    collectionMethod: z.enum(['form', 'paper', 'interview', 'other']).nullish(),
    rating: z.int().min(1).max(10).nullish(),
    categoryRatings: z.record(z.string(), z.int().min(1).max(10)).nullish(),
    comment: text(4000).min(1, 'Required'),
    visibility: z.enum(['staff_only', 'teacher_and_staff']).optional(),
    isAnonymous: z.boolean().optional(),
    /** The entry this one corrects (that one is hidden, never edited). */
    correctsId: z.uuid().nullish(),
  })
  .refine((b) => !b.periodStart === !b.periodEnd, {
    path: ['periodEnd'],
    error: 'Give both period dates or neither.',
  })
  .refine((b) => !b.periodStart || !b.periodEnd || b.periodEnd >= b.periodStart, {
    path: ['periodEnd'],
    error: 'Period end is before period start.',
  })
  .refine((b) => !(b.isAnonymous && (b.studentId || b.admissionNumber)), {
    path: ['isAnonymous'],
    error: 'Anonymous feedback cannot name a student.',
  });
export type FeedbackEntryInput = z.output<typeof feedbackEntryBody>;

export const importUploadBody = z.object({
  name: text(200).min(1),
  content: z.string().min(1).max(MAX_FEEDBACK_CSV_CHARS, 'The file is larger than 2 MB; split it.'),
  /** Column heading → field; omitted = suggested from the headings. */
  mapping: z.record(z.string(), z.string()).optional(),
});
/** The form sends the file's columns and, per column index, the chosen field ('' = skip). */
export const importMappingBody = z
  .object({
    columns: z.array(z.string()).min(1).max(200),
    fields: z.record(z.string(), z.string()).default({}),
  })
  .transform((b) => ({
    mapping: Object.fromEntries(b.columns.map((c, i) => [c, b.fields[String(i)] ?? ''])),
  }));
export const importActionParams = z.object({
  id: z.uuid(),
  action: z.enum(['commit', 'discard']),
});
export const importCommitBody = z.object({
  /** Approve the imported rows at once (the preview was the review). */
  approve: z.boolean().optional(),
  /** The collection asked no names: rows without a student are stored as anonymous. */
  anonymous: z.boolean().optional(),
});

export const summaryBody = z
  .object({
    teacherStaffId: z.uuid(),
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
    eligiblePopulation: z.int().min(0).nullish(),
  })
  .refine((b) => b.periodEnd >= b.periodStart, {
    path: ['periodEnd'],
    error: 'Period end is before period start.',
  });
export const summaryPatchBody = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('edit'),
    strengths: optText(),
    areasToImprove: optText(),
    summaryText: optText(),
    eligiblePopulation: z.int().min(0).nullish(),
  }),
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('withdraw') }),
]);

export const actionBody = z.object({
  teacherStaffId: z.uuid(),
  summaryId: z.uuid().nullish(),
  action: text(1000).min(1, 'Required'),
  ownerStaffId: z.uuid().nullish(),
  dueOn: isoDateSchema.nullish(),
  agreed: z.boolean().optional(),
});
export const actionPatchBody = z.object({
  status: z.enum(OPS_DEVELOPMENT_ACTION_STATUSES).optional(),
  agreed: z.boolean().optional(),
});

/** HR Responses tab filters (URL params). */
export const responsesQuery = z.object({
  teacher: z.uuid().optional().catch(undefined),
  batch: text(80).optional().catch(undefined),
  from: isoDateSchema.optional().catch(undefined),
  to: isoDateSchema.optional().catch(undefined),
  method: z.enum(['form', 'paper', 'interview', 'import', 'other']).optional().catch(undefined),
  moderation: z.enum(['pending', 'approved', 'rejected', 'hidden']).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
});
export type ResponsesFilter = z.output<typeof responsesQuery>;
