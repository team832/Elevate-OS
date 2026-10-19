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
import { check, index, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { Brand, StaffMemberId } from '@elevate/shared-types';
import { staffMembers } from './core';
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
