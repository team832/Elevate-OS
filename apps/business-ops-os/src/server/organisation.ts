/**
 * Staff directory (OPS-014, PLT-016). Business Ops is the steward of
 * core.departments and core.staff_members: these are the only writers.
 * Out of scope (D-015, OD-026): payroll, biometrics, leave, appraisal, HRIS.
 */
import { and, asc, count, eq, exists, ilike, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  branches,
  departments,
  opsStaffDepartments,
  opsStaffManagerHistory,
  opsStaffProfiles,
  staffMembers,
  userRoles,
  users,
  type CoreBranchId,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, ValidationError } from '@elevate/shared-contracts';
import type { DepartmentId, StaffMemberId, UserId } from '@elevate/shared-types';
import type { z } from 'zod';
import { checkReportingLine, istToday } from '../domain';
import { accessScope, activeStaff, type Actor } from './context';
import { directoryQuery } from './hr-schemas';
import { assertRemit } from './hr-staff-actions';
import { defined, opsAudit, rowById } from './ops-common';
import { hrReachWhere, hrScopeFor, hrScopeWhere, inDepartments } from './hr-scope';
import type {
  createDepartmentBody,
  createStaffBody,
  updateDepartmentBody,
  updateStaffBody,
} from './schemas';

export {
  hrReachWhere,
  hrScopeDepartments,
  hrScopeFor,
  hrScopeWhere,
  inDepartments,
  isHrScoped,
} from './hr-scope';

const auditStaff = opsAudit('staff_member');
const auditDepartment = opsAudit('department');

const managers = alias(staffMembers, 'managers');
const PAGE_SIZE = 25;

/**
 * Staff directory, filtered and paginated on the server (25 a page). `hr` = the HR view
 * (ops:hr:read, limited to HR's department scope); otherwise the organisation view
 * (ops:organisation:read, everyone). Filters only narrow; none of them grants access.
 */
export async function getDirectory(
  db: Database,
  actor: Actor,
  query: Record<string, unknown> = {},
  view: 'organisation' | 'hr' = 'organisation',
) {
  await accessScope(db, actor, view === 'hr' ? 'ops:hr:read' : 'ops:organisation:read');
  // A GET filter form sends empty fields; they mean "any".
  const f = directoryQuery.parse(Object.fromEntries(Object.entries(query).filter(([, v]) => v)));
  const scope = view === 'hr' ? await hrScopeFor(db, actor) : null;
  const q = f.q ? `%${f.q.replace(/[\\%_]/g, '\\$&')}%` : null;
  const where = and(
    hrReachWhere(actor, scope),
    q
      ? or(
          ilike(staffMembers.fullName, q),
          ilike(opsStaffProfiles.displayName, q),
          ilike(opsStaffProfiles.staffCode, q),
        )
      : undefined,
    f.department ? inDepartments([f.department as DepartmentId]) : undefined,
    f.manager ? eq(staffMembers.managerId, f.manager as StaffMemberId) : undefined,
    f.branch ? eq(opsStaffProfiles.branchId, f.branch as CoreBranchId) : undefined,
    f.role
      ? exists(
          db
            .select({ x: sql`1` })
            .from(userRoles)
            .where(and(eq(userRoles.userId, staffMembers.userId), eq(userRoles.role, f.role))),
        )
      : undefined,
    f.employment
      ? sql`coalesce(${opsStaffProfiles.employmentStatus}, 'not_recorded') = ${f.employment}`
      : undefined,
    f.status ? eq(staffMembers.status, f.status) : undefined,
  );
  const base = () =>
    db
      .select({
        s: staffMembers,
        p: opsStaffProfiles,
        departmentName: departments.name,
        managerName: managers.fullName,
        branchName: branches.name,
      })
      .from(staffMembers)
      .leftJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
      .leftJoin(departments, eq(departments.id, staffMembers.departmentId))
      .leftJoin(managers, eq(managers.id, staffMembers.managerId))
      .leftJoin(branches, eq(branches.id, opsStaffProfiles.branchId));
  const [rows, [counted], depts, heads, branchRows, managerRows] = await Promise.all([
    base()
      .where(where)
      .orderBy(asc(staffMembers.fullName), asc(staffMembers.id))
      .limit(PAGE_SIZE)
      .offset((f.page - 1) * PAGE_SIZE),
    db
      .select({ n: count() })
      .from(staffMembers)
      .leftJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
      .where(where),
    db
      .select()
      .from(departments)
      .where(scope ? inArray(departments.id, scope) : undefined)
      .orderBy(asc(departments.name)),
    db
      .select({ id: staffMembers.departmentId, n: count() })
      .from(staffMembers)
      .where(sql`${staffMembers.status} <> 'inactive'`)
      .groupBy(staffMembers.departmentId),
    db.select().from(branches).orderBy(asc(branches.name)),
    db
      .selectDistinct({ id: managers.id, fullName: managers.fullName })
      .from(staffMembers)
      .innerJoin(managers, eq(managers.id, staffMembers.managerId))
      .where(
        scope
          ? inArray(
              managers.id,
              db.select({ id: staffMembers.id }).from(staffMembers).where(hrScopeWhere(scope)),
            )
          : undefined,
      )
      .orderBy(asc(managers.fullName)),
  ]);
  const userIds = rows.map((r) => r.s.userId).filter((u): u is UserId => Boolean(u));
  const roles = userIds.length
    ? await db.select().from(userRoles).where(inArray(userRoles.userId, userIds))
    : [];
  return {
    page: f.page,
    pageSize: PAGE_SIZE,
    total: counted?.n ?? 0,
    /** Department scope applied (HR view); null = none. */
    scope,
    departments: depts.map((d) => ({
      ...d,
      headcount: heads.find((h) => h.id === d.id)?.n ?? 0,
    })),
    branches: branchRows,
    managers: managerRows,
    staff: rows.map(({ s, p, departmentName, managerName, branchName }) => ({
      ...s,
      displayName: p?.displayName ?? s.fullName,
      staffCode: p?.staffCode ?? null,
      departmentName,
      managerName,
      branchName,
      hasLogin: Boolean(s.userId),
      employmentType: p?.employmentType ?? 'not_recorded',
      employmentStatus: p?.employmentStatus ?? 'not_recorded',
      roleLabels: p?.roleLabels ?? [],
      roles: roles.filter((r) => r.userId === s.userId).map((r) => r.role),
    })),
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
    // History starts with the record; later changes go through HR (hr-staff-actions.ts).
    const fromDate = istToday(new Date());
    if (row.departmentId)
      await tx.insert(opsStaffDepartments).values({
        staffId: row.id,
        departmentId: row.departmentId,
        isPrimary: true,
        fromDate,
        createdBy: actor.id,
      });
    if (row.managerId)
      await tx.insert(opsStaffManagerHistory).values({
        staffId: row.id,
        managerStaffId: row.managerId,
        fromDate,
        changedBy: actor.id,
      });
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
    if ('userId' in input) await assertUserFree(tx, input.userId, before.id);
    // Re-hiring is not supported: an exited person's record stays inactive.
    if (input.status) {
      await assertRemit(tx, actor, before);
      const [p] = await tx
        .select({ employmentStatus: opsStaffProfiles.employmentStatus })
        .from(opsStaffProfiles)
        .where(eq(opsStaffProfiles.staffId, before.id));
      if (p?.employmentStatus === 'exited')
        throw new ConflictError('Employment has ended; the record status cannot be changed.');
    }
    const patch: Partial<typeof staffMembers.$inferInsert> = {};
    if (input.fullName) patch.fullName = input.fullName;
    if ('title' in input) patch.title = input.title ?? null;
    if ('userId' in input) patch.userId = (input.userId as UserId | null) ?? null;
    if (input.status) patch.status = input.status;
    const [after] = Object.keys(patch).length
      ? await tx.update(staffMembers).set(patch).where(eq(staffMembers.id, before.id)).returning()
      : [before];
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

export async function getStaffDetail(db: Database, actor: Actor, id: string) {
  await accessScope(db, actor, 'ops:organisation:read');
  const staff = await staffRow(db, id);
  const [profile] = await db
    .select()
    .from(opsStaffProfiles)
    .where(eq(opsStaffProfiles.staffId, staff.id));
  const reports = await db
    .select({ id: staffMembers.id, fullName: staffMembers.fullName })
    .from(staffMembers)
    .where(eq(staffMembers.managerId, staff.id));
  const manager = staff.managerId ? await staffRow(db, staff.managerId) : null;
  const [dept] = staff.departmentId
    ? await db.select().from(departments).where(eq(departments.id, staff.departmentId))
    : [];
  return {
    staff,
    profile: profile ?? null,
    reports,
    manager: manager ? { id: manager.id, fullName: manager.fullName } : null,
    department: dept ?? null,
  };
}
