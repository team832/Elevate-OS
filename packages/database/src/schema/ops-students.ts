/**
 * OWNER: Business Ops OS — admissions slice "conversion, admission numbers, lifecycle, guardians, reports" (owner brief 20 Oct 2026).
 * Part of the `ops` Postgres schema, split across ops*.ts (D-029). Same rules as ops.ts:
 * `ops.table(...)`, exports prefixed `ops`, UUID PKs, FKs only within ops or into core,
 * only `import type` from workspace packages; naming conventions in ops.ts (D-036).
 *
 * Rules (apps/business-ops-os/docs/parts/admissions-students.md):
 * - admission numbers come from a counter row locked FOR UPDATE inside the conversion;
 * - number changes, exit records and report exports are append-only (never deleted);
 * - guardians and KYC documents are restricted (`ops:student_private:read`): contact data never
 *   goes to core; identity documents keep a masked reference only (no number, no scan);
 * - KYC edit history is the audit trail (`core.audit_events` before/after), not a second table.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { AdmissionId, BatchId, Brand, LeadId } from '@elevate/shared-types';
import { ops, opsAdmissions, opsLeads, OPS_GUARDIAN_RELATIONSHIPS } from './ops';
import { createdAt, inList, instant, isoDate, studentRef, updatedAt, userRef } from './ops-columns';

export type OpsAdmissionNumberChangeId = Brand<string, 'OpsAdmissionNumberChangeId'>;
export type OpsExitRecordId = Brand<string, 'OpsExitRecordId'>;
export type OpsGuardianId = Brand<string, 'OpsGuardianId'>;
export type OpsReportExportId = Brand<string, 'OpsReportExportId'>;
export type OpsKycDocumentId = Brand<string, 'OpsKycDocumentId'>;

export const OPS_EXIT_STATUSES = [
  'withdrawn',
  'completed',
  'transferred',
  'cancelled_before_enrolment',
  'other_inactive',
] as const;
export const OPS_GUARDIAN_CONSENT = ['given', 'refused', 'withdrawn', 'not_recorded'] as const;
export const OPS_GUARDIAN_PREFERRED_CONTACT = ['call', 'whatsapp', 'sms', 'email'] as const;
export const OPS_EXIT_MATERIAL_STATUSES = [
  'not_recorded',
  'returned',
  'partly_returned',
  'not_returned',
  'not_applicable',
] as const;
export const OPS_KYC_SUBJECTS = ['student', 'guardian'] as const;
export const OPS_KYC_VERIFICATION = ['unverified', 'verified', 'rejected'] as const;
export const OPS_REPORT_AUDIENCES = ['internal', 'guardian', 'student', 'admin_dossier'] as const;
export const OPS_REPORT_STATUSES = ['draft', 'reviewed', 'final'] as const;

const admissionRef = () =>
  uuid('admission_id')
    .notNull()
    .references(() => opsAdmissions.id, { onDelete: 'restrict' })
    .$type<AdmissionId>();

/** One counter per scope key (`all`, or `Y2026` when the format includes the year). */
export const opsAdmissionNumberCounters = ops.table(
  'admission_number_counters',
  {
    /** `all`, or `Y2026` when the number format includes the year. */
    scopeKey: text('scope_key').primaryKey(),
    /** Next number to hand out in this scope. */
    nextValue: integer('next_value').notNull().default(1),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('admission_number_counters_next_check', sql`${t.nextValue} >= 1`),
    check('admission_number_counters_scope_format', sql`${t.scopeKey} ~ '^(all|Y[0-9]{4})$'`),
  ],
);

/** Append-only log of every admission number given or changed. */
export const opsAdmissionNumberChanges = ops.table(
  'admission_number_changes',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsAdmissionNumberChangeId>(),
    admissionId: admissionRef(),
    /** Number before (null when first assigned). */
    previousNumber: text('previous_number'),
    /** Number after. */
    newNumber: text('new_number').notNull(),
    /** `auto` (from the counter) or `manual` (override, reason required). */
    kind: text('kind').notNull(),
    /** Why (at least 10 characters for a manual change). */
    reason: text('reason'),
    actorUserId: userRef('actor_user_id').notNull(),
    at: instant('at').notNull().defaultNow(),
  },
  (t) => [
    index('admission_number_changes_admission_idx').on(t.admissionId, t.at),
    check('admission_number_changes_kind_check', sql`${t.kind} IN ('auto', 'manual')`),
    check(
      'admission_number_changes_manual_reason',
      sql`${t.kind} = 'auto' OR length(trim(coalesce(${t.reason}, ''))) >= 10`,
    ),
  ],
);

/** An exit (withdrawn, completed, transferred …): one row per exit, kept after reactivation. */
export const opsExitRecords = ops.table(
  'exit_records',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsExitRecordId>(),
    admissionId: admissionRef(),
    /** How the student left. */
    exitStatus: text('exit_status').notNull(),
    /** Last day (IST). */
    exitDate: isoDate('exit_date').notNull(),
    /** Why the student left. */
    reason: text('reason').notNull(),
    /** Student feedback at exit. */
    exitFeedback: text('exit_feedback'),
    /** Guardian feedback at exit. */
    guardianFeedback: text('guardian_feedback'),
    /** Coded reason category (setting `admissions.closure_reasons`); null = not coded. */
    reasonCode: text('reason_code'),
    /** Academic OS batch the student was in (plain id, no FK across modules). */
    priorBatchId: uuid('prior_batch_id').$type<BatchId>(),
    /** Pending fee or refund reference (text; fee records live with the fees slice). */
    feeReference: text('fee_reference'),
    /** Fee balance at exit in paise from the ledger: > 0 owed, < 0 credit; null = not computed. */
    balancePaise: bigint('balance_paise', { mode: 'number' }),
    /** Whether books/materials came back. */
    materialStatus: text('material_status')
      .$type<(typeof OPS_EXIT_MATERIAL_STATUSES)[number]>()
      .notNull()
      .default('not_recorded'),
    closingNotes: text('closing_notes'),
    /** Whether the student may be reactivated later. */
    reactivationAllowed: boolean('reactivation_allowed').notNull().default(false),
    recordedBy: userRef('recorded_by').notNull(),
    recordedAt: instant('recorded_at').notNull().defaultNow(),
    /** Set once when the student is reactivated (the approver who reactivated). */
    reactivatedBy: userRef('reactivated_by'),
    reactivatedAt: instant('reactivated_at'),
  },
  (t) => [
    index('exit_records_admission_idx').on(t.admissionId, t.recordedAt),
    check('exit_records_status_check', sql`${t.exitStatus} IN ${inList(OPS_EXIT_STATUSES)}`),
    check('exit_records_reason_check', sql`length(trim(${t.reason})) > 0`),
    check(
      'exit_records_reason_code_format',
      sql`${t.reasonCode} IS NULL OR ${t.reasonCode} ~ '^[a-z][a-z0-9_]{1,39}$'`,
    ),
    check(
      'exit_records_material_check',
      sql`${t.materialStatus} IN ${inList(OPS_EXIT_MATERIAL_STATUSES)}`,
    ),
    check(
      'exit_records_reactivated_pair',
      sql`(${t.reactivatedBy} IS NULL) = (${t.reactivatedAt} IS NULL)`,
    ),
    check(
      'exit_records_reactivation_allowed',
      sql`${t.reactivatedAt} IS NULL OR ${t.reactivationAllowed}`,
    ),
  ],
);

/** Guardians of a student (several allowed). Restricted: students are mostly minors. */
export const opsGuardians = ops.table(
  'guardians',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsGuardianId>(),
    studentId: studentRef().notNull(),
    /** Lead the guardian came from, when known. */
    leadId: uuid('lead_id')
      .references(() => opsLeads.id, { onDelete: 'restrict' })
      .$type<LeadId>(),
    /** Guardian full name. */
    fullName: text('full_name').notNull(),
    /** Relationship to the student. */
    relationship: text('relationship').notNull(),
    /** E.164 (domain/contacts.ts normalisePhone). */
    phone: text('phone'),
    /** Lower-cased and trimmed. */
    email: text('email'),
    /** Postal address (restricted). */
    address: text('address'),
    /** Primary contact of the student (at most one live guardian). */
    isPrimary: boolean('is_primary').notNull().default(false),
    /** Emergency contact. */
    isEmergency: boolean('is_emergency').notNull().default(false),
    /** Preferred channel. */
    preferredContact: text('preferred_contact'),
    /** Contact consent; `not_recorded` until recorded. */
    consentStatus: text('consent_status').notNull().default('not_recorded'),
    consentRecordedAt: instant('consent_recorded_at'),
    notes: text('notes'),
    /** Archived instead of deleted. */
    archivedAt: instant('archived_at'),
    createdBy: userRef('created_by').notNull(),
    updatedBy: userRef('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('guardians_student_idx').on(t.studentId),
    uniqueIndex('guardians_one_primary_per_student')
      .on(t.studentId)
      .where(sql`${t.isPrimary} AND ${t.archivedAt} IS NULL`),
    // Target of the composite FK from ops.kyc_documents (a guardian's document stays on that student).
    unique('guardians_id_student_key').on(t.id, t.studentId),
    index('guardians_phone_idx').on(t.phone),
    index('guardians_email_idx').on(t.email),
    check(
      'guardians_relationship_check',
      sql`${t.relationship} IN ${inList(OPS_GUARDIAN_RELATIONSHIPS)}`,
    ),
    check('guardians_phone_e164', sql`${t.phone} IS NULL OR ${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check('guardians_email_lowercase', sql`${t.email} IS NULL OR ${t.email} = lower(${t.email})`),
    check(
      'guardians_preferred_check',
      sql`${t.preferredContact} IS NULL OR ${t.preferredContact} IN ${inList(OPS_GUARDIAN_PREFERRED_CONTACT)}`,
    ),
    check('guardians_consent_check', sql`${t.consentStatus} IN ${inList(OPS_GUARDIAN_CONSENT)}`),
  ],
);

/**
 * Every student report: who, when, which period, which field groups (dossier sections), for
 * which audience. draft → reviewed → final; a final report is an immutable snapshot.
 */
export const opsReportExports = ops.table(
  'report_exports',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsReportExportId>(),
    studentId: studentRef().notNull(),
    /** User who generated the report. */
    requestedBy: userRef('requested_by').notNull(),
    /** First day of the reporting period (IST). */
    periodFrom: isoDate('period_from').notNull(),
    /** Last day of the reporting period (IST). */
    periodTo: isoDate('period_to').notNull(),
    /** Field groups included (depends on permissions). */
    fieldsIncluded: jsonb('fields_included').$type<string[]>().notNull(),
    /** Report reference printed on the report, e.g. SR-0A1B2C3D4E. */
    referenceCode: text('reference_code').notNull(),
    at: instant('at').notNull().defaultNow(),
    /** Who the report is for; raw teacher remarks only ever in `internal` / `admin_dossier`. */
    audience: text('audience')
      .$type<(typeof OPS_REPORT_AUDIENCES)[number]>()
      .notNull()
      .default('internal'),
    status: text('status').$type<(typeof OPS_REPORT_STATUSES)[number]>().notNull().default('draft'),
    /** Report content as finalised (required when final; `{legacy: true}` for pre-0007 exports). */
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>(),
    /** Report template version, e.g. progress-report/1. */
    templateVersion: text('template_version'),
    /** Source record ids the content came from (assessments, attendance window, feedback). */
    sourceRefs: jsonb('source_refs').$type<Record<string, unknown>>(),
    reviewedBy: userRef('reviewed_by'),
    reviewedAt: instant('reviewed_at'),
    finalisedBy: userRef('finalised_by'),
    finalisedAt: instant('finalised_at'),
  },
  (t) => [
    uniqueIndex('report_exports_reference_key').on(t.referenceCode),
    index('report_exports_student_idx').on(t.studentId, t.at),
    check('report_exports_period_check', sql`${t.periodFrom} <= ${t.periodTo}`),
    check('report_exports_reference_format', sql`${t.referenceCode} ~ '^SR-[0-9A-Z]{10}$'`),
    check('report_exports_audience_check', sql`${t.audience} IN ${inList(OPS_REPORT_AUDIENCES)}`),
    check('report_exports_status_check', sql`${t.status} IN ${inList(OPS_REPORT_STATUSES)}`),
    check(
      'report_exports_reviewed_pair',
      sql`(${t.reviewedBy} IS NULL) = (${t.reviewedAt} IS NULL)`,
    ),
    check(
      'report_exports_second_reviewer',
      sql`${t.reviewedBy} IS NULL OR ${t.reviewedBy} <> ${t.requestedBy}`,
    ),
    check(
      'report_exports_final_check',
      sql`(${t.status} = 'final') = (${t.finalisedBy} IS NOT NULL AND ${t.finalisedAt} IS NOT NULL AND ${t.snapshot} IS NOT NULL)`,
    ),
  ],
);

/**
 * An identity document seen for a student or one of their guardians: type, a MASKED reference
 * (never the full number, never a scan: no protected file storage exists) and verification.
 * A new document of the same type supersedes the old row (kept) and starts unverified.
 */
export const opsKycDocuments = ops.table(
  'kyc_documents',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsKycDocumentId>(),
    /** Student the document belongs to (or whose guardian it belongs to). */
    studentId: studentRef().notNull(),
    /** Student's own document, or a guardian's. */
    subjectType: text('subject_type').$type<(typeof OPS_KYC_SUBJECTS)[number]>().notNull(),
    /** Guardian (subject `guardian`); must be a guardian of `student_id` (composite FK). */
    guardianId: uuid('guardian_id').$type<OpsGuardianId>(),
    /** Code from setting `admissions.kyc.id_document_types`, e.g. aadhaar. */
    documentType: text('document_type').notNull(),
    /** Masked reference, e.g. XXXX-XXXX-1234: at most 4 digits and a mask character (X, *, •). */
    maskedReference: text('masked_reference').notNull(),
    verificationStatus: text('verification_status')
      .$type<(typeof OPS_KYC_VERIFICATION)[number]>()
      .notNull()
      .default('unverified'),
    /** Who verified or rejected it. */
    verifiedBy: userRef('verified_by'),
    verifiedAt: instant('verified_at'),
    /** Verifier note (required when rejected). */
    verificationNote: text('verification_note'),
    /** The newer row that replaced this one. */
    supersededById: uuid('superseded_by_id')
      .references((): AnyPgColumn => opsKycDocuments.id, { onDelete: 'restrict' })
      .$type<OpsKycDocumentId>(),
    supersededAt: instant('superseded_at'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('kyc_documents_student_idx').on(t.studentId),
    index('kyc_documents_guardian_idx').on(t.guardianId),
    foreignKey({
      name: 'kyc_documents_guardian_fk',
      columns: [t.guardianId, t.studentId],
      foreignColumns: [opsGuardians.id, opsGuardians.studentId],
    }),
    uniqueIndex('kyc_documents_live_student_key')
      .on(t.studentId, t.documentType)
      .where(sql`${t.guardianId} IS NULL AND ${t.supersededAt} IS NULL`),
    uniqueIndex('kyc_documents_live_guardian_key')
      .on(t.guardianId, t.documentType)
      .where(sql`${t.guardianId} IS NOT NULL AND ${t.supersededAt} IS NULL`),
    check('kyc_documents_subject_check', sql`${t.subjectType} IN ${inList(OPS_KYC_SUBJECTS)}`),
    check(
      'kyc_documents_guardian_link',
      sql`(${t.subjectType} = 'guardian') = (${t.guardianId} IS NOT NULL)`,
    ),
    check('kyc_documents_type_format', sql`${t.documentType} ~ '^[a-z][a-z0-9_]{1,39}$'`),
    check(
      'kyc_documents_masked_check',
      sql`length(${t.maskedReference}) BETWEEN 2 AND 40 AND length(regexp_replace(${t.maskedReference}, '[^0-9]', '', 'g')) <= 4 AND ${t.maskedReference} ~ '[Xx*•]'`,
    ),
    check(
      'kyc_documents_verification_check',
      sql`${t.verificationStatus} IN ${inList(OPS_KYC_VERIFICATION)}`,
    ),
    check(
      'kyc_documents_verified_pair',
      sql`(${t.verificationStatus} = 'unverified') = (${t.verifiedBy} IS NULL AND ${t.verifiedAt} IS NULL)`,
    ),
    check(
      'kyc_documents_rejected_note',
      sql`${t.verificationStatus} <> 'rejected' OR length(trim(coalesce(${t.verificationNote}, ''))) > 0`,
    ),
    check(
      'kyc_documents_superseded_pair',
      sql`(${t.supersededById} IS NULL) = (${t.supersededAt} IS NULL)`,
    ),
  ],
);

/**
 * Sibling links between two students, stored once as an ordered pair (lower id first). Added by
 * staff only: a shared guardian phone never links or merges siblings by itself.
 */
export const opsStudentSiblings = ops.table(
  'student_siblings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentId: studentRef().notNull(),
    siblingStudentId: studentRef('sibling_student_id').notNull(),
    note: text('note'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('student_siblings_pair_key').on(t.studentId, t.siblingStudentId),
    index('student_siblings_sibling_idx').on(t.siblingStudentId),
    check('student_siblings_ordered', sql`${t.studentId} < ${t.siblingStudentId}`),
  ],
);
