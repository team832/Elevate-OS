/**
 * Request schemas for conversion, admission numbers, the student lifecycle,
 * guardians, student search and student reports (owner brief §6–§9, §15).
 */
import { z } from 'zod';
import { isoDateSchema } from '@elevate/shared-contracts';
import { OPS_EXIT_MATERIAL_STATUSES, OPS_GUARDIAN_RELATIONSHIPS } from '@elevate/database';
import { EXIT_STATUSES } from '../domain';
import { COHORT_PROGRAMMES } from '../domain/catalog';
import { STUDENT_FEE_STATUSES } from '../domain/fee-plans';
import { PAST_OUTCOMES } from '../domain/student-lifecycle';
import { studentListQuery } from './admissions-schemas';

const optText = (max: number) => z.string().trim().max(max).nullish();
const reason = z.string().trim().min(3).max(1000);

/** POST /demos/{id}/convert */
export const convertBody = z
  .object({
    identityVerified: z.literal(true, { error: 'Confirm the student’s identity and contacts' }),
    guardianConfirmation: z.enum(['confirmed', 'not_applicable']),
    /** Codes, or one comma-separated value (the wizard's combination select). */
    programmeCodes: z.preprocess(
      (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v),
      z
        .array(z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/))
        .min(1, { error: 'Choose at least one programme' })
        .max(2),
    ),
    /** Academic batch id; absent = "to be assigned". */
    intendedBatchId: z.uuid().nullish(),
    deliveryMode: z.enum(['offline', 'online']),
    effectiveDate: isoDateSchema,
    /** Fee plan / approved pricing reference (fee plans are built by the fees slice). */
    feePlanReference: optText(120),
    /** A discount or exception asks the core fee-arrangement approval (no self-approval). */
    discountRequest: optText(1000),
    existingStudentIdentityId: z.uuid().nullish(),
    createNewStudent: z.boolean().optional(),
    admissionNumber: optText(40),
    admissionNumberReason: optText(1000),
    requestEnrolment: z.boolean().default(false),
  })
  .strict();
export type ConvertInput = z.output<typeof convertBody>;

/** POST /admissions/{id}/admission-number — manual correction after conversion. */
export const admissionNumberBody = z
  .object({ admissionNumber: z.string().trim().max(40), reason: z.string().trim().max(1000) })
  .strict();

/** POST /admissions/{id}/lifecycle */
export const lifecycleBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('hold'), reason, reviewDate: isoDateSchema }).strict(),
  z.object({ action: z.literal('resume'), reason }).strict(),
  z
    .object({
      action: z.literal('exit'),
      exitStatus: z.enum(EXIT_STATUSES),
      exitDate: isoDateSchema,
      reason,
      exitFeedback: optText(2000),
      guardianFeedback: optText(2000),
      feeReference: optText(200),
      /** A code from setting `admissions.closure_reasons` (the reason category). */
      reasonCode: z
        .string()
        .regex(/^[a-z][a-z0-9_]{1,39}$/)
        .nullish(),
      materialStatus: z.enum(OPS_EXIT_MATERIAL_STATUSES).default('not_recorded'),
      closingNotes: optText(2000),
      reactivationAllowed: z.boolean().default(false),
    })
    .strict(),
  z.object({ action: z.literal('reactivate'), reason }).strict(),
  /** A returning student: a NEW application and case for the same identity (brief §11). */
  z
    .object({
      action: z.literal('readmit'),
      reason,
      /** Programme of the new case; omitted = the programme of the closed case. */
      programmeCode: z
        .string()
        .regex(/^[A-Z][A-Z0-9_]{1,39}$/)
        .nullish(),
      academicYear: z
        .string()
        .regex(/^[0-9]{4}-[0-9]{2}$/, { error: 'Use the form 2027-28' })
        .nullish(),
    })
    .strict(),
]);
export type LifecycleInput = z.output<typeof lifecycleBody>;

/** POST /students/{id}/guardians, PATCH /students/{id}/guardians/{guardianId} */
export const guardianBody = z
  .object({
    fullName: z.string().trim().min(1).max(200),
    relationship: z.enum(OPS_GUARDIAN_RELATIONSHIPS),
    phone: optText(40),
    email: optText(254),
    address: optText(500),
    /** The student's primary contact (exactly one live guardian; the first one by default). */
    isPrimary: z.boolean().optional(),
    isEmergency: z.boolean().optional(),
    preferredContact: z.enum(['call', 'whatsapp', 'sms', 'email']).nullish(),
    consentStatus: z
      .enum(['given', 'refused', 'withdrawn', 'not_recorded'])
      .default('not_recorded'),
    notes: optText(1000),
  })
  .strict();
export type GuardianInput = z.output<typeof guardianBody>;
export const guardianPatchBody = guardianBody
  .partial()
  .extend({ archived: z.boolean().optional() })
  .strict();
export type GuardianPatch = z.output<typeof guardianPatchBody>;
export const guardianParams = z.object({ id: z.uuid(), guardianId: z.uuid() });

/** GET /students — the directory query plus the list view and contact search. */
export const studentSearchQuery = studentListQuery.extend({
  view: z.enum(['directory', 'active', 'on_hold', 'former']).default('directory'),
  /** Phone or email (student or guardian); needs ops:student_private:read; audited. */
  contact: z.string().trim().min(3).max(254).optional(),
  /** Students with a case in this cohort programme; `none` = an entrance programme only. */
  cohort: z.enum([...COHORT_PROGRAMMES, 'none']).optional(),
  counsellor: z.uuid().optional(),
  /** Needs ops:fees:read. */
  fee: z.enum(STUDENT_FEE_STATUSES).optional(),
  meeting: z.literal('upcoming').optional(),
  /** Past students only: withdrawn early, completed or another exit. */
  outcome: z.enum(PAST_OUTCOMES).optional(),
});
export type StudentSearchQuery = z.output<typeof studentSearchQuery>;
