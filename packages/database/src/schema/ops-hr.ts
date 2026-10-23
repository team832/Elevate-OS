/**
 * OWNER: Business Ops OS — HR employee records beside `staff_profiles` (owner brief 23 Oct 2026
 * §3, ruling R1): HR-private contact details, departments over time and reporting-line history.
 * `core.staff_members.department_id` / `manager_id` stay the canonical CURRENT primary department
 * and manager; these tables add other departments and the dated history, written by the HR
 * service (in the same transaction) from the first change it records. Part of the `ops` Postgres
 * schema, split across ops*.ts; same rules as ops.ts.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { DepartmentId, StaffMemberId } from '@elevate/shared-types';
import { departments, staffMembers } from './core';
import { createdAt, isoDate, ops, staffRefRestrict, updatedAt, userRef } from './ops-columns';
import { opsAttachments, type OpsAttachmentId } from './ops-attachments';

const dateOrder = (from: AnyPgColumn, to: AnyPgColumn) =>
  sql`${to} IS NULL OR ${from} IS NULL OR ${to} >= ${from}`;

/** HR-private details (permission ops:staff_private:read). Never on sample rows: no is_sample. */
export const opsStaffPrivateDetails = ops.table('staff_private_details', {
  staffId: uuid('staff_id')
    .primaryKey()
    .references(() => staffMembers.id, { onDelete: 'cascade' })
    .$type<StaffMemberId>(),
  personalPhone: text('personal_phone'),
  personalEmail: text('personal_email'),
  address: text('address'),
  emergencyContactName: text('emergency_contact_name'),
  emergencyContactPhone: text('emergency_contact_phone'),
  photoAttachmentId: uuid('photo_attachment_id')
    .references(() => opsAttachments.id, { onDelete: 'set null' })
    .$type<OpsAttachmentId>(),
  updatedBy: userRef('updated_by'),
  updatedAt: updatedAt(),
});

/** Department membership over time; one current primary department per person. */
export const opsStaffDepartments = ops.table(
  'staff_departments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: staffRefRestrict('staff_id').notNull(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'restrict' })
      .$type<DepartmentId>(),
    isPrimary: boolean('is_primary').notNull().default(false),
    /** null = start not recorded. */
    fromDate: isoDate('from_date'),
    toDate: isoDate('to_date'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('staff_departments_current_key')
      .on(t.staffId, t.departmentId)
      .where(sql`${t.toDate} IS NULL`),
    uniqueIndex('staff_departments_one_primary_key')
      .on(t.staffId)
      .where(sql`${t.isPrimary} AND ${t.toDate} IS NULL`),
    index('staff_departments_department_idx').on(t.departmentId),
    check('staff_departments_dates_check', dateOrder(t.fromDate, t.toDate)),
  ],
);

/** Reporting-line history; the open row (to_date null) is the current manager. */
export const opsStaffManagerHistory = ops.table(
  'staff_manager_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: staffRefRestrict('staff_id').notNull(),
    /** null = no manager in this period. */
    managerStaffId: staffRefRestrict('manager_staff_id'),
    fromDate: isoDate('from_date'),
    toDate: isoDate('to_date'),
    changedBy: userRef('changed_by').notNull(),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('staff_manager_history_current_key')
      .on(t.staffId)
      .where(sql`${t.toDate} IS NULL`),
    index('staff_manager_history_manager_idx').on(t.managerStaffId),
    check('staff_manager_history_dates_check', dateOrder(t.fromDate, t.toDate)),
    check(
      'staff_manager_history_not_self',
      sql`${t.managerStaffId} IS NULL OR ${t.managerStaffId} <> ${t.staffId}`,
    ),
  ],
);
