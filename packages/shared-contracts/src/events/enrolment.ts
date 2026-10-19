import { z } from 'zod';
import {
  admissionIdSchema,
  batchIdSchema,
  courseIdSchema,
  enrolmentIdSchema,
  integrationEventIdSchema,
  isoDateSchema,
  isoDateTimeSchema,
  leadIdSchema,
  phoneSchema,
  programmeCodeSchema,
  staffMemberIdSchema,
  studentIdSchema,
  userIdSchema,
} from '../ids';
import { defineEvent } from './define';

/**
 * THE ADMISSION → ENROLMENT HANDOFF (D-011.1)
 *
 *   Business Ops OS                      Academic OS
 *   ───────────────                      ───────────
 *   admission accepted ──(outbox)──▶ ops.admission.enrolment_requested v1
 *                                        │ creates/links student, enrolment
 *   ◀──(outbox)── academic.enrolment.confirmed v1   (or .rejected v1)
 *
 * Rules
 * - Ops publishes the request in the same transaction that moves the admission
 *   to "enrolment requested". idempotencyKey = `admission:<admissionId>:attempt:<attempt>`.
 * - Academic processes it idempotently (one enrolment per request event) and
 *   publishes exactly one reply in the same transaction as its own writes.
 *   Reply idempotencyKey = `enrolment-reply:<requestEventId>`; correlationId =
 *   the request event id.
 * - The student identity below is the minimum Academic needs to create a
 *   student record and contact the family. Ops keeps the lead; Academic owns
 *   the student from confirmation onwards. Fee and payment details are NOT part
 *   of this contract (they stay in Ops).
 * - Development and test data must be fictional (D-016).
 */

const personName = z.string().trim().min(1).max(200);

export const enrolmentStudentSchema = z.object({
  fullName: personName,
  preferredName: personName.optional(),
  /** Optional: many students are minors; collect only when needed. */
  dateOfBirth: isoDateSchema.optional(),
  currentStage: z
    .enum(['class_9', 'class_10', 'class_11', 'class_12', 'gap_year', 'graduate', 'other'])
    .optional(),
  /** Board for school students, e.g. CBSE, RBSE. Free text. */
  schoolBoard: z.string().trim().min(1).max(60).optional(),
  email: z.email().optional(),
  phone: phoneSchema.optional(),
  city: z.string().trim().min(1).max(100).optional(),
});

export const enrolmentGuardianSchema = z.object({
  fullName: personName,
  relationship: z.enum(['mother', 'father', 'guardian', 'other']),
  email: z.email().optional(),
  phone: phoneSchema.optional(),
});

export const enrolmentRequestedV1Payload = z
  .object({
    /** Ops admission record (ops schema). */
    admissionId: admissionIdSchema,
    /** Ops lead the admission came from (ops schema). */
    leadId: leadIdSchema,
    /** 1 for the first request for this admission; +1 for each re-request after a rejection. */
    attempt: z.int().min(1),
    /** core.programmes.code, e.g. CLAT, IPMAT, CUET, COMMERCE_11_12, CA_FOUNDATION. */
    programmeCode: programmeCodeSchema,
    /** Academic-owned refs chosen during counselling, if any. Academic validates them. */
    intendedCourseId: courseIdSchema.optional(),
    intendedBatchId: batchIdSchema.optional(),
    deliveryMode: z.enum(['offline', 'online', 'hybrid']).optional(),
    intendedStartDate: isoDateSchema.optional(),
    student: enrolmentStudentSchema,
    /** Required when the student is a minor or has no own contact details. */
    guardian: enrolmentGuardianSchema.optional(),
    /** core.staff_members.id of the admissions counsellor who owns the admission. */
    counsellorStaffId: staffMemberIdSchema,
    /** core.users.id of the person who triggered the request. */
    requestedByUserId: userIdSchema,
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine(
    (p) => Boolean(p.student.email || p.student.phone || p.guardian?.email || p.guardian?.phone),
    {
      error: 'At least one contact (student or guardian email/phone) is required',
      path: ['student'],
    },
  );

export const enrolmentRequestedV1 = defineEvent({
  type: 'ops.admission.enrolment_requested',
  version: 1,
  producer: 'ops',
  consumers: ['academic'],
  description:
    'An admission was accepted and Business Ops asks Academic OS to enrol the student. Academic replies with academic.enrolment.confirmed or academic.enrolment.rejected.',
  payload: enrolmentRequestedV1Payload,
});

export const enrolmentConfirmedV1Payload = z
  .object({
    /** Id of the ops.admission.enrolment_requested event this answers. */
    requestEventId: integrationEventIdSchema,
    admissionId: admissionIdSchema,
    leadId: leadIdSchema,
    enrolmentId: enrolmentIdSchema,
    studentId: studentIdSchema,
    /** True when an existing student record was reused (same person enrolling again). */
    existingStudent: z.boolean(),
    programmeCode: programmeCodeSchema,
    courseId: courseIdSchema.optional(),
    batchId: batchIdSchema.optional(),
    confirmedAt: isoDateTimeSchema,
    /** Null when confirmed automatically by a rule. */
    confirmedByUserId: userIdSchema.nullable(),
  })
  .strict();

export const enrolmentConfirmedV1 = defineEvent({
  type: 'academic.enrolment.confirmed',
  version: 1,
  producer: 'academic',
  consumers: ['ops'],
  description:
    'Academic OS created (or reused) the student and the enrolment for an enrolment request.',
  payload: enrolmentConfirmedV1Payload,
});

export const ENROLMENT_REJECTION_REASONS = [
  'PROGRAMME_NOT_OFFERED',
  'COURSE_NOT_FOUND',
  'BATCH_NOT_FOUND',
  'BATCH_FULL',
  'DUPLICATE_ENROLMENT',
  'INVALID_REQUEST',
  'OTHER',
] as const;

export const enrolmentRejectedV1Payload = z
  .object({
    requestEventId: integrationEventIdSchema,
    admissionId: admissionIdSchema,
    leadId: leadIdSchema,
    reasonCode: z.enum(ENROLMENT_REJECTION_REASONS),
    /** Human explanation shown to the counsellor. */
    reason: z.string().trim().min(1).max(1000),
    rejectedAt: isoDateTimeSchema,
    rejectedByUserId: userIdSchema.nullable(),
  })
  .strict();

export const enrolmentRejectedV1 = defineEvent({
  type: 'academic.enrolment.rejected',
  version: 1,
  producer: 'academic',
  consumers: ['ops'],
  description:
    'Academic OS could not enrol the student for an enrolment request; Ops may correct and re-request (attempt + 1).',
  payload: enrolmentRejectedV1Payload,
});

/** Idempotency keys for the handoff — producers must use these. */
export const enrolmentKeys = {
  request: (admissionId: string, attempt: number) => `admission:${admissionId}:attempt:${attempt}`,
  reply: (requestEventId: string) => `enrolment-reply:${requestEventId}`,
} as const;

export const enrolmentEvents = [
  enrolmentRequestedV1,
  enrolmentConfirmedV1,
  enrolmentRejectedV1,
] as const;
