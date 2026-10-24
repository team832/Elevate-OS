/** Request schemas for the teaching log (ACD-007) and teacher reviews (owner answer 1). */
import { z } from 'zod';
import { ACADEMIC_RECORD_ACTIVITIES, ACADEMIC_RECORD_STATES, ACADEMIC_REVIEW_STATUSES, ACADEMIC_REVIEW_TYPES, ACADEMIC_REVIEW_VISIBILITIES } from '@elevate/database';
import { isoDateSchema, optionalText, text } from './schemas';

// --- teaching log -----------------------------------------------------------------------------
/** No defaults: the teacher chooses chapter, activity, completion and minutes (no blank or "as timetabled" logs). */
const logFields = {
  chapterId: z.uuid(),
  activity: z.enum(ACADEMIC_RECORD_ACTIVITIES),
  completion: z.enum(['completed', 'partial']),
  actualMinutes: z.int().min(1).max(600),
  materials: optionalText(),
  homework: optionalText(),
  homeworkDueOn: isoDateSchema.optional(),
  difficulties: optionalText(),
  nextPlan: optionalText(),
  catchUpNeeded: optionalText(),
  notes: optionalText(),
  evidence: optionalText(1000),
  /** true = submit now (the session must already be marked delivered); otherwise save a draft. */
  submit: z.boolean().optional(),
};

export const recordClassBody = z.object({ sessionId: z.uuid(), ...logFields }).strict();

/** Replaces the draft's content; `version` is the one the form was opened with. */
export const updateClassBody = z.object({ version: z.int().min(1), ...logFields }).strict();

export const correctClassBody = z
  .object({
    chapterId: z.uuid().optional(),
    completion: z.enum(['completed', 'partial']).optional(),
    actualMinutes: z.int().min(1).max(600).optional(),
    activity: z.enum(ACADEMIC_RECORD_ACTIVITIES).optional(),
    notes: optionalText(),
    reason: text(1000),
  })
  .strict();

export const requestCorrectionBody = z.object({ reason: text(1000) }).strict();

const windowQuery = { from: isoDateSchema.optional(), to: isoDateSchema.optional() };

export const classRecordsQuery = z.object({
  batchId: z.uuid().optional(),
  teacherStaffId: z.uuid().optional(),
  state: z.enum(ACADEMIC_RECORD_STATES).optional(),
  ...windowQuery,
});

export const logExceptionsQuery = z.object({ batchId: z.uuid().optional(), teacherStaffId: z.uuid().optional(), ...windowQuery });

// --- teacher reviews ----------------------------------------------------------------------------
const reviewContent = {
  subjectId: z.uuid().optional(),
  periodFrom: isoDateSchema.optional(),
  periodTo: isoDateSchema.optional(),
  strengths: optionalText(4000),
  areasForSupport: optionalText(4000),
  attendanceEvidence: optionalText(4000),
  homeworkEvidence: optionalText(4000),
  academicConcerns: optionalText(4000),
  suggestedAction: optionalText(4000),
  followUpOn: isoDateSchema.optional(),
  /** Brief §16: the day the teacher observed it, and the batch the review is about. */
  observationOn: isoDateSchema.optional(),
  batchId: z.uuid().optional(),
  visibility: z.enum(ACADEMIC_REVIEW_VISIBILITIES).default('internal'),
  submit: z.boolean().optional(),
};

export const createReviewBody = z
  .object({
    reviewType: z.enum(ACADEMIC_REVIEW_TYPES),
    academicStudentId: z.uuid().optional(),
    coreStudentId: z.uuid().optional(),
    sessionId: z.uuid().optional(),
    opsDemoSessionId: z.uuid().optional(),
    ...reviewContent,
  })
  .strict()
  .refine((b) => Boolean(b.academicStudentId) !== Boolean(b.coreStudentId), { error: 'Give either an enrolled student or a demo student.', path: ['academicStudentId'] })
  .refine((b) => !b.coreStudentId || b.opsDemoSessionId, { error: 'A demo student review needs the demo session.', path: ['opsDemoSessionId'] });

/** `updatedAt` = the draft's value when the form was opened (refused if it changed since). */
export const updateReviewBody = z.object({ ...reviewContent, updatedAt: z.iso.datetime() }).strict();

export const withdrawReviewBody = z.object({ reason: text(1000) }).strict();

export const reviewsQuery = z.object({
  academicStudentId: z.uuid().optional(),
  coreStudentId: z.uuid().optional(),
  status: z.enum(ACADEMIC_REVIEW_STATUSES).optional(),
  mine: z.enum(['1']).optional(),
});

export const internalReviewsQuery = z
  .object({ coreStudentId: z.uuid().optional(), authorStaffId: z.uuid().optional(), ...windowQuery })
  .refine((q) => q.coreStudentId || q.authorStaffId, { error: 'Give coreStudentId or authorStaffId.' });
