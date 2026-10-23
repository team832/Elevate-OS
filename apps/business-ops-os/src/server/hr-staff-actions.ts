/**
 * HR staff changes (ops:staff:manage; private details ops:staff_private:manage), each in one
 * transaction with an audit row. Department and manager changes keep the CURRENT value on
 * core.staff_members and the dated history in ops.staff_departments / staff_manager_history
 * (first change also records the previous value, since history was not backfilled). Ending
 * employment exits the profile, makes the staff record inactive and disables the login with
 * its sessions; tasks, attendance, logs and reviews stay as they were.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { loadRoles, revokeAllSessionsForUser } from '@elevate/authentication';
import {
  branches,
  departments,
  opsStaffDepartments,
  opsStaffManagerHistory,
  opsStaffPrivateDetails,
  opsStaffProfiles,
  opsWorkSchedules,
  staffMembers,
  users,
  type CoreBranchId,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ROLES } from '@elevate/authorization';
import { ConflictError, ForbiddenError } from '@elevate/shared-contracts';
import type { DepartmentId, RoleKey, StaffMemberId, UserId } from '@elevate/shared-types';
import type { z } from 'zod';
import { istToday } from '../domain';
import { accessScope, type Actor } from './context';
import type {
  departmentChangeBody,
  endEmploymentBody,
  hrProfileBody,
  managerChangeBody,
  privateDetailsBody,
} from './hr-schemas';
import { scopedStaff } from './hr-staff';
import { fieldError, opsAudit, rowById } from './ops-common';
import { assertManager } from './organisation';

const audit = opsAudit('staff_member');

/** Roles HR manages (fix-round ruling, 23 Oct 2026); staff with no login qualify too. */
const HR_REMIT: readonly RoleKey[] = [
  'teacher',
  'academic_coordinator',
  'marketing_manager',
  'marketing_contributor',
  'admissions_counsellor',
  'finance_officer',
];

/** Targets nobody in Ops changes here: leadership and platform administration (owner, platform). */
const NEVER: readonly RoleKey[] = ['director', 'platform_admin'];

/**
 * Whom the actor may change, decided by where the right to change staff comes from: an
 * operations manager anyone but directors and platform administrators; every other holder
 * (HR managers, also with auditor or director) only the HR_REMIT roles. Never yourself. Those
 * outside leave through the platform's user screen.
 */
export async function assertRemit(
  tx: Database,
  actor: Actor,
  staff: { userId: UserId | null; fullName: string },
) {
  if (staff.userId === actor.id)
    throw new ForbiddenError('You cannot change your own staff record. Ask another manager.');
  const roles = staff.userId ? await loadRoles(tx, staff.userId) : [];
  const outside = actor.roles.includes('operations_manager')
    ? roles.filter((r) => NEVER.includes(r))
    : roles.filter((r) => !HR_REMIT.includes(r));
  if (outside.length)
    throw new ForbiddenError(
      `${staff.fullName} holds ${outside.map((r) => ROLES[r].label).join(', ')}, which you cannot change here. Ask the owner or a platform administrator.`,
    );
}

/** The staff row an HR change may touch (locked): in the actor's reach and remit. */
async function staffInRemit(tx: Database, actor: Actor, id: string) {
  const staff = await scopedStaff(tx, actor, id, true);
  await assertRemit(tx, actor, staff);
  return staff;
}

async function profileOf(tx: Database, staffId: StaffMemberId) {
  const [p] = await tx.select().from(opsStaffProfiles).where(eq(opsStaffProfiles.staffId, staffId));
  return p ?? null;
}

const upsertProfile = (
  tx: Database,
  staffId: StaffMemberId,
  values: Partial<typeof opsStaffProfiles.$inferInsert>,
) =>
  tx
    .insert(opsStaffProfiles)
    .values({ staffId, ...values })
    .onConflictDoUpdate({ target: opsStaffProfiles.staffId, set: values })
    .returning();

/** A history row can only close on or after the day it opened. */
function assertAfter(opened: string | null | undefined, from: string) {
  if (opened && from < opened)
    throw fieldError('fromDate', `Must be on or after ${opened}, when the current entry started.`);
}

export async function updateHrProfile(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof hrProfileBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:staff:manage');
  return withTransaction(db, async (tx) => {
    const staff = await staffInRemit(tx, actor, id);
    const before = await profileOf(tx, staff.id);
    if (before?.employmentStatus === 'exited' && input.employmentStatus)
      throw new ConflictError('Employment has ended; the status cannot be changed here.');
    const { title, ...fields } = input;
    // Only the fields this edit touched (never internal notes).
    const changedOf = (row: Record<string, unknown>) =>
      Object.fromEntries(Object.keys(input).map((k) => [k, row[k] ?? null]));
    const merged = {
      employmentStatus: before?.employmentStatus ?? 'not_recorded',
      joinedOn: before?.joinedOn ?? null,
      leftOn: before?.leftOn ?? null,
      ...fields,
    };
    if (merged.employmentStatus === 'exited' && !merged.leftOn)
      throw fieldError('leftOn', 'Employment has ended; the last working day stays recorded.');
    if (merged.leftOn && !['on_notice', 'exited'].includes(merged.employmentStatus))
      throw fieldError('leftOn', 'A last working day is recorded only once notice is given.');
    if (merged.leftOn && merged.joinedOn && merged.leftOn < merged.joinedOn)
      throw fieldError('leftOn', 'The last working day cannot be before the joining date.');
    if (fields.staffCode) {
      const [taken] = await tx
        .select({ id: opsStaffProfiles.staffId })
        .from(opsStaffProfiles)
        .where(
          and(
            eq(opsStaffProfiles.staffCode, fields.staffCode),
            sql`${opsStaffProfiles.staffId} <> ${staff.id}`,
          ),
        );
      if (taken)
        throw fieldError('staffCode', `Employee ID ${fields.staffCode} is already in use.`);
    }
    if (fields.branchId) await rowById(tx, branches, fields.branchId, 'Branch');
    if (fields.workScheduleId)
      await rowById(tx, opsWorkSchedules, fields.workScheduleId, 'Schedule');
    if (title !== undefined)
      await tx.update(staffMembers).set({ title }).where(eq(staffMembers.id, staff.id));
    const [after] = await upsertProfile(tx, staff.id, {
      ...fields,
      branchId: fields.branchId as CoreBranchId | null | undefined,
      updatedBy: actor.id,
    });
    await audit(
      tx,
      actor,
      staff.id,
      'staff.profile_updated',
      {
        before: changedOf({ ...before, title: staff.title }),
        after: changedOf({ ...after, title: title ?? staff.title }),
        metadata: { fields: Object.keys(input) },
      },
      requestId,
    );
    return after;
  });
}

export async function changeDepartment(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof departmentChangeBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:staff:manage');
  return withTransaction(db, async (tx) => {
    const staff = await staffInRemit(tx, actor, id);
    const dept = await rowById(tx, departments, input.departmentId, 'Department');
    if (dept.status === 'archived') throw fieldError('departmentId', `${dept.name} is archived.`);
    const from = input.fromDate ?? istToday(new Date());
    const current = await tx
      .select()
      .from(opsStaffDepartments)
      .where(and(eq(opsStaffDepartments.staffId, staff.id), isNull(opsStaffDepartments.toDate)));
    const row = current.find((r) => r.departmentId === dept.id);
    const close = async (r: (typeof current)[number]) => {
      assertAfter(r.fromDate, from);
      await tx
        .update(opsStaffDepartments)
        .set({ toDate: from })
        .where(eq(opsStaffDepartments.id, r.id));
    };
    const open = (
      departmentId: DepartmentId,
      isPrimary: boolean,
      fromDate: string | null,
      toDate: string | null = null,
    ) =>
      tx.insert(opsStaffDepartments).values({
        staffId: staff.id,
        departmentId,
        isPrimary,
        fromDate,
        toDate,
        createdBy: actor.id,
      });
    if (input.kind === 'primary') {
      if (staff.departmentId === dept.id) throw new ConflictError(`Already in ${dept.name}.`);
      const primary = current.find((r) => r.isPrimary);
      if (primary) await close(primary);
      // First recorded change: keep the previous primary department as history.
      else if (staff.departmentId) await open(staff.departmentId, true, null, from);
      if (row && !row.isPrimary) await close(row);
      await open(dept.id, true, from);
      await tx
        .update(staffMembers)
        .set({ departmentId: dept.id })
        .where(eq(staffMembers.id, staff.id));
    } else if (input.kind === 'additional') {
      if (staff.departmentId === dept.id || row)
        throw new ConflictError(`Already in ${dept.name}.`);
      await open(dept.id, false, from);
    } else {
      if (!row || row.isPrimary)
        throw fieldError(
          'departmentId',
          `${dept.name} is not an additional department. Change the main department instead.`,
        );
      await close(row);
    }
    await audit(
      tx,
      actor,
      staff.id,
      'staff.department_changed',
      {
        before: { departmentId: staff.departmentId },
        after: { departmentId: input.kind === 'primary' ? dept.id : staff.departmentId },
        metadata: { kind: input.kind, departmentId: dept.id, fromDate: from },
      },
      requestId,
    );
    return { staffId: staff.id, kind: input.kind, departmentId: dept.id, fromDate: from };
  });
}

export async function changeManager(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof managerChangeBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:staff:manage');
  return withTransaction(db, async (tx) => {
    const staff = await staffInRemit(tx, actor, id);
    if ((staff.managerId ?? null) === input.managerId)
      throw new ConflictError('That is already the current manager.');
    if (input.managerId) await scopedStaff(tx, actor, input.managerId);
    await assertManager(tx, staff.id, input.managerId);
    const from = input.fromDate ?? istToday(new Date());
    const [openRow] = await tx
      .select()
      .from(opsStaffManagerHistory)
      .where(
        and(eq(opsStaffManagerHistory.staffId, staff.id), isNull(opsStaffManagerHistory.toDate)),
      );
    if (openRow) {
      assertAfter(openRow.fromDate, from);
      await tx
        .update(opsStaffManagerHistory)
        .set({ toDate: from })
        .where(eq(opsStaffManagerHistory.id, openRow.id));
    } else if (staff.managerId)
      await tx.insert(opsStaffManagerHistory).values({
        staffId: staff.id,
        managerStaffId: staff.managerId,
        toDate: from,
        changedBy: actor.id,
        reason: 'Manager before the first recorded change',
      });
    const managerId = input.managerId as StaffMemberId | null;
    await tx.insert(opsStaffManagerHistory).values({
      staffId: staff.id,
      managerStaffId: managerId,
      fromDate: from,
      changedBy: actor.id,
      reason: input.reason ?? null,
    });
    await tx.update(staffMembers).set({ managerId }).where(eq(staffMembers.id, staff.id));
    await audit(
      tx,
      actor,
      staff.id,
      'staff.manager_changed',
      {
        before: { managerId: staff.managerId },
        after: { managerId },
        metadata: { fromDate: from, reason: input.reason ?? null },
      },
      requestId,
    );
    return { staffId: staff.id, managerId, fromDate: from };
  });
}

/**
 * End employment in ONE transaction: profile exited + last working day, staff record inactive,
 * login disabled and its sessions revoked (same steps as the platform's disable, D-072).
 */
export async function endEmployment(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof endEmploymentBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:staff:manage');
  return withTransaction(db, async (tx) => {
    const staff = await staffInRemit(tx, actor, id);
    const before = await profileOf(tx, staff.id);
    if (before?.employmentStatus === 'exited')
      throw new ConflictError(`Employment already ended on ${before.leftOn}.`);
    if (before?.joinedOn && input.leftOn < before.joinedOn)
      throw fieldError('leftOn', 'The last working day cannot be before the joining date.');
    const [after] = await upsertProfile(tx, staff.id, {
      employmentStatus: 'exited',
      leftOn: input.leftOn,
      updatedBy: actor.id,
    });
    await tx.update(staffMembers).set({ status: 'inactive' }).where(eq(staffMembers.id, staff.id));
    let sessionsRevoked = 0;
    if (staff.userId) {
      await tx.update(users).set({ status: 'disabled' }).where(eq(users.id, staff.userId));
      sessionsRevoked = await revokeAllSessionsForUser(tx, staff.userId);
      await opsAudit('user')(
        tx,
        actor,
        staff.userId,
        'user.disabled',
        { metadata: { reason: 'employment ended', staffId: staff.id, sessionsRevoked } },
        requestId,
      );
    }
    await audit(
      tx,
      actor,
      staff.id,
      'staff.employment_ended',
      {
        before: {
          employmentStatus: before?.employmentStatus ?? 'not_recorded',
          status: staff.status,
        },
        after: { employmentStatus: 'exited', leftOn: input.leftOn, status: 'inactive' },
        metadata: { reason: input.reason, userDisabled: Boolean(staff.userId), sessionsRevoked },
      },
      requestId,
    );
    return { profile: after, userDisabled: Boolean(staff.userId), sessionsRevoked };
  });
}

/** HR-private details; the audit names the fields changed, never their values. */
export async function updatePrivateDetails(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof privateDetailsBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:staff_private:manage');
  return withTransaction(db, async (tx) => {
    const staff = await staffInRemit(tx, actor, id);
    const values = { ...input, updatedBy: actor.id };
    const [row] = await tx
      .insert(opsStaffPrivateDetails)
      .values({ staffId: staff.id, ...values })
      .onConflictDoUpdate({ target: opsStaffPrivateDetails.staffId, set: values })
      .returning();
    await audit(
      tx,
      actor,
      staff.id,
      'staff.private_details_updated',
      { metadata: { fields: Object.keys(input) } },
      requestId,
    );
    return row;
  });
}
