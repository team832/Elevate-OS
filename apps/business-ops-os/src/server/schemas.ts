/**
 * zod schemas for Business Ops API inputs (routes validate with them; services
 * take their output types). Documented in docs/API.md.
 */
import { z } from 'zod';
import { isoDateSchema, isoDateTimeSchema, programmeCodeSchema } from '@elevate/shared-contracts';
import {
  ADMISSION_CHECK_ITEMS,
  ADMISSION_STATUSES,
  DECISION_LOG_STATES,
  FOLLOW_UP_KINDS,
  INCIDENT_CATEGORIES,
  INCIDENT_KINDS,
  INCIDENT_STATUSES,
  LEVELS,
  MILESTONE_STATUSES,
  PROJECT_STATUSES,
  RISK_KINDS,
  RISK_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from '../domain';

const text = (max = 500) => z.string().trim().max(max);
const optText = (max = 500) => text(max).nullish();
const uuid = z.uuid();
const optUuid = z.uuid().nullish();

export const idParams = z.object({ id: z.uuid() });

// --- leads ----------------------------------------------------------------------------------

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

export const createLeadBody = z.object({
  ...contactFields,
  programmeCode: programmeCodeSchema.nullish(),
  interestMode: z.enum(['offline', 'online', 'undecided']).default('undecided'),
  receivedAt: isoDateTimeSchema.nullish(),
  sourceCode: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{1,39}$/)
    .default('UNKNOWN'),
  channel: optText(200),
  discoverySource: optText(200),
  campaignRef: optText(200),
  contentRef: optText(200),
  notes: optText(2000),
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
    .enum(['unassigned', 'handoff_pending', 'overdue', 'missing_next_action', 'duplicate'])
    .optional(),
});

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

// --- admissions -------------------------------------------------------------------------------

export const listAdmissionsQuery = z.object({
  status: z.enum(ADMISSION_STATUSES).optional(),
  handoff: z.enum(['not_requested', 'pending', 'enrolled', 'rejected']).optional(),
});
export const transitionBody = z.object({
  to: z.enum(ADMISSION_STATUSES),
  reason: optText(1000),
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
export const enrolmentRequestBody = z.object({ notes: optText(2000) });

// --- follow-ups, counselling, demos ---------------------------------------------------------

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

export const counsellingBody = z.object({
  admissionId: uuid,
  scheduledAt: isoDateTimeSchema,
  counsellorStaffId: optUuid,
  mode: z.enum(['in_person', 'phone', 'video']),
  attendees: z.enum(['student', 'parent', 'both']).nullish(),
});
export const counsellingUpdateBody = z.object({
  action: z.enum(['complete', 'no_show', 'cancel']),
  outcome: optText(2000),
  objections: optText(2000),
  nextStep: optText(1000),
  attendees: z.enum(['student', 'parent', 'both']).nullish(),
  recommendedProgrammeCode: programmeCodeSchema.nullish(),
  reason: optText(1000),
});
export const demoBody = z.object({
  admissionId: uuid,
  subjects: z.array(text(100).min(1)).min(1).max(20),
  dayDates: z.array(isoDateSchema).min(1).max(14),
  teacherStaffIds: z.array(uuid).max(20).default([]),
  notes: optText(2000),
});
export const demoUpdateBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('attended'), notes: optText(2000) }),
  z.object({ action: z.literal('missed'), reason: text(1000).min(1) }),
  z.object({ action: z.literal('cancel'), reason: text(1000).min(1) }),
  z.object({
    action: z.literal('record_fee'),
    feeStatus: z.enum(['not_paid', 'paid_verified']),
    feeReference: optText(300),
  }),
]);
export const scheduleQuery = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

// --- tasks ---------------------------------------------------------------------------------------

export const taskLinks = {
  leadId: optUuid,
  admissionId: optUuid,
  sopId: optUuid,
  decisionId: optUuid,
  projectId: optUuid,
};
export const createTaskBody = z.object({
  title: text(300).min(1),
  description: optText(4000),
  departmentId: optUuid,
  ownerStaffId: optUuid,
  accountableStaffId: optUuid,
  backupStaffId: optUuid,
  dueDate: isoDateSchema.nullish(),
  priority: z.enum(TASK_PRIORITIES).default('medium'),
  ...taskLinks,
});
export type CreateTaskInput = z.output<typeof createTaskBody>;
export const updateTaskBody = createTaskBody.partial();
export type UpdateTaskInput = z.output<typeof updateTaskBody>;
export const taskStatusBody = z.object({
  to: z.enum(TASK_STATUSES),
  reason: optText(1000),
  completionNote: optText(2000),
  evidenceLink: optText(1000),
  blockerOverrideReason: optText(1000),
});
export const dependencyBody = z.object({ blockedByTaskId: uuid });
export const dependencyDeleteQuery = z.object({ blockedByTaskId: z.uuid() });
export const taskListQuery = z.object({
  view: z.enum(['mine', 'overdue', 'escalated', 'blocked', 'open', 'all']).default('open'),
});
export const escalationActionBody = z.object({
  action: z.enum(['acknowledge', 'resolve']),
  note: optText(1000),
});

// --- organisation ------------------------------------------------------------------------------

export const createStaffBody = z.object({
  fullName: text(200).min(1),
  departmentId: optUuid,
  title: optText(200),
  managerId: optUuid,
  userId: optUuid,
  employmentType: z
    .enum(['full_time', 'part_time', 'contract', 'visiting', 'not_recorded'])
    .default('not_recorded'),
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
export const responsibilityBody = z.object({
  title: text(300).min(1),
  description: optText(2000),
  departmentId: optUuid,
  accountableRole: optText(200),
  holderStaffId: optUuid,
  backupStaffId: optUuid,
  handOverToRole: optText(200),
  critical: z.boolean().default(false),
});
export const updateResponsibilityBody = responsibilityBody
  .extend({ status: z.enum(['active', 'retired']) })
  .partial();
export const onboardingItemBody = z.object({
  status: z.enum(['pending', 'done', 'not_applicable']),
  documentRef: optText(300),
});

// --- SOPs ---------------------------------------------------------------------------------------

export const createSopBody = z.object({
  title: text(300).min(1),
  process: optText(500),
  departmentId: optUuid,
  ownerStaffId: optUuid,
  reviewerStaffId: optUuid,
  backupStaffId: optUuid,
  ownerRole: optText(200),
  riskLevel: z.enum(LEVELS).nullish(),
  priority: optText(50),
  nextReviewDate: isoDateSchema.nullish(),
  content: text(50_000).default(''),
});
export const updateSopBody = createSopBody.omit({ content: true }).partial();
export const sopDraftBody = z.object({
  content: text(50_000),
  changeNote: optText(1000),
  documentRef: optText(500),
  checklist: z
    .array(z.object({ section: text(200).min(1), text: text(2000).min(1) }))
    .max(200)
    .optional(),
});
export const sopWorkflowBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('submit'), comment: optText(1000) }),
  z.object({
    action: z.literal('review'),
    outcome: z.enum(['recommend_approval', 'changes_requested']),
    note: optText(2000),
  }),
  z.object({ action: z.literal('approve'), comment: optText(1000) }),
  z.object({ action: z.literal('reject'), comment: text(1000).min(1) }),
  z.object({ action: z.literal('withdraw') }),
  z.object({ action: z.literal('retire'), reason: text(1000).min(1) }),
]);

// --- incidents ----------------------------------------------------------------------------------

export const incidentBody = z.object({
  kind: z.enum(INCIDENT_KINDS),
  category: z.enum(INCIDENT_CATEGORIES),
  title: text(300).min(1),
  description: optText(4000),
  severity: z.enum(LEVELS).default('medium'),
  ownerStaffId: optUuid,
  departmentId: optUuid,
  sopId: optUuid,
  occurredAt: isoDateTimeSchema.nullish(),
});
export const incidentUpdateBody = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  resolution: optText(4000),
  ownerStaffId: optUuid,
  severity: z.enum(LEVELS).optional(),
});

// --- planning -----------------------------------------------------------------------------------

export const decisionBody = z.object({
  area: text(200).min(1),
  statement: text(4000).min(1),
  state: z.enum(DECISION_LOG_STATES).default('proposed'),
  decidedByStaffId: optUuid,
  decidedOn: isoDateSchema.nullish(),
  source: optText(1000),
  ownerDecisionRef: z
    .string()
    .regex(/^OD-\d{3}$/)
    .nullish(),
});
export const updateDecisionBody = decisionBody.extend({ supersededById: optUuid }).partial();
export const riskBody = z.object({
  kind: z.enum(RISK_KINDS),
  title: text(300).min(1),
  description: optText(4000),
  likelihood: z.enum(LEVELS).nullish(),
  impact: z.enum(LEVELS).nullish(),
  ownerStaffId: optUuid,
  mitigation: optText(4000),
  reviewDate: isoDateSchema.nullish(),
  targetDate: isoDateSchema.nullish(),
  status: z.enum(RISK_STATUSES).default('open'),
  taskId: optUuid,
  projectId: optUuid,
});
export const updateRiskBody = riskBody.partial();
export const projectBody = z.object({
  name: text(300).min(1),
  workstream: optText(200),
  description: optText(4000),
  ownerStaffId: optUuid,
  startDate: isoDateSchema.nullish(),
  endDate: isoDateSchema.nullish(),
  status: z.enum(PROJECT_STATUSES).default('planned'),
});
export const updateProjectBody = projectBody.partial();
export const milestoneBody = z.object({
  title: text(300).min(1),
  dueDate: isoDateSchema.nullish(),
  ownerStaffId: optUuid,
  dependsOnMilestoneIds: z.array(uuid).max(50).default([]),
});
export const milestoneUpdateBody = z.object({
  status: z.enum(MILESTONE_STATUSES).optional(),
  dueDate: isoDateSchema.nullish(),
  addDependsOnMilestoneId: optUuid,
});

// --- settings, jobs, dashboard --------------------------------------------------------------------

export const settingBody = z.object({ value: z.unknown(), note: optText(1000) });
export const settingParams = z.object({ key: z.string().min(1).max(100) });
export const jobParams = z.object({
  job: z.enum(['follow-up-reminders', 'task-escalations', 'enrolment-replies']),
});
export const dashboardQuery = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
