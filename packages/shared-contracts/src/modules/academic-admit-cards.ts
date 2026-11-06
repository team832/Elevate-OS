/**
 * Admit cards for a test (F4-03): `GET /academic/api/internal/v1/assessments/{id}/admit-cards`
 * (caller ops) answers `academic.admit_cards` v1; `POST` the same path gives roll numbers or sets
 * the venue and instructions, and answers the same. Roll numbers are given once per roster row, by
 * batch then name, and never reused. Venue: a room, or online, or neither ("Venue not set").
 */
import { z } from 'zod';
import { batchIdSchema, isoDateSchema, isoDateTimeSchema } from '../ids';

export const ADMIT_CARD_INSTRUCTIONS_MAX = 600;

export const academicAdmitCardsV1Schema = z.object({
  contract: z.literal('academic.admit_cards'),
  version: z.literal(1),
  generatedAt: isoDateTimeSchema,
  assessment: z.object({
    id: z.uuid(),
    code: z.string().min(1),
    title: z.string().min(1),
    status: z.string().min(1),
    courseName: z.string().min(1),
    scheduledDate: isoDateSchema.nullable(),
    startTime: z.string().nullable(),
    durationMinutes: z.int().min(1).nullable(),
    rosterSnapshotAt: isoDateTimeSchema.nullable(),
    venue: z.object({
      online: z.boolean(),
      roomId: z.uuid().nullable(),
      roomName: z.string().nullable(),
    }),
    /** The test's own instructions; null = the default text (Ops setting). */
    instructions: z.string().nullable(),
    isSample: z.boolean(),
  }),
  /** Active rooms, for choosing the venue. */
  rooms: z.array(z.object({ id: z.uuid(), label: z.string().min(1) })),
  /** Roster rows not removed, by batch then name. */
  rows: z.array(
    z.object({
      rosterId: z.uuid(),
      coreStudentId: z.uuid().nullable(),
      admissionNumber: z.string().nullable(),
      displayName: z.string().min(1),
      batchId: batchIdSchema,
      batchCode: z.string().min(1),
      rollNumber: z.int().min(1).nullable(),
    }),
  ),
});
export type AcademicAdmitCardsV1 = z.output<typeof academicAdmitCardsV1Schema>;

export const admitCardWriteBody = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('roll_numbers') }),
  z.strictObject({
    action: z.literal('venue'),
    /** A room id, `online`, or `not_set`. */
    venue: z.union([z.literal('online'), z.literal('not_set'), z.uuid()]),
    /** Missing or empty = the default text. */
    instructions: z.string().trim().max(ADMIT_CARD_INSTRUCTIONS_MAX).nullish(),
  }),
]);
export type AdmitCardWrite = z.output<typeof admitCardWriteBody>;
