/**
 * Shift templates, shift assignments, the holiday calendar and schedule
 * loading (OPS-053, OPS-054), plus the employee/settings lookups the other
 * time services share. Every read and write checks its permission and HR scope
 * here (pages call services directly).
 *
 * Permissions: templates/assignments read `ops:shifts:read` (assignments are
 * HR-scoped), write `ops:shifts:manage`; holidays read `ops:shifts:read` or
 * `ops:leave:read`, write `ops:leave:manage`.
 */
import { and, asc, desc, eq, gte, inArray, lte, ne, or, isNull, sql, type SQL } from 'drizzle-orm';
import { can, type Permission } from '@elevate/authorization';
import {
  departments,
  opsEmployeeRecords,
  opsHolidays,
  opsShiftAssignments,
  opsShiftTemplates,
  staffMembers,
  type Database,
  type OpsHolidayId,
  type OpsShiftAssignmentId,
  type OpsShiftTemplateId,
} from '@elevate/database';
import { recordAudit, withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
} from '@elevate/shared-contracts';
import type { DepartmentId, IsoDate, StaffMemberId, UserId } from '@elevate/shared-types';
import type { DecisionCheck } from '../../domain/hr/attendance';
import type { AttendanceRules } from '../../domain/hr/attendance';
import { DEFAULT_TIMEZONE, holidaysFor, type HolidayEntry } from '../../domain/hr/calendar';
import {
  findAssignmentConflicts,
  scheduleForRange,
  validateShiftTemplate,
  type DaySchedule,
  type ShiftAssignmentLike,
  type ShiftTemplateLike,
} from '../../domain/hr/shifts';
import { notFound, userIdsForStaff, userIdsWithRole, type Actor } from '../context';
import { assertHrScope, hrCovers, hrScope, hrScopeIds } from '../hr-scope';
import { loadSettings } from '../settings';
import type {
  CreateAssignmentInput,
  CreateHolidayInput,
  CreateShiftInput,
  UpdateAssignmentInput,
  UpdateShiftInput,
} from './time-schemas';

export const PAGE_SIZE = 50;

// --- shared lookups ---------------------------------------------------------------------------

export interface TimeSettings {
  attendance: AttendanceRules;
  allowSplitShifts: boolean;
  defaultWorkingWeekdays: number[];
  countProposedHolidays: boolean;
  states: Record<'attendance' | 'shifts' | 'leave' | 'entitlements', string>;
}

export async function timeSettings(db: Database): Promise<TimeSettings> {
  const s = await loadSettings(db);
  return {
    attendance: s['attendance.rules'].value,
    allowSplitShifts: s['shifts.rules'].value.allowSplitShifts,
    defaultWorkingWeekdays: s['leave.rules'].value.defaultWorkingWeekdays,
    countProposedHolidays: s['leave.rules'].value.countProposedHolidays,
    states: {
      attendance: s['attendance.rules'].decisionState,
      shifts: s['shifts.rules'].decisionState,
      leave: s['leave.rules'].decisionState,
      entitlements: s['leave.entitlements'].decisionState,
    },
  };
}

export interface TimeEmployee {
  staffId: StaffMemberId;
  fullName: string;
  employeeCode: string | null;
  timezone: string;
  workLocation: string | null;
  departmentId: DepartmentId | null;
  departmentName: string | null;
  managerId: StaffMemberId | null;
  userId: string | null;
  staffStatus: string;
  employmentStatus: string | null;
}

const employeeColumns = {
  staffId: staffMembers.id,
  fullName: staffMembers.fullName,
  employeeCode: opsEmployeeRecords.employeeCode,
  timezone: opsEmployeeRecords.timezone,
  workLocation: opsEmployeeRecords.workLocation,
  departmentId: staffMembers.departmentId,
  departmentName: departments.name,
  managerId: staffMembers.managerId,
  userId: staffMembers.userId,
  staffStatus: staffMembers.status,
  employmentStatus: opsEmployeeRecords.employmentStatus,
};

function toEmployee(r: {
  staffId: StaffMemberId;
  fullName: string;
  employeeCode: string | null;
  timezone: string | null;
  workLocation: string | null;
  departmentId: DepartmentId | null;
  departmentName: string | null;
  managerId: StaffMemberId | null;
  userId: string | null;
  staffStatus: string;
  employmentStatus: string | null;
}): TimeEmployee {
  return { ...r, timezone: r.timezone ?? DEFAULT_TIMEZONE };
}

/** Staff members (with their HR record when one exists); null ids = everyone. */
export async function loadEmployees(
  db: Database,
  staffIds: readonly string[] | null,
  departmentId?: string | null,
): Promise<TimeEmployee[]> {
  if (staffIds && staffIds.length === 0) return [];
  const conds: SQL[] = [];
  if (staffIds) conds.push(inArray(staffMembers.id, staffIds as StaffMemberId[]));
  if (departmentId) conds.push(eq(staffMembers.departmentId, departmentId as DepartmentId));
  const rows = await db
    .select(employeeColumns)
    .from(staffMembers)
    .leftJoin(opsEmployeeRecords, eq(opsEmployeeRecords.staffId, staffMembers.id))
    .leftJoin(departments, eq(departments.id, staffMembers.departmentId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(staffMembers.fullName));
  return rows.map(toEmployee);
}

export async function loadEmployee(db: Database, staffId: string, field = 'staffId') {
  const [e] = await loadEmployees(db, [staffId]);
  if (!e)
    throw new ValidationError('Unknown staff member.', {
      details: [{ location: 'body', path: [field], message: 'Unknown staff member' }],
    });
  return e;
}

/** Employees in the actor's scope for a permission (for pickers and reports). */
export async function employeesInScope(
  db: Database,
  actor: Actor,
  permission: Parameters<typeof hrScope>[2],
) {
  const scope = await hrScope(db, actor, permission);
  return loadEmployees(db, hrScopeIds(scope));
}

// --- schedule loading --------------------------------------------------------------------------

export interface ScheduleContext {
  templates: Map<string, ShiftTemplateLike>;
  assignmentsByStaff: Map<string, ShiftAssignmentLike[]>;
  holidays: HolidayEntry[];
}

export async function loadScheduleContext(
  db: Database,
  staffIds: readonly string[],
  from: IsoDate,
  to: IsoDate,
): Promise<ScheduleContext> {
  const templates = new Map<string, ShiftTemplateLike>();
  for (const t of await db.select().from(opsShiftTemplates)) templates.set(t.id, toTemplate(t));
  const assignments = staffIds.length
    ? await db
        .select()
        .from(opsShiftAssignments)
        .where(
          and(
            inArray(opsShiftAssignments.staffId, staffIds as StaffMemberId[]),
            eq(opsShiftAssignments.status, 'active'),
            lte(opsShiftAssignments.fromDate, to),
            or(isNull(opsShiftAssignments.toDate), gte(opsShiftAssignments.toDate, from)),
          ),
        )
        .orderBy(asc(opsShiftAssignments.fromDate))
    : [];
  const assignmentsByStaff = new Map<string, ShiftAssignmentLike[]>();
  for (const a of assignments) {
    const list = assignmentsByStaff.get(a.staffId) ?? [];
    list.push(a);
    assignmentsByStaff.set(a.staffId, list);
  }
  const holidays = await db
    .select()
    .from(opsHolidays)
    .where(
      and(
        gte(opsHolidays.holidayDate, from),
        lte(opsHolidays.holidayDate, to),
        ne(opsHolidays.status, 'withdrawn'),
      ),
    );
  return {
    templates,
    assignmentsByStaff,
    holidays: holidays.map((h) => ({
      date: h.holidayDate,
      name: h.name,
      location: h.location,
      status: h.status,
    })),
  };
}

export function employeeSchedule(
  e: TimeEmployee,
  ctx: ScheduleContext,
  from: IsoDate,
  to: IsoDate,
  countProposedHolidays: boolean,
): DaySchedule[] {
  return scheduleForRange(
    from,
    to,
    ctx.assignmentsByStaff.get(e.staffId) ?? [],
    ctx.templates,
    holidaysFor(ctx.holidays, e.workLocation, countProposedHolidays),
  );
}

export function toTemplate(t: typeof opsShiftTemplates.$inferSelect): ShiftTemplateLike {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    startTime: t.startTime,
    endTime: t.endTime,
    crossesMidnight: t.crossesMidnight,
    unpaidBreakMinutes: t.unpaidBreakMinutes,
    workingWeekdays: t.workingWeekdays,
    status: t.status,
  };
}

// --- templates --------------------------------------------------------------------------------

export async function listShiftTemplates(db: Database, actor: Actor) {
  await hrScope(db, actor, 'ops:shifts:read');
  const rows = await db
    .select({ t: opsShiftTemplates, departmentName: departments.name })
    .from(opsShiftTemplates)
    .leftJoin(departments, eq(departments.id, opsShiftTemplates.departmentId))
    .orderBy(asc(opsShiftTemplates.status), asc(opsShiftTemplates.code));
  const counts = await db
    .select({ id: opsShiftAssignments.shiftTemplateId, n: sql<number>`count(*)::int` })
    .from(opsShiftAssignments)
    .where(eq(opsShiftAssignments.status, 'active'))
    .groupBy(opsShiftAssignments.shiftTemplateId);
  return rows.map((r) => ({
    ...r.t,
    departmentName: r.departmentName,
    activeAssignments: counts.find((c) => c.id === r.t.id)?.n ?? 0,
  }));
}

export async function getShiftTemplate(db: Database, actor: Actor, id: string) {
  await hrScope(db, actor, 'ops:shifts:read');
  const [t] = await db
    .select()
    .from(opsShiftTemplates)
    .where(eq(opsShiftTemplates.id, id as OpsShiftTemplateId));
  if (!t) notFound('Shift template');
  return t;
}

export async function createShiftTemplate(
  db: Database,
  actor: Actor,
  input: CreateShiftInput,
  requestId?: string,
) {
  await hrScope(db, actor, 'ops:shifts:manage');
  const issues = validateShiftTemplate(input);
  issuesError(issues);
  return withTransaction(db, async (tx) => {
    const [clash] = await tx
      .select({ id: opsShiftTemplates.id })
      .from(opsShiftTemplates)
      .where(eq(opsShiftTemplates.code, input.code));
    if (clash) throw new ConflictError(`A shift template with code ${input.code} exists.`);
    const [row] = await tx
      .insert(opsShiftTemplates)
      .values({
        code: input.code,
        name: input.name,
        startTime: input.startTime,
        endTime: input.endTime,
        crossesMidnight: input.crossesMidnight,
        unpaidBreakMinutes: input.unpaidBreakMinutes,
        workingWeekdays: [...new Set(input.workingWeekdays)].sort(),
        location: input.location ?? null,
        departmentId: (input.departmentId as DepartmentId | null) ?? null,
        notes: input.notes ?? null,
        status: 'proposed',
        createdBy: actor.id,
      })
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'shift_template.created',
      entityType: 'shift_template',
      entityId: row!.id,
      after: row,
      requestId,
    });
    return row!;
  });
}

export async function updateShiftTemplate(
  db: Database,
  actor: Actor,
  id: string,
  input: UpdateShiftInput,
  requestId?: string,
) {
  await hrScope(db, actor, 'ops:shifts:manage');
  return withTransaction(db, async (tx) => {
    const [before] = await tx
      .select()
      .from(opsShiftTemplates)
      .where(eq(opsShiftTemplates.id, id as OpsShiftTemplateId))
      .for('update');
    if (!before) notFound('Shift template');
    if (before.status === 'retired' && input.status !== 'proposed')
      throw new ConflictError(
        'A retired template cannot be edited; set it back to proposed first.',
      );
    const merged = { ...before, ...stripUndefined(input) };
    const issues = validateShiftTemplate(merged);
    issuesError(issues);
    const timingChanged =
      merged.startTime !== before.startTime ||
      merged.endTime !== before.endTime ||
      merged.crossesMidnight !== before.crossesMidnight ||
      merged.unpaidBreakMinutes !== before.unpaidBreakMinutes ||
      JSON.stringify([...merged.workingWeekdays].sort()) !==
        JSON.stringify([...before.workingWeekdays].sort());
    // Changing approved timings makes them a proposal again unless the change approves them.
    const status =
      input.status ?? (timingChanged && before.status === 'approved' ? 'proposed' : before.status);
    if (status === 'retired' && before.status !== 'retired') {
      const [active] = await tx
        .select({ id: opsShiftAssignments.id })
        .from(opsShiftAssignments)
        .where(
          and(
            eq(opsShiftAssignments.shiftTemplateId, before.id),
            eq(opsShiftAssignments.status, 'active'),
          ),
        )
        .limit(1);
      if (active)
        throw new ConflictError('End or cancel the active assignments before retiring this shift.');
    }
    const [after] = await tx
      .update(opsShiftTemplates)
      .set({
        ...stripUndefined(input),
        workingWeekdays: [...new Set(merged.workingWeekdays)].sort(),
        departmentId: (merged.departmentId as DepartmentId | null) ?? null,
        status,
      })
      .where(eq(opsShiftTemplates.id, before.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: status !== before.status ? `shift_template.${status}` : 'shift_template.updated',
      entityType: 'shift_template',
      entityId: before.id,
      before,
      after,
      requestId,
    });
    return after!;
  });
}

export function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// --- assignments ------------------------------------------------------------------------------

export async function listShiftAssignments(
  db: Database,
  actor: Actor,
  query: { staffId?: string; shiftTemplateId?: string; includeCancelled?: string; page?: number },
) {
  const scope = await hrScope(db, actor, 'ops:shifts:read');
  if (query.staffId) assertHrScope(scope, query.staffId);
  const ids = hrScopeIds(scope);
  const conds: SQL[] = [];
  if (ids) {
    if (ids.length === 0) return { rows: [], page: 1, pageSize: PAGE_SIZE, total: 0 };
    conds.push(inArray(opsShiftAssignments.staffId, ids));
  }
  if (query.staffId) conds.push(eq(opsShiftAssignments.staffId, query.staffId as StaffMemberId));
  if (query.shiftTemplateId)
    conds.push(
      eq(opsShiftAssignments.shiftTemplateId, query.shiftTemplateId as OpsShiftTemplateId),
    );
  if (query.includeCancelled !== 'true') conds.push(eq(opsShiftAssignments.status, 'active'));
  const where = conds.length ? and(...conds) : undefined;
  const page = query.page ?? 1;
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(opsShiftAssignments)
    .where(where);
  const rows = await db
    .select({
      a: opsShiftAssignments,
      fullName: staffMembers.fullName,
      templateCode: opsShiftTemplates.code,
      templateName: opsShiftTemplates.name,
      templateStatus: opsShiftTemplates.status,
    })
    .from(opsShiftAssignments)
    .innerJoin(staffMembers, eq(staffMembers.id, opsShiftAssignments.staffId))
    .innerJoin(opsShiftTemplates, eq(opsShiftTemplates.id, opsShiftAssignments.shiftTemplateId))
    .where(where)
    .orderBy(asc(staffMembers.fullName), desc(opsShiftAssignments.fromDate))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  return {
    rows: rows.map((r) => ({
      ...r.a,
      fullName: r.fullName,
      templateCode: r.templateCode,
      templateName: r.templateName,
      templateStatus: r.templateStatus,
    })),
    page,
    pageSize: PAGE_SIZE,
    total,
  };
}

async function assertNoConflict(
  tx: Database,
  candidate: { id?: string; staffId: string; fromDate: string; toDate: string | null },
  templateId: string,
) {
  const settings = await timeSettings(tx);
  const templates = new Map<string, ShiftTemplateLike>();
  for (const t of await tx.select().from(opsShiftTemplates)) templates.set(t.id, toTemplate(t));
  const template = templates.get(templateId);
  if (!template) throw new ValidationError('Unknown shift template.');
  const existing = await tx
    .select()
    .from(opsShiftAssignments)
    .where(
      and(
        eq(opsShiftAssignments.staffId, candidate.staffId as StaffMemberId),
        eq(opsShiftAssignments.status, 'active'),
      ),
    );
  const conflicts = findAssignmentConflicts(
    candidate,
    template,
    existing,
    templates,
    settings.allowSplitShifts,
  );
  if (conflicts.length) {
    const byId = new Map(existing.map((e) => [e.id as string, e]));
    throw new ConflictError(
      settings.allowSplitShifts
        ? 'This shift overlaps in time with another assignment of this employee.'
        : 'This employee already has a shift assignment for some of these dates (split shifts are not allowed by the proposed policy).',
      {
        details: {
          conflicts: conflicts.map((c) => {
            const e = byId.get(c.assignmentId);
            const t = e ? templates.get(e.shiftTemplateId) : undefined;
            return {
              assignmentId: c.assignmentId,
              reason: c.reason,
              template: t?.code ?? null,
              fromDate: e?.fromDate ?? null,
              toDate: e?.toDate ?? null,
            };
          }),
        },
      },
    );
  }
  return template;
}

export async function createShiftAssignment(
  db: Database,
  actor: Actor,
  input: CreateAssignmentInput,
  requestId?: string,
) {
  const scope = await hrScope(db, actor, 'ops:shifts:manage');
  assertHrScope(scope, input.staffId);
  if (input.toDate && input.toDate < input.fromDate)
    throw new ValidationError('The end date must be on or after the start date.', {
      details: [{ location: 'body', path: ['toDate'], message: 'Before the start date' }],
    });
  const employee = await loadEmployee(db, input.staffId);
  if (employee.staffStatus !== 'active')
    throw new ValidationError(`${employee.fullName} is not active.`);
  return withTransaction(db, async (tx) => {
    await lockStaff(tx, 'shifts', input.staffId);
    const template = await assertNoConflict(
      tx,
      { staffId: input.staffId, fromDate: input.fromDate, toDate: input.toDate ?? null },
      input.shiftTemplateId,
    );
    if (template.status === 'retired') throw new ConflictError('This shift template is retired.');
    const [row] = await tx
      .insert(opsShiftAssignments)
      .values({
        staffId: input.staffId as StaffMemberId,
        shiftTemplateId: input.shiftTemplateId as OpsShiftTemplateId,
        fromDate: input.fromDate,
        toDate: input.toDate ?? null,
        note: input.note ?? null,
        createdBy: actor.id,
      })
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'shift_assignment.created',
      entityType: 'shift_assignment',
      entityId: row!.id,
      after: { ...row, template: template.code },
      requestId,
    });
    return row!;
  });
}

export async function updateShiftAssignment(
  db: Database,
  actor: Actor,
  id: string,
  input: UpdateAssignmentInput,
  requestId?: string,
) {
  const scope = await hrScope(db, actor, 'ops:shifts:manage');
  return withTransaction(db, async (tx) => {
    const [before] = await tx
      .select()
      .from(opsShiftAssignments)
      .where(eq(opsShiftAssignments.id, id as OpsShiftAssignmentId))
      .for('update');
    if (!before) notFound('Shift assignment');
    assertHrScope(scope, before.staffId);
    if (before.status !== 'active') throw new ConflictError('This assignment is cancelled.');
    await lockStaff(tx, 'shifts', before.staffId);
    let patch: Partial<typeof opsShiftAssignments.$inferInsert>;
    if (input.action === 'end') {
      if (input.toDate < before.fromDate)
        throw new ValidationError('The end date must be on or after the start date.', {
          details: [{ location: 'body', path: ['toDate'], message: 'Before the start date' }],
        });
      await assertNoConflict(
        tx,
        { id: before.id, staffId: before.staffId, fromDate: before.fromDate, toDate: input.toDate },
        before.shiftTemplateId,
      );
      patch = { toDate: input.toDate };
    } else {
      patch = { status: 'cancelled', cancelReason: input.reason };
    }
    const [after] = await tx
      .update(opsShiftAssignments)
      .set(patch)
      .where(eq(opsShiftAssignments.id, before.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: input.action === 'end' ? 'shift_assignment.ended' : 'shift_assignment.cancelled',
      entityType: 'shift_assignment',
      entityId: before.id,
      before,
      after,
      requestId,
    });
    return after!;
  });
}

// --- holidays ---------------------------------------------------------------------------------

function assertHolidayRead(actor: Actor) {
  if (!can(actor, 'ops:shifts:read') && !can(actor, 'ops:leave:read'))
    throw new ForbiddenError('You do not have permission to see the holiday calendar.');
}

export async function listHolidays(
  db: Database,
  actor: Actor,
  query: { from?: string; to?: string; includeWithdrawn?: string } = {},
) {
  assertHolidayRead(actor);
  const conds: SQL[] = [];
  if (query.from) conds.push(gte(opsHolidays.holidayDate, query.from));
  if (query.to) conds.push(lte(opsHolidays.holidayDate, query.to));
  if (query.includeWithdrawn !== 'true') conds.push(ne(opsHolidays.status, 'withdrawn'));
  return db
    .select()
    .from(opsHolidays)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(opsHolidays.holidayDate))
    .limit(1000);
}

export async function createHoliday(
  db: Database,
  actor: Actor,
  input: CreateHolidayInput,
  requestId?: string,
) {
  await hrScope(db, actor, 'ops:leave:manage');
  return withTransaction(db, async (tx) => {
    const location = input.location?.trim() || null;
    const [clash] = await tx
      .select({ id: opsHolidays.id })
      .from(opsHolidays)
      .where(
        and(
          eq(opsHolidays.holidayDate, input.holidayDate),
          ne(opsHolidays.status, 'withdrawn'),
          sql`coalesce(lower(${opsHolidays.location}), '') = ${location?.toLowerCase() ?? ''}`,
        ),
      );
    if (clash)
      throw new ConflictError('A holiday is already recorded on this date for this location.');
    const [row] = await tx
      .insert(opsHolidays)
      .values({
        holidayDate: input.holidayDate,
        name: input.name,
        location,
        note: input.note ?? null,
        status: 'proposed',
        createdBy: actor.id,
      })
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'holiday.created',
      entityType: 'holiday',
      entityId: row!.id,
      after: row,
      requestId,
    });
    return row!;
  });
}

export async function updateHoliday(
  db: Database,
  actor: Actor,
  id: string,
  input: { status: 'proposed' | 'approved' | 'withdrawn'; note?: string | null },
  requestId?: string,
) {
  await hrScope(db, actor, 'ops:leave:manage');
  return withTransaction(db, async (tx) => {
    const [before] = await tx
      .select()
      .from(opsHolidays)
      .where(eq(opsHolidays.id, id as OpsHolidayId))
      .for('update');
    if (!before) notFound('Holiday');
    if (before.status === 'withdrawn')
      throw new ConflictError('A withdrawn holiday stays withdrawn; record a new one instead.');
    if (before.status === input.status) throw new ConflictError(`Already ${input.status}.`);
    const [after] = await tx
      .update(opsHolidays)
      .set({ status: input.status, note: input.note ?? before.note })
      .where(eq(opsHolidays.id, before.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: `holiday.${input.status}`,
      entityType: 'holiday',
      entityId: before.id,
      before,
      after,
      requestId,
    });
    return after!;
  });
}

// --- shared helpers for the time services -------------------------------------------------------

/** Throw a 400 listing every issue. */
export function issuesError(issues: { path: string; message: string }[]): void {
  if (issues.length)
    throw new ValidationError(issues[0]!.message, {
      details: issues.map((i) => ({ location: 'body', path: [i.path], message: i.message })),
    });
}

/** Serialise writes for one employee within an area (attendance, leave, shifts). */
export async function lockStaff(tx: Database, area: string, staffId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ops.${area}.${staffId}`}))`);
}

/** Approvers to notify for an employee: their manager's login, else HR managers; never the actor or the employee. */
export async function approverUserIds(tx: Database, e: TimeEmployee, exclude: UserId) {
  const ids = new Set<UserId>(await userIdsForStaff(tx, [e.managerId]));
  if (ids.size === 0) for (const u of await userIdsWithRole(tx, 'hr_manager')) ids.add(u);
  ids.delete(exclude);
  if (e.userId) ids.delete(e.userId as UserId);
  return [...ids];
}

/** Turn a failed domain check into the matching AppError. */
export function throwCheck(check: DecisionCheck, notePath = 'note'): void {
  if (check.ok) return;
  if (check.code === 'NOTE_REQUIRED')
    throw new ValidationError(check.message, {
      details: [{ location: 'body', path: [notePath], message: check.message }],
    });
  if (check.code === 'ILLEGAL') throw new InvalidStateTransitionError(check.message);
  throw new ForbiddenError(check.message);
}

/** `(staffId, requestedBy) => boolean`: may the actor decide a pending request (in scope, not self)? */
export async function decider(db: Database, actor: Actor, permission: Permission) {
  const scope = can(actor, permission) ? await hrScope(db, actor, permission) : null;
  return (staffId: string, requestedBy: string) =>
    scope !== null &&
    hrCovers(scope, staffId) &&
    requestedBy !== actor.id &&
    scope.staffId !== staffId;
}
