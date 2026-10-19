/**
 * OWNER: Business Ops OS team — HR lifecycle slice (OPS-040…OPS-049, D-028).
 *
 * Recruitment, onboarding and offboarding: job requisitions, candidates, job
 * applications with stage history, interviews with their panel (and each
 * panelist's feedback), offers, and lifecycle cases (onboarding / offboarding)
 * with their checklist items.
 *
 * Rules: same as ops.ts — `ops.table(...)` (import `ops` from './ops'), exports
 * prefixed `ops`, UUID PKs, human codes in separate unique columns, FKs only
 * into `ops` or `core`, column helpers from './ops-columns', only
 * `import type` from workspace packages, no `drizzle-kit generate`.
 *
 * Sensitive columns (services enforce field-level access; never in list
 * responses or audit payloads): candidate email/phone, separation reason.
 * Offer salary is NOT stored here: compensation records belong to HR records
 * (ops-hr.ts); an offer keeps at most a reference text. Rows that history
 * depends on are never deleted (status columns instead); unsuccessful
 * candidates are anonymised in place, keeping their stage history.
 * Column-level documentation: apps/business-ops-os/docs/parts/hr-lifecycle.md.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Brand, DepartmentId, IntegrationEventId, StaffMemberId } from '@elevate/shared-types';
import { departments, integrationEvents } from './core';
import { ops } from './ops';
import { opsAssetAssignments, opsEmployeeRecords, type OpsAssetAssignmentId } from './ops-hr';
import {
  createdAt,
  inList,
  instant,
  isoDate,
  staffRef,
  staffRefRestrict,
  updatedAt,
  userRef,
} from './ops-columns';

export type OpsRequisitionId = Brand<string, 'OpsRequisitionId'>;
export type OpsCandidateId = Brand<string, 'OpsCandidateId'>;
export type OpsJobApplicationId = Brand<string, 'OpsJobApplicationId'>;
export type OpsJobApplicationStageId = Brand<string, 'OpsJobApplicationStageId'>;
export type OpsInterviewId = Brand<string, 'OpsInterviewId'>;
export type OpsJobOfferId = Brand<string, 'OpsJobOfferId'>;
export type OpsLifecycleCaseId = Brand<string, 'OpsLifecycleCaseId'>;
export type OpsLifecycleItemId = Brand<string, 'OpsLifecycleItemId'>;

// --- vocabularies (mirrored by apps/business-ops-os/src/domain/hr/{recruitment,lifecycle}.ts) ---
export const OPS_REQUISITION_STATUSES = [
  'draft',
  'open',
  'on_hold',
  'filled',
  'cancelled',
] as const;
export const OPS_REQUISITION_EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'contract',
  'visiting',
] as const;
export const OPS_CANDIDATE_SOURCES = [
  'referral',
  'job_portal',
  'website',
  'walk_in',
  'social_media',
  'agency',
  'campus',
  'internal',
  'other',
] as const;
export const OPS_CANDIDATE_STATUSES = ['active', 'anonymised'] as const;
export const OPS_APPLICATION_STAGES = [
  'applied',
  'screening',
  'interview',
  'offer',
  'hired',
  'rejected',
  'withdrawn',
] as const;
export const OPS_INTERVIEW_MODES = ['in_person', 'video', 'phone'] as const;
export const OPS_INTERVIEW_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'] as const;
export const OPS_INTERVIEW_RECOMMENDATIONS = [
  'strong_hire',
  'hire',
  'no_hire',
  'strong_no_hire',
] as const;
export const OPS_OFFER_STATUSES = [
  'draft',
  'approved',
  'extended',
  'accepted',
  'declined',
  'withdrawn',
  'expired',
] as const;
export const OPS_LIFECYCLE_KINDS = ['onboarding', 'offboarding'] as const;
export const OPS_LIFECYCLE_STATUSES = ['open', 'approved', 'completed', 'cancelled'] as const;
export const OPS_SEPARATION_TYPES = [
  'resignation',
  'termination',
  'contract_end',
  'retirement',
  'other',
] as const;
export const OPS_LIFECYCLE_ITEM_KINDS = [
  'document',
  'policy_ack',
  'org_confirmation',
  'asset_assignment',
  'access_request',
  'induction',
  'asset_return',
  'access_revocation',
  'ownership_transfer',
  'final_settlement',
  'exit_interview',
  'custom',
] as const;
export const OPS_LIFECYCLE_ITEM_STATUSES = [
  'pending',
  'done',
  'not_applicable',
  'blocked',
] as const;
export const OPS_TRANSFER_ENTITY_TYPES = ['task', 'lead', 'admission', 'responsibility'] as const;

// --- recruitment -------------------------------------------------------------------------------

/**
 * Job requisitions (OPS-040). `draft` → `open` needs an `ops:recruitment:decide`
 * holder who is not the requester (createdBy). The recruiter is the staff
 * member whose `own` recruitment scope covers it.
 */
export const opsRequisitions = ops.table(
  'requisitions',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsRequisitionId>(),
    /** REQ-0001 … (never reused). */
    code: text('code').notNull(),
    title: text('title').notNull(),
    departmentId: uuid('department_id')
      .references(() => departments.id, { onDelete: 'restrict' })
      .$type<DepartmentId>(),
    roleDescription: text('role_description'),
    openings: integer('openings').notNull().default(1),
    employmentType: text('employment_type', { enum: OPS_REQUISITION_EMPLOYMENT_TYPES }).notNull(),
    location: text('location'),
    status: text('status', { enum: OPS_REQUISITION_STATUSES }).notNull().default('draft'),
    statusReason: text('status_reason'),
    statusChangedAt: instant('status_changed_at').notNull().defaultNow(),
    recruiterStaffId: staffRef('recruiter_staff_id'),
    hiringManagerStaffId: staffRef('hiring_manager_staff_id'),
    approvedBy: userRef('approved_by'),
    approvedAt: instant('approved_at'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('requisitions_code_key').on(t.code),
    index('requisitions_status_idx').on(t.status, t.statusChangedAt),
    index('requisitions_recruiter_idx').on(t.recruiterStaffId),
    check('requisitions_code_format', sql`${t.code} ~ '^REQ-[0-9]{4}$'`),
    check('requisitions_status_check', sql`${t.status} IN ${inList(OPS_REQUISITION_STATUSES)}`),
    check(
      'requisitions_employment_type_check',
      sql`${t.employmentType} IN ${inList(OPS_REQUISITION_EMPLOYMENT_TYPES)}`,
    ),
    check('requisitions_openings_check', sql`${t.openings} BETWEEN 1 AND 500`),
    check(
      'requisitions_approved_consistent',
      sql`(${t.approvedBy} IS NULL) = (${t.approvedAt} IS NULL)`,
    ),
  ],
);

/**
 * Candidates (OPS-041): minimal personal data. Email (lower-case) and phone
 * (E.164) are normalised by domain/contacts.ts and are sensitive. Anonymised
 * candidates keep their code and stage history; name/contacts are replaced.
 */
export const opsCandidates = ops.table(
  'candidates',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsCandidateId>(),
    /** CAND-00001 … */
    code: text('code').notNull(),
    fullName: text('full_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    source: text('source', { enum: OPS_CANDIDATE_SOURCES }).notNull(),
    sourceDetail: text('source_detail'),
    recruiterStaffId: staffRef('recruiter_staff_id'),
    /** When the candidate was given the privacy notice (how their data is used and kept). */
    privacyNoticeAt: instant('privacy_notice_at'),
    /** Free-text consent record, e.g. "agreed to be kept for future openings" (no documents). */
    consentNote: text('consent_note'),
    status: text('status', { enum: OPS_CANDIDATE_STATUSES }).notNull().default('active'),
    anonymisedAt: instant('anonymised_at'),
    anonymisedBy: userRef('anonymised_by'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('candidates_code_key').on(t.code),
    uniqueIndex('candidates_email_key')
      .on(t.email)
      .where(sql`${t.email} IS NOT NULL`),
    uniqueIndex('candidates_phone_key')
      .on(t.phone)
      .where(sql`${t.phone} IS NOT NULL`),
    index('candidates_recruiter_idx').on(t.recruiterStaffId),
    check('candidates_code_format', sql`${t.code} ~ '^CAND-[0-9]{5}$'`),
    check('candidates_source_check', sql`${t.source} IN ${inList(OPS_CANDIDATE_SOURCES)}`),
    check('candidates_status_check', sql`${t.status} IN ${inList(OPS_CANDIDATE_STATUSES)}`),
    check('candidates_email_lowercase', sql`${t.email} IS NULL OR ${t.email} = lower(${t.email})`),
    check(
      'candidates_anonymised_consistent',
      sql`(${t.status} = 'anonymised') = (${t.anonymisedAt} IS NOT NULL)`,
    ),
    check(
      'candidates_anonymised_no_contacts',
      sql`${t.status} <> 'anonymised' OR (${t.email} IS NULL AND ${t.phone} IS NULL)`,
    ),
  ],
);

/**
 * A candidate's application to one requisition (OPS-042). Stage machine:
 * domain/hr/recruitment.ts. `employeeStaffId` is set once by the conversion
 * (unique: one employee per application, idempotent conversion).
 */
export const opsJobApplications = ops.table(
  'job_applications',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsJobApplicationId>(),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => opsCandidates.id, { onDelete: 'restrict' })
      .$type<OpsCandidateId>(),
    requisitionId: uuid('requisition_id')
      .notNull()
      .references(() => opsRequisitions.id, { onDelete: 'restrict' })
      .$type<OpsRequisitionId>(),
    stage: text('stage', { enum: OPS_APPLICATION_STAGES }).notNull().default('applied'),
    stageReason: text('stage_reason'),
    stageChangedAt: instant('stage_changed_at').notNull().defaultNow(),
    /** Set when the application reaches hired / rejected / withdrawn. */
    closedAt: instant('closed_at'),
    employeeStaffId: uuid('employee_staff_id')
      .references(() => opsEmployeeRecords.staffId, { onDelete: 'restrict' })
      .$type<StaffMemberId>(),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('job_applications_candidate_requisition_key').on(t.candidateId, t.requisitionId),
    uniqueIndex('job_applications_employee_key')
      .on(t.employeeStaffId)
      .where(sql`${t.employeeStaffId} IS NOT NULL`),
    index('job_applications_requisition_idx').on(t.requisitionId, t.stage),
    index('job_applications_stage_idx').on(t.stage, t.stageChangedAt),
    check('job_applications_stage_check', sql`${t.stage} IN ${inList(OPS_APPLICATION_STAGES)}`),
    check(
      'job_applications_closed_consistent',
      sql`(${t.stage} IN ('hired', 'rejected', 'withdrawn')) = (${t.closedAt} IS NOT NULL)`,
    ),
    check(
      'job_applications_hired_has_employee',
      sql`${t.stage} <> 'hired' OR ${t.employeeStaffId} IS NOT NULL`,
    ),
  ],
);

/** Every stage change of an application (append-only; survives anonymisation). */
export const opsJobApplicationStages = ops.table(
  'job_application_stages',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsJobApplicationStageId>(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => opsJobApplications.id, { onDelete: 'restrict' })
      .$type<OpsJobApplicationId>(),
    fromStage: text('from_stage', { enum: OPS_APPLICATION_STAGES }),
    toStage: text('to_stage', { enum: OPS_APPLICATION_STAGES }).notNull(),
    reason: text('reason'),
    actorUserId: userRef('actor_user_id').notNull(),
    at: instant('at').notNull().defaultNow(),
  },
  (t) => [
    index('job_application_stages_application_idx').on(t.applicationId, t.at),
    check(
      'job_application_stages_to_check',
      sql`${t.toStage} IN ${inList(OPS_APPLICATION_STAGES)}`,
    ),
  ],
);

/** Interviews of an application (OPS-043). `scheduledAt` is a UTC instant. */
export const opsInterviews = ops.table(
  'interviews',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsInterviewId>(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => opsJobApplications.id, { onDelete: 'restrict' })
      .$type<OpsJobApplicationId>(),
    scheduledAt: instant('scheduled_at').notNull(),
    durationMinutes: integer('duration_minutes').notNull().default(45),
    mode: text('mode', { enum: OPS_INTERVIEW_MODES }).notNull(),
    /** Room or meeting reference (no credentials). */
    location: text('location'),
    status: text('status', { enum: OPS_INTERVIEW_STATUSES }).notNull().default('scheduled'),
    statusReason: text('status_reason'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('interviews_application_idx').on(t.applicationId, t.scheduledAt),
    check('interviews_mode_check', sql`${t.mode} IN ${inList(OPS_INTERVIEW_MODES)}`),
    check('interviews_status_check', sql`${t.status} IN ${inList(OPS_INTERVIEW_STATUSES)}`),
    check('interviews_duration_check', sql`${t.durationMinutes} BETWEEN 5 AND 480`),
  ],
);

/**
 * Interview panel: one row per assigned interviewer (staff), holding that
 * interviewer's feedback. Only the assigned interviewer can write their row.
 */
export const opsInterviewPanelists = ops.table(
  'interview_panelists',
  {
    interviewId: uuid('interview_id')
      .notNull()
      .references(() => opsInterviews.id, { onDelete: 'restrict' })
      .$type<OpsInterviewId>(),
    staffId: staffRefRestrict('staff_id').notNull(),
    recommendation: text('recommendation', { enum: OPS_INTERVIEW_RECOMMENDATIONS }),
    feedbackNotes: text('feedback_notes'),
    submittedBy: userRef('submitted_by'),
    submittedAt: instant('submitted_at'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'interview_panelists_pkey', columns: [t.interviewId, t.staffId] }),
    index('interview_panelists_staff_idx').on(t.staffId),
    check(
      'interview_panelists_recommendation_check',
      sql`${t.recommendation} IS NULL OR ${t.recommendation} IN ${inList(OPS_INTERVIEW_RECOMMENDATIONS)}`,
    ),
    check(
      'interview_panelists_feedback_consistent',
      sql`(${t.submittedAt} IS NULL) = (${t.recommendation} IS NULL) AND (${t.submittedAt} IS NULL) = (${t.submittedBy} IS NULL)`,
    ),
  ],
);

/**
 * Offers (OPS-044). draft → approved (by someone other than the preparer) →
 * extended (marked by hand: Elevate OS never sends an offer) → accepted |
 * declined | withdrawn | expired. No salary here — `compensationReference` is
 * a pointer only. At most one live offer per application.
 */
export const opsJobOffers = ops.table(
  'job_offers',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsJobOfferId>(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => opsJobApplications.id, { onDelete: 'restrict' })
      .$type<OpsJobApplicationId>(),
    status: text('status', { enum: OPS_OFFER_STATUSES }).notNull().default('draft'),
    statusReason: text('status_reason'),
    offeredTitle: text('offered_title').notNull(),
    proposedStartDate: isoDate('proposed_start_date'),
    validUntil: isoDate('valid_until'),
    /** Reference to the compensation proposal held by HR records; never an amount. */
    compensationReference: text('compensation_reference'),
    notes: text('notes'),
    preparedBy: userRef('prepared_by').notNull(),
    approvedBy: userRef('approved_by'),
    approvedAt: instant('approved_at'),
    extendedBy: userRef('extended_by'),
    extendedAt: instant('extended_at'),
    respondedAt: instant('responded_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('job_offers_one_live_key')
      .on(t.applicationId)
      .where(sql`${t.status} IN ('draft', 'approved', 'extended', 'accepted')`),
    index('job_offers_status_idx').on(t.status),
    check('job_offers_status_check', sql`${t.status} IN ${inList(OPS_OFFER_STATUSES)}`),
    check(
      'job_offers_not_self_approved',
      sql`${t.approvedBy} IS NULL OR ${t.approvedBy} <> ${t.preparedBy}`,
    ),
    check(
      'job_offers_approved_consistent',
      sql`(${t.approvedBy} IS NULL) = (${t.approvedAt} IS NULL)`,
    ),
    check(
      'job_offers_approved_before_extended',
      sql`${t.status} NOT IN ('approved', 'extended', 'accepted', 'declined') OR ${t.approvedAt} IS NOT NULL`,
    ),
  ],
);

// --- lifecycle cases ---------------------------------------------------------------------------

/**
 * Onboarding / offboarding cases (OPS-045…048), HRC-00001 … At most one live
 * case per employee and kind. Onboarding: open → completed (final approval) |
 * cancelled. Offboarding: open → approved (separation approved; employee on
 * notice) → completed (separated by runSeparations) | cancelled.
 * `separationReason` is sensitive (approvers and HR only).
 */
export const opsLifecycleCases = ops.table(
  'lifecycle_cases',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsLifecycleCaseId>(),
    /** HRC-00001 … */
    code: text('code').notNull(),
    kind: text('kind', { enum: OPS_LIFECYCLE_KINDS }).notNull(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => opsEmployeeRecords.staffId, { onDelete: 'restrict' })
      .$type<StaffMemberId>(),
    status: text('status', { enum: OPS_LIFECYCLE_STATUSES }).notNull().default('open'),
    statusReason: text('status_reason'),
    /** Onboarding opened by a candidate conversion. */
    applicationId: uuid('application_id')
      .references(() => opsJobApplications.id, { onDelete: 'restrict' })
      .$type<OpsJobApplicationId>(),
    separationType: text('separation_type', { enum: OPS_SEPARATION_TYPES }),
    noticeDate: isoDate('notice_date'),
    lastWorkingDay: isoDate('last_working_day'),
    /** Sensitive: shown only to lifecycle approvers and HR (all-scope lifecycle managers). */
    separationReason: text('separation_reason'),
    /** Reference to the final settlement handled outside Elevate OS (no calculation here). */
    settlementReference: text('settlement_reference'),
    openedBy: userRef('opened_by').notNull(),
    approvedBy: userRef('approved_by'),
    approvedAt: instant('approved_at'),
    approvalComment: text('approval_comment'),
    completedAt: instant('completed_at'),
    separatedAt: instant('separated_at'),
    /** The ops.employee.separated event published at separation. */
    separationEventId: uuid('separation_event_id')
      .references(() => integrationEvents.id, { onDelete: 'restrict' })
      .$type<IntegrationEventId>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('lifecycle_cases_code_key').on(t.code),
    uniqueIndex('lifecycle_cases_one_live_key')
      .on(t.staffId, t.kind)
      .where(sql`${t.status} IN ('open', 'approved')`),
    uniqueIndex('lifecycle_cases_application_key')
      .on(t.applicationId)
      .where(sql`${t.applicationId} IS NOT NULL`),
    index('lifecycle_cases_status_idx').on(t.kind, t.status),
    index('lifecycle_cases_lwd_idx').on(t.lastWorkingDay),
    check('lifecycle_cases_code_format', sql`${t.code} ~ '^HRC-[0-9]{5}$'`),
    check('lifecycle_cases_kind_check', sql`${t.kind} IN ${inList(OPS_LIFECYCLE_KINDS)}`),
    check('lifecycle_cases_status_check', sql`${t.status} IN ${inList(OPS_LIFECYCLE_STATUSES)}`),
    check(
      'lifecycle_cases_separation_type_check',
      sql`${t.separationType} IS NULL OR ${t.separationType} IN ${inList(OPS_SEPARATION_TYPES)}`,
    ),
    check(
      'lifecycle_cases_offboarding_fields',
      sql`${t.kind} <> 'offboarding' OR (${t.separationType} IS NOT NULL AND ${t.lastWorkingDay} IS NOT NULL)`,
    ),
    check(
      'lifecycle_cases_onboarding_fields',
      sql`${t.kind} <> 'onboarding' OR (${t.separationType} IS NULL AND ${t.lastWorkingDay} IS NULL AND ${t.separationReason} IS NULL)`,
    ),
    check(
      'lifecycle_cases_notice_before_lwd',
      sql`${t.noticeDate} IS NULL OR ${t.lastWorkingDay} IS NULL OR ${t.noticeDate} <= ${t.lastWorkingDay}`,
    ),
    check(
      'lifecycle_cases_approved_consistent',
      sql`(${t.approvedBy} IS NULL) = (${t.approvedAt} IS NULL)`,
    ),
    check(
      'lifecycle_cases_onboarding_only_open_completed',
      sql`${t.kind} <> 'onboarding' OR ${t.status} <> 'approved'`,
    ),
  ],
);

/**
 * Checklist items of a lifecycle case. `itemKey` makes generation idempotent:
 * `template:<key>`, `asset:<assignmentId>`, `transfer:<type>:<id>`,
 * `access_revocation`, `final_settlement`, `custom:<n>`.
 */
export const opsLifecycleItems = ops.table(
  'lifecycle_items',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsLifecycleItemId>(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => opsLifecycleCases.id, { onDelete: 'restrict' })
      .$type<OpsLifecycleCaseId>(),
    itemKey: text('item_key').notNull(),
    seq: integer('seq').notNull(),
    kind: text('kind', { enum: OPS_LIFECYCLE_ITEM_KINDS }).notNull(),
    title: text('title').notNull(),
    required: boolean('required').notNull().default(true),
    assigneeStaffId: staffRef('assignee_staff_id'),
    /** Asia/Kolkata calendar day. */
    dueDate: isoDate('due_date'),
    status: text('status', { enum: OPS_LIFECYCLE_ITEM_STATUSES }).notNull().default('pending'),
    /** Evidence reference (document ref, ticket ref, "returned per AST-00001"). No files, no credentials. */
    evidence: text('evidence'),
    notes: text('notes'),
    assetAssignmentId: uuid('asset_assignment_id')
      .references(() => opsAssetAssignments.id, { onDelete: 'restrict' })
      .$type<OpsAssetAssignmentId>(),
    transferEntityType: text('transfer_entity_type', { enum: OPS_TRANSFER_ENTITY_TYPES }),
    transferEntityId: uuid('transfer_entity_id'),
    transferTargetStaffId: staffRef('transfer_target_staff_id'),
    completedBy: userRef('completed_by'),
    completedAt: instant('completed_at'),
    /** Last IST day a reminder was sent for this item (one reminder per day). */
    lastRemindedOn: isoDate('last_reminded_on'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('lifecycle_items_case_key').on(t.caseId, t.itemKey),
    index('lifecycle_items_case_idx').on(t.caseId, t.seq),
    index('lifecycle_items_due_idx').on(t.status, t.dueDate),
    check('lifecycle_items_kind_check', sql`${t.kind} IN ${inList(OPS_LIFECYCLE_ITEM_KINDS)}`),
    check(
      'lifecycle_items_status_check',
      sql`${t.status} IN ${inList(OPS_LIFECYCLE_ITEM_STATUSES)}`,
    ),
    check(
      'lifecycle_items_transfer_type_check',
      sql`${t.transferEntityType} IS NULL OR ${t.transferEntityType} IN ${inList(OPS_TRANSFER_ENTITY_TYPES)}`,
    ),
    check(
      'lifecycle_items_transfer_consistent',
      sql`(${t.transferEntityType} IS NULL) = (${t.transferEntityId} IS NULL)`,
    ),
    check(
      'lifecycle_items_done_has_completion',
      sql`${t.status} <> 'done' OR ${t.completedAt} IS NOT NULL`,
    ),
  ],
);
