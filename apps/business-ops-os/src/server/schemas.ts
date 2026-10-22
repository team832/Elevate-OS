/**
 * zod schemas for Business Ops API inputs (routes validate with them; services
 * take their output types). Documented in docs/API.md.
 */
import { z } from 'zod';
import { isoDateSchema, isoDateTimeSchema, programmeCodeSchema } from '@elevate/shared-contracts';
import {
  ADMISSION_CHECK_ITEMS,
  ADMISSION_STATUSES,
  EMPLOYMENT_TYPES,
  FOLLOW_UP_KINDS,
} from '../domain';

const text = (max = 500) => z.string().trim().max(max);
const optText = (max = 500) => text(max).nullish();
const uuid = z.uuid();
const optUuid = z.uuid().nullish();

export const idParams = z.object({ id: z.uuid() });

export const contactFields = {
  studentName: text(200).min(1),
  preferredName: optText(200),
  studentPhone: optText(40),
  studentEmail: optText(254),
  currentStage: z
    .enum(['class_9', 'class_10', 'class_11', 'class_12', 'gap_year', 'graduate', 'other'])
    .nullish(),
  schoolBoard: optText(60),
  previousSchool: optText(200),
  city: optText(100),
  guardianName: optText(200),
  guardianRelationship: z.enum(['mother', 'father', 'guardian', 'other']).nullish(),
  guardianPhone: optText(40),
  guardianEmail: optText(254),
};

export const duplicateCheckBody = z.object({
  studentName: text(200).min(1),
  studentPhone: optText(40),
  studentEmail: optText(254),
  guardianPhone: optText(40),
  guardianEmail: optText(254),
  previousSchool: optText(200),
});
export type DuplicateCheckInput = z.output<typeof duplicateCheckBody>;

export const enquiryBody = z.object({
  receivedAt: isoDateTimeSchema.nullish(),
  sourceCode: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{1,39}$/)
    .default('UNKNOWN'),
  channel: optText(200),
  discoverySource: optText(200),
  campaignRef: optText(200),
  contentRef: optText(200),
  programmeCode: programmeCodeSchema.nullish(),
  interestMode: z.enum(['offline', 'online', 'undecided']).default('undecided'),
  notes: optText(2000),
});
export type EnquiryInput = z.output<typeof enquiryBody>;

/** A new lead is its first enquiry plus the contact fields. */
export const createLeadBody = z.object({
  ...contactFields,
  ...enquiryBody.shape,
  ownerStaffId: optUuid,
  /** Required to save when an EXACT duplicate exists (the UI shows the warning first). */
  acknowledgeDuplicates: z.object({ reason: text(500).min(3) }).nullish(),
});
export type CreateLeadInput = z.output<typeof createLeadBody>;

export const updateLeadBody = z
  .object({
    ...contactFields,
    studentName: text(200).min(1).optional(),
    programmeCode: programmeCodeSchema.nullish(),
    interestMode: z.enum(['offline', 'online', 'undecided']).optional(),
    notes: optText(2000),
  })
  .partial();
export type UpdateLeadInput = z.output<typeof updateLeadBody>;

export const listLeadsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(ADMISSION_STATUSES).optional(),
  flag: z
    .enum([
      'new_this_week',
      'awaiting_contact',
      'unassigned',
      'handoff_pending',
      'overdue',
      'missing_next_action',
      'duplicate',
    ])
    .optional(),
});

export const assignBody = z.object({ ownerStaffId: uuid });
export const activityBody = z.object({
  kind: z.enum(['call', 'whatsapp', 'sms', 'email', 'visit', 'note']),
  outcome: z.enum([
    'connected_two_way',
    'replied',
    'visited',
    'no_answer',
    'busy',
    'wrong_number',
    'message_sent',
    'other',
  ]),
  occurredAt: isoDateTimeSchema.nullish(),
  note: optText(2000),
});
export type ActivityInput = z.output<typeof activityBody>;

export const mergeBody = z.object({ targetLeadId: uuid, note: text(1000).min(3) });
export const duplicateReviewBody = z.object({
  decision: z.literal('dismissed'),
  note: text(1000).min(3),
});

export const listAdmissionsQuery = z.object({
  status: z.enum(ADMISSION_STATUSES).optional(),
  handoff: z.enum(['not_requested', 'pending', 'enrolled', 'rejected']).optional(),
});
export const updateAdmissionBody = z
  .object({
    programmeCode: programmeCodeSchema.nullish(),
    counsellorStaffId: optUuid,
    deliveryMode: z.enum(['offline', 'online', 'hybrid']).nullish(),
    intendedStartDate: isoDateSchema.nullish(),
    intendedCourseId: optUuid,
    intendedBatchId: optUuid,
  })
  .partial();
export type UpdateAdmissionInput = z.output<typeof updateAdmissionBody>;
export const checkBody = z.object({
  itemKey: z.enum(ADMISSION_CHECK_ITEMS),
  status: z.enum(['done', 'not_done', 'not_applicable']),
  reference: optText(300),
});
export const feeApprovalBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request'), comment: optText(1000) }),
  z.object({ action: z.literal('approve'), comment: optText(1000) }),
  z.object({ action: z.literal('reject'), comment: text(1000).min(1) }),
  z.object({ action: z.literal('withdraw') }),
]);

export const followUpBody = z.object({
  leadId: uuid,
  admissionId: optUuid,
  kind: z.enum(FOLLOW_UP_KINDS).default('general'),
  title: optText(200),
  dueDate: isoDateSchema,
  ownerStaffId: optUuid,
});
export const followUpCloseBody = z.object({
  action: z.enum(['complete', 'cancel']),
  outcome: text(1000).min(1),
});
export const followUpListQuery = z.object({
  view: z.enum(['mine', 'overdue', 'due_today', 'open', 'all']).default('open'),
  leadId: z.uuid().optional(),
});

// Demo inputs: ./demos-schemas.ts.
export const scheduleQuery = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

export const createStaffBody = z.object({
  fullName: text(200).min(1),
  departmentId: optUuid,
  title: optText(200),
  managerId: optUuid,
  userId: optUuid,
  employmentType: z.enum(EMPLOYMENT_TYPES).default('not_recorded'),
  roleLabels: z.array(text(100).min(1)).max(20).default([]),
});
export const updateStaffBody = createStaffBody
  .extend({ status: z.enum(['active', 'on_leave', 'inactive']) })
  .partial();
export const updateDepartmentBody = z
  .object({
    name: text(200).min(1),
    description: optText(1000),
    status: z.enum(['active', 'provisional', 'archived']),
  })
  .partial();
export const createDepartmentBody = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
  name: text(200).min(1),
  description: optText(1000),
});

export const settingBody = z.object({ value: z.unknown(), note: optText(1000) });
export const settingParams = z.object({ key: z.string().min(1).max(100) });
export const OPS_JOBS = [
  'follow-up-reminders',
  'enrolment-replies',
  'lead-intake',
  'demo-academic-marks',
] as const;
export const jobParams = z.object({ job: z.enum(OPS_JOBS) });
export const dashboardQuery = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
