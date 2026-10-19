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
import { recordAudit, withTransaction } from '@elevate/server-kit';
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
import { accessScope, activeStaff, nextCode, notFound, type Actor } from './context';
import { runDeactivationHook, writeHistory } from './hr/employee-core';
import type {
  createDepartmentBody,
  createStaffBody,
  onboardingItemBody,
  responsibilityBody,
  updateDepartmentBody,
  updateResponsibilityBody,
  updateStaffBody,
} from './schemas';

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
  const gaps = responsibilityGaps(
    responsibilities.map((r) => ({ ...r, status: r.status })),
    (id) => byId.get(id)?.status === 'active',
  );
  return {
    departments: depts.map((d) => ({
      ...d,
      headcount: staff.filter((s) => s.departmentId === d.id && s.status !== 'inactive').length,
    })),
    staff: staff.map((s) => ({
      ...s,
      departmentName: s.departmentId ? (deptName.get(s.departmentId) ?? null) : null,
      managerName: name(s.managerId),
      hasLogin: Boolean(s.userId),
      employmentType: profile.get(s.id)?.employmentType ?? 'not_recorded',
      roleLabels: profile.get(s.id)?.roleLabels ?? [],
    })),
    responsibilities: responsibilities.map((r) => ({
      ...r,
      departmentName: r.departmentId ? (deptName.get(r.departmentId) ?? null) : null,
      holderName: name(r.holderStaffId),
      backupName: name(r.backupStaffId),
    })),
    gaps: gaps.map((g) => ({ ...g, labels: g.gaps.map((k) => RESPONSIBILITY_GAP_LABELS[k]) })),
  };
}

async function staffRow(db: Database, id: string) {
  const [row] = await db
    .select()
    .from(staffMembers)
    .where(eq(staffMembers.id, id as StaffMemberId))
    .limit(1);
  if (!row) notFound('Staff member');
  return row;
}

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
    await tx.insert(opsStaffProfiles).values({
      staffId: row.id,
      employmentType: input.employmentType,
      roleLabels: input.roleLabels,
      updatedBy: actor.id,
    });
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'staff.created',
      entityType: 'staff_member',
      entityId: row.id,
      after: { ...row, employmentType: input.employmentType, roleLabels: input.roleLabels },
      requestId,
    });
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
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'staff.updated',
      entityType: 'staff_member',
      entityId: before.id,
      before,
      after: { ...after, ...input },
      requestId,
    });
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
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'department.created',
      entityType: 'department',
      entityId: row?.id ?? null,
      after: row,
      requestId,
    });
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
    const [before] = await tx
      .select()
      .from(departments)
      .where(eq(departments.id, id as DepartmentId));
    if (!before) notFound('Department');
    if (input.status === 'archived') {
      const [member] = await tx
        .select({ id: staffMembers.id })
        .from(staffMembers)
        .where(eq(staffMembers.departmentId, before.id))
        .limit(1);
      if (member) throw new ConflictError('Move the department’s staff before archiving it.');
    }
    const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const [after] = await tx
      .update(departments)
      .set(patch)
      .where(eq(departments.id, before.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'department.updated',
      entityType: 'department',
      entityId: before.id,
      before,
      after,
      requestId,
    });
    return after;
  });
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
  for (const f of ['holderStaffId', 'backupStaffId'] as const)
    if (input[f]) await activeStaff(db, input[f] as string, f);
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
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'responsibility.created',
      entityType: 'responsibility',
      entityId: row?.id ?? null,
      after: row,
      requestId,
    });
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
  for (const f of ['holderStaffId', 'backupStaffId'] as const)
    if (input[f]) await activeStaff(db, input[f] as string, f);
  return withTransaction(db, async (tx) => {
    const [before] = await tx
      .select()
      .from(opsResponsibilities)
      .where(eq(opsResponsibilities.id, id as typeof opsResponsibilities.$inferSelect.id))
      .for('update');
    if (!before) notFound('Responsibility');
    assertHolderBackup(
      'holderStaffId' in input ? input.holderStaffId : before.holderStaffId,
      'backupStaffId' in input ? input.backupStaffId : before.backupStaffId,
    );
    const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const [after] = await tx
      .update(opsResponsibilities)
      .set(patch)
      .where(eq(opsResponsibilities.id, before.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'responsibility.updated',
      entityType: 'responsibility',
      entityId: before.id,
      before,
      after,
      requestId,
    });
    return after;
  });
}

export async function getStaffDetail(db: Database, actor: Actor, id: string) {
  await accessScope(db, actor, 'ops:organisation:read');
  const staff = await staffRow(db, id);
  const [profile] = await db
    .select()
    .from(opsStaffProfiles)
    .where(eq(opsStaffProfiles.staffId, staff.id));
  const onboarding = await db
    .select()
    .from(opsOnboardingItems)
    .where(eq(opsOnboardingItems.staffId, staff.id))
    .orderBy(asc(opsOnboardingItems.seq));
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
    let seq = 0;
    for (const title of DEFAULT_ONBOARDING_ITEMS) {
      seq += 1;
      await tx
        .insert(opsOnboardingItems)
        .values({ staffId: staff.id, seq, title })
        .onConflictDoNothing();
    }
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'staff.onboarding_started',
      entityType: 'staff_member',
      entityId: staff.id,
      requestId,
    });
    return tx
      .select()
      .from(opsOnboardingItems)
      .where(eq(opsOnboardingItems.staffId, staff.id))
      .orderBy(asc(opsOnboardingItems.seq));
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
    const [before] = await tx
      .select()
      .from(opsOnboardingItems)
      .where(eq(opsOnboardingItems.id, itemId as typeof opsOnboardingItems.$inferSelect.id))
      .for('update');
    if (!before) notFound('Onboarding item');
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
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'staff.onboarding_item_updated',
      entityType: 'staff_member',
      entityId: before.staffId,
      before,
      after,
      requestId,
    });
    return after;
  });
}

/** Active staff for pickers. */
export async function staffOptions(db: Database) {
  return db
    .select({
      id: staffMembers.id,
      fullName: staffMembers.fullName,
      departmentId: staffMembers.departmentId,
    })
    .from(staffMembers)
    .where(eq(staffMembers.status, 'active'))
    .orderBy(asc(staffMembers.fullName));
}
