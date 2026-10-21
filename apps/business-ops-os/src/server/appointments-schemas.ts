/**
 * zod schemas for appointments, teachers and feedback (brief §8H, §11, §12).
 * Documented in docs/parts/admissions-meetings.md.
 */
import { z } from 'zod';
import { isoDateSchema, isoDateTimeSchema, programmeCodeSchema } from '@elevate/shared-contracts';
import { OPS_STUDENT_STAGES } from '@elevate/database';
import {
  APPOINTMENT_MODES,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  GROUP_APPOINTMENT_TYPES,
  isGroupType,
  MESSAGE_CHANNELS,
} from '../domain/appointments';
import { EVENT_POPULATIONS } from '../domain/policies';
import { MODERATION_ACTIONS } from '../domain/feedback';

const text = (max = 500) => z.string().trim().max(max);
const optText = (max = 500) => text(max).nullish();
const required = (max = 1000) => text(max).min(1, 'Required');
const optUuid = z.uuid().nullish();
const page = z.coerce.number().int().min(1).default(1);

export const appointmentBody = z.object({
  type: z
    .enum(APPOINTMENT_TYPES)
    .refine((t) => !isGroupType(t), 'Schedule events and webinars with POST /appointments/events'),
  /** Omitted: the case counsellor, else the organiser. */
  staffId: optUuid,
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema.nullish(),
  mode: z.enum(APPOINTMENT_MODES),
  location: optText(200),
  studentId: optUuid,
  leadId: optUuid,
  admissionId: optUuid,
  demoId: optUuid,
  programmeCode: programmeCodeSchema.nullish(),
  subject: optText(100),
  purpose: optText(1000),
  /** `proposed` = pencilled in; default `scheduled`. */
  status: z.enum(['proposed', 'scheduled']).default('scheduled'),
  otherStaffIds: z.array(z.uuid()).max(10).default([]),
  guardianIds: z.array(z.uuid()).max(5).default([]),
});
export type AppointmentInput = z.output<typeof appointmentBody>;

/** One select value or several (forms send one; the API takes a list). */
const oneOrMany = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (typeof v === 'string' ? [v] : v), z.array(item).max(20)).default([]);

/**
 * Who an event is for (brief §12). Empty = nobody is added from filters. When any filter is
 * set and `populations` is empty, the populations of setting `events.eligibility` apply.
 */
export const eventAudience = z
  .object({
    populations: oneOrMany(z.enum(EVENT_POPULATIONS)),
    programmeCodes: oneOrMany(programmeCodeSchema),
    /** Class/category (lead stage; `gap_year` = Dropper). */
    stages: oneOrMany(z.enum(OPS_STUDENT_STAGES)),
    /** Academic batch ids (enrolled or intended). */
    batchIds: oneOrMany(z.uuid()),
  })
  .strict();
export type EventAudience = z.output<typeof eventAudience>;

const eventFields = {
  type: z.enum(GROUP_APPOINTMENT_TYPES),
  title: required(200),
  onlineLink: z.url().max(500).nullish(),
  /** Room or place (offline). */
  location: optText(200),
  capacity: z.int().min(1).max(10_000).nullish(),
  /** Notes. */
  purpose: optText(2000),
  audience: eventAudience.default({
    populations: [],
    programmeCodes: [],
    stages: [],
    batchIds: [],
  }),
};

/** POST /appointments/events — scheduling sends nothing (brief §12). */
export const eventBody = z
  .object({
    ...eventFields,
    /** The owner; omitted = the organiser. */
    staffId: optUuid,
    startsAt: isoDateTimeSchema,
    /** Omitted = the default length of setting `appointments.scheduling`. */
    durationMinutes: z.int().min(5).max(480).nullish(),
    // shortcut: IST only (all students are in India), allow other zones when one is needed.
    timezone: z.literal('Asia/Kolkata').default('Asia/Kolkata'),
    mode: z.enum(APPOINTMENT_MODES),
    /** Students invited by name besides the audience (added as manual participants). */
    participantStudentIds: oneOrMany(z.uuid()),
  })
  .strict();
export type EventInput = z.output<typeof eventBody>;

/** PATCH /appointments/{id} action `edit` (events and webinars): changes never touch participants. */
const eventEdit = z
  .object({ action: z.literal('edit'), ...eventFields })
  .partial()
  .required({ action: true })
  .strict();
export type EventEdit = z.output<typeof eventEdit>;

/** POST /appointments/{id}/participants — add one student by hand. */
export const participantAddBody = z.object({ studentId: z.uuid() }).strict();
/** PATCH /appointments/{id}/participants */
export const participantChangeBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('remove'), participantId: z.uuid(), reason: required() }).strict(),
  z
    .object({
      action: z.literal('update'),
      participantId: z.uuid(),
      registrationStatus: z.enum(['invited', 'registered', 'declined']).optional(),
      attendance: z.enum(['not_recorded', 'present', 'absent']).optional(),
    })
    .strict(),
]);
export type ParticipantChange = z.output<typeof participantChangeBody>;

/** POST /appointments/{id}/messages — a draft and its preview; nothing is sent. */
export const messageDraftBody = z
  .object({ channel: z.enum(MESSAGE_CHANNELS), body: required(2000) })
  .strict();
export const messageParams = z.object({ id: z.uuid(), messageId: z.uuid() });

export const appointmentChangeBody = z.discriminatedUnion('action', [
  eventEdit,
  z.object({ action: z.literal('confirm') }),
  z.object({
    action: z.literal('reschedule'),
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema.nullish(),
    reason: required(),
  }),
  z.object({ action: z.literal('cancel'), reason: required() }),
  z.object({
    action: z.literal('complete'),
    outcome: required(2000),
    objections: optText(2000),
    nextStep: optText(1000),
    followUpOn: isoDateSchema.nullish(),
    recommendedProgrammeCode: programmeCodeSchema.nullish(),
  }),
]);
export type AppointmentChange = z.output<typeof appointmentChangeBody>;

export const appointmentListQuery = z.object({
  /** Part of the student's (or lead's) name. */
  q: text(100).optional(),
  type: z.enum(APPOINTMENT_TYPES).optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  staffId: z.uuid().optional(),
  studentId: z.uuid().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  page,
});
export type AppointmentFilters = z.output<typeof appointmentListQuery>;

export const teacherListQuery = z.object({
  subject: text(100).optional(),
  programmeCode: programmeCodeSchema.optional(),
});
export const teacherUpdateBody = z.object({
  displayName: optText(200),
  staffCode: text(40)
    .regex(/^[A-Z0-9][A-Z0-9-]{0,39}$/, 'Use capitals, digits and hyphens')
    .nullish(),
  verificationStatus: z.enum(['unverified', 'confirmed']).optional(),
  roleNote: optText(200),
  /** Full replacement of the subject list. */
  subjects: z.array(required(100)).max(20).optional(),
});

export const studentFeedbackQuery = z.object({ studentId: z.uuid() });

export const studentTeacherFeedbackBody = z.object({
  teacherStaffId: z.uuid(),
  studentId: optUuid,
  submittedByKind: z.enum(['student', 'guardian']),
  subjectRef: optText(200),
  feedbackOn: isoDateSchema,
  rating: z.int().min(1).max(5).nullish(),
  comment: required(4000),
});
export const teacherFeedbackQuery = z.object({ teacherStaffId: z.uuid() });
export const moderationBody = z.object({
  action: z.enum(Object.keys(MODERATION_ACTIONS) as [keyof typeof MODERATION_ACTIONS]),
  note: optText(1000),
  visibility: z.enum(['staff_only', 'teacher_and_staff']).optional(),
});
