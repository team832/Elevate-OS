/**
 * OWNER: Business Ops OS team (see docs/BUILD_PLAN.md — file ownership).
 *
 * Tables of the `ops` schema: leads, enquiries, contact activity, duplicate
 * flags, admissions (pipeline), follow-ups, counselling, demos, tasks,
 * escalations, responsibilities, onboarding checklists, SOPs, incidents,
 * decisions, risks, projects, milestones, work inventory and settings
 * (D-010). Business Ops also stewards `core.departments` and
 * `core.staff_members` (written from Ops services, defined in ./core.ts).
 *
 * Rules (D-005, D-009):
 * - Every table is `ops.table(...)`; every export is prefixed `ops`.
 * - Primary keys are UUIDs; human codes (LEAD-000001, SOP-0001, LEGACY-OPSWB-D-003)
 *   are separate unique columns. Legacy codes always start with `LEGACY-` (DI-21).
 * - Foreign keys only within `ops` or into `core`. Academic refs (course, batch,
 *   student, enrolment) are plain UUIDs validated through the enrolment contract.
 * - Only `import type` from workspace packages.
 * - Do not run `drizzle-kit generate`; tests build the schema with `createTestDb()`.
 * Column-level documentation: apps/business-ops-os/docs/DOMAIN_MODEL.md.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type {
  AdmissionId,
  ApprovalId,
  BatchId,
  Brand,
  CourseId,
  DepartmentId,
  EnrolmentId,
  IntegrationEventId,
  LeadId,
  ProgrammeId,
  StaffMemberId,
  StudentId,
  TaskId,
  UserId,
} from '@elevate/shared-types';
import { approvals, departments, integrationEvents, programmes, staffMembers, users } from './core';

export const ops = pgSchema('ops');

// --- branded ids for ops-only entities (LeadId, AdmissionId, TaskId live in shared-types) ---
export type OpsSettingId = Brand<string, 'OpsSettingId'>;
export type OpsLeadSourceId = Brand<string, 'OpsLeadSourceId'>;
export type OpsEnquiryId = Brand<string, 'OpsEnquiryId'>;
export type OpsLeadActivityId = Brand<string, 'OpsLeadActivityId'>;
export type OpsDuplicateFlagId = Brand<string, 'OpsDuplicateFlagId'>;
export type OpsAdmissionTransitionId = Brand<string, 'OpsAdmissionTransitionId'>;
export type OpsFollowUpId = Brand<string, 'OpsFollowUpId'>;
export type OpsCounsellingSessionId = Brand<string, 'OpsCounsellingSessionId'>;
export type OpsDemoId = Brand<string, 'OpsDemoId'>;
export type OpsEscalationId = Brand<string, 'OpsEscalationId'>;
export type OpsResponsibilityId = Brand<string, 'OpsResponsibilityId'>;
export type OpsOnboardingItemId = Brand<string, 'OpsOnboardingItemId'>;
export type OpsSopId = Brand<string, 'OpsSopId'>;
export type OpsSopVersionId = Brand<string, 'OpsSopVersionId'>;
export type OpsSopChecklistItemId = Brand<string, 'OpsSopChecklistItemId'>;
export type OpsIncidentId = Brand<string, 'OpsIncidentId'>;
export type OpsDecisionId = Brand<string, 'OpsDecisionId'>;
export type OpsRiskId = Brand<string, 'OpsRiskId'>;
export type OpsProjectId = Brand<string, 'OpsProjectId'>;
export type OpsMilestoneId = Brand<string, 'OpsMilestoneId'>;
export type OpsWorkItemId = Brand<string, 'OpsWorkItemId'>;

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const isoDate = (name: string) => date(name, { mode: 'string' });
const staffRef = (name: string) =>
  uuid(name)
    .references(() => staffMembers.id, { onDelete: 'set null' })
    .$type<StaffMemberId>();
const userRef = (name: string) =>
  uuid(name)
    .references(() => users.id, { onDelete: 'restrict' })
    .$type<UserId>();

/** `IN (...)` list for CHECK constraints built from a readonly tuple. */
function inList(values: readonly string[]) {
  return sql.raw(`(${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ')})`);
}

// --- status vocabularies (mirrored by the pure domain in apps/business-ops-os/src/domain) ---
export const OPS_DECISION_STATES = [
  'proposed',
  'approved',
  'locked',
  'open',
  'pending_verification',
  'superseded',
] as const;
export const OPS_ADMISSION_STATUSES = [
  'new',
  'contacted',
  'counselling_scheduled',
  'counselled',
  'demo_scheduled',
  'demo_attended',
  'admission_pending',
  'admitted',
  'enrolment_requested',
  'enrolled',
  'lost',
  'on_hold',
] as const;
export const OPS_HANDOFF_STATUSES = ['not_requested', 'pending', 'enrolled', 'rejected'] as const;
export const OPS_INTEREST_MODES = ['offline', 'online', 'undecided'] as const;
export const OPS_STUDENT_STAGES = [
  'class_9',
  'class_10',
  'class_11',
  'class_12',
  'gap_year',
  'graduate',
  'other',
] as const;
export const OPS_GUARDIAN_RELATIONSHIPS = ['mother', 'father', 'guardian', 'other'] as const;
export const OPS_ACTIVITY_KINDS = ['call', 'whatsapp', 'sms', 'email', 'visit', 'note'] as const;
export const OPS_ACTIVITY_OUTCOMES = [
  'connected_two_way',
  'replied',
  'visited',
  'no_answer',
  'busy',
  'wrong_number',
  'message_sent',
  'other',
] as const;
export const OPS_ADMISSION_CHECK_ITEMS = [
  'admission_form',
  'documents_verified',
  'fee_verification_1',
  'fee_verification_2',
  'down_payment_verified',
  'kit_issued',
  'communication_group_added',
  'timetable_communicated',
  'school_coordination',
  'hostel_coordination',
] as const;
export const OPS_FOLLOW_UP_KINDS = [
  'first_contact',
  'counselling_followup',
  'demo_followup',
  'general',
] as const;
export const OPS_TASK_STATUSES = [
  'not_started',
  'in_progress',
  'waiting',
  'at_risk',
  'blocked',
  'completed',
  'cancelled',
] as const;
export const OPS_TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export const OPS_SOP_STATUSES = [
  'not_drafted',
  'draft',
  'in_review',
  'approved',
  'retired',
] as const;
export const OPS_SOP_VERSION_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'rejected',
  'superseded',
] as const;
export const OPS_DECISION_LOG_STATES = [
  'open',
  'proposed',
  'confirmed',
  'provisional',
  'superseded',
] as const;
export const OPS_LEVELS = ['low', 'medium', 'high'] as const;

// --- configuration -----------------------------------------------------------------------

/**
 * Policy/configuration values (OPS-022). Every value carries a decision state
 * (PLT-007): a value implementing a `proposed` policy is shown as proposed.
 */
export const opsSettings = ops.table(
  'settings',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsSettingId>(),
    key: text('key').notNull(),
    /** Open-ended config value (validated per key by the domain settings schema). */
    value: jsonb('value').notNull(),
    decisionState: text('decision_state').notNull().default('proposed'),
    source: text('source'),
    ownerDecision: text('owner_decision'),
    note: text('note'),
    updatedBy: uuid('updated_by')
      .references(() => users.id, { onDelete: 'set null' })
      .$type<UserId>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('settings_key_key').on(t.key),
    check(
      'settings_decision_state_check',
      sql`${t.decisionState} IN ${inList(OPS_DECISION_STATES)}`,
    ),
  ],
);

/** Configurable lead-source list (OPS-002). */
export const opsLeadSources = ops.table(
  'lead_sources',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsLeadSourceId>(),
    /** Unique constraint (not just an index) because ops.enquiries.source_code references it. */
    code: text('code').notNull().unique('lead_sources_code_key'),
    label: text('label').notNull(),
    status: text('status', { enum: ['active', 'retired'] })
      .notNull()
      .default('active'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    check('lead_sources_code_format', sql`${t.code} ~ '^[A-Z][A-Z0-9_]{1,39}$'`),
    check('lead_sources_status_check', sql`${t.status} IN ('active', 'retired')`),
  ],
);

// --- leads and enquiries -------------------------------------------------------------------

export const opsLeads = ops.table(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<LeadId>(),
    code: text('code').notNull(),
    studentName: text('student_name').notNull(),
    preferredName: text('preferred_name'),
    /** E.164 after normalisation (domain/contacts.ts). */
    studentPhone: text('student_phone'),
    /** Lower-cased and trimmed. */
    studentEmail: text('student_email'),
    currentStage: text('current_stage'),
    schoolBoard: text('school_board'),
    previousSchool: text('previous_school'),
    city: text('city'),
    guardianName: text('guardian_name'),
    guardianRelationship: text('guardian_relationship'),
    guardianPhone: text('guardian_phone'),
    guardianEmail: text('guardian_email'),
    /** Programme of interest (core.programmes); null = undecided. */
    programmeId: uuid('programme_id')
      .references(() => programmes.id, { onDelete: 'restrict' })
      .$type<ProgrammeId>(),
    interestMode: text('interest_mode').notNull().default('undecided'),
    firstReceivedAt: timestamp('first_received_at', { withTimezone: true }).notNull(),
    ownerStaffId: staffRef('owner_staff_id'),
    ownerAssignedAt: timestamp('owner_assigned_at', { withTimezone: true }),
    /** Handoff acceptance (OPS-004); reset whenever the owner changes. */
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    /** First successful two-way contact (BR-OPS-4); set once. */
    firstSuccessfulContactAt: timestamp('first_successful_contact_at', { withTimezone: true }),
    mergedIntoLeadId: uuid('merged_into_lead_id')
      .references((): AnyPgColumn => opsLeads.id, { onDelete: 'restrict' })
      .$type<LeadId>(),
    mergedAt: timestamp('merged_at', { withTimezone: true }),
    notes: text('notes'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('leads_code_key').on(t.code),
    index('leads_owner_idx').on(t.ownerStaffId),
    index('leads_student_phone_idx').on(t.studentPhone),
    index('leads_student_email_idx').on(t.studentEmail),
    index('leads_guardian_phone_idx').on(t.guardianPhone),
    index('leads_guardian_email_idx').on(t.guardianEmail),
    index('leads_received_idx').on(t.firstReceivedAt),
    check('leads_code_format', sql`${t.code} ~ '^LEAD-[0-9]{6}$'`),
    check(
      'leads_has_contact',
      sql`${t.studentPhone} IS NOT NULL OR ${t.studentEmail} IS NOT NULL OR ${t.guardianPhone} IS NOT NULL OR ${t.guardianEmail} IS NOT NULL`,
    ),
    check(
      'leads_phone_e164',
      sql`(${t.studentPhone} IS NULL OR ${t.studentPhone} ~ '^\\+[1-9][0-9]{7,14}$') AND (${t.guardianPhone} IS NULL OR ${t.guardianPhone} ~ '^\\+[1-9][0-9]{7,14}$')`,
    ),
    check(
      'leads_email_lowercase',
      sql`(${t.studentEmail} IS NULL OR ${t.studentEmail} = lower(${t.studentEmail})) AND (${t.guardianEmail} IS NULL OR ${t.guardianEmail} = lower(${t.guardianEmail}))`,
    ),
    check('leads_interest_mode_check', sql`${t.interestMode} IN ${inList(OPS_INTEREST_MODES)}`),
    check(
      'leads_stage_check',
      sql`${t.currentStage} IS NULL OR ${t.currentStage} IN ${inList(OPS_STUDENT_STAGES)}`,
    ),
    check(
      'leads_relationship_check',
      sql`${t.guardianRelationship} IS NULL OR ${t.guardianRelationship} IN ${inList(OPS_GUARDIAN_RELATIONSHIPS)}`,
    ),
    check(
      'leads_not_merged_into_self',
      sql`${t.mergedIntoLeadId} IS NULL OR ${t.mergedIntoLeadId} <> ${t.id}`,
    ),
  ],
);

/** Each enquiry a person made (one lead can enquire several times, from several sources). */
export const opsEnquiries = ops.table(
  'enquiries',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsEnquiryId>(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => opsLeads.id, { onDelete: 'restrict' })
      .$type<LeadId>(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    /** Primary source (BR-OPS-5), a code from ops.lead_sources. Unknown stays UNKNOWN. */
    sourceCode: text('source_code')
      .notNull()
      .references(() => opsLeadSources.code, { onDelete: 'restrict' }),
    channel: text('channel'),
    discoverySource: text('discovery_source'),
    campaignRef: text('campaign_ref'),
    contentRef: text('content_ref'),
    programmeId: uuid('programme_id')
      .references(() => programmes.id, { onDelete: 'restrict' })
      .$type<ProgrammeId>(),
    interestMode: text('interest_mode').notNull().default('undecided'),
    notes: text('notes'),
    /** Lead this enquiry originally belonged to, when it was moved by a merge. */
    mergedFromLeadId: uuid('merged_from_lead_id').$type<LeadId>(),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('enquiries_lead_idx').on(t.leadId),
    index('enquiries_received_idx').on(t.receivedAt),
    check('enquiries_interest_mode_check', sql`${t.interestMode} IN ${inList(OPS_INTEREST_MODES)}`),
  ],
);

/** Contact attempts and notes (OPS-006). */
export const opsLeadActivities = ops.table(
  'lead_activities',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsLeadActivityId>(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => opsLeads.id, { onDelete: 'restrict' })
      .$type<LeadId>(),
    kind: text('kind').notNull(),
    outcome: text('outcome').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    note: text('note'),
    staffId: staffRef('staff_id'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('lead_activities_lead_idx').on(t.leadId, t.occurredAt),
    check('lead_activities_kind_check', sql`${t.kind} IN ${inList(OPS_ACTIVITY_KINDS)}`),
    check('lead_activities_outcome_check', sql`${t.outcome} IN ${inList(OPS_ACTIVITY_OUTCOMES)}`),
  ],
);

/** Duplicate-contact warnings raised at creation (OPS-003). Never merged automatically. */
export const opsDuplicateFlags = ops.table(
  'duplicate_flags',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsDuplicateFlagId>(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => opsLeads.id, { onDelete: 'restrict' })
      .$type<LeadId>(),
    matchedLeadId: uuid('matched_lead_id')
      .notNull()
      .references(() => opsLeads.id, { onDelete: 'restrict' })
      .$type<LeadId>(),
    level: text('level', { enum: ['exact', 'possible'] }).notNull(),
    signals: text('signals').array().notNull(),
    status: text('status', { enum: ['open', 'dismissed', 'merged'] })
      .notNull()
      .default('open'),
    /** Why the creator went ahead despite the warning. */
    acknowledgement: text('acknowledgement'),
    reviewedBy: uuid('reviewed_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('duplicate_flags_pair_key').on(t.leadId, t.matchedLeadId),
    index('duplicate_flags_status_idx').on(t.status),
    check('duplicate_flags_not_self', sql`${t.leadId} <> ${t.matchedLeadId}`),
    check('duplicate_flags_level_check', sql`${t.level} IN ('exact', 'possible')`),
    check('duplicate_flags_status_check', sql`${t.status} IN ('open', 'dismissed', 'merged')`),
  ],
);

// --- admissions pipeline ---------------------------------------------------------------------

/**
 * One admission case per lead and programme: the pipeline record whose status
 * walks new → … → enrolled (state machine: domain/pipeline.ts). The enrolment
 * handoff fields mirror the outbox conversation with Academic OS.
 */
export const opsAdmissions = ops.table(
  'admissions',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AdmissionId>(),
    code: text('code').notNull(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => opsLeads.id, { onDelete: 'restrict' })
      .$type<LeadId>(),
    programmeId: uuid('programme_id')
      .references(() => programmes.id, { onDelete: 'restrict' })
      .$type<ProgrammeId>(),
    status: text('status').notNull().default('new'),
    statusReason: text('status_reason'),
    /** Status before `on_hold`, restored on resume. */
    heldFromStatus: text('held_from_status'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull().defaultNow(),
    counsellorStaffId: staffRef('counsellor_staff_id'),
    deliveryMode: text('delivery_mode', { enum: ['offline', 'online', 'hybrid'] }),
    intendedStartDate: isoDate('intended_start_date'),
    /** Academic-owned refs chosen in counselling (no FK across modules, D-005). */
    intendedCourseId: uuid('intended_course_id').$type<CourseId>(),
    intendedBatchId: uuid('intended_batch_id').$type<BatchId>(),
    demoSkipped: boolean('demo_skipped').notNull().default(false),
    admittedAt: timestamp('admitted_at', { withTimezone: true }),
    enrolmentAttempt: integer('enrolment_attempt').notNull().default(0),
    handoffStatus: text('handoff_status').notNull().default('not_requested'),
    lastRequestEventId: uuid('last_request_event_id')
      .references(() => integrationEvents.id, { onDelete: 'set null' })
      .$type<IntegrationEventId>(),
    enrolmentRequestedAt: timestamp('enrolment_requested_at', { withTimezone: true }),
    enrolmentId: uuid('enrolment_id').$type<EnrolmentId>(),
    studentId: uuid('student_id').$type<StudentId>(),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }),
    rejectionCode: text('rejection_code'),
    rejectionReason: text('rejection_reason'),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('admissions_code_key').on(t.code),
    uniqueIndex('admissions_one_open_per_programme')
      .on(t.leadId, t.programmeId)
      .where(sql`${t.status} NOT IN ('enrolled', 'lost')`),
    index('admissions_status_idx').on(t.status, t.statusChangedAt),
    index('admissions_lead_idx').on(t.leadId),
    index('admissions_counsellor_idx').on(t.counsellorStaffId),
    check('admissions_code_format', sql`${t.code} ~ '^ADM-[0-9]{6}$'`),
    check('admissions_status_check', sql`${t.status} IN ${inList(OPS_ADMISSION_STATUSES)}`),
    check(
      'admissions_held_from_check',
      sql`(${t.status} = 'on_hold') = (${t.heldFromStatus} IS NOT NULL)`,
    ),
    check('admissions_handoff_check', sql`${t.handoffStatus} IN ${inList(OPS_HANDOFF_STATUSES)}`),
    check('admissions_attempt_check', sql`${t.enrolmentAttempt} >= 0`),
    check(
      'admissions_enrolled_has_ids',
      sql`${t.status} <> 'enrolled' OR (${t.enrolmentId} IS NOT NULL AND ${t.studentId} IS NOT NULL)`,
    ),
  ],
);

/** Every status change (first-attainment times come from here). */
export const opsAdmissionTransitions = ops.table(
  'admission_transitions',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsAdmissionTransitionId>(),
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => opsAdmissions.id, { onDelete: 'restrict' })
      .$type<AdmissionId>(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    reason: text('reason'),
    actorType: text('actor_type', { enum: ['user', 'system'] }).notNull(),
    actorUserId: uuid('actor_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    /** Integration event that caused (reply) or was caused by (request) this transition. */
    eventId: uuid('event_id')
      .references(() => integrationEvents.id, { onDelete: 'set null' })
      .$type<IntegrationEventId>(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('admission_transitions_admission_idx').on(t.admissionId, t.at),
    index('admission_transitions_to_idx').on(t.toStatus, t.at),
    check(
      'admission_transitions_to_check',
      sql`${t.toStatus} IN ${inList(OPS_ADMISSION_STATUSES)}`,
    ),
    check(
      'admission_transitions_user_has_id',
      sql`${t.actorType} <> 'user' OR ${t.actorUserId} IS NOT NULL`,
    ),
  ],
);

/** Admission checklist (OPS-010/011): status and references only, never documents or amounts. */
export const opsAdmissionChecks = ops.table(
  'admission_checks',
  {
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => opsAdmissions.id, { onDelete: 'restrict' })
      .$type<AdmissionId>(),
    itemKey: text('item_key').notNull(),
    status: text('status', { enum: ['done', 'not_done', 'not_applicable'] }).notNull(),
    /** Reference only (e.g. "receipt ref in accounts system"); no file, no amount (OD-013/OD-014). */
    reference: text('reference'),
    recordedBy: userRef('recorded_by').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'admission_checks_pkey', columns: [t.admissionId, t.itemKey] }),
    check('admission_checks_item_check', sql`${t.itemKey} IN ${inList(OPS_ADMISSION_CHECK_ITEMS)}`),
    check(
      'admission_checks_status_check',
      sql`${t.status} IN ('done', 'not_done', 'not_applicable')`,
    ),
  ],
);

/** Follow-ups (OPS-007, BR-OPS-9: every follow-up has an owner and a due date). */
export const opsFollowUps = ops.table(
  'follow_ups',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsFollowUpId>(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => opsLeads.id, { onDelete: 'restrict' })
      .$type<LeadId>(),
    admissionId: uuid('admission_id')
      .references(() => opsAdmissions.id, { onDelete: 'restrict' })
      .$type<AdmissionId>(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    /** Asia/Kolkata calendar date. */
    dueDate: isoDate('due_date').notNull(),
    ownerStaffId: uuid('owner_staff_id')
      .notNull()
      .references(() => staffMembers.id, { onDelete: 'restrict' })
      .$type<StaffMemberId>(),
    status: text('status', { enum: ['open', 'done', 'cancelled'] })
      .notNull()
      .default('open'),
    outcome: text('outcome'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: uuid('completed_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    /** IST date of the last reminder sent (one reminder per follow-up per day). */
    lastReminderOn: isoDate('last_reminder_on'),
    source: text('source', { enum: ['manual', 'rule'] })
      .notNull()
      .default('manual'),
    createdBy: uuid('created_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('follow_ups_status_due_idx').on(t.status, t.dueDate),
    index('follow_ups_owner_idx').on(t.ownerStaffId, t.status),
    index('follow_ups_lead_idx').on(t.leadId),
    check('follow_ups_kind_check', sql`${t.kind} IN ${inList(OPS_FOLLOW_UP_KINDS)}`),
    check('follow_ups_status_check', sql`${t.status} IN ('open', 'done', 'cancelled')`),
    check('follow_ups_done_has_time', sql`${t.status} <> 'done' OR ${t.completedAt} IS NOT NULL`),
  ],
);

/** Counselling appointments (OPS-008). */
export const opsCounsellingSessions = ops.table(
  'counselling_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsCounsellingSessionId>(),
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => opsAdmissions.id, { onDelete: 'restrict' })
      .$type<AdmissionId>(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => opsLeads.id, { onDelete: 'restrict' })
      .$type<LeadId>(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    counsellorStaffId: uuid('counsellor_staff_id')
      .notNull()
      .references(() => staffMembers.id, { onDelete: 'restrict' })
      .$type<StaffMemberId>(),
    mode: text('mode', { enum: ['in_person', 'phone', 'video'] }).notNull(),
    attendees: text('attendees', { enum: ['student', 'parent', 'both'] }),
    status: text('status', { enum: ['scheduled', 'completed', 'no_show', 'cancelled'] })
      .notNull()
      .default('scheduled'),
    recommendedProgrammeId: uuid('recommended_programme_id')
      .references(() => programmes.id, { onDelete: 'restrict' })
      .$type<ProgrammeId>(),
    objections: text('objections'),
    outcome: text('outcome'),
    nextStep: text('next_step'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('counselling_sessions_scheduled_idx').on(t.scheduledAt),
    index('counselling_sessions_admission_idx').on(t.admissionId),
    check(
      'counselling_sessions_status_check',
      sql`${t.status} IN ('scheduled', 'completed', 'no_show', 'cancelled')`,
    ),
    check('counselling_sessions_mode_check', sql`${t.mode} IN ('in_person', 'phone', 'video')`),
  ],
);

/**
 * Demo classes (OPS-009, BR-OPS-2). Always separate demo sessions, never a
 * main-batch session. Fee amount and terms are copied from the demo-terms
 * setting at booking, together with that setting's decision state.
 */
export const opsDemos = ops.table(
  'demos',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsDemoId>(),
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => opsAdmissions.id, { onDelete: 'restrict' })
      .$type<AdmissionId>(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => opsLeads.id, { onDelete: 'restrict' })
      .$type<LeadId>(),
    subjects: text('subjects').array().notNull(),
    /** Demo days (Asia/Kolkata dates); how many comes from the demo-terms setting. */
    dayDates: date('day_dates', { mode: 'string' }).array().notNull(),
    status: text('status', { enum: ['scheduled', 'attended', 'missed', 'cancelled'] })
      .notNull()
      .default('scheduled'),
    feeStatus: text('fee_status', {
      enum: ['not_paid', 'paid_verified', 'adjusted_against_fees', 'retained_non_refundable'],
    })
      .notNull()
      .default('not_paid'),
    feeAmountInr: numeric('fee_amount_inr', { precision: 12, scale: 2 }),
    /** Decision state of the demo-terms fee when booked (e.g. `approved`, recorded from legacy D-003). */
    feeTermsState: text('fee_terms_state').notNull(),
    feeReference: text('fee_reference'),
    notes: text('notes'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('demos_admission_idx').on(t.admissionId),
    check(
      'demos_status_check',
      sql`${t.status} IN ('scheduled', 'attended', 'missed', 'cancelled')`,
    ),
    check(
      'demos_fee_status_check',
      sql`${t.feeStatus} IN ('not_paid', 'paid_verified', 'adjusted_against_fees', 'retained_non_refundable')`,
    ),
    check('demos_has_subjects', sql`cardinality(${t.subjects}) >= 1`),
    check('demos_has_days', sql`cardinality(${t.dayDates}) >= 1`),
  ],
);

/** Teachers booked for a demo (and when they were notified). */
export const opsDemoTeachers = ops.table(
  'demo_teachers',
  {
    demoId: uuid('demo_id')
      .notNull()
      .references(() => opsDemos.id, { onDelete: 'cascade' })
      .$type<OpsDemoId>(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffMembers.id, { onDelete: 'restrict' })
      .$type<StaffMemberId>(),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ name: 'demo_teachers_pkey', columns: [t.demoId, t.staffId] })],
);

// --- tasks and escalation ---------------------------------------------------------------------

/** Tasks (OPS-016) with owner, accountable owner and backup; status standard BR-OPS-10. */
export const opsTasks = ops.table(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<TaskId>(),
    code: text('code').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    departmentId: uuid('department_id')
      .references(() => departments.id, { onDelete: 'set null' })
      .$type<DepartmentId>(),
    /** Responsible owner (does the work). Null → flagged `missing_owner`. */
    ownerStaffId: staffRef('owner_staff_id'),
    /** One accountable owner (BR-OPS-12). */
    accountableStaffId: staffRef('accountable_staff_id'),
    backupStaffId: staffRef('backup_staff_id'),
    /** Asia/Kolkata calendar date. Null → flagged `missing_due`. */
    dueDate: isoDate('due_date'),
    priority: text('priority').notNull().default('medium'),
    status: text('status').notNull().default('not_started'),
    statusReason: text('status_reason'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull().defaultNow(),
    /** When the task last entered `blocked` (for the blocked-for-N-days escalation rule). */
    blockedSince: timestamp('blocked_since', { withTimezone: true }),
    /** Highest escalation level raised so far (1 = owner, BR-OPS-10). */
    escalationLevel: integer('escalation_level').notNull().default(1),
    completionNote: text('completion_note'),
    evidenceLink: text('evidence_link'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: uuid('completed_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    /** Reason given when completing despite open blockers (audited). */
    blockerOverrideReason: text('blocker_override_reason'),
    leadId: uuid('lead_id')
      .references(() => opsLeads.id, { onDelete: 'set null' })
      .$type<LeadId>(),
    admissionId: uuid('admission_id')
      .references(() => opsAdmissions.id, { onDelete: 'set null' })
      .$type<AdmissionId>(),
    sopId: uuid('sop_id')
      .references((): AnyPgColumn => opsSops.id, { onDelete: 'set null' })
      .$type<OpsSopId>(),
    decisionId: uuid('decision_id')
      .references((): AnyPgColumn => opsDecisions.id, { onDelete: 'set null' })
      .$type<OpsDecisionId>(),
    projectId: uuid('project_id')
      .references((): AnyPgColumn => opsProjects.id, { onDelete: 'set null' })
      .$type<OpsProjectId>(),
    source: text('source', { enum: ['manual', 'rule', 'legacy_import'] })
      .notNull()
      .default('manual'),
    createdBy: uuid('created_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('tasks_code_key').on(t.code),
    index('tasks_status_due_idx').on(t.status, t.dueDate),
    index('tasks_owner_idx').on(t.ownerStaffId),
    index('tasks_accountable_idx').on(t.accountableStaffId),
    index('tasks_project_idx').on(t.projectId),
    check('tasks_code_format', sql`${t.code} ~ '^(TSK-[0-9]{5}|LEGACY-[A-Z0-9-]+)$'`),
    check('tasks_status_check', sql`${t.status} IN ${inList(OPS_TASK_STATUSES)}`),
    check('tasks_priority_check', sql`${t.priority} IN ${inList(OPS_TASK_PRIORITIES)}`),
    check('tasks_escalation_level_check', sql`${t.escalationLevel} BETWEEN 1 AND 4`),
    check(
      'tasks_completed_needs_evidence',
      sql`${t.status} <> 'completed' OR (${t.completedAt} IS NOT NULL AND (${t.completionNote} IS NOT NULL OR ${t.evidenceLink} IS NOT NULL))`,
    ),
  ],
);

/** "task is blocked by blockedByTask" edges; cycles are rejected by domain/graph.ts. */
export const opsTaskDependencies = ops.table(
  'task_dependencies',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => opsTasks.id, { onDelete: 'cascade' })
      .$type<TaskId>(),
    blockedByTaskId: uuid('blocked_by_task_id')
      .notNull()
      .references(() => opsTasks.id, { onDelete: 'cascade' })
      .$type<TaskId>(),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'task_dependencies_pkey', columns: [t.taskId, t.blockedByTaskId] }),
    index('task_dependencies_blocked_by_idx').on(t.blockedByTaskId),
    check('task_dependencies_not_self', sql`${t.taskId} <> ${t.blockedByTaskId}`),
  ],
);

/** Escalations L2–L4 (OPS-017). The task owner keeps ownership. One record per task and level. */
export const opsEscalations = ops.table(
  'escalations',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsEscalationId>(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => opsTasks.id, { onDelete: 'restrict' })
      .$type<TaskId>(),
    level: integer('level').notNull(),
    trigger: text('trigger', { enum: ['overdue', 'blocked', 'manual'] }).notNull(),
    reason: text('reason').notNull(),
    daysOverdue: integer('days_overdue'),
    /** Threshold (days) that fired, copied from the escalation setting. */
    thresholdDays: integer('threshold_days'),
    /** From the owner's reporting line; null = no manager on record (routed to operations managers). */
    recipientStaffId: staffRef('recipient_staff_id'),
    status: text('status', { enum: ['open', 'acknowledged', 'resolved'] })
      .notNull()
      .default('open'),
    respondBy: isoDate('respond_by'),
    raisedAt: timestamp('raised_at', { withTimezone: true }).notNull().defaultNow(),
    raisedBy: uuid('raised_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedBy: uuid('acknowledged_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    resolutionNote: text('resolution_note'),
  },
  (t) => [
    uniqueIndex('escalations_task_level_key').on(t.taskId, t.level),
    index('escalations_status_idx').on(t.status, t.raisedAt),
    index('escalations_recipient_idx').on(t.recipientStaffId),
    check('escalations_level_check', sql`${t.level} BETWEEN 2 AND 4`),
    check('escalations_status_check', sql`${t.status} IN ('open', 'acknowledged', 'resolved')`),
    check('escalations_trigger_check', sql`${t.trigger} IN ('overdue', 'blocked', 'manual')`),
  ],
);

// --- organisation (Ops-owned extensions of core.staff_members) -----------------------------------

/** Operational profile of a staff member. No payroll, biometrics, leave or HR records (D-015, OD-026). */
export const opsStaffProfiles = ops.table(
  'staff_profiles',
  {
    staffId: uuid('staff_id')
      .primaryKey()
      .references(() => staffMembers.id, { onDelete: 'cascade' })
      .$type<StaffMemberId>(),
    employmentType: text('employment_type', {
      enum: ['full_time', 'part_time', 'contract', 'visiting', 'not_recorded'],
    })
      .notNull()
      .default('not_recorded'),
    /** Role labels held (legacy vocabulary, e.g. "Admissions Coordinator"); roles ≠ hires. */
    roleLabels: text('role_labels')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notes: text('notes'),
    updatedBy: uuid('updated_by')
      .references(() => users.id, { onDelete: 'set null' })
      .$type<UserId>(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'staff_profiles_employment_check',
      sql`${t.employmentType} IN ('full_time', 'part_time', 'contract', 'visiting', 'not_recorded')`,
    ),
  ],
);

/** Responsibilities with accountable role, holder and backup (OPS-015, OD-009). */
export const opsResponsibilities = ops.table(
  'responsibilities',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsResponsibilityId>(),
    code: text('code').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    departmentId: uuid('department_id')
      .references(() => departments.id, { onDelete: 'set null' })
      .$type<DepartmentId>(),
    accountableRole: text('accountable_role'),
    /** Named holder (accountable owner). Null until OD-009 names people. */
    holderStaffId: staffRef('holder_staff_id'),
    backupStaffId: staffRef('backup_staff_id'),
    handOverToRole: text('hand_over_to_role'),
    critical: boolean('critical').notNull().default(false),
    status: text('status', { enum: ['active', 'retired'] })
      .notNull()
      .default('active'),
    source: text('source'),
    legacyRef: text('legacy_ref'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('responsibilities_code_key').on(t.code),
    index('responsibilities_holder_idx').on(t.holderStaffId),
    check('responsibilities_status_check', sql`${t.status} IN ('active', 'retired')`),
  ],
);

/** Staff onboarding checklist items — document REFERENCES only, never files or HR records. */
export const opsOnboardingItems = ops.table(
  'onboarding_items',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsOnboardingItemId>(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffMembers.id, { onDelete: 'cascade' })
      .$type<StaffMemberId>(),
    seq: integer('seq').notNull(),
    title: text('title').notNull(),
    documentRef: text('document_ref'),
    status: text('status', { enum: ['pending', 'done', 'not_applicable'] })
      .notNull()
      .default('pending'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: uuid('completed_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('onboarding_items_staff_title_key').on(t.staffId, t.title),
    check(
      'onboarding_items_status_check',
      sql`${t.status} IN ('pending', 'done', 'not_applicable')`,
    ),
  ],
);

// --- SOPs ----------------------------------------------------------------------------------------

/** SOP register (OPS-019). Legacy register rows keep their namespaced code and source status. */
export const opsSops = ops.table(
  'sops',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsSopId>(),
    code: text('code').notNull(),
    title: text('title').notNull(),
    process: text('process'),
    departmentId: uuid('department_id')
      .references(() => departments.id, { onDelete: 'set null' })
      .$type<DepartmentId>(),
    ownerStaffId: staffRef('owner_staff_id'),
    reviewerStaffId: staffRef('reviewer_staff_id'),
    backupStaffId: staffRef('backup_staff_id'),
    /** Owner role label from the legacy register (roles, not names). */
    ownerRole: text('owner_role'),
    riskLevel: text('risk_level'),
    priority: text('priority'),
    status: text('status').notNull().default('draft'),
    currentVersionId: uuid('current_version_id')
      .references((): AnyPgColumn => opsSopVersions.id, { onDelete: 'set null' })
      .$type<OpsSopVersionId>(),
    approvedVersionId: uuid('approved_version_id')
      .references((): AnyPgColumn => opsSopVersions.id, { onDelete: 'set null' })
      .$type<OpsSopVersionId>(),
    nextReviewDate: isoDate('next_review_date'),
    legacySource: text('legacy_source'),
    legacyStatus: text('legacy_status'),
    legacyRef: text('legacy_ref'),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    retiredReason: text('retired_reason'),
    createdBy: uuid('created_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('sops_code_key').on(t.code),
    index('sops_status_idx').on(t.status),
    check('sops_code_format', sql`${t.code} ~ '^(SOP-[0-9]{4}|LEGACY-[A-Z0-9-]+)$'`),
    check('sops_status_check', sql`${t.status} IN ${inList(OPS_SOP_STATUSES)}`),
    check(
      'sops_risk_check',
      sql`${t.riskLevel} IS NULL OR ${t.riskLevel} IN ${inList(OPS_LEVELS)}`,
    ),
    check(
      'sops_legacy_code_has_source',
      sql`${t.code} NOT LIKE 'LEGACY-%' OR ${t.legacySource} IS NOT NULL`,
    ),
  ],
);

/** Immutable-once-submitted SOP versions; a new version never erases the previous one. */
export const opsSopVersions = ops.table(
  'sop_versions',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsSopVersionId>(),
    sopId: uuid('sop_id')
      .notNull()
      .references((): AnyPgColumn => opsSops.id, { onDelete: 'restrict' })
      .$type<OpsSopId>(),
    versionNumber: integer('version_number').notNull(),
    versionLabel: text('version_label').notNull(),
    status: text('status').notNull().default('draft'),
    content: text('content').notNull().default(''),
    changeNote: text('change_note'),
    documentRef: text('document_ref'),
    /** sha256 of the content at submission; the approval binds to it (PLT-006). */
    contentHash: text('content_hash'),
    approvalId: uuid('approval_id')
      .references(() => approvals.id, { onDelete: 'set null' })
      .$type<ApprovalId>(),
    reviewedBy: uuid('reviewed_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewOutcome: text('review_outcome', { enum: ['recommend_approval', 'changes_requested'] }),
    reviewNote: text('review_note'),
    approvedBy: uuid('approved_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    /** Source date for imported versions (e.g. 2026-09-18 for the coordinator SOP draft). */
    sourceDate: isoDate('source_date'),
    createdBy: uuid('created_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sop_versions_number_key').on(t.sopId, t.versionNumber),
    check('sop_versions_status_check', sql`${t.status} IN ${inList(OPS_SOP_VERSION_STATUSES)}`),
    check('sop_versions_number_positive', sql`${t.versionNumber} >= 1`),
    check(
      'sop_versions_approved_consistency',
      sql`${t.status} <> 'approved' OR (${t.approvedBy} IS NOT NULL AND ${t.approvedAt} IS NOT NULL)`,
    ),
  ],
);

/** Checklist steps of an SOP version (e.g. the coordinator SOP's daily checklist). */
export const opsSopChecklistItems = ops.table(
  'sop_checklist_items',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsSopChecklistItemId>(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => opsSopVersions.id, { onDelete: 'cascade' })
      .$type<OpsSopVersionId>(),
    seq: integer('seq').notNull(),
    section: text('section').notNull(),
    text: text('text').notNull(),
  },
  (t) => [uniqueIndex('sop_checklist_items_seq_key').on(t.versionId, t.seq)],
);

/** Operational exceptions and incidents (BR-OPS-15: exception approval limits pending OD-013). */
export const opsIncidents = ops.table(
  'incidents',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsIncidentId>(),
    code: text('code').notNull(),
    kind: text('kind', { enum: ['exception', 'incident'] }).notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    severity: text('severity').notNull().default('medium'),
    status: text('status', { enum: ['open', 'in_progress', 'resolved', 'closed'] })
      .notNull()
      .default('open'),
    ownerStaffId: staffRef('owner_staff_id'),
    departmentId: uuid('department_id')
      .references(() => departments.id, { onDelete: 'set null' })
      .$type<DepartmentId>(),
    sopId: uuid('sop_id')
      .references(() => opsSops.id, { onDelete: 'set null' })
      .$type<OpsSopId>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    /** Exceptions such as refunds or waivers need authorised approval; the limits are OD-013. */
    needsAuthorisedApproval: boolean('needs_authorised_approval').notNull().default(false),
    resolution: text('resolution'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('incidents_code_key').on(t.code),
    index('incidents_status_idx').on(t.status, t.occurredAt),
    check('incidents_code_format', sql`${t.code} ~ '^INC-[0-9]{5}$'`),
    check('incidents_kind_check', sql`${t.kind} IN ('exception', 'incident')`),
    check('incidents_severity_check', sql`${t.severity} IN ${inList(OPS_LEVELS)}`),
    check(
      'incidents_status_check',
      sql`${t.status} IN ('open', 'in_progress', 'resolved', 'closed')`,
    ),
    check(
      'incidents_resolved_has_resolution',
      sql`${t.status} NOT IN ('resolved', 'closed') OR ${t.resolution} IS NOT NULL`,
    ),
  ],
);

// --- business planning -------------------------------------------------------------------------

/** Decision log (OPS-021). Legacy decisions keep namespaced codes and their original status. */
export const opsDecisions = ops.table(
  'decisions',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsDecisionId>(),
    code: text('code').notNull(),
    area: text('area').notNull(),
    statement: text('statement').notNull(),
    state: text('state').notNull().default('proposed'),
    decidedByStaffId: staffRef('decided_by_staff_id'),
    decidedOn: isoDate('decided_on'),
    source: text('source'),
    /** Open owner decision this depends on, e.g. OD-012. */
    ownerDecisionRef: text('owner_decision_ref'),
    supersededById: uuid('superseded_by_id')
      .references((): AnyPgColumn => opsDecisions.id, { onDelete: 'set null' })
      .$type<OpsDecisionId>(),
    legacyStatus: text('legacy_status'),
    legacyRef: text('legacy_ref'),
    createdBy: uuid('created_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('decisions_code_key').on(t.code),
    index('decisions_state_idx').on(t.state),
    check('decisions_code_format', sql`${t.code} ~ '^(DEC-[0-9]{4}|LEGACY-[A-Z0-9-]+)$'`),
    check('decisions_state_check', sql`${t.state} IN ${inList(OPS_DECISION_LOG_STATES)}`),
    check(
      'decisions_superseded_link',
      sql`${t.state} <> 'superseded' OR ${t.supersededById} IS NOT NULL`,
    ),
    check('decisions_not_self', sql`${t.supersededById} IS NULL OR ${t.supersededById} <> ${t.id}`),
  ],
);

/** Risks, issues and blockers (OPS-023). */
export const opsRisks = ops.table(
  'risks',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsRiskId>(),
    code: text('code').notNull(),
    kind: text('kind', { enum: ['risk', 'issue', 'blocker'] }).notNull(),
    title: text('title').notNull(),
    description: text('description'),
    likelihood: text('likelihood'),
    impact: text('impact'),
    ownerStaffId: staffRef('owner_staff_id'),
    mitigation: text('mitigation'),
    reviewDate: isoDate('review_date'),
    targetDate: isoDate('target_date'),
    status: text('status', { enum: ['open', 'mitigating', 'resolved', 'closed', 'accepted'] })
      .notNull()
      .default('open'),
    taskId: uuid('task_id')
      .references(() => opsTasks.id, { onDelete: 'set null' })
      .$type<TaskId>(),
    projectId: uuid('project_id')
      .references((): AnyPgColumn => opsProjects.id, { onDelete: 'set null' })
      .$type<OpsProjectId>(),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('risks_code_key').on(t.code),
    index('risks_status_idx').on(t.status),
    check('risks_code_format', sql`${t.code} ~ '^RSK-[0-9]{4}$'`),
    check('risks_kind_check', sql`${t.kind} IN ('risk', 'issue', 'blocker')`),
    check(
      'risks_status_check',
      sql`${t.status} IN ('open', 'mitigating', 'resolved', 'closed', 'accepted')`,
    ),
    check(
      'risks_likelihood_check',
      sql`${t.likelihood} IS NULL OR ${t.likelihood} IN ${inList(OPS_LEVELS)}`,
    ),
    check('risks_impact_check', sql`${t.impact} IS NULL OR ${t.impact} IN ${inList(OPS_LEVELS)}`),
  ],
);

/** Projects (OPS-025). */
export const opsProjects = ops.table(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsProjectId>(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    workstream: text('workstream'),
    description: text('description'),
    ownerStaffId: staffRef('owner_staff_id'),
    startDate: isoDate('start_date'),
    endDate: isoDate('end_date'),
    status: text('status', { enum: ['planned', 'active', 'on_hold', 'completed', 'cancelled'] })
      .notNull()
      .default('planned'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('projects_code_key').on(t.code),
    check('projects_code_format', sql`${t.code} ~ '^PRJ-[0-9]{4}$'`),
    check(
      'projects_status_check',
      sql`${t.status} IN ('planned', 'active', 'on_hold', 'completed', 'cancelled')`,
    ),
    check(
      'projects_dates_order',
      sql`${t.startDate} IS NULL OR ${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`,
    ),
  ],
);

export const opsMilestones = ops.table(
  'milestones',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsMilestoneId>(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => opsProjects.id, { onDelete: 'restrict' })
      .$type<OpsProjectId>(),
    title: text('title').notNull(),
    dueDate: isoDate('due_date'),
    ownerStaffId: staffRef('owner_staff_id'),
    status: text('status', { enum: ['planned', 'done', 'missed', 'cancelled'] })
      .notNull()
      .default('planned'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('milestones_project_idx').on(t.projectId),
    check(
      'milestones_status_check',
      sql`${t.status} IN ('planned', 'done', 'missed', 'cancelled')`,
    ),
  ],
);

/** "milestone depends on dependsOnMilestone" edges; cycles rejected (domain/graph.ts). */
export const opsMilestoneDependencies = ops.table(
  'milestone_dependencies',
  {
    milestoneId: uuid('milestone_id')
      .notNull()
      .references(() => opsMilestones.id, { onDelete: 'cascade' })
      .$type<OpsMilestoneId>(),
    dependsOnMilestoneId: uuid('depends_on_milestone_id')
      .notNull()
      .references(() => opsMilestones.id, { onDelete: 'cascade' })
      .$type<OpsMilestoneId>(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({
      name: 'milestone_dependencies_pkey',
      columns: [t.milestoneId, t.dependsOnMilestoneId],
    }),
    check('milestone_dependencies_not_self', sql`${t.milestoneId} <> ${t.dependsOnMilestoneId}`),
  ],
);

/** Work inventory (legacy `Work Inventory` sheet as processes), imported with its decision status. */
export const opsWorkItems = ops.table(
  'work_items',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsWorkItemId>(),
    code: text('code').notNull(),
    function: text('function').notNull(),
    process: text('process').notNull(),
    scope: text('scope'),
    proposedRole: text('proposed_role'),
    /** Controlled vocabulary (approved, documented, planned, proposed, open). */
    status: text('status').notNull(),
    /** Verbatim legacy word (Confirmed, Discussed, Planned, Proposed, Open). */
    legacyStatus: text('legacy_status'),
    legacyRef: text('legacy_ref'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('work_items_code_key').on(t.code),
    check(
      'work_items_status_check',
      sql`${t.status} IN ('approved', 'documented', 'planned', 'proposed', 'open')`,
    ),
  ],
);
