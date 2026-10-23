/**
 * HR staff record (brief 23 Oct 2026 §3, §6; ruling R1): the employee profile over
 * core.staff_members + ops.staff_profiles, departments and reporting-line history, login and
 * workspaces (derived from stored roles, D-072), and the record's audit trail. Staff outside
 * HR's department scope are "not found". HR-private details are read only with
 * ops:staff_private:read and are otherwise absent from the result (not just hidden on screen).
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { can, workspacesFor } from '@elevate/authorization';
import {
  auditEvents,
  branches,
  departments,
  opsStaffDepartments,
  opsStaffManagerHistory,
  opsStaffPrivateDetails,
  opsStaffProfiles,
  opsStaffSubjectCapabilities,
  opsWorkSchedules,
  staffMembers,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import { NotFoundError } from '@elevate/shared-contracts';
import { MODULES, type StaffMemberId } from '@elevate/shared-types';
import { accessScope, type Actor } from './context';
import { formOptions } from './options';
import { hrReachWhere, hrScopeFor } from './organisation';

const managers = alias(staffMembers, 'managers');

/** A staff row inside HR's department scope, else 404 (never "forbidden": no existence leak). */
export async function scopedStaff(db: Database, actor: Actor, id: string, lock = false) {
  const scope = await hrScopeFor(db, actor);
  const q = db
    .select({ s: staffMembers })
    .from(staffMembers)
    .where(and(eq(staffMembers.id, id as StaffMemberId), hrReachWhere(actor, scope)))
    .limit(1);
  const [row] = lock ? await q.for('update') : await q;
  if (!row) throw new NotFoundError('Staff member not found.');
  return row.s;
}

export async function getHrStaff(db: Database, actor: Actor, id: string) {
  await accessScope(db, actor, 'ops:hr:read');
  const staff = await scopedStaff(db, actor, id);
  const seesPrivate = can(actor, 'ops:staff_private:read');
  const [[person], depts, managerHistory, login, roles, history, capabilities, privateRows] =
    await Promise.all([
      db
        .select({
          p: opsStaffProfiles,
          department: departments.name,
          manager: managers.fullName,
          branch: branches.name,
          schedule: opsWorkSchedules.name,
        })
        .from(staffMembers)
        .leftJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
        .leftJoin(departments, eq(departments.id, staffMembers.departmentId))
        .leftJoin(managers, eq(managers.id, staffMembers.managerId))
        .leftJoin(branches, eq(branches.id, opsStaffProfiles.branchId))
        .leftJoin(opsWorkSchedules, eq(opsWorkSchedules.id, opsStaffProfiles.workScheduleId))
        .where(eq(staffMembers.id, staff.id)),
      db
        .select({ d: opsStaffDepartments, name: departments.name })
        .from(opsStaffDepartments)
        .innerJoin(departments, eq(departments.id, opsStaffDepartments.departmentId))
        .where(eq(opsStaffDepartments.staffId, staff.id))
        .orderBy(desc(opsStaffDepartments.isPrimary), asc(departments.name)),
      db
        .select({ h: opsStaffManagerHistory, name: managers.fullName })
        .from(opsStaffManagerHistory)
        .leftJoin(managers, eq(managers.id, opsStaffManagerHistory.managerStaffId))
        .where(eq(opsStaffManagerHistory.staffId, staff.id))
        .orderBy(desc(opsStaffManagerHistory.createdAt)),
      staff.userId
        ? db
            .select({ email: users.email, status: users.status, lastLoginAt: users.lastLoginAt })
            .from(users)
            .where(eq(users.id, staff.userId))
        : [],
      staff.userId
        ? db
            .select({ role: userRoles.role })
            .from(userRoles)
            .where(eq(userRoles.userId, staff.userId))
        : [],
      db
        .select({ e: auditEvents, actorName: users.displayName })
        .from(auditEvents)
        .leftJoin(users, eq(users.id, auditEvents.actorUserId))
        .where(
          and(
            eq(auditEvents.entityId, staff.id),
            inArray(auditEvents.entityType, ['staff_member', 'teacher']),
          ),
        )
        .orderBy(desc(auditEvents.at))
        .limit(30),
      db
        .select({
          subject: opsStaffSubjectCapabilities.subject,
          verificationStatus: opsStaffSubjectCapabilities.verificationStatus,
        })
        .from(opsStaffSubjectCapabilities)
        .where(eq(opsStaffSubjectCapabilities.staffId, staff.id))
        .orderBy(asc(opsStaffSubjectCapabilities.subject)),
      seesPrivate
        ? db
            .select()
            .from(opsStaffPrivateDetails)
            .where(eq(opsStaffPrivateDetails.staffId, staff.id))
        : [],
    ]);
  const roleKeys = roles.map((r) => r.role);
  // Internal notes never leave the server (brief 2 §7).
  const { notes: _notes, ...profile } = person?.p ?? { notes: null };
  return {
    staff,
    profile: person?.p ? (profile as Omit<NonNullable<typeof person.p>, 'notes'>) : null,
    displayName: person?.p?.displayName ?? staff.fullName,
    department: person?.department ?? null,
    manager: person?.manager ?? null,
    branch: person?.branch ?? null,
    /** null = the default schedule. */
    schedule: person?.schedule ?? null,
    /** Subjects this person can teach: grants no access to any student (brief §4). */
    capabilities,
    departments: depts.map(({ d, name }) => ({ ...d, name })),
    managerHistory: managerHistory.map(({ h, name }) => ({ ...h, managerName: name })),
    login: login[0] ?? null,
    roles: roleKeys,
    workspaces: staff.userId
      ? workspacesFor({ id: staff.userId, roles: roleKeys }).map((w) => MODULES[w].label)
      : [],
    // What happened, by whom and when; before/after values stay in the audit table.
    history: history.map(({ e, actorName }) => ({
      id: e.id,
      at: e.at,
      action: e.action,
      actorName,
    })),
    ...(seesPrivate ? { private: privateRows[0] ?? null } : {}),
  };
}
export type HrStaff = Awaited<ReturnType<typeof getHrStaff>>;

/** Choices for the HR edit forms: departments, active staff (managers), branches, schedules. */
export async function hrFormOptions(db: Database) {
  const [base, branchRows, schedules] = await Promise.all([
    formOptions(db),
    db.select({ id: branches.id, name: branches.name, status: branches.status }).from(branches),
    db.select({ id: opsWorkSchedules.id, name: opsWorkSchedules.name }).from(opsWorkSchedules),
  ]);
  return {
    departments: base.departments,
    staff: base.staff,
    branches: branchRows
      .filter((b) => b.status !== 'archived')
      .map((b) => ({ value: b.id as string, label: b.name })),
    schedules: schedules.map((x) => ({ value: x.id, label: x.name })),
  };
}
