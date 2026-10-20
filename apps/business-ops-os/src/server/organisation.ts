/**
 * Staff directory (OPS-014, OPS-015, PLT-016). Business Ops is the steward of
 * core.departments and core.staff_members: these are the only writers.
 * Out of scope (D-015, OD-026): payroll, biometrics, leave, appraisal, HRIS.
 */
import { asc, eq } from 'drizzle-orm';
import {
  departments,
  opsEmployeeRecords,
  opsOnboardingItems,
  opsResponsibilities,
  opsStaffProfiles,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, ValidationError } from '@elevate/shared-contracts';
import type { DepartmentId, StaffMemberId, UserId } from '@elevate/shared-types';
import type { z } from 'zod';
import {
  checkReportingLine,
  DEFAULT_ONBOARDING_ITEMS,
  responsibilityGaps,
  RESPONSIBILITY_GAP_LABELS,
} from '../domain';
import { istToday } from '../domain/dates';
import { historyChanges } from '../domain/hr/employees';
import { accessScope, activeStaff, nextCode, type Actor } from './context';
import { runDeactivationHook, writeHistory } from './hr/employee-core';
import './hr/wiring';
import { defined, opsAudit, rowById } from './ops-common';
import type {
  createDepartmentBody,
  createStaffBody,
  onboardingItemBody,
  responsibilityBody,
  updateDepartmentBody,
  updateResponsibilityBody,
  updateStaffBody,
} from './schemas';

const auditStaff = opsAudit('staff_member');
const auditDepartment = opsAudit('department');
const auditResponsibility = opsAudit('responsibility');

export async function getDirectory(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:organisation:read');
  const [depts, staff, profiles, responsibilities] = await Promise.all([
    db.select().from(departments).orderBy(asc(departments.name)),
    db.select().from(staffMembers).orderBy(asc(staffMembers.fullName)),
    db.select().from(opsStaffProfiles),
    db.select().from(opsResponsibilities).orderBy(asc(opsResponsibilities.code)),
  ]);
  const byId = new Map(staff.map((s) => [s.id as string, s]));
  const deptName = new Map(depts.map((d) => [d.id as string, d.name]));
  const profile = new Map(profiles.map((p) => [p.staffId as string, p]));
  const name = (id: string | null) => (id ? (byId.get(id)?.fullName ?? null) : null);
  const dept = (id: string | null) => (id ? (deptName.get(id) ?? null) : null);
  const gaps = responsibilityGaps(responsibilities, (id) => byId.get(id)?.status === 'active');
  return {
    departments: depts.map((d) => ({
      ...d,
      headcount: staff.filter((s) => s.departmentId === d.id && s.status !== 'inactive').length,
    })),
    staff: staff.map((s) => ({
      ...s,
      departmentName: dept(s.departmentId),
      managerName: name(s.managerId),
      hasLogin: Boolean(s.userId),
      employmentType: profile.get(s.id)?.employmentType ?? 'not_recorded',
      roleLabels: profile.get(s.id)?.roleLabels ?? [],
    })),
    responsibilities: responsibilities.map((r) => ({
      ...r,
      departmentName: dept(r.departmentId),
      holderName: name(r.holderStaffId),
      backupName: name(r.backupStaffId),
    })),
    gaps: gaps.map((g) => ({ ...g, labels: g.gaps.map((k) => RESPONSIBILITY_GAP_LABELS[k]) })),
  };
}

const staffRow = (db: Database, id: string) => rowById(db, staffMembers, id, 'Staff member');

/** Manager must be active and the change must not create a reporting loop (A-10). */
export async function assertManager(
  tx: Database,
  staffId: string,
  managerId: string | null | undefined,
) {
  if (!managerId) return;
  await activeStaff(tx, managerId, 'managerId');
  const all = await tx
    .select({ id: staffMembers.id, managerId: staffMembers.managerId })
    .from(staffMembers);
  const map = new Map(all.map((s) => [s.id as string, s.managerId as string | null]));
  const check = checkReportingLine(staffId, managerId, (id) => map.get(id));
  if (!check.ok) throw new ConflictError(check.message, { details: { path: check.path ?? [] } });
}

async function assertUserFree(tx: Database, userId: string | null | undefined, staffId?: string) {
  if (!userId) return;
  const [u] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId as UserId));
  if (!u) throw new ValidationError('Unknown user account.');
  const [taken] = await tx
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(eq(staffMembers.userId, userId as UserId));
  if (taken && taken.id !== staffId)
    throw new ConflictError('That login is already linked to another staff member.');
}

export async function createStaff(
  db: Database,
  actor: Actor,
  input: z.output<typeof createStaffBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:organisation:manage');
  return withTransaction(db, async (tx) => {
    await assertUserFree(tx, input.userId);
    if (input.managerId) await activeStaff(tx, input.managerId, 'managerId');
    const [row] = await tx
      .insert(staffMembers)
      .values({
        fullName: input.fullName,
        departmentId: (input.departmentId as DepartmentId | null) ?? null,
        title: input.title ?? null,
        managerId: (input.managerId as StaffMemberId | null) ?? null,
        userId: (input.userId as UserId | null) ?? null,
      })
      .returning();
    if (!row) throw new Error('staff insert returned no row');
    const { employmentType, roleLabels } = input;
    await tx
      .insert(opsStaffProfiles)
      .values({ staffId: row.id, employmentType, roleLabels, updatedBy: actor.id });
    const after = { ...row, employmentType, roleLabels };
    await auditStaff(tx, actor, row.id, 'staff.created', { after }, requestId);
    return row;
  });
}

export async function updateStaff(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof updateStaffBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:organisation:manage');
  return withTransaction(db, async (tx) => {
    const before = await staffRow(tx, id);
    if ('managerId' in input) await assertManager(tx, before.id, input.managerId);
    if ('userId' in input) await assertUserFree(tx, input.userId, before.id);
    const patch: Partial<typeof staffMembers.$inferInsert> = {};
    if (input.fullName) patch.fullName = input.fullName;
    if ('departmentId' in input)
      patch.departmentId = (input.departmentId as DepartmentId | null) ?? null;
    if ('title' in input) patch.title = input.title ?? null;
    if ('managerId' in input) patch.managerId = (input.managerId as StaffMemberId | null) ?? null;
    if ('userId' in input) patch.userId = (input.userId as UserId | null) ?? null;
    if (input.status) patch.status = input.status;
    const [after] = Object.keys(patch).length
      ? await tx.update(staffMembers).set(patch).where(eq(staffMembers.id, before.id)).returning()
      : [before];
    const [profileBefore] = await tx
      .select({ employmentType: opsStaffProfiles.employmentType })
      .from(opsStaffProfiles)
      .where(eq(opsStaffProfiles.staffId, before.id));
    // Employment history (OPS-033): every tracked change, whichever screen made it.
    await writeHistory(tx, {
      staffId: before.id,
      changes: historyChanges(
        {
          departmentId: before.departmentId,
          title: before.title,
          managerId: before.managerId,
          employmentType: profileBefore?.employmentType ?? 'not_recorded',
          employmentStatus: null,
        },
        {
          ...('departmentId' in patch ? { departmentId: patch.departmentId ?? null } : {}),
          ...('title' in patch ? { title: patch.title ?? null } : {}),
          ...('managerId' in patch ? { managerId: patch.managerId ?? null } : {}),
          ...(input.employmentType ? { employmentType: input.employmentType } : {}),
        },
      ),
      effectiveOn: istToday(new Date()),
      reason: 'Changed from the staff directory',
      actorId: actor.id,
    });
    if (input.employmentType || input.roleLabels) {
      const values = {
        staffId: before.id,
        ...(input.employmentType ? { employmentType: input.employmentType } : {}),
        ...(input.roleLabels ? { roleLabels: input.roleLabels } : {}),
        updatedBy: actor.id,
      };
      await tx
        .insert(opsStaffProfiles)
        .values(values)
        .onConflictDoUpdate({ target: opsStaffProfiles.staffId, set: values });
    }
    if (input.status === 'inactive' && before.status !== 'inactive')
      await runDeactivationHook(tx, actor, {
        staffId: before.id,
        source: 'staff_inactive',
        effectiveOn: istToday(new Date()),
        requestId,
      });
    const audited = { before, after: { ...after, ...input } };
    await auditStaff(tx, actor, before.id, 'staff.updated', audited, requestId);
    return after;
  });
}

export async function createDepartment(
  db: Database,
  actor: Actor,
  input: z.output<typeof createDepartmentBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:organisation:manage');
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(departments)
      .values({
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        status: 'provisional',
      })
      .returning();
    await auditDepartment(
      tx,
      actor,
      row?.id ?? null,
      'department.created',
      { after: row },
      requestId,
    );
    return row;
  });
}

/** Confirming a department (`active`) records the owner's decision on D-026; it is audited. */
export async function updateDepartment(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof updateDepartmentBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:organisation:manage');
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, departments, id, 'Department');
    if (input.status === 'archived') {
      const [member] = await tx
        .select({ id: staffMembers.id })
        .from(staffMembers)
        .where(eq(staffMembers.departmentId, before.id))
        .limit(1);
      if (member) throw new ConflictError('Move the department’s staff before archiving it.');
    }
    const [after] = await tx
      .update(departments)
      .set(defined(input))
      .where(eq(departments.id, before.id))
      .returning();
    await auditDepartment(tx, actor, before.id, 'department.updated', { before, after }, requestId);
    return after;
  });
}

/** Holder and backup must be active staff and two different people. */
async function assertHolders(
  db: Database,
  input: { holderStaffId?: string | null; backupStaffId?: string | null },
) {
  for (const f of ['holderStaffId', 'backupStaffId'] as const)
    if (input[f]) await activeStaff(db, input[f], f);
}

function assertHolderBackup(holder: string | null | undefined, backup: string | null | undefined) {
  if (holder && backup && holder === backup)
    throw new ValidationError('The backup must be a different person from the holder.', {
      details: [{ location: 'body', path: ['backupStaffId'], message: 'Same as holder' }],
    });
}

export async function createResponsibility(
  db: Database,
  actor: Actor,
  input: z.output<typeof responsibilityBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:organisation:manage');
  assertHolderBackup(input.holderStaffId, input.backupStaffId);
  await assertHolders(db, input);
  return withTransaction(db, async (tx) => {
    const code = await nextCode(tx, 'responsibility', 'ops.responsibilities');
    const [row] = await tx
      .insert(opsResponsibilities)
      .values({
        code,
        title: input.title,
        description: input.description ?? null,
        departmentId: (input.departmentId as DepartmentId | null) ?? null,
        accountableRole: input.accountableRole ?? null,
        holderStaffId: (input.holderStaffId as StaffMemberId | null) ?? null,
        backupStaffId: (input.backupStaffId as StaffMemberId | null) ?? null,
        handOverToRole: input.handOverToRole ?? null,
        critical: input.critical,
        source: 'Elevate OS',
      })
      .returning();
    const id = row?.id ?? null;
    await auditResponsibility(tx, actor, id, 'responsibility.created', { after: row }, requestId);
    return row;
  });
}

export async function updateResponsibility(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof updateResponsibilityBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:organisation:manage');
  await assertHolders(db, input);
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, opsResponsibilities, id, 'Responsibility', true);
    assertHolderBackup(
      'holderStaffId' in input ? input.holderStaffId : before.holderStaffId,
      'backupStaffId' in input ? input.backupStaffId : before.backupStaffId,
    );
    const [after] = await tx
      .update(opsResponsibilities)
      .set(defined(input) as Partial<typeof opsResponsibilities.$inferInsert>)
      .where(eq(opsResponsibilities.id, before.id))
      .returning();
    const audited = { before, after };
    await auditResponsibility(tx, actor, before.id, 'responsibility.updated', audited, requestId);
    return after;
  });
}

const onboardingItems = (db: Database, staffId: StaffMemberId) =>
  db
    .select()
    .from(opsOnboardingItems)
    .where(eq(opsOnboardingItems.staffId, staffId))
    .orderBy(asc(opsOnboardingItems.seq));

export async function getStaffDetail(db: Database, actor: Actor, id: string) {
  await accessScope(db, actor, 'ops:organisation:read');
  const staff = await staffRow(db, id);
  const [profile] = await db
    .select()
    .from(opsStaffProfiles)
    .where(eq(opsStaffProfiles.staffId, staff.id));
  const onboarding = await onboardingItems(db, staff.id);
  const reports = await db
    .select({ id: staffMembers.id, fullName: staffMembers.fullName })
    .from(staffMembers)
    .where(eq(staffMembers.managerId, staff.id));
  const manager = staff.managerId ? await staffRow(db, staff.managerId) : null;
  const [dept] = staff.departmentId
    ? await db.select().from(departments).where(eq(departments.id, staff.departmentId))
    : [];
  const [employee] = await db
    .select({ employeeCode: opsEmployeeRecords.employeeCode })
    .from(opsEmployeeRecords)
    .where(eq(opsEmployeeRecords.staffId, staff.id));
  return {
    staff,
    /** EMP code when this staff member has an HR employee record (link to /ops/hr/employees/[id]). */
    employeeCode: employee?.employeeCode ?? null,
    profile: profile ?? null,
    onboarding,
    reports,
    manager: manager ? { id: manager.id, fullName: manager.fullName } : null,
    department: dept ?? null,
  };
}

/** Create the default onboarding checklist (document references only). Idempotent. */
export async function startOnboarding(
  db: Database,
  actor: Actor,
  staffId: string,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:organisation:manage');
  return withTransaction(db, async (tx) => {
    const staff = await staffRow(tx, staffId);
    for (const [i, title] of DEFAULT_ONBOARDING_ITEMS.entries())
      await tx
        .insert(opsOnboardingItems)
        .values({ staffId: staff.id, seq: i + 1, title })
        .onConflictDoNothing();
    await auditStaff(tx, actor, staff.id, 'staff.onboarding_started', {}, requestId);
    return onboardingItems(tx, staff.id);
  });
}

export async function updateOnboardingItem(
  db: Database,
  actor: Actor,
  itemId: string,
  input: z.output<typeof onboardingItemBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:organisation:manage');
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, opsOnboardingItems, itemId, 'Onboarding item', true);
    const done = input.status === 'done';
    const [after] = await tx
      .update(opsOnboardingItems)
      .set({
        status: input.status,
        documentRef: input.documentRef ?? before.documentRef,
        completedAt: done ? new Date() : null,
        completedBy: done ? actor.id : null,
      })
      .where(eq(opsOnboardingItems.id, before.id))
      .returning();
    const audited = { before, after };
    await auditStaff(
      tx,
      actor,
      before.staffId,
      'staff.onboarding_item_updated',
      audited,
      requestId,
    );
    return after;
  });
}
