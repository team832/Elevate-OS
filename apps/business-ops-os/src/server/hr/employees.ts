/**
 * Employee directory and records (OPS-030, OPS-031, OPS-037). Every read goes
 * through `hrScope` + `employeeVisibility` and returns per-tier DTOs
 * (`projectEmployee`): private fields are never in directory rows, lists or
 * audit payloads. Creation goes through `insertEmployee` / `registerExistingStaff`.
 */
import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  departments,
  opsEmployeeRecords,
  opsEmploymentHistory,
  opsLifecycleCases,
  opsStaffProfiles,
  staffMembers,
  userRoles,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ForbiddenError, NotFoundError, ValidationError } from '@elevate/shared-contracts';
import type { DepartmentId, StaffMemberId } from '@elevate/shared-types';
import { istToday } from '../../domain/dates';
import {
  HISTORY_FIELD_LABELS,
  historyChanges,
  pageWindow,
  projectEmployee,
  RECORD_TIER_SORTS,
  type EmployeeRow,
  type EmploymentStatus,
} from '../../domain/hr/employees';
import type { Actor } from '../context';
import { assertHrScope, assertNotSelf, hrScope, hrScopeIds } from '../hr-scope';
import { assertManager } from '../organisation';
import { opsAudit } from '../ops-common';
import { employeeVisibility, likePattern } from './access';
import {
  assertDepartmentUsable,
  assertTimeZone,
  assertWorkEmailFree,
  changeEmploymentStatus,
  insertEmployee,
  normaliseWorkEmail,
  normaliseWorkPhoneOrThrow,
  registerExistingStaff,
  writeHistory,
} from './employee-core';
import type { CreateEmployeeInput, EmployeeListQuery, UpdateEmployeeInput } from './schemas';
import './wiring';

const audit = opsAudit('employee');

const manager = alias(staffMembers, 'manager');

const rowColumns = {
  staffId: staffMembers.id,
  employeeCode: opsEmployeeRecords.employeeCode,
  fullName: staffMembers.fullName,
  legalName: opsEmployeeRecords.legalName,
  departmentId: staffMembers.departmentId,
  departmentName: departments.name,
  title: staffMembers.title,
  managerId: staffMembers.managerId,
  managerName: manager.fullName,
  workEmail: opsEmployeeRecords.workEmail,
  workPhone: opsEmployeeRecords.workPhone,
  workLocation: opsEmployeeRecords.workLocation,
  timezone: opsEmployeeRecords.timezone,
  employmentType: opsStaffProfiles.employmentType,
  employmentStatus: opsEmployeeRecords.employmentStatus,
  employmentStartDate: opsEmployeeRecords.employmentStartDate,
  employmentEndDate: opsEmployeeRecords.employmentEndDate,
  staffStatus: staffMembers.status,
  userId: staffMembers.userId,
};

function baseQuery(db: Database) {
  return db
    .select(rowColumns)
    .from(opsEmployeeRecords)
    .innerJoin(staffMembers, eq(staffMembers.id, opsEmployeeRecords.staffId))
    .leftJoin(departments, eq(departments.id, staffMembers.departmentId))
    .leftJoin(manager, eq(manager.id, staffMembers.managerId))
    .leftJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id));
}

type RawRow = Awaited<ReturnType<ReturnType<typeof baseQuery>['execute']>>[number];

function toRow(r: RawRow): EmployeeRow & Pick<RawRow, 'userId'> {
  return {
    ...r,
    employmentType: r.employmentType ?? 'not_recorded',
    employmentStatus: r.employmentStatus as EmploymentStatus,
    hasLogin: Boolean(r.userId),
  };
}

/** Employee directory: server-side search, filters, sorting and pagination. */
export async function listEmployees(db: Database, actor: Actor, query: EmployeeListQuery) {
  const scope = await hrScope(db, actor, 'ops:employees:read');
  const vis = await employeeVisibility(db, actor);
  const ids = hrScopeIds(scope);
  // Record-tier filters/sorts are only offered when the caller may see record
  // fields of EVERY row they can list (HR roles, department managers' chains).
  const recordAll =
    vis.canManage ||
    vis.lifecycle?.scope === 'all' ||
    (ids !== null && ids.every((id) => vis.tiers(id).record));
  if (!recordAll) {
    const used =
      query.status || query.employmentType || query.includeSeparated === 'true'
        ? 'status / employment type filters'
        : RECORD_TIER_SORTS.includes(query.sort)
          ? 'this sort order'
          : null;
    if (used) throw new ForbiddenError(`The ${used} are limited to HR roles.`);
  }
  const where: SQL[] = [];
  if (ids) where.push(ids.length ? inArray(staffMembers.id, ids) : sql`false`);
  if (query.q) {
    const like = likePattern(query.q);
    where.push(
      or(
        ilike(staffMembers.fullName, like),
        ilike(opsEmployeeRecords.employeeCode, like),
        ilike(staffMembers.title, like),
        ilike(opsEmployeeRecords.workEmail, like),
      )!,
    );
  }
  if (query.departmentId)
    where.push(eq(staffMembers.departmentId, query.departmentId as DepartmentId));
  if (query.location)
    where.push(ilike(opsEmployeeRecords.workLocation, likePattern(query.location)));
  if (query.status) where.push(eq(opsEmployeeRecords.employmentStatus, query.status));
  else if (!(recordAll && query.includeSeparated === 'true'))
    where.push(ne(opsEmployeeRecords.employmentStatus, 'separated'));
  if (query.employmentType) where.push(eq(opsStaffProfiles.employmentType, query.employmentType));

  const dir = query.dir === 'desc' ? desc : asc;
  const sortCol = {
    name: staffMembers.fullName,
    code: opsEmployeeRecords.employeeCode,
    department: departments.name,
    start_date: opsEmployeeRecords.employmentStartDate,
    status: opsEmployeeRecords.employmentStatus,
  }[query.sort];
  const { page, pageSize, offset } = pageWindow(query.page, query.pageSize);
  const cond = where.length ? and(...where) : undefined;
  const [rows, [total]] = await Promise.all([
    baseQuery(db)
      .where(cond)
      .orderBy(
        sql`${dir(sortCol)} NULLS LAST`,
        asc(staffMembers.fullName),
        asc(opsEmployeeRecords.employeeCode),
      )
      .limit(pageSize)
      .offset(offset),
    db
      .select({ n: count() })
      .from(opsEmployeeRecords)
      .innerJoin(staffMembers, eq(staffMembers.id, opsEmployeeRecords.staffId))
      .leftJoin(departments, eq(departments.id, staffMembers.departmentId))
      .leftJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
      .where(cond),
  ]);
  return {
    items: rows.map((r) => projectEmployee(toRow(r), vis.tiers(r.staffId))),
    total: total?.n ?? 0,
    page,
    pageSize,
    recordTier: recordAll,
  };
}

async function loadRow(db: Database, staffId: string) {
  const [r] = await baseQuery(db)
    .where(eq(opsEmployeeRecords.staffId, staffId as StaffMemberId))
    .limit(1);
  if (!r) throw new NotFoundError('Employee not found.');
  return toRow(r);
}

/** Latest onboarding/offboarding cases (lifecycle slice), status only — no separation reasons. */
function lifecycleCases(db: Database, staffId: StaffMemberId) {
  return db
    .select({
      code: opsLifecycleCases.code,
      kind: opsLifecycleCases.kind,
      status: opsLifecycleCases.status,
    })
    .from(opsLifecycleCases)
    .where(eq(opsLifecycleCases.staffId, staffId))
    .orderBy(desc(opsLifecycleCases.createdAt))
    .limit(5);
}

/** Employee profile: directory fields, plus record/private tiers when allowed. */
export async function getEmployee(db: Database, actor: Actor, staffId: string) {
  const scope = await hrScope(db, actor, 'ops:employees:read');
  assertHrScope(scope, staffId, 'this employee');
  const row = await loadRow(db, staffId);
  const vis = await employeeVisibility(db, actor);
  const tiers = vis.tiers(row.staffId);
  if (!tiers.record && row.employmentStatus === 'separated')
    throw new NotFoundError('Employee not found.');
  const reports = await db
    .select({ id: staffMembers.id, fullName: staffMembers.fullName, title: staffMembers.title })
    .from(staffMembers)
    .where(
      and(
        eq(staffMembers.managerId, row.staffId as StaffMemberId),
        ne(staffMembers.status, 'inactive'),
      ),
    )
    .orderBy(asc(staffMembers.fullName));
  const employee = projectEmployee(row, tiers);
  let roles: string[] | null = null;
  let lifecycle: Awaited<ReturnType<typeof lifecycleCases>> | null = null;
  if (tiers.record) {
    roles = row.userId
      ? (
          await db
            .select({ role: userRoles.role })
            .from(userRoles)
            .where(eq(userRoles.userId, row.userId))
            .orderBy(asc(userRoles.role))
        ).map((r) => r.role as string)
      : [];
    lifecycle = await lifecycleCases(db, row.staffId as StaffMemberId);
  }
  return {
    employee,
    reports,
    /** Read-only: roles are assigned by a platform administrator, never here. */
    roles,
    lifecycle,
    access: {
      record: tiers.record,
      private: tiers.private,
      isSelf: vis.staffId === row.staffId,
      canManage: vis.canManage,
    },
  };
}

/** Append-only employment history with names resolved (record tier only). */
export async function listEmploymentHistory(db: Database, actor: Actor, staffId: string) {
  const scope = await hrScope(db, actor, 'ops:employees:read');
  assertHrScope(scope, staffId, 'this employee');
  const vis = await employeeVisibility(db, actor);
  if (!vis.tiers(staffId).record)
    throw new ForbiddenError(
      'Employment history is limited to HR roles, managers and the employee.',
    );
  const rows = await db
    .select()
    .from(opsEmploymentHistory)
    .where(eq(opsEmploymentHistory.staffId, staffId as StaffMemberId))
    .orderBy(desc(opsEmploymentHistory.effectiveOn), desc(opsEmploymentHistory.changedAt));
  const ids = (f: string) =>
    rows
      .flatMap((r) => (r.field === f ? [r.fromValue, r.toValue] : []))
      .filter(Boolean) as string[];
  const deptIds = [...new Set(ids('department'))];
  const staffIds = [...new Set(ids('manager'))];
  const [depts, people] = await Promise.all([
    deptIds.length
      ? db
          .select({ id: departments.id, name: departments.name })
          .from(departments)
          .where(inArray(departments.id, deptIds as DepartmentId[]))
      : [],
    staffIds.length
      ? db
          .select({ id: staffMembers.id, name: staffMembers.fullName })
          .from(staffMembers)
          .where(inArray(staffMembers.id, staffIds as StaffMemberId[]))
      : [],
  ]);
  const names = new Map<string, string>([
    ...depts.map((d) => [d.id as string, d.name] as const),
    ...people.map((p) => [p.id as string, p.name] as const),
  ]);
  const label = (field: string, v: string | null) =>
    v === null ? null : field === 'department' || field === 'manager' ? (names.get(v) ?? v) : v;
  return rows.map((r) => ({
    id: r.id,
    field: r.field,
    fieldLabel: HISTORY_FIELD_LABELS[r.field],
    from: label(r.field, r.fromValue),
    to: label(r.field, r.toValue),
    effectiveOn: r.effectiveOn,
    reason: r.reason,
    changedAt: r.changedAt,
  }));
}

/** Create an employee (or register an existing staff member as one). */
export async function createEmployee(
  db: Database,
  actor: Actor,
  input: CreateEmployeeInput,
  requestId?: string,
) {
  const scope = await hrScope(db, actor, 'ops:employees:manage');
  if (scope.scope !== 'all')
    throw new ForbiddenError('Creating employees needs HR access to all records.');
  const { existingStaffId, fullName, departmentId, title, managerId, ...record } = input;
  const result = await withTransaction(db, async (tx) => {
    if (existingStaffId)
      return registerExistingStaff(tx, actor, existingStaffId as StaffMemberId, record, requestId);
    if (!fullName)
      throw new ValidationError('Name is required.', {
        details: [{ location: 'body', path: ['fullName'], message: 'Required' }],
      });
    const staff = {
      fullName,
      title,
      departmentId: (departmentId as DepartmentId | null) ?? null,
      managerId: (managerId as StaffMemberId | null) ?? null,
    };
    return insertEmployee(tx, actor, { ...record, ...staff }, requestId);
  });
  return { id: result.staffId, ...result };
}

const NON_SENSITIVE_AUDIT_FIELDS = [
  'fullName',
  'departmentId',
  'title',
  'managerId',
  'employmentType',
  'employmentStatus',
  'employmentStartDate',
  'employmentEndDate',
  'workLocation',
  'timezone',
] as const;

/** Authorised edit (ops:employees:manage). Writes history for tracked fields. */
export async function updateEmployee(
  db: Database,
  actor: Actor,
  staffId: string,
  input: UpdateEmployeeInput,
  requestId?: string,
) {
  const scope = await hrScope(db, actor, 'ops:employees:manage');
  assertHrScope(scope, staffId, 'this employee');
  const effectiveOn = input.effectiveOn ?? istToday(new Date());
  await withTransaction(db, async (tx) => {
    const [staff] = await tx
      .select()
      .from(staffMembers)
      .where(eq(staffMembers.id, staffId as StaffMemberId))
      .for('update');
    const [record] = await tx
      .select()
      .from(opsEmployeeRecords)
      .where(eq(opsEmployeeRecords.staffId, staffId as StaffMemberId))
      .for('update');
    if (!staff || !record) throw new NotFoundError('Employee not found.');
    const [profile] = await tx
      .select()
      .from(opsStaffProfiles)
      .where(eq(opsStaffProfiles.staffId, staff.id));
    const before = {
      fullName: staff.fullName,
      departmentId: staff.departmentId as string | null,
      title: staff.title,
      managerId: staff.managerId as string | null,
      employmentType: profile?.employmentType ?? 'not_recorded',
      employmentStatus: record.employmentStatus as string,
      employmentStartDate: record.employmentStartDate,
      employmentEndDate: record.employmentEndDate,
      workLocation: record.workLocation,
      timezone: record.timezone,
    };

    // core.staff_members (Ops is the steward)
    const staffPatch: Partial<typeof staffMembers.$inferInsert> = {};
    if (input.fullName) staffPatch.fullName = input.fullName;
    if ('departmentId' in input) {
      await assertDepartmentUsable(tx, input.departmentId);
      staffPatch.departmentId = (input.departmentId as DepartmentId | null) ?? null;
    }
    if ('title' in input) staffPatch.title = input.title?.trim() || null;
    if ('managerId' in input) {
      await assertManager(tx, staff.id, input.managerId);
      staffPatch.managerId = (input.managerId as StaffMemberId | null) ?? null;
    }
    if (Object.keys(staffPatch).length)
      await tx.update(staffMembers).set(staffPatch).where(eq(staffMembers.id, staff.id));
    if (input.employmentType && input.employmentType !== before.employmentType)
      await tx
        .insert(opsStaffProfiles)
        .values({ staffId: staff.id, employmentType: input.employmentType, updatedBy: actor.id })
        .onConflictDoUpdate({
          target: opsStaffProfiles.staffId,
          set: { employmentType: input.employmentType, updatedBy: actor.id },
        });

    // ops.employee_records (work contacts and dates)
    const recordPatch: Partial<typeof opsEmployeeRecords.$inferInsert> = {};
    if ('workEmail' in input) {
      const email = normaliseWorkEmail(input.workEmail);
      await assertWorkEmailFree(tx, email, staff.id);
      recordPatch.workEmail = email;
    }
    if ('workPhone' in input) recordPatch.workPhone = normaliseWorkPhoneOrThrow(input.workPhone);
    if ('workLocation' in input) recordPatch.workLocation = input.workLocation?.trim() || null;
    if (input.timezone) recordPatch.timezone = assertTimeZone(input.timezone);
    if ('employmentStartDate' in input)
      recordPatch.employmentStartDate = input.employmentStartDate ?? null;
    if ('employmentEndDate' in input && input.employmentStatus !== 'separated')
      recordPatch.employmentEndDate = input.employmentEndDate ?? null;
    const start = recordPatch.employmentStartDate ?? record.employmentStartDate;
    const end =
      'employmentEndDate' in input ? (input.employmentEndDate ?? null) : record.employmentEndDate;
    if (start && end && end < start)
      throw new ValidationError('The end date is before the start date.', {
        details: [{ location: 'body', path: ['employmentEndDate'], message: 'Before start date' }],
      });
    if (Object.keys(recordPatch).length)
      await tx
        .update(opsEmployeeRecords)
        .set(recordPatch)
        .where(eq(opsEmployeeRecords.staffId, staff.id));

    await writeHistory(tx, {
      staffId: staff.id,
      changes: historyChanges(before, {
        ...('departmentId' in staffPatch ? { departmentId: staffPatch.departmentId ?? null } : {}),
        ...('title' in staffPatch ? { title: staffPatch.title ?? null } : {}),
        ...('managerId' in staffPatch ? { managerId: staffPatch.managerId ?? null } : {}),
        ...(input.employmentType ? { employmentType: input.employmentType } : {}),
      }),
      effectiveOn,
      reason: input.reason,
      actorId: actor.id,
    });

    // Employment status: transition rules, own history row and audit.
    if (input.employmentStatus && input.employmentStatus !== record.employmentStatus) {
      assertNotSelf(scope.staffId, staff.id, 'a change of your own employment status');
      await changeEmploymentStatus(
        tx,
        actor,
        staff.id,
        input.employmentStatus,
        { reason: input.reason ?? '', effectiveOn, endDate: input.employmentEndDate ?? null },
        requestId,
      );
    }

    const after = { ...before, ...staffPatch, ...recordPatch, ...input };
    const fieldsChanged = Object.keys(input).filter((k) => !['effectiveOn', 'reason'].includes(k));
    const pick = (o: Record<string, unknown>) =>
      Object.fromEntries(NON_SENSITIVE_AUDIT_FIELDS.map((k) => [k, o[k] ?? null]));
    await audit(
      tx,
      actor,
      staff.id,
      'employee.updated',
      {
        before: pick(before),
        after: pick(after),
        // Work contacts are named, never copied (OPS-037).
        metadata: { fieldsChanged, effectiveOn },
      },
      requestId,
    );
  });
  return getEmployee(db, actor, staffId);
}

/** Picker of staff without an employee record (for "register existing staff"). */
export async function staffWithoutEmployeeRecord(db: Database, actor: Actor) {
  const scope = await hrScope(db, actor, 'ops:employees:manage');
  if (scope.scope !== 'all') return [];
  return db
    .select({ id: staffMembers.id, fullName: staffMembers.fullName })
    .from(staffMembers)
    .leftJoin(opsEmployeeRecords, eq(opsEmployeeRecords.staffId, staffMembers.id))
    .where(and(sql`${opsEmployeeRecords.staffId} IS NULL`, ne(staffMembers.status, 'inactive')))
    .orderBy(asc(staffMembers.fullName));
}

/** Filter options for the directory (departments, distinct locations). */
export async function employeeFilterOptions(db: Database, actor: Actor) {
  const scope = await hrScope(db, actor, 'ops:employees:read');
  const ids = hrScopeIds(scope);
  const locs = await db
    .selectDistinct({ location: opsEmployeeRecords.workLocation })
    .from(opsEmployeeRecords)
    .where(
      ids
        ? ids.length
          ? inArray(opsEmployeeRecords.staffId, ids)
          : sql`false`
        : sql`${opsEmployeeRecords.workLocation} IS NOT NULL`,
    );
  const depts = await db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(ne(departments.status, 'archived'))
    .orderBy(asc(departments.name));
  return {
    departments: depts.map((d) => ({ value: d.id as string, label: d.name })),
    locations: locs
      .map((l) => l.location)
      .filter((l): l is string => Boolean(l))
      .sort()
      .map((l) => ({ value: l, label: l })),
  };
}

/** Picker of current employees (not separated, staff not inactive). Callers check permission. */
export async function employeeOptions(db: Database) {
  const rows = await db
    .select({
      id: opsEmployeeRecords.staffId,
      code: opsEmployeeRecords.employeeCode,
      name: staffMembers.fullName,
    })
    .from(opsEmployeeRecords)
    .innerJoin(staffMembers, eq(staffMembers.id, opsEmployeeRecords.staffId))
    .where(
      and(
        ne(opsEmployeeRecords.employmentStatus, 'separated'),
        ne(staffMembers.status, 'inactive'),
      ),
    )
    .orderBy(asc(staffMembers.fullName));
  return rows.map((r) => ({ value: r.id as string, label: `${r.name} (${r.code})` }));
}
