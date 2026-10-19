/**
 * OWNER: Business Ops OS team.
 *
 * Operations work additions (OPS-060…OPS-069): task comments, document
 * references, supervisor reviews and reminders; SOP version schedules
 * (effective / next review dates), archive flags, required acknowledgements;
 * risk mitigation actions. Side tables only — the BR-OPS-10 task statuses and
 * the SOP statuses in ops.ts are unchanged.
 *
 * Rules: same as ops.ts — `ops.table(...)` (import `ops` from './ops'), exports
 * prefixed `ops`, UUID PKs, human codes in separate unique columns, FKs only
 * into `ops` or `core`, column helpers from './ops-columns', only
 * `import type` from workspace packages, no `drizzle-kit generate`.
 * Column-level documentation: apps/business-ops-os/docs/parts/operations.md.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { ApprovalId, Brand, DepartmentId, TaskId } from '@elevate/shared-types';
import { approvals, departments } from './core';
import {
  ops,
  opsRisks,
  opsSops,
  opsSopVersions,
  opsTasks,
  type OpsRiskId,
  type OpsSopId,
  type OpsSopVersionId,
} from './ops';
import { createdAt, inList, instant, isoDate, staffRef, updatedAt, userRef } from './ops-columns';

export type OpsTaskCommentId = Brand<string, 'OpsTaskCommentId'>;
export type OpsTaskReferenceId = Brand<string, 'OpsTaskReferenceId'>;
export type OpsTaskReviewId = Brand<string, 'OpsTaskReviewId'>;
export type OpsTaskReminderId = Brand<string, 'OpsTaskReminderId'>;
export type OpsSopAckRequirementId = Brand<string, 'OpsSopAckRequirementId'>;
export type OpsSopAcknowledgementId = Brand<string, 'OpsSopAcknowledgementId'>;
export type OpsRiskMitigationId = Brand<string, 'OpsRiskMitigationId'>;

export const OPS_TASK_REFERENCE_KINDS = ['document', 'evidence', 'other'] as const;
export const OPS_TASK_REVIEW_STATUSES = ['pending', 'accepted', 'returned'] as const;
export const OPS_TASK_REMINDER_KINDS = ['due_soon', 'overdue'] as const;
export const OPS_SOP_ACK_AUDIENCES = ['department', 'role'] as const;
export const OPS_MITIGATION_STATUSES = ['planned', 'in_progress', 'done', 'dropped'] as const;

const taskRef = (name: string) =>
  uuid(name)
    .notNull()
    .references(() => opsTasks.id, { onDelete: 'restrict' })
    .$type<TaskId>();
const versionRef = (name: string) =>
  uuid(name)
    .notNull()
    .references(() => opsSopVersions.id, { onDelete: 'restrict' })
    .$type<OpsSopVersionId>();

// --- tasks ---------------------------------------------------------------------------------------

/**
 * Task comments (OPS-060). Append-only: the body is never edited. "Deleting" a
 * comment hides it with a reason (author or operations manager), audited.
 */
export const opsTaskComments = ops.table(
  'task_comments',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsTaskCommentId>(),
    taskId: taskRef('task_id'),
    authorUserId: userRef('author_user_id').notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
    hiddenAt: instant('hidden_at'),
    hiddenBy: userRef('hidden_by'),
    hiddenReason: text('hidden_reason'),
  },
  (t) => [
    index('task_comments_task_idx').on(t.taskId, t.createdAt),
    check('task_comments_body_not_blank', sql`length(btrim(${t.body})) > 0`),
    check(
      'task_comments_hidden_consistency',
      sql`(${t.hiddenAt} IS NULL AND ${t.hiddenBy} IS NULL AND ${t.hiddenReason} IS NULL) OR (${t.hiddenAt} IS NOT NULL AND ${t.hiddenBy} IS NOT NULL AND length(btrim(${t.hiddenReason})) > 0)`,
    ),
  ],
);

/**
 * Document / evidence REFERENCES on a task (OPS-061): a label and where the
 * document lives (a URL or a location such as "Admissions drive › 2026 › forms").
 * Elevate OS stores no files. Removal is a soft remove with a reason.
 */
export const opsTaskReferences = ops.table(
  'task_references',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsTaskReferenceId>(),
    taskId: taskRef('task_id'),
    kind: text('kind').notNull().default('document'),
    label: text('label').notNull(),
    location: text('location').notNull(),
    addedBy: userRef('added_by').notNull(),
    createdAt: createdAt(),
    removedAt: instant('removed_at'),
    removedBy: userRef('removed_by'),
    removedReason: text('removed_reason'),
  },
  (t) => [
    index('task_references_task_idx').on(t.taskId),
    check('task_references_kind_check', sql`${t.kind} IN ${inList(OPS_TASK_REFERENCE_KINDS)}`),
    check(
      'task_references_removed_consistency',
      sql`(${t.removedAt} IS NULL AND ${t.removedBy} IS NULL AND ${t.removedReason} IS NULL) OR (${t.removedAt} IS NOT NULL AND ${t.removedBy} IS NOT NULL AND ${t.removedReason} IS NOT NULL)`,
    ),
  ],
);

/** "This task needs a supervisor review when completed" (OPS-062). One row per task. */
export const opsTaskReviewRequirements = ops.table('task_review_requirements', {
  taskId: uuid('task_id')
    .primaryKey()
    .references(() => opsTasks.id, { onDelete: 'restrict' })
    .$type<TaskId>(),
  /** Named reviewer; null = the accountable owner or an operations manager reviews. */
  reviewerStaffId: staffRef('reviewer_staff_id'),
  note: text('note'),
  requiredBy: userRef('required_by').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Review cycles of a completed task (OPS-062). The task keeps its BR-OPS-10
 * status `completed`; "awaiting review" = a `pending` row. `returned` reopens
 * the task (to In progress). The submitter can never decide the review.
 */
export const opsTaskReviews = ops.table(
  'task_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsTaskReviewId>(),
    taskId: taskRef('task_id'),
    cycle: integer('cycle').notNull(),
    status: text('status').notNull().default('pending'),
    submittedBy: userRef('submitted_by').notNull(),
    submittedAt: instant('submitted_at').notNull().defaultNow(),
    /** Snapshot of the named reviewer at submission (null = accountable owner / ops managers). */
    reviewerStaffId: staffRef('reviewer_staff_id'),
    decidedBy: userRef('decided_by'),
    decidedAt: instant('decided_at'),
    decisionNote: text('decision_note'),
  },
  (t) => [
    uniqueIndex('task_reviews_cycle_key').on(t.taskId, t.cycle),
    uniqueIndex('task_reviews_one_pending')
      .on(t.taskId)
      .where(sql`${t.status} = 'pending'`),
    index('task_reviews_status_idx').on(t.status, t.submittedAt),
    check('task_reviews_status_check', sql`${t.status} IN ${inList(OPS_TASK_REVIEW_STATUSES)}`),
    check('task_reviews_cycle_positive', sql`${t.cycle} >= 1`),
    check(
      'task_reviews_decision_consistency',
      sql`(${t.status} = 'pending' AND ${t.decidedBy} IS NULL AND ${t.decidedAt} IS NULL) OR (${t.status} <> 'pending' AND ${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL)`,
    ),
    check(
      'task_reviews_returned_has_note',
      sql`${t.status} <> 'returned' OR length(btrim(coalesce(${t.decisionNote}, ''))) > 0`,
    ),
    check(
      'task_reviews_no_self_review',
      sql`${t.decidedBy} IS NULL OR ${t.decidedBy} <> ${t.submittedBy}`,
    ),
  ],
);

/** Reminder log (OPS-063): one `due_soon` and one `overdue` reminder per task and due date. */
export const opsTaskReminders = ops.table(
  'task_reminders',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsTaskReminderId>(),
    taskId: taskRef('task_id'),
    kind: text('kind').notNull(),
    /** The due date the reminder was about (a changed due date can be reminded again). */
    dueDate: isoDate('due_date').notNull(),
    recipientCount: integer('recipient_count').notNull(),
    sentAt: instant('sent_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('task_reminders_once_key').on(t.taskId, t.kind, t.dueDate),
    check('task_reminders_kind_check', sql`${t.kind} IN ${inList(OPS_TASK_REMINDER_KINDS)}`),
    check('task_reminders_recipients_check', sql`${t.recipientCount} >= 0`),
  ],
);

// --- SOPs ----------------------------------------------------------------------------------------

/**
 * Effective date and next review date of an APPROVED SOP version (OPS-064).
 * "Published" is derived: approved version in force + effective date reached.
 */
export const opsSopVersionSchedules = ops.table(
  'sop_version_schedules',
  {
    versionId: uuid('version_id')
      .primaryKey()
      .references(() => opsSopVersions.id, { onDelete: 'restrict' })
      .$type<OpsSopVersionId>(),
    effectiveDate: isoDate('effective_date').notNull(),
    nextReviewDate: isoDate('next_review_date'),
    setBy: userRef('set_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'sop_version_schedules_review_after_effective',
      sql`${t.nextReviewDate} IS NULL OR ${t.nextReviewDate} >= ${t.effectiveDate}`,
    ),
  ],
);

/** Archive flag for a RETIRED SOP (OPS-064). Existing SOP rows are never changed. */
export const opsSopArchives = ops.table('sop_archives', {
  sopId: uuid('sop_id')
    .primaryKey()
    .references(() => opsSops.id, { onDelete: 'restrict' })
    .$type<OpsSopId>(),
  reason: text('reason').notNull(),
  archivedBy: userRef('archived_by').notNull(),
  archivedAt: instant('archived_at').notNull().defaultNow(),
});

/** An approved SOP version requires acknowledgement by a department or role audience (OPS-065). */
export const opsSopAckRequirements = ops.table(
  'sop_ack_requirements',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsSopAckRequirementId>(),
    versionId: versionRef('version_id'),
    audienceType: text('audience_type').notNull(),
    departmentId: uuid('department_id')
      .references(() => departments.id, { onDelete: 'restrict' })
      .$type<DepartmentId>(),
    /** A RoleKey (validated by the service). */
    role: text('role'),
    /** Asia/Kolkata date by which the audience should acknowledge (optional). */
    dueDate: isoDate('due_date'),
    note: text('note'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    withdrawnAt: instant('withdrawn_at'),
    withdrawnBy: userRef('withdrawn_by'),
    withdrawnReason: text('withdrawn_reason'),
  },
  (t) => [
    index('sop_ack_requirements_version_idx').on(t.versionId),
    uniqueIndex('sop_ack_requirements_active_department')
      .on(t.versionId, t.departmentId)
      .where(sql`${t.audienceType} = 'department' AND ${t.withdrawnAt} IS NULL`),
    uniqueIndex('sop_ack_requirements_active_role')
      .on(t.versionId, t.role)
      .where(sql`${t.audienceType} = 'role' AND ${t.withdrawnAt} IS NULL`),
    check(
      'sop_ack_requirements_audience_check',
      sql`${t.audienceType} IN ${inList(OPS_SOP_ACK_AUDIENCES)}`,
    ),
    check(
      'sop_ack_requirements_audience_target',
      sql`(${t.audienceType} = 'department' AND ${t.departmentId} IS NOT NULL AND ${t.role} IS NULL) OR (${t.audienceType} = 'role' AND ${t.role} IS NOT NULL AND ${t.departmentId} IS NULL)`,
    ),
    check(
      'sop_ack_requirements_withdrawn_consistency',
      sql`(${t.withdrawnAt} IS NULL AND ${t.withdrawnBy} IS NULL AND ${t.withdrawnReason} IS NULL) OR (${t.withdrawnAt} IS NOT NULL AND ${t.withdrawnBy} IS NOT NULL AND ${t.withdrawnReason} IS NOT NULL)`,
    ),
  ],
);

/** Append-only, version-specific acknowledgements (OPS-065). One per user and version. */
export const opsSopAcknowledgements = ops.table(
  'sop_acknowledgements',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsSopAcknowledgementId>(),
    versionId: versionRef('version_id'),
    userId: userRef('user_id').notNull(),
    staffId: staffRef('staff_id'),
    acknowledgedAt: instant('acknowledged_at').notNull().defaultNow(),
    note: text('note'),
  },
  (t) => [
    uniqueIndex('sop_acknowledgements_once_key').on(t.versionId, t.userId),
    index('sop_acknowledgements_user_idx').on(t.userId),
  ],
);

// --- risks ---------------------------------------------------------------------------------------

/** Mitigation actions of a risk / issue / blocker (OPS-067). */
export const opsRiskMitigations = ops.table(
  'risk_mitigations',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsRiskMitigationId>(),
    riskId: uuid('risk_id')
      .notNull()
      .references(() => opsRisks.id, { onDelete: 'restrict' })
      .$type<OpsRiskId>(),
    action: text('action').notNull(),
    ownerStaffId: staffRef('owner_staff_id'),
    dueDate: isoDate('due_date'),
    status: text('status').notNull().default('planned'),
    outcome: text('outcome'),
    completedAt: instant('completed_at'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('risk_mitigations_risk_idx').on(t.riskId),
    check('risk_mitigations_status_check', sql`${t.status} IN ${inList(OPS_MITIGATION_STATUSES)}`),
    check(
      'risk_mitigations_done_has_date',
      sql`${t.status} <> 'done' OR ${t.completedAt} IS NOT NULL`,
    ),
    check(
      'risk_mitigations_dropped_has_outcome',
      sql`${t.status} <> 'dropped' OR length(btrim(coalesce(${t.outcome}, ''))) > 0`,
    ),
  ],
);

// --- policies and compliance register (OPS-066) ---------------------------------------------------

export type OpsPolicyId = Brand<string, 'OpsPolicyId'>;
export type OpsPolicyVersionId = Brand<string, 'OpsPolicyVersionId'>;

export const OPS_POLICY_AREAS = [
  'attendance',
  'working_hours',
  'shifts',
  'leave',
  'holidays',
  'compensation',
  'recruitment',
  'onboarding_offboarding',
  'employee_records',
  'data_protection',
  'document_retention',
  'admissions_students',
  'fees_refunds',
  'health_safety',
  'other',
] as const;
export const OPS_POLICY_STATUSES = ['draft', 'proposed', 'approved', 'retired'] as const;
export const OPS_POLICY_VERSION_STATUSES = [
  'draft',
  'proposed',
  'approved',
  'rejected',
  'superseded',
] as const;

/**
 * Company policies and compliance obligations recorded BY THE COMPANY (OPS-066).
 * Elevate OS stores what staff enter; nothing is researched or pre-filled and
 * nothing here is legal advice. Text lives in versions; approved text is never
 * overwritten (a change is a new version that needs approval again).
 */
export const opsPolicies = ops.table(
  'policies',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsPolicyId>(),
    code: text('code').notNull(),
    title: text('title').notNull(),
    area: text('area').notNull(),
    summary: text('summary'),
    accountableStaffId: staffRef('accountable_staff_id'),
    /** Open owner decision this depends on, e.g. OD-026. */
    ownerDecisionRef: text('owner_decision_ref'),
    status: text('status').notNull().default('draft'),
    currentVersionId: uuid('current_version_id')
      .references((): AnyPgColumn => opsPolicyVersions.id, { onDelete: 'set null' })
      .$type<OpsPolicyVersionId>(),
    approvedVersionId: uuid('approved_version_id')
      .references((): AnyPgColumn => opsPolicyVersions.id, { onDelete: 'set null' })
      .$type<OpsPolicyVersionId>(),
    retiredAt: instant('retired_at'),
    retiredBy: userRef('retired_by'),
    retiredReason: text('retired_reason'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('policies_code_key').on(t.code),
    index('policies_area_status_idx').on(t.area, t.status),
    check('policies_code_format', sql`${t.code} ~ '^POL-[0-9]{4}$'`),
    check('policies_area_check', sql`${t.area} IN ${inList(OPS_POLICY_AREAS)}`),
    check('policies_status_check', sql`${t.status} IN ${inList(OPS_POLICY_STATUSES)}`),
    check(
      'policies_owner_decision_format',
      sql`${t.ownerDecisionRef} IS NULL OR ${t.ownerDecisionRef} ~ '^OD-[0-9]{3}$'`,
    ),
    check(
      'policies_retired_consistency',
      sql`(${t.status} = 'retired') = (${t.retiredAt} IS NOT NULL AND ${t.retiredBy} IS NOT NULL AND ${t.retiredReason} IS NOT NULL)`,
    ),
    check(
      'policies_approved_has_version',
      sql`${t.status} <> 'approved' OR ${t.approvedVersionId} IS NOT NULL`,
    ),
  ],
);

/** Append-only versions of a policy entry (OPS-066); approval goes through core approvals. */
export const opsPolicyVersions = ops.table(
  'policy_versions',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsPolicyVersionId>(),
    policyId: uuid('policy_id')
      .notNull()
      .references((): AnyPgColumn => opsPolicies.id, { onDelete: 'restrict' })
      .$type<OpsPolicyId>(),
    versionNumber: integer('version_number').notNull(),
    status: text('status').notNull().default('draft'),
    /** The requirement as written by the company (never generated). */
    requirementText: text('requirement_text').notNull().default(''),
    /** Where it comes from, entered by staff (e.g. "company handbook v2"). */
    sourceReference: text('source_reference'),
    /** SETTING_DEFINITIONS keys this policy is implemented by (validated by the service). */
    linkedSettingKeys: text('linked_setting_keys')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    effectiveDate: isoDate('effective_date'),
    nextReviewDate: isoDate('next_review_date'),
    changeNote: text('change_note'),
    approvalId: uuid('approval_id')
      .references(() => approvals.id, { onDelete: 'set null' })
      .$type<ApprovalId>(),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    proposedBy: userRef('proposed_by'),
    proposedAt: instant('proposed_at'),
    decidedBy: userRef('decided_by'),
    decidedAt: instant('decided_at'),
    decisionNote: text('decision_note'),
  },
  (t) => [
    uniqueIndex('policy_versions_number_key').on(t.policyId, t.versionNumber),
    check('policy_versions_number_positive', sql`${t.versionNumber} >= 1`),
    check(
      'policy_versions_status_check',
      sql`${t.status} IN ${inList(OPS_POLICY_VERSION_STATUSES)}`,
    ),
    check(
      'policy_versions_review_after_effective',
      sql`${t.nextReviewDate} IS NULL OR ${t.effectiveDate} IS NULL OR ${t.nextReviewDate} >= ${t.effectiveDate}`,
    ),
    check(
      'policy_versions_proposed_consistency',
      sql`${t.status} = 'draft' OR (${t.proposedBy} IS NOT NULL AND ${t.proposedAt} IS NOT NULL)`,
    ),
    check(
      'policy_versions_decided_consistency',
      sql`${t.status} NOT IN ('approved', 'rejected') OR (${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL)`,
    ),
    check(
      'policy_versions_no_self_approval',
      sql`${t.decidedBy} IS NULL OR ${t.proposedBy} IS NULL OR ${t.decidedBy} <> ${t.proposedBy}`,
    ),
  ],
);
