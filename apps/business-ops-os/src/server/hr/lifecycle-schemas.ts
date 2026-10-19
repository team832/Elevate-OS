/**
 * zod schemas for the HR lifecycle API (recruitment, onboarding, offboarding).
 * Routes validate with them; services take their output types.
 * Documented in docs/parts/hr-lifecycle.md → API.
 */
import { z } from 'zod';
import { isoDateSchema, isoDateTimeSchema } from '@elevate/shared-contracts';
import {
  APPLICATION_STAGES,
  CANDIDATE_SOURCES,
  INTERVIEW_MODES,
  INTERVIEW_RECOMMENDATIONS,
  INTERVIEW_STATUSES,
  OFFER_STATUSES,
  REQUISITION_EMPLOYMENT_TYPES,
  REQUISITION_STATUSES,
} from '../../domain/hr/recruitment';
import { ITEM_STATUSES, LIFECYCLE_STATUSES, SEPARATION_TYPES } from '../../domain/hr/lifecycle';

const text = (max = 500) => z.string().trim().max(max);
const optText = (max = 500) => text(max).nullish();
const reason = optText(1000);

export { idParams } from '../schemas';
export const caseItemParams = z.object({ id: z.uuid(), itemId: z.uuid() });

/** Common list query: search, sort, pagination. */
const listBase = {
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  dir: z.enum(['asc', 'desc']).default('desc'),
};

// --- requisitions -------------------------------------------------------------------------------

export const requisitionListQuery = z.object({
  ...listBase,
  status: z.enum(REQUISITION_STATUSES).optional(),
  sort: z.enum(['code', 'title', 'status', 'updated']).default('updated'),
});
export type RequisitionListQuery = z.output<typeof requisitionListQuery>;

export const createRequisitionBody = z.object({
  title: text(200).min(2),
  departmentId: z.uuid().nullish(),
  roleDescription: optText(5000),
  openings: z.int().min(1).max(500).default(1),
  employmentType: z.enum(REQUISITION_EMPLOYMENT_TYPES),
  location: optText(200),
  recruiterStaffId: z.uuid().nullish(),
  hiringManagerStaffId: z.uuid().nullish(),
});
export type CreateRequisitionInput = z.output<typeof createRequisitionBody>;

export const updateRequisitionBody = createRequisitionBody
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { error: 'Nothing to change.' });
export type UpdateRequisitionInput = z.output<typeof updateRequisitionBody>;

export const requisitionTransitionBody = z.object({
  to: z.enum(REQUISITION_STATUSES),
  reason,
});

// --- candidates ---------------------------------------------------------------------------------

export const candidateListQuery = z.object({
  ...listBase,
  status: z.enum(['active', 'anonymised']).optional(),
  retention: z.enum(['due']).optional(),
  sort: z.enum(['code', 'name', 'updated']).default('updated'),
});
export type CandidateListQuery = z.output<typeof candidateListQuery>;

export const createCandidateBody = z.object({
  fullName: text(200).min(2),
  email: optText(254),
  phone: optText(40),
  source: z.enum(CANDIDATE_SOURCES),
  sourceDetail: optText(200),
  recruiterStaffId: z.uuid().nullish(),
  privacyNoticeGiven: z.boolean().default(false),
  consentNote: optText(1000),
});
export type CreateCandidateInput = z.output<typeof createCandidateBody>;

export const updateCandidateBody = createCandidateBody
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { error: 'Nothing to change.' });
export type UpdateCandidateInput = z.output<typeof updateCandidateBody>;

/** Sensitive actions carry an explicit confirmation the server checks. */
export const confirmBody = z.object({
  confirm: z.literal(true, { error: 'Tick the confirmation box.' }),
  comment: optText(1000),
});

// --- applications -------------------------------------------------------------------------------

export const applicationListQuery = z.object({
  ...listBase,
  stage: z.enum(APPLICATION_STAGES).optional(),
  requisitionId: z.uuid().optional(),
  view: z.enum(['all', 'interviewing_me']).default('all'),
  sort: z.enum(['stage', 'updated', 'candidate']).default('updated'),
});
export type ApplicationListQuery = z.output<typeof applicationListQuery>;

export const createApplicationBody = z.object({
  candidateId: z.uuid(),
  requisitionId: z.uuid(),
});

export const applicationTransitionBody = z.object({
  to: z.enum(APPLICATION_STAGES),
  reason,
});

export const convertBody = z.object({
  /** Reporting manager; defaults to the requisition's hiring manager. */
  managerStaffId: z.uuid().nullish(),
  workEmail: optText(254),
  workLocation: optText(200),
});
export type ConvertInput = z.output<typeof convertBody>;

// --- interviews ---------------------------------------------------------------------------------

/** Screens post `interviewer1..3` (one select each); API clients post `interviewerStaffIds`. */
function collectInterviewers(input: unknown) {
  if (!input || typeof input !== 'object') return input;
  const { interviewer1, interviewer2, interviewer3, ...rest } = input as Record<string, unknown>;
  const singles = [interviewer1, interviewer2, interviewer3].filter(
    (v) => typeof v === 'string' && v,
  );
  if (singles.length === 0) return rest;
  const list = Array.isArray(rest.interviewerStaffIds) ? rest.interviewerStaffIds : [];
  return { ...rest, interviewerStaffIds: [...list, ...singles] };
}

export const createInterviewBody = z.preprocess(
  collectInterviewers,
  z.object({
    applicationId: z.uuid(),
    scheduledAt: isoDateTimeSchema,
    durationMinutes: z.int().min(5).max(480).default(45),
    mode: z.enum(INTERVIEW_MODES),
    location: optText(300),
    interviewerStaffIds: z
      .array(z.uuid())
      .min(1, { error: 'Choose at least one interviewer.' })
      .max(10),
  }),
);
export type CreateInterviewInput = z.output<typeof createInterviewBody>;

export const updateInterviewBody = z
  .object({
    status: z.enum(INTERVIEW_STATUSES).optional(),
    scheduledAt: isoDateTimeSchema.optional(),
    reason,
  })
  .refine((v) => v.status !== undefined || v.scheduledAt !== undefined, {
    error: 'Give a new status or a new time.',
  });

export const feedbackBody = z.object({
  recommendation: z.enum(INTERVIEW_RECOMMENDATIONS),
  notes: text(5000).min(3),
});

// --- offers -------------------------------------------------------------------------------------

export const createOfferBody = z.object({
  applicationId: z.uuid(),
  offeredTitle: text(200).min(2),
  proposedStartDate: isoDateSchema.nullish(),
  validUntil: isoDateSchema.nullish(),
  compensationReference: optText(200),
  notes: optText(2000),
});
export type CreateOfferInput = z.output<typeof createOfferBody>;

export const offerTransitionBody = z.object({
  to: z.enum(OFFER_STATUSES),
  reason,
});

// --- lifecycle cases ----------------------------------------------------------------------------

export const caseListQuery = z.object({
  ...listBase,
  kind: z.enum(['onboarding', 'offboarding']).optional(),
  status: z.enum(LIFECYCLE_STATUSES).optional(),
  sort: z.enum(['code', 'updated', 'employee']).default('updated'),
});
export type CaseListQuery = z.output<typeof caseListQuery>;

export const createCaseBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('onboarding'), staffId: z.uuid() }),
  z.object({
    kind: z.literal('offboarding'),
    staffId: z.uuid(),
    separationType: z.enum(SEPARATION_TYPES),
    noticeDate: isoDateSchema.nullish(),
    lastWorkingDay: isoDateSchema,
    reason: optText(2000),
  }),
]);
export type CreateCaseInput = z.output<typeof createCaseBody>;

export const updateItemBody = z
  .object({
    status: z.enum(ITEM_STATUSES).optional(),
    evidence: optText(500),
    notes: optText(2000),
    assigneeStaffId: z.uuid().nullish(),
    dueDate: isoDateSchema.nullish(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { error: 'Nothing to change.' });
export type UpdateItemInput = z.output<typeof updateItemBody>;

export const addItemBody = z.object({
  title: text(200).min(2),
  required: z.boolean().default(false),
  assigneeStaffId: z.uuid().nullish(),
  dueDate: isoDateSchema.nullish(),
});
export type AddItemInput = z.output<typeof addItemBody>;

export const transferBody = z.object({ targetStaffId: z.uuid() });

export const cancelCaseBody = z.object({ reason: text(1000).min(3) });

export const lifecycleJobBody = z.object({
  job: z.enum(['lifecycle-reminders', 'separations']),
});
