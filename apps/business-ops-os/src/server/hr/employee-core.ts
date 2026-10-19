/**
 * The one way to create an employee (OPS-030, D-028): a core.staff_members row
 * (Ops is its steward), its ops.staff_profiles row and an ops.employee_records
 * row with a new EMP-#### code, audited, with the initial employment history
 * (OPS-033) — all inside the caller's transaction.
 *
 * No permission check here: callers check first (`ops:employees:manage` for
 * direct creation, `ops:recruitment:decide` for candidate conversion).
 * Owned by the HR records slice; other slices call `insertEmployee` and
 * `changeEmploymentStatus` but never change this file.
 */
import { eq } from 'drizzle-orm';
import {
  departments,
  opsEmployeeRecords,
  opsEmploymentHistory,
  opsStaffProfiles,
  staffMembers,
  type Database,
} from '@elevate/database';
import { recordAudit } from '@elevate/server-kit';
import {
  ConflictError,
  InvalidStateTransitionError,
  NotFoundError,
} from '@elevate/shared-contracts';
import type { DepartmentId, StaffMemberId, UserId } from '@elevate/shared-types';
import { normaliseEmail } from '../../domain/contacts';
import { istToday } from '../../domain/dates';
import {
  checkEmploymentStatusChange,
  historyChanges,
  isValidTimeZone,
  normaliseWorkPhone,
  type EmploymentStatus,
  type HistoryField,
} from '../../domain/hr/employees';
import { activeStaff, nextCode, type Actor } from '../context';
import { invalidField } from './access';

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
  if (!result.ok) throw invalidField('workEmail', 'Work email is not a valid address.');
  return result.email;
}

/** Work phone → E.164 or VALIDATION_FAILED. */
export function normaliseWorkPhoneOrThrow(raw: string | null | undefined): string | null {
  const r = normaliseWorkPhone(raw);
  if (!r.ok) throw invalidField('workPhone', r.message);
  return r.phone;
}

export function assertTimeZone(zone: string | undefined): string {
  const z = zone?.trim() || 'Asia/Kolkata';
  if (!isValidTimeZone(z)) throw invalidField('timezone', 'Unknown time zone.');
  return z;
}

/** Work email must be unique among employee records (the unique index is the final guard). */
export async function assertWorkEmailFree(
  tx: Database,
  email: string | null,
  exceptStaffId?: string,
): Promise<void> {
  if (!email) return;
  const [clash] = await tx
    .select({ staffId: opsEmployeeRecords.staffId })
    .from(opsEmployeeRecords)
    .where(eq(opsEmployeeRecords.workEmail, email))
    .limit(1);
  if (clash && clash.staffId !== exceptStaffId)
    throw new ConflictError('Another employee already uses this work email.');
}

/** The department must exist and not be archived. */
export async function assertDepartmentUsable(
  tx: Database,
  departmentId: string | null | undefined,
): Promise<void> {
  if (!departmentId) return;
  const [d] = await tx
    .select({ status: departments.status })
    .from(departments)
    .where(eq(departments.id, departmentId as DepartmentId))
    .limit(1);
  if (!d) throw invalidField('departmentId', 'Unknown department.');
  if (d.status === 'archived') throw invalidField('departmentId', 'That department is archived.');
}

/** Append employment-history rows (OPS-033). Never updates or deletes history. */
export async function writeHistory(
  tx: Database,
  input: {
    staffId: StaffMemberId;
    changes: readonly { field: HistoryField; fromValue: string | null; toValue: string | null }[];
    effectiveOn: string;
    reason?: string | null;
    actorId: UserId | null;
  },
): Promise<number> {
  if (input.changes.length === 0) return 0;
  await tx.insert(opsEmploymentHistory).values(
    input.changes.map((c) => ({
      staffId: input.staffId,
      field: c.field,
      fromValue: c.fromValue,
      toValue: c.toValue,
      effectiveOn: input.effectiveOn,
      reason: input.reason?.trim() || null,
      changedBy: input.actorId,
    })),
  );
  return input.changes.length;
}

/**
 * DEACTIVATION HOOK POINT (integration). When an employee is separated
 * (`changeEmploymentStatus(… 'separated' …)`) or a staff row is set `inactive`
 * (organisation.ts → updateStaff), `runDeactivationHook` runs inside the same
 * transaction. It always writes an `employee.deactivated` audit row saying
 * whether access revocation is wired; registered handlers (e.g. the lifecycle
 * slice's separation publisher / session revocation) run after it. With no
 * handler registered the audit row records `accessRevocation: 'not_wired'`, so
 * a skipped revocation is visible, never silent.
 */
export interface DeactivationEvent {
  staffId: StaffMemberId;
  source: 'employment_separated' | 'staff_inactive';
  effectiveOn: string;
  requestId?: string;
}
export type DeactivationHandler = (
  tx: Database,
  actor: Actor,
  event: DeactivationEvent,
) => Promise<void>;

const deactivationHandlers: DeactivationHandler[] = [];

/** Register a handler (idempotent per function). Returns an unregister function. */
export function registerDeactivationHandler(handler: DeactivationHandler): () => void {
  if (!deactivationHandlers.includes(handler)) deactivationHandlers.push(handler);
  return () => {
    const i = deactivationHandlers.indexOf(handler);
    if (i >= 0) deactivationHandlers.splice(i, 1);
  };
}

export async function runDeactivationHook(
  tx: Database,
  actor: Actor,
  event: DeactivationEvent,
): Promise<{ handlers: number }> {
  await recordAudit(tx, {
    actorUserId: actor.id,
    module: 'ops',
    action: 'employee.deactivated',
    entityType: 'employee',
    entityId: event.staffId,
    metadata: {
      source: event.source,
      effectiveOn: event.effectiveOn,
      accessRevocation: deactivationHandlers.length ? 'handled' : 'not_wired',
    },
    requestId: event.requestId,
  });
  for (const handler of deactivationHandlers) await handler(tx, actor, event);
  return { handlers: deactivationHandlers.length };
}

export async function insertEmployee(
  tx: Database,
  actor: Actor,
  input: NewEmployeeInput,
  requestId?: string,
): Promise<{ staffId: StaffMemberId; employeeCode: string }> {
  const fullName = input.fullName.trim();
  if (!fullName) throw invalidField('fullName', 'Name is required.');
  const workEmail = normaliseWorkEmail(input.workEmail);
  const workPhone = normaliseWorkPhoneOrThrow(input.workPhone);
  const timezone = assertTimeZone(input.timezone);
  await assertWorkEmailFree(tx, workEmail);
  await assertDepartmentUsable(tx, input.departmentId);
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

  const employmentType = input.employmentType ?? 'not_recorded';
  await tx.insert(opsStaffProfiles).values({
    staffId: staff.id,
    employmentType,
    updatedBy: actor.id,
  });

  return createRecordRow(tx, actor, {
    staff,
    employmentType,
    legalName: input.legalName,
    workEmail,
    workPhone,
    workLocation: input.workLocation,
    timezone,
    employmentStatus: input.employmentStatus ?? 'onboarding',
    employmentStartDate: input.employmentStartDate ?? null,
    action: 'employee.created',
    requestId,
  });
}

/**
 * Give an EXISTING staff member (e.g. a seed or wave-2 staff row) an employee
 * record. Refused when the staff member already has one. Caller checks permission.
 */
export async function registerExistingStaff(
  tx: Database,
  actor: Actor,
  staffId: StaffMemberId,
  input: Omit<NewEmployeeInput, 'fullName' | 'departmentId' | 'title' | 'managerId' | 'userId'>,
  requestId?: string,
): Promise<{ staffId: StaffMemberId; employeeCode: string }> {
  const [staff] = await tx
    .select()
    .from(staffMembers)
    .where(eq(staffMembers.id, staffId))
    .for('update');
  if (!staff) throw new NotFoundError('Staff member not found.');
  const [existing] = await tx
    .select({ code: opsEmployeeRecords.employeeCode })
    .from(opsEmployeeRecords)
    .where(eq(opsEmployeeRecords.staffId, staffId));
  if (existing) throw new ConflictError(`This staff member already is employee ${existing.code}.`);
  const workEmail = normaliseWorkEmail(input.workEmail);
  const workPhone = normaliseWorkPhoneOrThrow(input.workPhone);
  const timezone = assertTimeZone(input.timezone);
  await assertWorkEmailFree(tx, workEmail);
  const [profile] = await tx
    .select({ employmentType: opsStaffProfiles.employmentType })
    .from(opsStaffProfiles)
    .where(eq(opsStaffProfiles.staffId, staffId));
  const employmentType = input.employmentType ?? profile?.employmentType ?? 'not_recorded';
  await tx
    .insert(opsStaffProfiles)
    .values({ staffId, employmentType, updatedBy: actor.id })
    .onConflictDoUpdate({
      target: opsStaffProfiles.staffId,
      set: { employmentType, updatedBy: actor.id },
    });
  return createRecordRow(tx, actor, {
    staff,
    employmentType,
    legalName: input.legalName,
    workEmail,
    workPhone,
    workLocation: input.workLocation,
    timezone,
    employmentStatus: input.employmentStatus ?? 'active',
    employmentStartDate: input.employmentStartDate ?? null,
    action: 'employee.registered',
    requestId,
  });
}

async function createRecordRow(
  tx: Database,
  actor: Actor,
  input: {
    staff: typeof staffMembers.$inferSelect;
    employmentType: EmploymentType;
    legalName?: string | null;
    workEmail: string | null;
    workPhone: string | null;
    workLocation?: string | null;
    timezone: string;
    employmentStatus: 'onboarding' | 'active';
    employmentStartDate: string | null;
    action: string;
    requestId?: string;
  },
): Promise<{ staffId: StaffMemberId; employeeCode: string }> {
  const { staff } = input;
  const employeeCode = await nextCode(tx, 'employee', 'ops.employee_records', 'employee_code');
  const [record] = await tx
    .insert(opsEmployeeRecords)
    .values({
      staffId: staff.id,
      employeeCode,
      legalName: input.legalName?.trim() || null,
      workEmail: input.workEmail,
      workPhone: input.workPhone,
      workLocation: input.workLocation?.trim() || null,
      timezone: input.timezone,
      employmentStatus: input.employmentStatus,
      employmentStartDate: input.employmentStartDate,
      createdBy: actor.id,
    })
    .returning();
  if (!record) throw new Error('employee record insert returned no row');

  await writeHistory(tx, {
    staffId: staff.id,
    changes: historyChanges(null, {
      departmentId: staff.departmentId,
      title: staff.title,
      managerId: staff.managerId,
      employmentType: input.employmentType,
      employmentStatus: record.employmentStatus,
    }),
    effectiveOn: record.employmentStartDate ?? istToday(new Date()),
    reason:
      input.action === 'employee.created'
        ? 'Employee record created'
        : 'Employee record registered',
    actorId: actor.id,
  });

  await recordAudit(tx, {
    actorUserId: actor.id,
    module: 'ops',
    action: input.action,
    entityType: 'employee',
    entityId: staff.id,
    // No private fields here; legal name and contacts stay out of the audit payload.
    after: {
      employeeCode,
      fullName: staff.fullName,
      departmentId: staff.departmentId,
      title: staff.title,
      managerId: staff.managerId,
      employmentType: input.employmentType,
      employmentStatus: record.employmentStatus,
      employmentStartDate: record.employmentStartDate,
    },
    requestId: input.requestId,
  });
  return { staffId: staff.id, employeeCode };
}

/**
 * Change an employee's employment status with the transition rules (A-HR-02),
 * history row and audit, inside the caller's transaction. Used by the HR edit
 * screen and by the onboarding/offboarding workflow once its approval is given.
 * Caller checks permission (and approvals). Separation sets the end date.
 */
export async function changeEmploymentStatus(
  tx: Database,
  actor: Actor,
  staffId: StaffMemberId,
  to: EmploymentStatus,
  context: { reason: string; effectiveOn?: string; endDate?: string | null },
  requestId?: string,
): Promise<typeof opsEmployeeRecords.$inferSelect> {
  const [before] = await tx
    .select()
    .from(opsEmployeeRecords)
    .where(eq(opsEmployeeRecords.staffId, staffId))
    .for('update');
  if (!before) throw new NotFoundError('Employee record not found.');
  const check = checkEmploymentStatusChange(before.employmentStatus, to, {
    reason: context.reason,
    endDate: context.endDate,
  });
  if (!check.ok) {
    if (check.code === 'ILLEGAL' || check.code === 'NO_CHANGE')
      throw new InvalidStateTransitionError(check.message);
    throw invalidField(
      check.code === 'REASON_REQUIRED' ? 'reason' : 'employmentEndDate',
      check.message,
    );
  }
  const effectiveOn = context.effectiveOn ?? istToday(new Date());
  const [after] = await tx
    .update(opsEmployeeRecords)
    .set({
      employmentStatus: to,
      ...(to === 'separated' ? { employmentEndDate: context.endDate ?? null } : {}),
      ...(before.employmentStatus === 'on_notice' && to === 'active'
        ? { employmentEndDate: null }
        : {}),
    })
    .where(eq(opsEmployeeRecords.staffId, staffId))
    .returning();
  if (!after) throw new Error('employee record update returned no row');
  await writeHistory(tx, {
    staffId,
    changes: [{ field: 'employment_status', fromValue: before.employmentStatus, toValue: to }],
    effectiveOn,
    reason: context.reason,
    actorId: actor.id,
  });
  await recordAudit(tx, {
    actorUserId: actor.id,
    module: 'ops',
    action: 'employee.status_changed',
    entityType: 'employee',
    entityId: staffId,
    before: { employmentStatus: before.employmentStatus },
    after: {
      employmentStatus: to,
      employmentEndDate: after.employmentEndDate,
      effectiveOn,
    },
    requestId,
  });
  if (to === 'separated')
    await runDeactivationHook(tx, actor, {
      staffId,
      source: 'employment_separated',
      effectiveOn,
      requestId,
    });
  return after;
}
