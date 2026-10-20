/**
 * zod schemas for the operations-work routes (OPS-060…OPS-069): task comments,
 * references, reviews, filters; SOP schedules, archive, acknowledgements; risk
 * mitigations; the policies & compliance register. Documented in
 * docs/parts/operations.md → API.
 */
import { z } from 'zod';
import { isoDateSchema } from '@elevate/shared-contracts';
import { ROLE_KEYS } from '@elevate/shared-types';
import {
  MITIGATION_STATUSES,
  POLICY_AREAS,
  POLICY_STATUSES,
  TASK_COMMENT_MAX_LENGTH,
} from '../domain';

const text = (max = 500) => z.string().trim().max(max);
const optText = (max = 500) => text(max).nullish();
const optUuid = z.uuid().nullish();

// --- tasks ---------------------------------------------------------------------------------------

export const TASK_VIEWS = [
  'mine',
  'overdue',
  'escalated',
  'blocked',
  'awaiting_review',
  'open',
  'all',
] as const;

/** GET /tasks: views plus department / person filters and page-based pagination. */
export const taskSearchQuery = z.object({
  view: z.enum(TASK_VIEWS).default('open'),
  departmentId: z.uuid().optional(),
  staffId: z.uuid().optional(),
  /** Which role `staffId` (or "me" in the mine view) holds on the task. */
  role: z.enum(['any', 'owner', 'accountable', 'backup']).default('any'),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
export type TaskSearchQuery = z.output<typeof taskSearchQuery>;

export const taskCommentBody = z.object({ body: text(TASK_COMMENT_MAX_LENGTH).min(1) });
export const hideCommentBody = z.object({ reason: text(1000).min(1) });
export const commentParams = z.object({ id: z.uuid(), commentId: z.uuid() });

export const taskReferenceBody = z.object({
  kind: z.enum(['document', 'evidence', 'other']).default('document'),
  label: text(200).min(1),
  /** URL or location description; Elevate OS stores no files. */
  location: text(1000).min(1),
});
export const removeReferenceBody = z.object({ reason: text(1000).min(1) });
export const referenceParams = z.object({ id: z.uuid(), referenceId: z.uuid() });

export const reviewRequirementBody = z.object({ reviewerStaffId: optUuid, note: optText(1000) });
export const taskReviewBody = z.object({
  decision: z.enum(['accept', 'return']),
  note: optText(2000),
});

// --- SOPs ----------------------------------------------------------------------------------------

export const sopScheduleBody = z.object({
  /** Defaults to the approved version in force. */
  versionId: optUuid,
  effectiveDate: isoDateSchema,
  nextReviewDate: isoDateSchema.nullish(),
});
export const sopArchiveBody = z.object({ reason: text(1000).min(1) });
export const ackRequirementBody = z
  .object({
    audienceType: z.enum(['department', 'role']),
    departmentId: optUuid,
    role: z.enum(ROLE_KEYS).nullish(),
    dueDate: isoDateSchema.nullish(),
    note: optText(1000),
  })
  .superRefine((v, ctx) => {
    if (v.audienceType === 'department' && !v.departmentId)
      ctx.addIssue({ code: 'custom', path: ['departmentId'], message: 'Choose a department' });
    if (v.audienceType === 'role' && !v.role)
      ctx.addIssue({ code: 'custom', path: ['role'], message: 'Choose a role' });
  });
export const withdrawRequirementBody = z.object({ reason: text(1000).min(1) });
export const requirementParams = z.object({ id: z.uuid(), requirementId: z.uuid() });
export const acknowledgeBody = z.object({ note: optText(1000) });

// --- risks ---------------------------------------------------------------------------------------

export const mitigationBody = z.object({
  action: text(2000).min(1),
  ownerStaffId: optUuid,
  dueDate: isoDateSchema.nullish(),
});
export const mitigationUpdateBody = z.object({
  status: z.enum(MITIGATION_STATUSES).optional(),
  outcome: optText(2000),
  ownerStaffId: optUuid,
  dueDate: isoDateSchema.nullish(),
});
export const mitigationParams = z.object({ id: z.uuid(), mitigationId: z.uuid() });

// --- policies & compliance register ---------------------------------------------------------------

const settingKeys = z.array(z.string().trim().min(1).max(100)).max(30);
const ownerDecisionRef = z
  .string()
  .regex(/^OD-\d{3}$/)
  .nullish();

export const policyListQuery = z.object({
  area: z.enum(POLICY_AREAS).optional(),
  status: z.enum(POLICY_STATUSES).optional(),
  review: z.enum(['overdue', 'due_soon']).optional(),
});
export const createPolicyBody = z.object({
  title: text(300).min(1),
  area: z.enum(POLICY_AREAS),
  summary: optText(2000),
  accountableStaffId: optUuid,
  ownerDecisionRef,
  requirementText: text(20_000).default(''),
  sourceReference: optText(1000),
  linkedSettingKeys: settingKeys.default([]),
  effectiveDate: isoDateSchema.nullish(),
  nextReviewDate: isoDateSchema.nullish(),
});
export const updatePolicyBody = z
  .object({
    title: text(300).min(1),
    area: z.enum(POLICY_AREAS),
    summary: optText(2000),
    accountableStaffId: optUuid,
    ownerDecisionRef,
  })
  .partial();
export const policyDraftBody = z.object({
  requirementText: text(20_000),
  sourceReference: optText(1000),
  linkedSettingKeys: settingKeys.default([]),
  effectiveDate: isoDateSchema.nullish(),
  nextReviewDate: isoDateSchema.nullish(),
  changeNote: optText(1000),
});
export const policyWorkflowBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('propose'), comment: optText(1000) }),
  z.object({ action: z.literal('approve'), comment: optText(1000) }),
  z.object({ action: z.literal('reject'), comment: text(1000).min(1) }),
  z.object({ action: z.literal('withdraw') }),
  z.object({ action: z.literal('retire'), reason: text(1000).min(1) }),
]);
