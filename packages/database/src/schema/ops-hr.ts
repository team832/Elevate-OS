/**
 * OWNER: Business Ops OS team — HR records (OPS-030…, D-028).
 *
 * Employee records (the HR extension of core.staff_members), organisation
 * history, private HR fields, employment-document metadata, compensation
 * records and work assets. Sensitive tables are named in their doc comment;
 * the services enforce the matching `ops:*` permissions (field-level).
 *
 * Rules: same as ops.ts — `ops.table(...)`, exports prefixed `ops`, UUID PKs,
 * human codes in separate unique columns, FKs only into `ops` or `core`,
 * only `import type` from workspace packages, no `drizzle-kit generate`.
 * Rows that history depends on are never deleted (status columns instead).
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { Brand, DepartmentId, StaffMemberId } from '@elevate/shared-types';
import { departments, staffMembers } from './core';
import { ops } from './ops';
import {
  createdAt,
  inList,
  instant,
  isoDate,
  staffRefRestrict,
  updatedAt,
  userRef,
} from './ops-columns';

export type OpsAssetId = Brand<string, 'OpsAssetId'>;
export type OpsAssetAssignmentId = Brand<string, 'OpsAssetAssignmentId'>;
export type OpsEmploymentHistoryId = Brand<string, 'OpsEmploymentHistoryId'>;
export type OpsDepartmentHeadId = Brand<string, 'OpsDepartmentHeadId'>;
export type OpsEmergencyContactId = Brand<string, 'OpsEmergencyContactId'>;
export type OpsIdentityReferenceId = Brand<string, 'OpsIdentityReferenceId'>;
export type OpsEmployeeDocumentId = Brand<string, 'OpsEmployeeDocumentId'>;
export type OpsCompensationRecordId = Brand<string, 'OpsCompensationRecordId'>;

export const OPS_EMPLOYMENT_STATUSES = ['onboarding', 'active', 'on_notice', 'separated'] as const;
export const OPS_ASSET_STATUSES = [
  'available',
  'assigned',
  'in_repair',
  'retired',
  'lost',
] as const;

/**
 * Employee record: the HR side of a core.staff_members row (1:1). The staff row
 * keeps the display name, department, title and manager; this row adds the
 * employee code and employment facts. Not every staff row is an employee
 * record (role labels are not hires, OD-009). Never deleted.
 */
export const opsEmployeeRecords = ops.table(
  'employee_records',
  {
    staffId: uuid('staff_id')
      .primaryKey()
      .references(() => staffMembers.id, { onDelete: 'restrict' })
      .$type<StaffMemberId>(),
    /** EMP-0001 … (never reused). */
    employeeCode: text('employee_code').notNull(),
    /** Legal name as on employment documents (HR views only; display name is on core). */
    legalName: text('legal_name'),
    /** Work email, stored lower-case. */
    workEmail: text('work_email'),
    workPhone: text('work_phone'),
    workLocation: text('work_location'),
    /** IANA zone used to render this employee's attendance (D-028). */
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    employmentStatus: text('employment_status', { enum: OPS_EMPLOYMENT_STATUSES })
      .notNull()
      .default('onboarding'),
    employmentStartDate: isoDate('employment_start_date'),
    /** Last working day once a separation is approved. */
    employmentEndDate: isoDate('employment_end_date'),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('employee_records_code_key').on(t.employeeCode),
    uniqueIndex('employee_records_work_email_key')
      .on(t.workEmail)
      .where(sql`${t.workEmail} IS NOT NULL`),
    index('employee_records_status_idx').on(t.employmentStatus),
    check('employee_records_code_format', sql`${t.employeeCode} ~ '^EMP-[0-9]{4}$'`),
    check(
      'employee_records_work_email_lowercase',
      sql`${t.workEmail} IS NULL OR ${t.workEmail} = lower(${t.workEmail})`,
    ),
    check(
      'employee_records_status_check',
      sql`${t.employmentStatus} IN ${inList(OPS_EMPLOYMENT_STATUSES)}`,
    ),
    check(
      'employee_records_dates_order',
      sql`${t.employmentEndDate} IS NULL OR ${t.employmentStartDate} IS NULL OR ${t.employmentEndDate} >= ${t.employmentStartDate}`,
    ),
  ],
);

/** Work assets (laptops, phones, keys, ID cards …). Never deleted: retired or lost instead. */
export const opsAssets = ops.table(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsAssetId>(),
    /** AST-00001 … */
    code: text('code').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    serialNumber: text('serial_number'),
    status: text('status', { enum: OPS_ASSET_STATUSES }).notNull().default('available'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('assets_code_key').on(t.code),
    uniqueIndex('assets_serial_key')
      .on(t.serialNumber)
      .where(sql`${t.serialNumber} IS NOT NULL`),
    check('assets_code_format', sql`${t.code} ~ '^AST-[0-9]{5}$'`),
    check('assets_status_check', sql`${t.status} IN ${inList(OPS_ASSET_STATUSES)}`),
  ],
);

/** Assignment history of an asset. At most one open (unreturned) assignment per asset. */
export const opsAssetAssignments = ops.table(
  'asset_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsAssetAssignmentId>(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => opsAssets.id, { onDelete: 'restrict' })
      .$type<OpsAssetId>(),
    staffId: staffRefRestrict('staff_id').notNull(),
    assignedOn: isoDate('assigned_on').notNull(),
    expectedReturnOn: isoDate('expected_return_on'),
    returnedAt: instant('returned_at'),
    conditionOnReturn: text('condition_on_return'),
    notes: text('notes'),
    assignedBy: userRef('assigned_by').notNull(),
    returnedBy: userRef('returned_by'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('asset_assignments_one_open_key')
      .on(t.assetId)
      .where(sql`${t.returnedAt} IS NULL`),
    index('asset_assignments_staff_idx').on(t.staffId),
    check(
      'asset_assignments_return_consistent',
      sql`(${t.returnedAt} IS NULL) = (${t.returnedBy} IS NULL)`,
    ),
  ],
);

// --- HR records slice additions (OPS-031…OPS-039) -------------------------------------------------

export const OPS_EMPLOYMENT_HISTORY_FIELDS = [
  'department',
  'title',
  'manager',
  'employment_type',
  'employment_status',
] as const;
export const OPS_EMPLOYEE_DOCUMENT_KINDS = [
  'agreement',
  'identification_reference',
  'qualification',
  'certificate',
  'policy_acknowledgement',
  'onboarding',
  'training',
  'performance_review',
  'other',
] as const;
export const OPS_EMPLOYEE_DOCUMENT_STATUSES = [
  'active',
  'superseded',
  'retention_hold',
  'deletion_requested',
  'deleted',
] as const;
/** `reference` = metadata + an external location label only; `stored` = bytes behind the storage adapter. */
export const OPS_DOCUMENT_STORAGE_KINDS = ['reference', 'stored'] as const;
/** Retention classes; the periods per class are an OPEN owner decision (setting `hr.document_retention`). */
export const OPS_DOCUMENT_RETENTION_CLASSES = [
  'employment_record',
  'identity',
  'training',
  'general',
] as const;
export const OPS_IDENTITY_REFERENCE_KINDS = [
  'aadhaar',
  'pan',
  'passport',
  'voter_id',
  'driving_licence',
  'other',
] as const;
export const OPS_COMPENSATION_BASES = ['monthly', 'annual', 'hourly'] as const;
export const OPS_COMPENSATION_STATUSES = ['draft', 'approved', 'superseded', 'cancelled'] as const;

/** One earning or allowance line of a compensation record (integer paise; no deductions). */
export interface OpsCompensationComponent {
  kind: 'earning' | 'allowance';
  label: string;
  amountPaise: number;
}

/**
 * Append-only employment history (OPS-033): every change of department, title,
 * manager, employment type or employment status, written by the service that
 * makes the change (insertEmployee, updateEmployee, updateStaff). Values are ids
 * or enum values as text; names are resolved when read. Never updated or deleted.
 */
export const opsEmploymentHistory = ops.table(
  'employment_history',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsEmploymentHistoryId>(),
    staffId: staffRefRestrict('staff_id').notNull(),
    field: text('field', { enum: OPS_EMPLOYMENT_HISTORY_FIELDS }).notNull(),
    fromValue: text('from_value'),
    toValue: text('to_value'),
    /** Calendar day the change takes effect (Asia/Kolkata). */
    effectiveOn: isoDate('effective_on').notNull(),
    reason: text('reason'),
    changedBy: userRef('changed_by'),
    changedAt: createdAt(),
  },
  (t) => [
    index('employment_history_staff_idx').on(t.staffId, t.effectiveOn),
    check(
      'employment_history_field_check',
      sql`${t.field} IN ${inList(OPS_EMPLOYMENT_HISTORY_FIELDS)}`,
    ),
  ],
);

/** Department heads with history (OPS-032). At most one current head per department. */
export const opsDepartmentHeads = ops.table(
  'department_heads',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsDepartmentHeadId>(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'restrict' })
      .$type<DepartmentId>(),
    staffId: staffRefRestrict('staff_id').notNull(),
    startsOn: isoDate('starts_on').notNull(),
    /** Last day as head; null = current head. */
    endsOn: isoDate('ends_on'),
    reason: text('reason'),
    assignedBy: userRef('assigned_by').notNull(),
    endedBy: userRef('ended_by'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('department_heads_one_current_key')
      .on(t.departmentId)
      .where(sql`${t.endsOn} IS NULL`),
    index('department_heads_staff_idx').on(t.staffId),
    check('department_heads_dates_order', sql`${t.endsOn} IS NULL OR ${t.endsOn} >= ${t.startsOn}`),
  ],
);

/**
 * SENSITIVE — `ops:employee_private:*`. Personal contact details and address
 * (1:1 with the employee). No date of birth is stored (not needed; data
 * minimisation). Never in directory DTOs, lists, exports or audit payloads.
 */
export const opsEmployeePrivateDetails = ops.table('employee_private_details', {
  staffId: uuid('staff_id')
    .primaryKey()
    .references(() => staffMembers.id, { onDelete: 'restrict' })
    .$type<StaffMemberId>(),
  personalEmail: text('personal_email'),
  /** E.164 (normalised with domain/contacts normalisePhone). */
  personalPhone: text('personal_phone'),
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: text('city'),
  state: text('state'),
  postalCode: text('postal_code'),
  country: text('country'),
  updatedBy: userRef('updated_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** SENSITIVE — `ops:employee_private:*`. Emergency contacts of an employee. */
export const opsEmergencyContacts = ops.table(
  'emergency_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsEmergencyContactId>(),
    staffId: staffRefRestrict('staff_id').notNull(),
    name: text('name').notNull(),
    relationship: text('relationship').notNull(),
    /** E.164. */
    phone: text('phone').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    updatedBy: userRef('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('emergency_contacts_staff_idx').on(t.staffId),
    uniqueIndex('emergency_contacts_one_primary_key')
      .on(t.staffId)
      .where(sql`${t.isPrimary}`),
  ],
);

/**
 * Employment document metadata (OPS-035). Bytes are never in PostgreSQL: a
 * `stored` document has a storage key behind the DocumentStorage adapter (D-014;
 * the default mock refuses to store), a `reference` document only records where
 * the paper/file is kept. `identification_reference` documents are also
 * SENSITIVE (`ops:employee_private:read` needed in addition). Never deleted:
 * `deleted` keeps the metadata (retention periods are an open owner decision).
 */
export const opsEmployeeDocuments = ops.table(
  'employee_documents',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsEmployeeDocumentId>(),
    staffId: staffRefRestrict('staff_id').notNull(),
    kind: text('kind', { enum: OPS_EMPLOYEE_DOCUMENT_KINDS }).notNull(),
    title: text('title').notNull(),
    storageKind: text('storage_kind', { enum: OPS_DOCUMENT_STORAGE_KINDS }).notNull(),
    storageKey: text('storage_key'),
    /** Where a reference-only document is kept, e.g. "HR cabinet B, file 12". */
    externalReference: text('external_reference'),
    contentType: text('content_type'),
    sizeBytes: integer('size_bytes'),
    sha256: text('sha256'),
    retentionClass: text('retention_class', { enum: OPS_DOCUMENT_RETENTION_CLASSES })
      .notNull()
      .default('general'),
    status: text('status', { enum: OPS_EMPLOYEE_DOCUMENT_STATUSES }).notNull().default('active'),
    expiresOn: isoDate('expires_on'),
    supersededById: uuid('superseded_by_id')
      .references((): AnyPgColumn => opsEmployeeDocuments.id, { onDelete: 'restrict' })
      .$type<OpsEmployeeDocumentId>(),
    uploadedBy: userRef('uploaded_by').notNull(),
    deletionRequestedBy: userRef('deletion_requested_by'),
    deletionRequestedAt: instant('deletion_requested_at'),
    deletionReason: text('deletion_reason'),
    deletionDecidedBy: userRef('deletion_decided_by'),
    deletionDecidedAt: instant('deletion_decided_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('employee_documents_staff_idx').on(t.staffId, t.status),
    uniqueIndex('employee_documents_storage_key')
      .on(t.storageKey)
      .where(sql`${t.storageKey} IS NOT NULL`),
    check(
      'employee_documents_kind_check',
      sql`${t.kind} IN ${inList(OPS_EMPLOYEE_DOCUMENT_KINDS)}`,
    ),
    check(
      'employee_documents_status_check',
      sql`${t.status} IN ${inList(OPS_EMPLOYEE_DOCUMENT_STATUSES)}`,
    ),
    check(
      'employee_documents_retention_check',
      sql`${t.retentionClass} IN ${inList(OPS_DOCUMENT_RETENTION_CLASSES)}`,
    ),
    check(
      'employee_documents_storage_check',
      sql`(${t.storageKind} = 'reference' AND ${t.externalReference} IS NOT NULL AND ${t.storageKey} IS NULL) OR (${t.storageKind} = 'stored' AND ${t.storageKey} IS NOT NULL AND ${t.sha256} IS NOT NULL)`,
    ),
    check(
      'employee_documents_sha256_format',
      sql`${t.sha256} IS NULL OR ${t.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check('employee_documents_size_check', sql`${t.sizeBytes} IS NULL OR ${t.sizeBytes} >= 0`),
  ],
);

/**
 * SENSITIVE — `ops:employee_private:*`. Identity-document references (OD-014):
 * the kind and at most the LAST FOUR characters, optionally linked to a
 * document record. Full identity numbers are never stored.
 */
export const opsEmployeeIdentityReferences = ops.table(
  'employee_identity_references',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsIdentityReferenceId>(),
    staffId: staffRefRestrict('staff_id').notNull(),
    kind: text('kind', { enum: OPS_IDENTITY_REFERENCE_KINDS }).notNull(),
    last4: text('last4'),
    documentId: uuid('document_id')
      .references(() => opsEmployeeDocuments.id, { onDelete: 'restrict' })
      .$type<OpsEmployeeDocumentId>(),
    notes: text('notes'),
    status: text('status', { enum: ['active', 'retired'] })
      .notNull()
      .default('active'),
    recordedBy: userRef('recorded_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('employee_identity_references_staff_idx').on(t.staffId),
    check(
      'employee_identity_references_kind_check',
      sql`${t.kind} IN ${inList(OPS_IDENTITY_REFERENCE_KINDS)}`,
    ),
    check(
      'employee_identity_references_last4_format',
      sql`${t.last4} IS NULL OR ${t.last4} ~ '^[A-Z0-9]{1,4}$'`,
    ),
    check('employee_identity_references_status_check', sql`${t.status} IN ('active', 'retired')`),
  ],
);

/**
 * SENSITIVE — `ops:compensation:*`. Effective-dated compensation records
 * (OPS-036). Records only — not payroll: no deductions, tax, PF, ESI or payslips
 * (D-028). Amounts are integer paise in INR. Draft → approved (by a different
 * person) → superseded; at most one `approved` (current, open-ended) record per
 * employee; superseded records keep their effective window for history.
 */
export const opsCompensationRecords = ops.table(
  'compensation_records',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsCompensationRecordId>(),
    staffId: staffRefRestrict('staff_id').notNull(),
    basis: text('basis', { enum: OPS_COMPENSATION_BASES }).notNull(),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('INR'),
    components: jsonb('components')
      .$type<OpsCompensationComponent[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    effectiveFrom: isoDate('effective_from').notNull(),
    /** Set when a later approved record supersedes this one (the day before its start). */
    effectiveTo: isoDate('effective_to'),
    status: text('status', { enum: OPS_COMPENSATION_STATUSES }).notNull().default('draft'),
    note: text('note'),
    createdBy: userRef('created_by').notNull(),
    approvedBy: userRef('approved_by'),
    approvedAt: instant('approved_at'),
    supersededById: uuid('superseded_by_id')
      .references((): AnyPgColumn => opsCompensationRecords.id, { onDelete: 'restrict' })
      .$type<OpsCompensationRecordId>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('compensation_records_staff_idx').on(t.staffId, t.effectiveFrom),
    uniqueIndex('compensation_records_one_approved_key')
      .on(t.staffId)
      .where(sql`${t.status} = 'approved'`),
    check(
      'compensation_records_status_check',
      sql`${t.status} IN ${inList(OPS_COMPENSATION_STATUSES)}`,
    ),
    check('compensation_records_basis_check', sql`${t.basis} IN ${inList(OPS_COMPENSATION_BASES)}`),
    check('compensation_records_currency_check', sql`${t.currency} = 'INR'`),
    check('compensation_records_amount_check', sql`${t.amountPaise} >= 0`),
    check(
      'compensation_records_dates_order',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
    check(
      'compensation_records_approval_consistent',
      sql`(${t.status} IN ('draft', 'cancelled')) = (${t.approvedBy} IS NULL)`,
    ),
  ],
);
