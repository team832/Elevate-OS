/**
 * The one way to create an employee (OPS-030, D-028): a core.staff_members row
 * (Ops is its steward), its ops.staff_profiles row and an ops.employee_records
 * row with a new EMP-#### code, audited — all inside the caller's transaction.
 *
 * No permission check here: callers check first (`ops:employees:manage` for
 * direct creation, `ops:recruitment:decide` for candidate conversion).
 * Owned by the HR records slice; other slices call it but never change it.
 */
import { eq } from 'drizzle-orm';
import {
  opsEmployeeRecords,
  opsStaffProfiles,
  staffMembers,
  type Database,
} from '@elevate/database';
import { recordAudit } from '@elevate/server-kit';
import { ConflictError, ValidationError } from '@elevate/shared-contracts';
import type { DepartmentId, StaffMemberId, UserId } from '@elevate/shared-types';
import { normaliseEmail } from '../../domain/contacts';
import { activeStaff, nextCode, type Actor } from '../context';

export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'visiting' | 'not_recorded';

export interface NewEmployeeInput {
  /** Display name (core.staff_members.full_name). */
  fullName: string;
  legalName?: string | null;
  workEmail?: string | null;
  workPhone?: string | null;
  workLocation?: string | null;
  timezone?: string;
  departmentId?: DepartmentId | null;
  /** Designation / job title. */
  title?: string | null;
  managerId?: StaffMemberId | null;
  employmentType?: EmploymentType;
  employmentStartDate?: string | null;
  /** Defaults to `onboarding`; direct creation of an already-working employee may pass `active`. */
  employmentStatus?: 'onboarding' | 'active';
  /** Linking a login is a platform-administrator act; normally null here. */
  userId?: UserId | null;
}

/** Lower-case and validate a work email; null stays null. Throws VALIDATION_ERROR when invalid. */
export function normaliseWorkEmail(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  const result = normaliseEmail(raw);
  if (!result.ok) {
    throw new ValidationError('Work email is not a valid address.', {
      details: [{ location: 'body', path: ['workEmail'], message: 'Invalid email' }],
    });
  }
  return result.email;
}

export async function insertEmployee(
  tx: Database,
  actor: Actor,
  input: NewEmployeeInput,
  requestId?: string,
): Promise<{ staffId: StaffMemberId; employeeCode: string }> {
  const fullName = input.fullName.trim();
  if (!fullName) throw new ValidationError('Name is required.');
  const workEmail = normaliseWorkEmail(input.workEmail);
  if (workEmail) {
    const [clash] = await tx
      .select({ staffId: opsEmployeeRecords.staffId })
      .from(opsEmployeeRecords)
      .where(eq(opsEmployeeRecords.workEmail, workEmail))
      .limit(1);
    if (clash) throw new ConflictError('Another employee already uses this work email.');
  }
  if (input.managerId) await activeStaff(tx, input.managerId, 'managerId');

  const [staff] = await tx
    .insert(staffMembers)
    .values({
      fullName,
      departmentId: input.departmentId ?? null,
      title: input.title?.trim() || null,
      managerId: input.managerId ?? null,
      userId: input.userId ?? null,
    })
    .returning();
  if (!staff) throw new Error('staff insert returned no row');

  await tx.insert(opsStaffProfiles).values({
    staffId: staff.id,
    employmentType: input.employmentType ?? 'not_recorded',
    updatedBy: actor.id,
  });

  const employeeCode = await nextCode(tx, 'employee', 'ops.employee_records', 'employee_code');
  const [record] = await tx
    .insert(opsEmployeeRecords)
    .values({
      staffId: staff.id,
      employeeCode,
      legalName: input.legalName?.trim() || null,
      workEmail,
      workPhone: input.workPhone?.trim() || null,
      workLocation: input.workLocation?.trim() || null,
      timezone: input.timezone ?? 'Asia/Kolkata',
      employmentStatus: input.employmentStatus ?? 'onboarding',
      employmentStartDate: input.employmentStartDate ?? null,
      createdBy: actor.id,
    })
    .returning();

  await recordAudit(tx, {
    actorUserId: actor.id,
    module: 'ops',
    action: 'employee.created',
    entityType: 'employee',
    entityId: staff.id,
    // No private fields here; legal name and contacts stay out of the audit payload.
    after: {
      employeeCode,
      fullName,
      departmentId: staff.departmentId,
      title: staff.title,
      managerId: staff.managerId,
      employmentStatus: record?.employmentStatus,
      employmentStartDate: record?.employmentStartDate,
    },
    requestId,
  });
  return { staffId: staff.id, employeeCode };
}
