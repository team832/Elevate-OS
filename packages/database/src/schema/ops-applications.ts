/**
 * OWNER: Business Ops OS — admissions slice "application → form → signatures → confirmation"
 * (owner brief 21 Oct 2026 §6–§7). Part of the `ops` Postgres schema, split across ops*.ts
 * (D-029). Same rules and naming as ops.ts (D-036).
 *
 * Rules:
 * - one application per primary admission case; every case it covers (multi-programme bundles,
 *   the primary too) carries `ops.admissions.application_id`;
 * - a form PDF and a signature confirmation name the exact application version they cover
 *   (composite FKs: the form and version belong to the same application);
 *   a material change invalidates the live confirmation (invalidated_*), never deletes it;
 * - `admission_approvals` is written once, in the confirmation transaction, after the approver's
 *   password re-check (D-041). Its (admission_id, admission_number) references
 *   ops.admissions(id, admission_number), so the admission must carry that number first and the
 *   number can never change afterwards (D-040, enforced by the database in production and tests).
 */
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AdmissionId, Brand } from '@elevate/shared-types';
import { opsAdmissions } from './ops';
// `ops` from ops-columns: ops.ts imports this file (admissions.application_id), see ops-columns.ts.
import {
  createdAt,
  inList,
  instant,
  isoDate,
  ops,
  studentRef,
  updatedAt,
  userRef,
} from './ops-columns';
import { opsDemos, type OpsDemoId } from './ops-demos';

export type OpsApplicationId = Brand<string, 'OpsApplicationId'>;
export type OpsApplicationVersionId = Brand<string, 'OpsApplicationVersionId'>;
export type OpsApplicationFormId = Brand<string, 'OpsApplicationFormId'>;
export type OpsSignatureConfirmationId = Brand<string, 'OpsSignatureConfirmationId'>;
export type OpsAdmissionApprovalId = Brand<string, 'OpsAdmissionApprovalId'>;

export const OPS_APPLICATION_ORIGINS = ['demo', 'direct', 'readmission'] as const;
export const OPS_APPLICATION_STATUSES = [
  'draft',
  'ready_for_review',
  'form_generated',
  'signatures_confirmed',
  'admission_confirmed',
  'withdrawn',
] as const;
export type OpsApplicationStatus = (typeof OPS_APPLICATION_STATUSES)[number];
export const OPS_REAUTH_METHODS = ['password'] as const;

/** Who signed a form: the student or a guardian (`ops.guardians` id). */
export type OpsSigner = { role: 'student' | 'guardian'; name: string; guardianId?: string };

const applicationRef = () =>
  uuid('application_id')
    .notNull()
    .references(() => opsApplications.id, { onDelete: 'restrict' })
    .$type<OpsApplicationId>();
const isSha256 = (c: unknown) => sql`${c} ~ '^[0-9a-f]{64}$'`;

/**
 * An admission application (brief §6) for one admission case, through a demo, directly, or as a
 * readmission of a former student (same identity, new case). Completing it never admits anyone:
 * only `admission_approvals` does.
 */
export const opsApplications = ops.table(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsApplicationId>(),
    /** Application reference printed on the form before admission, e.g. APP-000001. */
    reference: text('reference').notNull(),
    studentId: studentRef().notNull(),
    /** The admission case this application is for (one application per case). */
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => opsAdmissions.id, { onDelete: 'restrict' })
      .$type<AdmissionId>(),
    /** Through a demo, a direct admission, or a readmission. */
    origin: text('origin').$type<(typeof OPS_APPLICATION_ORIGINS)[number]>().notNull(),
    /** Demo it was converted from (origin `demo`). */
    demoId: uuid('demo_id')
      .references(() => opsDemos.id, { onDelete: 'restrict' })
      .$type<OpsDemoId>(),
    /** Earlier admission of the same student (origin `readmission`); it stays closed. */
    previousAdmissionId: uuid('previous_admission_id')
      .references(() => opsAdmissions.id, { onDelete: 'restrict' })
      .$type<AdmissionId>(),
    /** Draft → ready for review → form generated → signatures confirmed → admission confirmed. */
    status: text('status').$type<OpsApplicationStatus>().notNull().default('draft'),
    /** Latest `application_versions.version` (optimistic concurrency check on every write). */
    currentVersion: integer('current_version').notNull().default(1),
    /** Academic year applied for, e.g. 2026-27. */
    academicYear: text('academic_year'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('applications_reference_key').on(t.reference),
    uniqueIndex('applications_admission_key').on(t.admissionId),
    index('applications_student_idx').on(t.studentId),
    index('applications_status_idx').on(t.status),
    index('applications_demo_idx').on(t.demoId),
    index('applications_previous_admission_idx').on(t.previousAdmissionId),
    check('applications_reference_format', sql`${t.reference} ~ '^APP-[0-9]{6}$'`),
    check('applications_origin_check', sql`${t.origin} IN ${inList(OPS_APPLICATION_ORIGINS)}`),
    check('applications_status_check', sql`${t.status} IN ${inList(OPS_APPLICATION_STATUSES)}`),
    check('applications_demo_link', sql`(${t.origin} = 'demo') = (${t.demoId} IS NOT NULL)`),
    check(
      'applications_readmission_link',
      sql`(${t.origin} = 'readmission') = (${t.previousAdmissionId} IS NOT NULL)`,
    ),
    check('applications_version_check', sql`${t.currentVersion} >= 1`),
    check(
      'applications_year_format',
      sql`${t.academicYear} IS NULL OR ${t.academicYear} ~ '^[0-9]{4}-[0-9]{2}$'`,
    ),
  ],
);

/** Every saved version of an application: the full content (KYC, programmes, fee agreement, declarations). */
export const opsApplicationVersions = ops.table(
  'application_versions',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsApplicationVersionId>(),
    applicationId: applicationRef(),
    /** 1, 2, … within the application. */
    version: integer('version').notNull(),
    /** Application content at this version (what the form prints). */
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    /** SHA-256 (hex) of the material fields; a change invalidates signatures. */
    contentHash: text('content_hash').notNull(),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('application_versions_version_key').on(t.applicationId, t.version),
    check('application_versions_version_check', sql`${t.version} >= 1`),
    check('application_versions_hash_format', isSha256(t.contentHash)),
  ],
);

/** Each generated admission-form PDF and the application version it shows. */
export const opsApplicationForms = ops.table(
  'application_forms',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsApplicationFormId>(),
    applicationId: applicationRef(),
    /** Application version printed on the form. */
    version: integer('version').notNull(),
    /** Form template version, e.g. admission-form/1. */
    templateVersion: text('template_version').notNull(),
    /** SHA-256 (hex) of the PDF bytes. */
    pdfSha256: text('pdf_sha256').notNull(),
    generatedBy: userRef('generated_by').notNull(),
    generatedAt: instant('generated_at').notNull().defaultNow(),
  },
  (t) => [
    index('application_forms_application_idx').on(t.applicationId, t.version),
    unique('application_forms_id_version_key').on(t.id, t.applicationId, t.version),
    foreignKey({
      name: 'application_forms_version_fk',
      columns: [t.applicationId, t.version],
      foreignColumns: [opsApplicationVersions.applicationId, opsApplicationVersions.version],
    }),
    check('application_forms_version_check', sql`${t.version} >= 1`),
    check('application_forms_hash_format', isSha256(t.pdfSha256)),
  ],
);

/**
 * Staff confirmation that the required physical signatures are on a printed form. At most one
 * live (not invalidated) confirmation per application.
 */
export const opsSignatureConfirmations = ops.table(
  'signature_confirmations',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsSignatureConfirmationId>(),
    applicationId: applicationRef(),
    /** Application version on the signed form. */
    version: integer('version').notNull(),
    /** The generated form that was signed (same application and version: composite FK). */
    formId: uuid('form_id').notNull().$type<OpsApplicationFormId>(),
    /** Who signed (setting `admissions.signatures.required_signers`). */
    signers: jsonb('signers').$type<OpsSigner[]>().notNull(),
    /** IST day written on the form. */
    signedOn: isoDate('signed_on').notNull(),
    confirmedBy: userRef('confirmed_by').notNull(),
    confirmedAt: instant('confirmed_at').notNull().defaultNow(),
    /** Set when a material change made this confirmation stale. */
    invalidatedAt: instant('invalidated_at'),
    invalidatedBy: userRef('invalidated_by'),
    invalidatedReason: text('invalidated_reason'),
  },
  (t) => [
    uniqueIndex('signature_confirmations_live_key')
      .on(t.applicationId)
      .where(sql`${t.invalidatedAt} IS NULL`),
    index('signature_confirmations_form_idx').on(t.formId),
    foreignKey({
      name: 'signature_confirmations_form_fk',
      columns: [t.formId, t.applicationId, t.version],
      foreignColumns: [
        opsApplicationForms.id,
        opsApplicationForms.applicationId,
        opsApplicationForms.version,
      ],
    }),
    check('signature_confirmations_signers_check', sql`jsonb_array_length(${t.signers}) >= 1`),
    check(
      'signature_confirmations_invalidated_check',
      sql`(${t.invalidatedAt} IS NULL) = (${t.invalidatedBy} IS NULL) AND (${t.invalidatedAt} IS NULL) = (${t.invalidatedReason} IS NULL)`,
    ),
  ],
);

/**
 * The final, password-confirmed admission approval (one per admission case): actor, re-check
 * evidence, the accepted application and fee snapshot, and the admission number given.
 */
export const opsAdmissionApprovals = ops.table(
  'admission_approvals',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsAdmissionApprovalId>(),
    /** Admission case approved (with `admission_number`: composite FK to ops.admissions). */
    admissionId: uuid('admission_id').notNull().$type<AdmissionId>(),
    applicationId: applicationRef(),
    /** Application version that was approved. */
    applicationVersion: integer('application_version').notNull(),
    approvedBy: userRef('approved_by').notNull(),
    approvedAt: instant('approved_at').notNull().defaultNow(),
    /** How the approver was re-verified (D-041). */
    reauthMethod: text('reauth_method').$type<(typeof OPS_REAUTH_METHODS)[number]>().notNull(),
    reauthVerifiedAt: instant('reauth_verified_at').notNull(),
    /** Accepted application content and fee agreement. */
    acceptedSnapshot: jsonb('accepted_snapshot').$type<Record<string, unknown>>().notNull(),
    /** Admission number given at confirmation (D-040); never changed or reused. */
    admissionNumber: text('admission_number').notNull(),
  },
  (t) => [
    uniqueIndex('admission_approvals_admission_key').on(t.admissionId),
    uniqueIndex('admission_approvals_number_key').on(t.admissionNumber),
    index('admission_approvals_application_idx').on(t.applicationId),
    check(
      'admission_approvals_reauth_check',
      sql`${t.reauthMethod} IN ${inList(OPS_REAUTH_METHODS)}`,
    ),
    check('admission_approvals_version_check', sql`${t.applicationVersion} >= 1`),
    foreignKey({
      name: 'admission_approvals_admission_number_fk',
      columns: [t.admissionId, t.admissionNumber],
      foreignColumns: [opsAdmissions.id, opsAdmissions.admissionNumber],
    }),
    foreignKey({
      name: 'admission_approvals_version_fk',
      columns: [t.applicationId, t.applicationVersion],
      foreignColumns: [opsApplicationVersions.applicationId, opsApplicationVersions.version],
    }),
  ],
);
