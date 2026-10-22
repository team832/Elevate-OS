/**
 * OWNER: Business Ops OS team (see docs/BUILD_PLAN.md — file ownership).
 *
 * Tables of the `ops` schema: settings, leads, enquiries, contact activity, duplicate
 * flags, admissions (pipeline), follow-ups, enrolment attempts, contact preferences and
 * staff profiles (D-010). The rest of `ops` is split by concept: demos and their sessions
 * in ./ops-demos.ts, students in ./ops-students.ts, appointments and feedback in
 * ./ops-meetings.ts, the fee ledger, fee plans and the Marketing intake in
 * ./ops-fees-intake.ts. Column helpers: ./ops-columns.ts.
 * HR and Operations tables were removed by the owner on 20 Oct 2026 (D-032).
 * Business Ops also stewards `core.departments` and `core.staff_members`
 * (written from Ops services, defined in ./core.ts).
 *
 * Rules (D-005, D-009):
 * - Every table is `ops.table(...)`; every export is prefixed `ops`.
 * - Primary keys are UUIDs; human codes (LEAD-000001, ADM-000001)
 *   are separate unique columns. Legacy codes always start with `LEGACY-` (DI-21).
 * - Foreign keys only within `ops` or into `core`. Academic refs (course, batch,
 *   student, enrolment) are plain UUIDs validated through the enrolment contract.
 * - Only `import type` from workspace packages.
 * - Names (D-036): `<x>_staff_id` = core.staff_members, `student_id` = core.students,
 *   `<x>_by` / `actor_user_id` = core.users, `<x>_at` = UTC instant, `<x>_date` / `<x>_on` =
 *   Asia/Kolkata calendar day, `<x>_paise` = integer paise (INR). Sample rows: `is_sample`.
 * - Schema changes ship as a reviewed migration (docs/DATABASE_MIGRATION_PLAN.md §4);
 *   tests build the schema with `createTestDb()`.
 * Plain-language column list: apps/business-ops-os/docs/DATA_DICTIONARY.md
 * (`npm run docs:data-dictionary`, generated from these comments).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type {
  AdmissionId,
  BatchId,
  Brand,
  CourseId,
  EnrolmentId,
  IntegrationEventId,
  LeadId,
  ProgrammeId,
  StaffMemberId,
  StudentId,
  UserId,
} from '@elevate/shared-types';
import { integrationEvents, programmes, staffMembers, users } from './core';
import {
  createdAt,
  inList,
  instant,
  isoDate,
  ops,
  staffRef,
  staffRefRestrict,
  studentRef,
  updatedAt,
  userRef,
} from './ops-columns';
// Cycle on purpose (admissions.application_id): used only in a lazy FK callback; see ops-columns.ts.
import { opsApplications, type OpsApplicationId } from './ops-applications';

export { ops };

// --- branded ids for ops-only entities (LeadId, AdmissionId live in shared-types) ---
export type OpsSettingId = Brand<string, 'OpsSettingId'>;
export type OpsLeadSourceId = Brand<string, 'OpsLeadSourceId'>;
export type OpsEnquiryId = Brand<string, 'OpsEnquiryId'>;
export type OpsLeadActivityId = Brand<string, 'OpsLeadActivityId'>;
export type OpsDuplicateFlagId = Brand<string, 'OpsDuplicateFlagId'>;
export type OpsAdmissionTransitionId = Brand<string, 'OpsAdmissionTransitionId'>;
export type OpsFollowUpId = Brand<string, 'OpsFollowUpId'>;
export type OpsEnrolmentAttemptId = Brand<string, 'OpsEnrolmentAttemptId'>;

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
  // Student lifecycle after admission (owner brief 20 Oct 2026 §9); exit records in ./ops-students.ts.
  'withdrawn',
  'completed',
  'transferred',
  'cancelled_before_enrolment',
  'other_inactive',
] as const;
export type OpsAdmissionStatus = (typeof OPS_ADMISSION_STATUSES)[number];
const CLOSED_ADMISSION_STATUSES = [
  'enrolled',
  'lost',
  'withdrawn',
  'completed',
  'transferred',
  'cancelled_before_enrolment',
  'other_inactive',
] as const satisfies readonly OpsAdmissionStatus[];
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
export const OPS_HANDOFF_ATTEMPT_KINDS = ['initial', 'after_rejection', 'after_failure'] as const;
export const OPS_HANDOFF_ATTEMPT_OUTCOMES = [
  'pending',
  'confirmed',
  'rejected',
  'superseded',
] as const;
export const OPS_CONSENT_STATUSES = ['given', 'refused', 'withdrawn'] as const;
export const OPS_CONTACT_CHANNELS = ['call', 'whatsapp', 'sms', 'email'] as const;

/**
 * Policy/configuration values (OPS-022). Every value carries a decision state
 * (PLT-007): a value implementing a `proposed` policy is shown as proposed.
 */
export const opsSettings = ops.table(
  'settings',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsSettingId>(),
    /** Setting name, e.g. `admissions.demo.day_count`. */
    key: text('key').notNull(),
    /** Open-ended config value (validated per key by the domain settings schema). */
    value: jsonb('value').notNull(),
    decisionState: text('decision_state').notNull().default('proposed'),
    /** Where the value came from (brief, decision, legacy file). */
    source: text('source'),
    /** Owner decision it implements, e.g. OD-013. */
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
    /** Name shown on screens, e.g. "Instagram (organic)". */
    label: text('label').notNull(),
    /** `retired` sources stay on old enquiries but cannot be chosen. */
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

/**
 * One person who enquired (usually a student, often through a parent): contact details,
 * programme interest, owner and first contact. Every lead has at least one contact; a
 * duplicate is merged into another lead, never deleted. Restricted contact fields are
 * masked in lists. Each enquiry is a row of `ops.enquiries`; the pipeline is `ops.admissions`.
 */
export const opsLeads = ops.table(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<LeadId>(),
    code: text('code').notNull(),
    /** Student name as given by the family. */
    studentName: text('student_name').notNull(),
    /** Name the student likes to be called. */
    preferredName: text('preferred_name'),
    /** E.164 after normalisation (domain/contacts.ts). */
    studentPhone: text('student_phone'),
    /** Lower-cased and trimmed. */
    studentEmail: text('student_email'),
    /** School stage when the enquiry came in. */
    currentStage: text('current_stage'),
    /** School board, e.g. CBSE or RBSE. */
    schoolBoard: text('school_board'),
    /** Current or last school. */
    previousSchool: text('previous_school'),
    /** Home town or city. */
    city: text('city'),
    /** Parent or guardian name (minors: the main contact). */
    guardianName: text('guardian_name'),
    /** Relationship of that guardian to the student. */
    guardianRelationship: text('guardian_relationship'),
    /** Guardian phone, E.164 (restricted; masked in lists). */
    guardianPhone: text('guardian_phone'),
    /** Guardian email, lower-cased. */
    guardianEmail: text('guardian_email'),
    /** Programme of interest (core.programmes); null = undecided. */
    programmeId: uuid('programme_id')
      .references(() => programmes.id, { onDelete: 'restrict' })
      .$type<ProgrammeId>(),
    /** Every programme the family is interested in (core.programmes codes, catalog order). */
    interestedProgrammeCodes: text('interested_programme_codes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Student date of birth (restricted; decides the guardian signature rule). */
    dateOfBirth: isoDate('date_of_birth'),
    /** Student home address (restricted). */
    address: text('address'),
    /** Emergency contact when it is not the guardian above (restricted). */
    emergencyContactName: text('emergency_contact_name'),
    /** Emergency contact phone, E.164 (restricted; masked in lists). */
    emergencyContactPhone: text('emergency_contact_phone'),
    /** Offline (Sikar centre), online, or not decided yet. */
    interestMode: text('interest_mode').notNull().default('undecided'),
    firstReceivedAt: instant('first_received_at').notNull(),
    /** Counsellor who owns the lead and its follow-ups. */
    ownerStaffId: staffRef('owner_staff_id'),
    /** When the current owner was assigned. */
    ownerAssignedAt: instant('owner_assigned_at'),
    /** Handoff acceptance (OPS-004); reset whenever the owner changes. */
    acceptedAt: instant('accepted_at'),
    /** First successful two-way contact (BR-OPS-4); set once. */
    firstSuccessfulContactAt: instant('first_successful_contact_at'),
    /** Set when this lead was a duplicate and was merged into another (kept for history). */
    mergedIntoLeadId: uuid('merged_into_lead_id')
      .references((): AnyPgColumn => opsLeads.id, { onDelete: 'restrict' })
      .$type<LeadId>(),
    mergedAt: instant('merged_at'),
    notes: text('notes'),
    /** Sample record for development (D-036): shown with a SAMPLE DATA badge, removed by `npm run db:clear-samples`. */
    isSample: boolean('is_sample').notNull().default(false),
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
    index('leads_merged_into_idx')
      .on(t.mergedIntoLeadId)
      .where(sql`${t.mergedIntoLeadId} IS NOT NULL`),
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
      'leads_emergency_phone_e164',
      sql`${t.emergencyContactPhone} IS NULL OR ${t.emergencyContactPhone} ~ '^\\+[1-9][0-9]{7,14}$'`,
    ),
    check('leads_interests_check', sql`cardinality(${t.interestedProgrammeCodes}) <= 6`),
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
    receivedAt: instant('received_at').notNull(),
    /** Primary source (BR-OPS-5), a code from ops.lead_sources. Unknown stays UNKNOWN. */
    sourceCode: text('source_code')
      .notNull()
      .references(() => opsLeadSources.code, { onDelete: 'restrict' }),
    /** Account or channel the enquiry came through, e.g. a specific Instagram account. */
    channel: text('channel'),
    /** How the family says they heard of Elevate. */
    discoverySource: text('discovery_source'),
    /** Marketing campaign reference, when known. */
    campaignRef: text('campaign_ref'),
    /** Post or content reference, when known. */
    contentRef: text('content_ref'),
    /** Programme asked about in this enquiry. */
    programmeId: uuid('programme_id')
      .references(() => programmes.id, { onDelete: 'restrict' })
      .$type<ProgrammeId>(),
    /** Offline, online or undecided, as said in this enquiry. */
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
    /** How contact was attempted. */
    kind: text('kind').notNull(),
    /** What happened. */
    outcome: text('outcome').notNull(),
    occurredAt: instant('occurred_at').notNull(),
    note: text('note'),
    /** Staff member who made the contact. */
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
    /** The other lead that looks like the same person. */
    matchedLeadId: uuid('matched_lead_id')
      .notNull()
      .references(() => opsLeads.id, { onDelete: 'restrict' })
      .$type<LeadId>(),
    /** `exact` = same phone/email; `possible` = similar name/school. */
    level: text('level', { enum: ['exact', 'possible'] }).notNull(),
    /** Which details matched, e.g. student_phone. */
    signals: text('signals').array().notNull(),
    /** Open until someone dismisses it or merges the leads. */
    status: text('status', { enum: ['open', 'dismissed', 'merged'] })
      .notNull()
      .default('open'),
    /** Why the creator went ahead despite the warning. */
    acknowledgement: text('acknowledgement'),
    reviewedBy: userRef('reviewed_by'),
    reviewedAt: instant('reviewed_at'),
    /** Reviewer note when dismissed or merged. */
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
    /** Where the case is in the pipeline (state machine: domain/pipeline.ts). */
    status: text('status').$type<OpsAdmissionStatus>().notNull().default('new'),
    /** Why the current status was set (free text). */
    statusReason: text('status_reason'),
    /** Status before `on_hold`, restored on resume. */
    heldFromStatus: text('held_from_status').$type<OpsAdmissionStatus>(),
    statusChangedAt: instant('status_changed_at').notNull().defaultNow(),
    /** Counsellor responsible for the case. */
    counsellorStaffId: staffRef('counsellor_staff_id'),
    /** How the student will study. */
    deliveryMode: text('delivery_mode', { enum: ['offline', 'online', 'hybrid'] }),
    intendedStartDate: isoDate('intended_start_date'),
    /** Academic-owned refs chosen in counselling (no FK across modules, D-005). */
    intendedCourseId: uuid('intended_course_id').$type<CourseId>(),
    /** Academic OS batch chosen in counselling; null = to be assigned. */
    intendedBatchId: uuid('intended_batch_id').$type<BatchId>(),
    /** True when the family joined without a demo. */
    demoSkipped: boolean('demo_skipped').notNull().default(false),
    admittedAt: instant('admitted_at'),
    /** Number of the latest enrolment request sent to Academic OS (0 = none). */
    enrolmentAttempt: integer('enrolment_attempt').notNull().default(0),
    /** State of the enrolment request to Academic OS. */
    handoffStatus: text('handoff_status').notNull().default('not_requested'),
    /** Latest `ops.admission.enrolment_requested` outbox event. */
    lastRequestEventId: uuid('last_request_event_id')
      .references(() => integrationEvents.id, { onDelete: 'set null' })
      .$type<IntegrationEventId>(),
    /** When the latest enrolment request was sent. */
    enrolmentRequestedAt: instant('enrolment_requested_at'),
    /** Academic OS enrolment id from its confirmation. */
    enrolmentId: uuid('enrolment_id').$type<EnrolmentId>(),
    /** Academic OS student record id from the enrolment reply (plain UUID, no FK across modules). */
    academicStudentId: uuid('academic_student_id').$type<StudentId>(),
    /** When Academic OS confirmed the enrolment. */
    enrolledAt: instant('enrolled_at'),
    rejectionCode: text('rejection_code'),
    rejectionReason: text('rejection_reason'),
    rejectedAt: instant('rejected_at'),
    /** Coded reason of the current status (closure codes, setting `admissions.closure_reasons`). */
    statusReasonCode: text('status_reason_code'),
    /** Asia/Kolkata calendar day the admission first reached `admitted`. */
    admissionDate: isoDate('admission_date'),
    /** From academic.enrolment.confirmed: Academic reused an existing student record. */
    academicExistingStudent: boolean('academic_existing_student'),
    /** Course/batch Academic actually enrolled into (may differ from the intended ones). */
    enrolledCourseId: uuid('enrolled_course_id').$type<CourseId>(),
    enrolledBatchId: uuid('enrolled_batch_id').$type<BatchId>(),
    /**
     * Admission number (counter `ops.admission_number_counters`, format setting
     * `admissions.number.format`, approved D-037). Given at final confirmation (D-040) and
     * then immutable (composite FK from `ops.admission_approvals`); earlier changes are logged in
     * `ops.admission_number_changes`. Null before confirmation and on extra programme
     * admissions of the same conversion (the student's number is on the primary one).
     */
    admissionNumber: text('admission_number'),
    /** Canonical student (core.students), linked at conversion or on admission. */
    studentId: studentRef(),
    /** Review date of an `on_hold` student (IST calendar day). */
    holdReviewDate: isoDate('hold_review_date'),
    /**
     * `required` = admitted before final confirmation existed (no approval, signed form or
     * payment evidence on record): shown "Legacy — verification required" until an approver
     * reconciles it (`verified`). Null = a normal case.
     */
    legacyVerification: text('legacy_verification').$type<'required' | 'verified'>(),
    legacyVerifiedBy: userRef('legacy_verified_by'),
    legacyVerifiedAt: instant('legacy_verified_at'),
    /** Application that covers this case (multi-programme bundles: every case of the bundle). */
    applicationId: uuid('application_id')
      .references((): AnyPgColumn => opsApplications.id, { onDelete: 'restrict' })
      .$type<OpsApplicationId>(),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('admissions_code_key').on(t.code),
    uniqueIndex('admissions_admission_number_key').on(t.admissionNumber),
    index('admissions_student_idx').on(t.studentId),
    index('admissions_application_idx').on(t.applicationId),
    check(
      'admissions_number_format',
      sql`${t.admissionNumber} IS NULL OR ${t.admissionNumber} ~ '^[A-Za-z0-9][A-Za-z0-9/-]{0,39}$'`,
    ),
    uniqueIndex('admissions_one_open_per_programme')
      .on(t.leadId, t.programmeId)
      .where(sql`${t.status} NOT IN ${inList(CLOSED_ADMISSION_STATUSES)}`),
    // A NULL programme is not caught by the index above (NULLs are distinct).
    uniqueIndex('admissions_one_open_without_programme')
      .on(t.leadId)
      .where(
        sql`${t.programmeId} IS NULL AND ${t.status} NOT IN ${inList(CLOSED_ADMISSION_STATUSES)}`,
      ),
    // Target of the composite FK from ops.admission_approvals: a confirmed number cannot change (D-040).
    unique('admissions_id_number_key').on(t.id, t.admissionNumber),
    index('admissions_status_idx').on(t.status, t.statusChangedAt),
    index('admissions_lead_idx').on(t.leadId),
    index('admissions_counsellor_idx').on(t.counsellorStaffId),
    check('admissions_code_format', sql`${t.code} ~ '^ADM-[0-9]{6}$'`),
    check('admissions_status_check', sql`${t.status} IN ${inList(OPS_ADMISSION_STATUSES)}`),
    check(
      'admissions_held_from_check',
      sql`(${t.status} = 'on_hold') = (${t.heldFromStatus} IS NOT NULL)`,
    ),
    check(
      'admissions_held_from_status_check',
      sql`${t.heldFromStatus} IS NULL OR ${t.heldFromStatus} IN ${inList(OPS_ADMISSION_STATUSES)}`,
    ),
    check(
      'admissions_delivery_mode_check',
      sql`${t.deliveryMode} IS NULL OR ${t.deliveryMode} IN ('offline', 'online', 'hybrid')`,
    ),
    check('admissions_handoff_check', sql`${t.handoffStatus} IN ${inList(OPS_HANDOFF_STATUSES)}`),
    check('admissions_attempt_check', sql`${t.enrolmentAttempt} >= 0`),
    check(
      'admissions_reason_code_format',
      sql`${t.statusReasonCode} IS NULL OR ${t.statusReasonCode} ~ '^[a-z][a-z0-9_]{1,39}$'`,
    ),
    check(
      'admissions_legacy_check',
      sql`${t.legacyVerification} IS NULL OR ${t.legacyVerification} IN ('required', 'verified')`,
    ),
    check(
      'admissions_legacy_verified_check',
      sql`(${t.legacyVerification} IS NOT DISTINCT FROM 'verified') = (${t.legacyVerifiedBy} IS NOT NULL AND ${t.legacyVerifiedAt} IS NOT NULL)`,
    ),
    check(
      'admissions_enrolled_has_ids',
      sql`${t.status} <> 'enrolled' OR (${t.enrolmentId} IS NOT NULL AND ${t.academicStudentId} IS NOT NULL)`,
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
    /** Status before (null for the first row). */
    fromStatus: text('from_status').$type<OpsAdmissionStatus>(),
    /** Status after. */
    toStatus: text('to_status').$type<OpsAdmissionStatus>().notNull(),
    /** Why (free text). */
    reason: text('reason'),
    /** Coded reason (closure), e.g. `chose_competitor`; null = not coded. */
    reasonCode: text('reason_code'),
    /** `user` (a person) or `system` (an event reply or rule). */
    actorType: text('actor_type', { enum: ['user', 'system'] }).notNull(),
    actorUserId: userRef('actor_user_id'),
    /** Integration event that caused (reply) or was caused by (request) this transition. */
    eventId: uuid('event_id')
      .references(() => integrationEvents.id, { onDelete: 'set null' })
      .$type<IntegrationEventId>(),
    at: instant('at').notNull().defaultNow(),
  },
  (t) => [
    index('admission_transitions_admission_idx').on(t.admissionId, t.at),
    index('admission_transitions_to_idx').on(t.toStatus, t.at),
    check(
      'admission_transitions_to_check',
      sql`${t.toStatus} IN ${inList(OPS_ADMISSION_STATUSES)}`,
    ),
    check(
      'admission_transitions_from_check',
      sql`${t.fromStatus} IS NULL OR ${t.fromStatus} IN ${inList(OPS_ADMISSION_STATUSES)}`,
    ),
    check('admission_transitions_actor_check', sql`${t.actorType} IN ('user', 'system')`),
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
    /** Confirmation step, e.g. documents_verified. */
    itemKey: text('item_key').notNull(),
    /** Done, not done, or not applicable. */
    status: text('status', { enum: ['done', 'not_done', 'not_applicable'] }).notNull(),
    /** Reference only (e.g. "receipt ref in accounts system"); no file, no amount (OD-013/OD-014). */
    reference: text('reference'),
    recordedBy: userRef('recorded_by').notNull(),
    recordedAt: instant('recorded_at').notNull().defaultNow(),
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
    /** Why the follow-up exists. */
    kind: text('kind').notNull(),
    /** What to do, in a few words. */
    title: text('title').notNull(),
    /** Asia/Kolkata calendar date. */
    dueDate: isoDate('due_date').notNull(),
    /** Staff member who must do it. */
    ownerStaffId: staffRefRestrict('owner_staff_id').notNull(),
    /** Open, done or cancelled. */
    status: text('status', { enum: ['open', 'done', 'cancelled'] })
      .notNull()
      .default('open'),
    /** What happened (required when done). */
    outcome: text('outcome'),
    completedAt: instant('completed_at'),
    completedBy: userRef('completed_by'),
    /** IST date of the last reminder sent (one reminder per follow-up per day). */
    lastReminderOn: isoDate('last_reminder_on'),
    /** `manual` = typed by staff; `rule` = created by a follow-up rule. */
    source: text('source', { enum: ['manual', 'rule'] })
      .notNull()
      .default('manual'),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('follow_ups_status_due_idx').on(t.status, t.dueDate),
    index('follow_ups_owner_idx').on(t.ownerStaffId, t.status),
    index('follow_ups_lead_idx').on(t.leadId),
    index('follow_ups_admission_idx').on(t.admissionId, t.status),
    check('follow_ups_kind_check', sql`${t.kind} IN ${inList(OPS_FOLLOW_UP_KINDS)}`),
    check('follow_ups_status_check', sql`${t.status} IN ('open', 'done', 'cancelled')`),
    check('follow_ups_done_has_time', sql`${t.status} <> 'done' OR ${t.completedAt} IS NOT NULL`),
    check('follow_ups_done_has_outcome', sql`${t.status} <> 'done' OR ${t.outcome} IS NOT NULL`),
    check('follow_ups_source_check', sql`${t.source} IN ('manual', 'rule')`),
  ],
);

// --- admissions administration (OPS-070…) ----------------------------------------------------

/**
 * Every enrolment-handoff attempt of an admission (OPS-075, IR-OPS-03): one row
 * per published `ops.admission.enrolment_requested` event, so the attempt
 * history and each outcome stay visible. The business identity (admission id)
 * is the same for every attempt; a new attempt is only allowed once the
 * previous one can no longer create an enrolment (rejected, or its Academic
 * delivery is `dead` — rolled back).
 */
export const opsEnrolmentAttempts = ops.table(
  'enrolment_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsEnrolmentAttemptId>(),
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => opsAdmissions.id, { onDelete: 'restrict' })
      .$type<AdmissionId>(),
    /** Attempt number 1, 2, … for this admission. */
    attempt: integer('attempt').notNull(),
    /** The enrolment request event sent for this attempt. */
    requestEventId: uuid('request_event_id')
      .notNull()
      .references(() => integrationEvents.id, { onDelete: 'restrict' })
      .$type<IntegrationEventId>(),
    /** First attempt, after a rejection, or after a failed delivery. */
    kind: text('kind').notNull(),
    /** Why a new attempt was made (required after a failure). */
    reason: text('reason'),
    requestedBy: userRef('requested_by').notNull(),
    requestedAt: instant('requested_at').notNull().defaultNow(),
    /** Pending until Academic OS replies. */
    outcome: text('outcome').notNull().default('pending'),
    outcomeAt: instant('outcome_at'),
    /** Academic OS reply event. */
    replyEventId: uuid('reply_event_id')
      .references(() => integrationEvents.id, { onDelete: 'set null' })
      .$type<IntegrationEventId>(),
    rejectionCode: text('rejection_code'),
    rejectionReason: text('rejection_reason'),
    /** E.g. "late confirmation for a superseded attempt — check Academic for a duplicate". */
    note: text('note'),
  },
  (t) => [
    uniqueIndex('enrolment_attempts_admission_attempt_key').on(t.admissionId, t.attempt),
    uniqueIndex('enrolment_attempts_request_event_key').on(t.requestEventId),
    check('enrolment_attempts_attempt_check', sql`${t.attempt} >= 1`),
    check('enrolment_attempts_kind_check', sql`${t.kind} IN ${inList(OPS_HANDOFF_ATTEMPT_KINDS)}`),
    check(
      'enrolment_attempts_outcome_check',
      sql`${t.outcome} IN ${inList(OPS_HANDOFF_ATTEMPT_OUTCOMES)}`,
    ),
    check(
      'enrolment_attempts_failure_reason',
      sql`${t.kind} <> 'after_failure' OR ${t.reason} IS NOT NULL`,
    ),
  ],
);

/**
 * Contact consent and communication preferences of a student/family (OPS-077).
 * Private (ops:student_private:read): never shown in the unrestricted student
 * directory, never sent to Marketing. Absent row = not recorded (never "given").
 */
export const opsContactPreferences = ops.table(
  'contact_preferences',
  {
    leadId: uuid('lead_id')
      .primaryKey()
      .references(() => opsLeads.id, { onDelete: 'restrict' })
      .$type<LeadId>(),
    /** Consent to be contacted. */
    consentStatus: text('consent_status').notNull(),
    /** Who gave or refused consent (minors: the guardian). */
    consentBy: text('consent_by', { enum: ['student', 'guardian', 'both'] }).notNull(),
    /** Channels the family allows. */
    allowedChannels: text('allowed_channels').array().notNull(),
    /** Contact the student or the guardian first. */
    preferredContact: text('preferred_contact', { enum: ['student', 'guardian'] }),
    note: text('note'),
    recordedBy: userRef('recorded_by').notNull(),
    recordedAt: instant('recorded_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'contact_preferences_status_check',
      sql`${t.consentStatus} IN ${inList(OPS_CONSENT_STATUSES)}`,
    ),
    check('contact_preferences_by_check', sql`${t.consentBy} IN ('student', 'guardian', 'both')`),
    check(
      'contact_preferences_preferred_check',
      sql`${t.preferredContact} IS NULL OR ${t.preferredContact} IN ('student', 'guardian')`,
    ),
    check(
      'contact_preferences_channels_check',
      sql`${t.allowedChannels} <@ ${sql.raw(`ARRAY[${OPS_CONTACT_CHANNELS.map((c) => `'${c}'`).join(', ')}]::text[]`)}`,
    ),
    check(
      'contact_preferences_refused_no_channels',
      sql`${t.consentStatus} = 'given' OR cardinality(${t.allowedChannels}) = 0`,
    ),
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
    /** Employment type; `not_recorded` until known. */
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
    /** Internal notes (never shown on public-facing text). */
    notes: text('notes'),
    /** Name shown in the UI; null = use core full_name. */
    displayName: text('display_name'),
    /** Internal staff code, e.g. an HR number (unique when set). */
    staffCode: text('staff_code'),
    /** Identity (name) verification of an owner-supplied record. */
    verificationStatus: text('verification_status', { enum: ['unverified', 'confirmed'] })
      .notNull()
      .default('unverified'),
    /** Organisational role, kept apart from teaching (e.g. "CEO / director of coaching"). */
    roleNote: text('role_note'),
    /** Where the record came from (e.g. "owner-supplied 2026-10-20"). */
    sourceNote: text('source_note'),
    /** Sample staff member for development (D-036); removed by `npm run db:clear-samples`. */
    isSample: boolean('is_sample').notNull().default(false),
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
    check(
      'staff_profiles_verification_check',
      sql`${t.verificationStatus} IN ('unverified', 'confirmed')`,
    ),
    uniqueIndex('staff_profiles_staff_code_key')
      .on(t.staffCode)
      .where(sql`${t.staffCode} IS NOT NULL`),
  ],
);
