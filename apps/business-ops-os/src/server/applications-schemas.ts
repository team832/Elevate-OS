/** Request schemas for admission applications and final confirmation (owner brief §6–§7). */
import { z } from 'zod';
import { isoDateSchema } from '@elevate/shared-contracts';
import { OPS_STUDENT_STAGES } from '@elevate/database';
import { APPLICATION_STATUSES } from '../domain/applications';

const optText = (max: number) => z.string().trim().max(max).nullish();
const version = z.int().min(1);

/** GET /applications */
export const applicationListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
  /** Programme code of the application's own case. */
  programme: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{1,39}$/)
    .optional(),
  sort: z.enum(['updated', 'oldest', 'name']).default('updated'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

/** POST /applications — new direct admission for an `admission_pending` case without an open demo. */
export const directApplicationBody = z
  .object({
    admissionId: z.uuid(),
    academicYear: z
      .string()
      .regex(/^[0-9]{4}-[0-9]{2}$/)
      .nullish(),
    existingStudentIdentityId: z.uuid().nullish(),
    createNewStudent: z.boolean().optional(),
  })
  .strict();

/** PATCH /applications/{id} — save: a material change makes a new version (signatures invalidated). */
export const saveApplicationBody = z
  .object({
    version,
    academicYear: z
      .string()
      .regex(/^[0-9]{4}-[0-9]{2}$/)
      .nullish(),
    intendedStartDate: isoDateSchema.nullish(),
    deliveryMode: z.enum(['offline', 'online']).nullish(),
    intendedBatchId: z.uuid().nullish(),
    student: z
      .object({
        preferredName: optText(120),
        dateOfBirth: isoDateSchema.nullish(),
        currentStage: z.enum(OPS_STUDENT_STAGES).nullish(),
        schoolBoard: optText(120),
        previousSchool: optText(200),
        city: optText(120),
        address: optText(500),
        emergencyContactName: optText(200),
        emergencyContactPhone: optText(40),
      })
      .strict()
      .optional(),
    /** The paper form's other answers (empty clears one). */
    form: z
      .object({
        gender: optText(40),
        whatsapp: optText(40),
        guardianOccupation: optText(120),
        guardianOfficeAddress: optText(500),
        guardianAlternateContact: optText(40),
        qualification: optText(120),
        yearOfPassing: z
          .string()
          .regex(/^[0-9]{4}$/)
          .nullish(),
        percentageOrGrade: optText(20),
        subjectsOrStream: optText(200),
        batchTiming: optText(120),
      })
      .strict()
      .optional(),
    /** T&C clause 8 (result publicity): recorded with who and when; not given by default. */
    resultPublicityConsent: z.boolean().optional(),
  })
  .strict();
export type SaveApplicationInput = z.output<typeof saveApplicationBody>;

/** POST /applications/{id}/ready */
export const versionBody = z.object({ version }).strict();

/** POST /applications/{id}/signatures — staff confirm the physical signatures on a generated form. */
export const signaturesBody = z
  .object({
    version,
    formId: z.uuid(),
    signedOn: isoDateSchema,
    studentSigned: z.boolean().default(false),
    guardianSigned: z.boolean().default(false),
  })
  .strict();

/**
 * POST /applications/{id}/confirm — the approver's own password and the version they reviewed.
 * Nothing else: no client flag can stand in for the server's checks (unknown keys → 400).
 */
export const confirmBody = z
  .object({
    password: z.string().min(1, { error: 'Enter your password' }).max(1024),
    applicationVersion: version,
  })
  .strict();

/** POST /applications/{id}/withdraw */
export const withdrawBody = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();

/** POST /admissions/{id}/legacy-verification — reconcile a legacy admission (evidence checked). */
export const legacyVerificationBody = z
  .object({ note: z.string().trim().min(10).max(2000) })
  .strict();
