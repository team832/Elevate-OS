/**
 * Staff attendance (OPS-050…OPS-052): self clock-in/out and breaks, manual
 * entries (reason mandatory, audited), late/early flags against the assigned
 * shift, the missing clock-out job, corrections that never overwrite, and the
 * monthly summary. STAFF attendance only — Academic OS class attendance is
 * never read, stored or duplicated here.
 *
 * Permissions (checked here for every call; HR `own` = self + reporting chain
 * for department managers, server/hr-scope.ts):
 *   read `ops:attendance:read` · self clock/break/correction request
 *   `ops:attendance:record` · manual entries `ops:attendance:manage` ·
 *   correction decisions `ops:attendance:approve` (never one's own).
 */
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  opsAttendanceBreaks,
  opsAttendanceCorrections,
  opsAttendanceSessions,
  opsShiftTemplates,
  staffMembers,
  type Database,
  type OpsAttendanceCorrectionId,
  type OpsAttendanceSessionId,
  type OpsShiftTemplateId,
} from '@elevate/database';
import { notify } from '@elevate/notifications';
import { recordAudit, withTransaction } from '@elevate/server-kit';
import { ConflictError, ForbiddenError, ValidationError } from '@elevate/shared-contracts';
import type { IsoDate, StaffMemberId, UserId } from '@elevate/shared-types';
import {
  checkDecision,
  checkWithdraw,
  isMissingClockOut,
  lateEarly,
  sessionsOverlap,
  sessionWorkedMinutes,
  validateSessionTimes,
  workDateFor,
  type AttendanceRules,
} from '../../domain/hr/attendance';
import { addDays } from '../../domain/dates';
import { minutesBetween, monthRange, zonedDate, zonedToInstant } from '../../domain/hr/calendar';
import { shiftWindow, templateOn, type ShiftTemplateLike } from '../../domain/hr/shifts';
import { dailyTimesheet, periodSummary } from '../../domain/hr/timesheets';
import { accessScope, nextCode, notFound, type Actor } from '../context';
import { assertHrScope, hrCovers, hrScope, hrScopeIds, type HrScope } from '../hr-scope';
import { approvedLeaveByDate } from './leave';
import {
  approverUserIds,
  decider,
  employeeSchedule,
  issuesError,
  loadEmployee,
  lockStaff,
  throwCheck,
  loadScheduleContext,
  PAGE_SIZE,
  timeSettings,
  toTemplate,
  type TimeEmployee,
} from './shifts';
import type {
  AttendanceListQuery,
  CreateCorrectionInput,
  DecisionInput,
  ManualSessionInput,
} from './time-schemas';

export type SessionRow = typeof opsAttendanceSessions.$inferSelect;
export type CorrectionRow = typeof opsAttendanceCorrections.$inferSelect;

// --- helpers ----------------------------------------------------------------------------------

/** The shift that applies to `workDate` for the employee, and its UTC window. */
export async function shiftFor(
  db: Database,
  e: TimeEmployee,
  workDate: IsoDate,
): Promise<{ template: ShiftTemplateLike; window: { start: Date; end: Date } } | null> {
  const ctx = await loadScheduleContext(db, [e.staffId], workDate, workDate);
  const settings = await timeSettings(db);
  const [day] = employeeSchedule(e, ctx, workDate, workDate, settings.countProposedHolidays);
  if (!day || day.status !== 'scheduled') return null;
  const template = templateOn(workDate, ctx.assignmentsByStaff.get(e.staffId) ?? [], ctx.templates);
  if (!template) return null;
  return { template, window: shiftWindow(template, workDate, e.timezone) };
}

async function templateById(db: Database, id: string | null) {
  if (!id) return null;
  const [t] = await db
    .select()
    .from(opsShiftTemplates)
    .where(eq(opsShiftTemplates.id, id as OpsShiftTemplateId));
  return t ? toTemplate(t) : null;
}

/** Non-superseded sessions of one employee that touch a time span (± 1 day of work dates). */
async function liveSessions(tx: Database, staffId: string, from: IsoDate, to: IsoDate) {
  return tx
    .select()
    .from(opsAttendanceSessions)
    .where(
      and(
        eq(opsAttendanceSessions.staffId, staffId as StaffMemberId),
        ne(opsAttendanceSessions.status, 'superseded'),
        gte(opsAttendanceSessions.workDate, addDays(from, -1)),
        lte(opsAttendanceSessions.workDate, addDays(to, 1)),
      ),
    );
}

/** Refuse overlaps and (unless allowed) a second session on the same work date. */
function assertNoClash(
  existing: readonly SessionRow[],
  candidate: { clockInAt: Date; clockOutAt: Date | null; workDate: string },
  rules: AttendanceRules,
  now: Date,
  ignoreId?: string,
) {
  for (const s of existing) {
    if (s.id === ignoreId) continue;
    if (sessionsOverlap(candidate, s, now))
      throw new ConflictError('This overlaps another attendance session of this employee.', {
        details: { sessionId: s.id },
      });
    if (!rules.multipleSessionsPerDay && s.workDate === candidate.workDate)
      throw new ConflictError(
        'A session is already recorded for this day (one session per day — proposed policy attendance.rules).',
        { details: { sessionId: s.id } },
      );
  }
}

async function breakTotal(tx: Database, sessionId: OpsAttendanceSessionId) {
  const breaks = await tx
    .select()
    .from(opsAttendanceBreaks)
    .where(eq(opsAttendanceBreaks.sessionId, sessionId));
  return breaks.reduce((n, b) => n + (b.endAt ? minutesBetween(b.startAt, b.endAt) : 0), 0);
}

function selfStaff(scope: HrScope): StaffMemberId {
  if (!scope.staffId) throw new ForbiddenError('Your account is not linked to a staff record.');
  return scope.staffId;
}

export function sessionView(s: SessionRow, now: Date) {
  return {
    ...s,
    workedMinutes: sessionWorkedMinutes(s),
    elapsedMinutes: s.clockOutAt ? null : Math.max(0, minutesBetween(s.clockInAt, now)),
    flags: {
      late: (s.lateMinutes ?? 0) > 0,
      early: (s.earlyDepartureMinutes ?? 0) > 0,
      missingClockOut: s.status === 'open' && s.missingClockOutFlaggedAt !== null,
      /** No shift applied that day: late/early were not measured (not "on time"). */
      notMeasured: s.shiftTemplateId === null,
    },
  };
}

// --- self service -----------------------------------------------------------------------------

export async function clockIn(
  db: Database,
  actor: Actor,
  input: { note?: string | null } = {},
  requestId?: string,
  now = new Date(),
) {
  const scope = await hrScope(db, actor, 'ops:attendance:record');
  const staffId = selfStaff(scope);
  const e = await loadEmployee(db, staffId);
  const { attendance: rules } = await timeSettings(db);
  const workDate = workDateFor(now, e.timezone);
  const shift = await shiftFor(db, e, workDate);
  return withTransaction(db, async (tx) => {
    await lockStaff(tx, 'attendance', staffId);
    const [open] = await tx
      .select({ id: opsAttendanceSessions.id })
      .from(opsAttendanceSessions)
      .where(
        and(eq(opsAttendanceSessions.staffId, staffId), eq(opsAttendanceSessions.status, 'open')),
      );
    if (open) throw new ConflictError('You are already clocked in. Clock out first.');
    const existing = await liveSessions(tx, staffId, workDate, workDate);
    assertNoClash(existing, { clockInAt: now, clockOutAt: null, workDate }, rules, now);
    const le = lateEarly({ clockInAt: now, clockOutAt: null }, shift?.window ?? null, rules);
    const [row] = await tx
      .insert(opsAttendanceSessions)
      .values({
        staffId,
        workDate,
        clockInAt: now,
        timezone: e.timezone,
        source: 'self',
        status: 'open',
        shiftTemplateId: (shift?.template.id as OpsShiftTemplateId | undefined) ?? null,
        lateMinutes: le.lateMinutes,
        reason: input.note ?? null,
        createdBy: actor.id,
      })
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'attendance.clocked_in',
      entityType: 'attendance_session',
      entityId: row!.id,
      after: row,
      requestId,
    });
    return sessionView(row!, now);
  });
}

export async function clockOut(
  db: Database,
  actor: Actor,
  input: { note?: string | null } = {},
  requestId?: string,
  now = new Date(),
) {
  const scope = await hrScope(db, actor, 'ops:attendance:record');
  const staffId = selfStaff(scope);
  const { attendance: rules } = await timeSettings(db);
  return withTransaction(db, async (tx) => {
    await lockStaff(tx, 'attendance', staffId);
    const [before] = await tx
      .select()
      .from(opsAttendanceSessions)
      .where(
        and(eq(opsAttendanceSessions.staffId, staffId), eq(opsAttendanceSessions.status, 'open')),
      )
      .for('update');
    if (!before) throw new ConflictError('You are not clocked in.');
    if (now.getTime() <= before.clockInAt.getTime())
      throw new ValidationError('Clock-out must be after clock-in.');
    await tx
      .update(opsAttendanceBreaks)
      .set({ endAt: now })
      .where(and(eq(opsAttendanceBreaks.sessionId, before.id), isNull(opsAttendanceBreaks.endAt)));
    const breakMinutes = await breakTotal(tx, before.id);
    const template = await templateById(tx, before.shiftTemplateId);
    const window = template
      ? shiftWindow(template, before.workDate as IsoDate, before.timezone)
      : null;
    const le = lateEarly({ clockInAt: before.clockInAt, clockOutAt: now }, window, rules);
    const [after] = await tx
      .update(opsAttendanceSessions)
      .set({
        clockOutAt: now,
        status: 'closed',
        breakMinutes: Math.min(
          breakMinutes,
          Math.max(0, minutesBetween(before.clockInAt, now) - 1),
        ),
        earlyDepartureMinutes: le.earlyDepartureMinutes,
        missingClockOutFlaggedAt: null,
        reason: input.note
          ? [before.reason, input.note].filter(Boolean).join(' · ')
          : before.reason,
      })
      .where(eq(opsAttendanceSessions.id, before.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'attendance.clocked_out',
      entityType: 'attendance_session',
      entityId: before.id,
      before: { clockOutAt: null, status: before.status },
      after: { clockOutAt: now, breakMinutes: after!.breakMinutes, early: le.early },
      requestId,
    });
    return sessionView(after!, now);
  });
}

export async function recordBreak(
  db: Database,
  actor: Actor,
  action: 'start' | 'end',
  requestId?: string,
  now = new Date(),
) {
  const scope = await hrScope(db, actor, 'ops:attendance:record');
  const staffId = selfStaff(scope);
  return withTransaction(db, async (tx) => {
    await lockStaff(tx, 'attendance', staffId);
    const [session] = await tx
      .select()
      .from(opsAttendanceSessions)
      .where(
        and(eq(opsAttendanceSessions.staffId, staffId), eq(opsAttendanceSessions.status, 'open')),
      );
    if (!session) throw new ConflictError('Clock in before recording a break.');
    const [openBreak] = await tx
      .select()
      .from(opsAttendanceBreaks)
      .where(and(eq(opsAttendanceBreaks.sessionId, session.id), isNull(opsAttendanceBreaks.endAt)));
    let row;
    if (action === 'start') {
      if (openBreak) throw new ConflictError('A break is already running.');
      [row] = await tx
        .insert(opsAttendanceBreaks)
        .values({ sessionId: session.id, startAt: now, createdBy: actor.id })
        .returning();
    } else {
      if (!openBreak) throw new ConflictError('No break is running.');
      if (now.getTime() <= openBreak.startAt.getTime())
        throw new ValidationError('The break must end after it started.');
      [row] = await tx
        .update(opsAttendanceBreaks)
        .set({ endAt: now })
        .where(eq(opsAttendanceBreaks.id, openBreak.id))
        .returning();
      await tx
        .update(opsAttendanceSessions)
        .set({ breakMinutes: await breakTotal(tx, session.id) })
        .where(eq(opsAttendanceSessions.id, session.id));
    }
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: action === 'start' ? 'attendance.break_started' : 'attendance.break_ended',
      entityType: 'attendance_session',
      entityId: session.id,
      after: row,
      requestId,
    });
    return row!;
  });
}

/** Self-service status: open session, running break and today's sessions. */
export async function myAttendanceStatus(db: Database, actor: Actor, now = new Date()) {
  const scope = await hrScope(db, actor, 'ops:attendance:record');
  if (!scope.staffId) return { linked: false as const };
  const e = await loadEmployee(db, scope.staffId);
  const today = zonedDate(now, e.timezone);
  const { attendance: rules } = await timeSettings(db);
  const sessions = await db
    .select()
    .from(opsAttendanceSessions)
    .where(
      and(
        eq(opsAttendanceSessions.staffId, scope.staffId),
        ne(opsAttendanceSessions.status, 'superseded'),
        gte(opsAttendanceSessions.workDate, addDays(today, -1)),
      ),
    )
    .orderBy(asc(opsAttendanceSessions.clockInAt));
  const open = sessions.find((s) => s.status === 'open') ?? null;
  const [runningBreak] = open
    ? await db
        .select()
        .from(opsAttendanceBreaks)
        .where(and(eq(opsAttendanceBreaks.sessionId, open.id), isNull(opsAttendanceBreaks.endAt)))
    : [];
  const shift = await shiftFor(db, e, today);
  return {
    linked: true as const,
    employee: e,
    today,
    open: open ? sessionView(open, now) : null,
    runningBreak: runningBreak ?? null,
    todaySessions: sessions.filter((s) => s.workDate === today).map((s) => sessionView(s, now)),
    shift: shift
      ? {
          code: shift.template.code,
          name: shift.template.name,
          status: shift.template.status,
          ...shift.window,
        }
      : null,
    rules,
  };
}

// --- manual entries ---------------------------------------------------------------------------

export async function createManualSession(
  db: Database,
  actor: Actor,
  input: ManualSessionInput,
  requestId?: string,
  now = new Date(),
) {
  const scope = await hrScope(db, actor, 'ops:attendance:manage');
  assertHrScope(scope, input.staffId);
  const e = await loadEmployee(db, input.staffId);
  const { attendance: rules } = await timeSettings(db);
  const clockInAt = zonedToInstant(input.workDate, input.clockIn, e.timezone);
  const clockOutAt = input.clockOut
    ? zonedToInstant(input.clockOutDate ?? input.workDate, input.clockOut, e.timezone)
    : null;
  issuesError(
    validateSessionTimes({ clockInAt, clockOutAt, breakMinutes: input.breakMinutes }, rules),
  );
  if (clockInAt.getTime() > now.getTime() || (clockOutAt && clockOutAt.getTime() > now.getTime()))
    throw new ValidationError('Attendance cannot be recorded in the future.');
  const shift = await shiftFor(db, e, input.workDate);
  return withTransaction(db, async (tx) => {
    await lockStaff(tx, 'attendance', input.staffId);
    const existing = await liveSessions(tx, input.staffId, input.workDate, input.workDate);
    if (!clockOutAt && existing.some((s) => s.status === 'open'))
      throw new ConflictError('This employee already has an open session.');
    assertNoClash(existing, { clockInAt, clockOutAt, workDate: input.workDate }, rules, now);
    const le = lateEarly({ clockInAt, clockOutAt }, shift?.window ?? null, rules);
    const [row] = await tx
      .insert(opsAttendanceSessions)
      .values({
        staffId: input.staffId as StaffMemberId,
        workDate: input.workDate,
        clockInAt,
        clockOutAt,
        timezone: e.timezone,
        breakMinutes: input.breakMinutes,
        source: 'manual',
        status: clockOutAt ? 'closed' : 'open',
        shiftTemplateId: (shift?.template.id as OpsShiftTemplateId | undefined) ?? null,
        lateMinutes: le.lateMinutes,
        earlyDepartureMinutes: le.earlyDepartureMinutes,
        reason: input.reason,
        createdBy: actor.id,
      })
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'attendance.manual_entry',
      entityType: 'attendance_session',
      entityId: row!.id,
      after: row,
      requestId,
    });
    if (e.userId && e.userId !== actor.id)
      await notify(tx, {
        userIds: [e.userId as UserId],
        module: 'ops',
        kind: 'attendance.manual_entry',
        title: `Attendance recorded for you on ${input.workDate}`,
        body: `Recorded manually: ${input.reason}`,
        link: `/ops/hr/attendance/${row!.id}`,
        entityType: 'attendance_session',
        entityId: row!.id,
      });
    return sessionView(row!, now);
  });
}

// --- reads ------------------------------------------------------------------------------------

export async function listAttendance(
  db: Database,
  actor: Actor,
  query: Partial<AttendanceListQuery> = {},
  now = new Date(),
) {
  const scope = await hrScope(db, actor, 'ops:attendance:read');
  if (query.staffId) assertHrScope(scope, query.staffId);
  const ids = hrScopeIds(scope);
  const page = query.page ?? 1;
  if (ids && ids.length === 0) return { rows: [], page, pageSize: PAGE_SIZE, total: 0 };
  const conds: SQL[] = [];
  if (ids) conds.push(inArray(opsAttendanceSessions.staffId, ids));
  if (query.staffId) conds.push(eq(opsAttendanceSessions.staffId, query.staffId as StaffMemberId));
  if (query.from) conds.push(gte(opsAttendanceSessions.workDate, query.from));
  if (query.to) conds.push(lte(opsAttendanceSessions.workDate, query.to));
  if (query.source) conds.push(eq(opsAttendanceSessions.source, query.source));
  if (query.status === 'missing_clock_out')
    conds.push(
      and(
        eq(opsAttendanceSessions.status, 'open'),
        isNotNull(opsAttendanceSessions.missingClockOutFlaggedAt),
      ) as SQL,
    );
  else if (query.status) conds.push(eq(opsAttendanceSessions.status, query.status));
  const where = conds.length ? and(...conds) : undefined;
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(opsAttendanceSessions)
    .where(where);
  const rows = await db
    .select({
      s: opsAttendanceSessions,
      fullName: staffMembers.fullName,
      shiftCode: opsShiftTemplates.code,
    })
    .from(opsAttendanceSessions)
    .innerJoin(staffMembers, eq(staffMembers.id, opsAttendanceSessions.staffId))
    .leftJoin(opsShiftTemplates, eq(opsShiftTemplates.id, opsAttendanceSessions.shiftTemplateId))
    .where(where)
    .orderBy(desc(opsAttendanceSessions.workDate), desc(opsAttendanceSessions.clockInAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  return {
    rows: rows.map((r) => ({
      ...sessionView(r.s, now),
      fullName: r.fullName,
      shiftCode: r.shiftCode,
    })),
    page,
    pageSize: PAGE_SIZE,
    total,
  };
}

export async function getAttendanceSession(
  db: Database,
  actor: Actor,
  id: string,
  now = new Date(),
) {
  const scope = await hrScope(db, actor, 'ops:attendance:read');
  const [s] = await db
    .select()
    .from(opsAttendanceSessions)
    .where(eq(opsAttendanceSessions.id, id as OpsAttendanceSessionId));
  if (!s) notFound('Attendance session');
  assertHrScope(scope, s.staffId, 'this attendance record');
  const e = await loadEmployee(db, s.staffId);
  const breaks = await db
    .select()
    .from(opsAttendanceBreaks)
    .where(eq(opsAttendanceBreaks.sessionId, s.id))
    .orderBy(asc(opsAttendanceBreaks.startAt));
  const corrections = await db
    .select()
    .from(opsAttendanceCorrections)
    .where(
      sql`${opsAttendanceCorrections.sessionId} = ${s.id} OR ${opsAttendanceCorrections.resultingSessionId} = ${s.id}`,
    )
    .orderBy(desc(opsAttendanceCorrections.createdAt));
  const replacedBy = s.supersededById
    ? ((
        await db
          .select()
          .from(opsAttendanceSessions)
          .where(eq(opsAttendanceSessions.id, s.supersededById))
      )[0] ?? null)
    : null;
  const replaces = await db
    .select()
    .from(opsAttendanceSessions)
    .where(eq(opsAttendanceSessions.supersededById, s.id));
  const template = await templateById(db, s.shiftTemplateId);
  const selfScope = scope.staffId === s.staffId;
  return {
    session: sessionView(s, now),
    employee: e,
    shift: template,
    breaks,
    corrections,
    replacedBy: replacedBy ? sessionView(replacedBy, now) : null,
    replaces: replaces.map((r) => sessionView(r, now)),
    canRequestCorrection:
      s.status !== 'superseded' &&
      can(actor, 'ops:attendance:record') &&
      (selfScope || (scope.scope === 'own' && hrCovers(scope, s.staffId))) &&
      !corrections.some((c) => c.status === 'pending' && c.sessionId === s.id),
  };
}

/** Monthly summary for one employee (self by default). */
export async function monthlyAttendanceSummary(
  db: Database,
  actor: Actor,
  query: { staffId?: string; month?: string },
  now = new Date(),
) {
  const scope = await hrScope(db, actor, 'ops:attendance:read');
  const staffId = query.staffId ?? scope.staffId;
  if (!staffId) throw new ForbiddenError('Your account is not linked to a staff record.');
  assertHrScope(scope, staffId);
  const e = await loadEmployee(db, staffId);
  const month = query.month ?? zonedDate(now, e.timezone).slice(0, 7);
  const { from, to } = monthRange(month);
  return employeePeriod(db, e, from, to);
}

/** Days + period summary for one employee (no permission check: callers check). */
export async function employeePeriod(db: Database, e: TimeEmployee, from: IsoDate, to: IsoDate) {
  const settings = await timeSettings(db);
  const ctx = await loadScheduleContext(db, [e.staffId], from, to);
  const schedule = employeeSchedule(e, ctx, from, to, settings.countProposedHolidays);
  const sessions = await db
    .select()
    .from(opsAttendanceSessions)
    .where(
      and(
        eq(opsAttendanceSessions.staffId, e.staffId),
        gte(opsAttendanceSessions.workDate, from),
        lte(opsAttendanceSessions.workDate, to),
      ),
    );
  const pending = await db
    .select({ workDate: opsAttendanceCorrections.workDate })
    .from(opsAttendanceCorrections)
    .where(
      and(
        eq(opsAttendanceCorrections.staffId, e.staffId),
        eq(opsAttendanceCorrections.status, 'pending'),
        gte(opsAttendanceCorrections.workDate, from),
        lte(opsAttendanceCorrections.workDate, to),
      ),
    );
  const pendingByDate = new Map<string, number>();
  for (const p of pending) pendingByDate.set(p.workDate, (pendingByDate.get(p.workDate) ?? 0) + 1);
  const leaveByDate = await approvedLeaveByDate(db, e, from, to);
  const days = dailyTimesheet(schedule, sessions, leaveByDate, pendingByDate);
  return { employee: e, from, to, days, summary: periodSummary(from, to, days) };
}

// --- missing clock-out job --------------------------------------------------------------------

/**
 * Flag open sessions past shift end + grace (or past the maximum session length
 * when no shift applies) and notify the employee once. Idempotent: a flagged
 * session is never flagged or notified again.
 */
export async function runMissingClockOutCheck(
  db: Database,
  now = new Date(),
  options: { actor?: Actor; requestId?: string } = {},
): Promise<{ checked: number; flagged: number; notified: number; unreachable: number }> {
  if (options.actor) await accessScope(db, options.actor, 'ops:jobs:run');
  const { attendance: rules } = await timeSettings(db);
  return withTransaction(db, async (tx) => {
    const open = await tx
      .select({ s: opsAttendanceSessions, userId: staffMembers.userId })
      .from(opsAttendanceSessions)
      .innerJoin(staffMembers, eq(staffMembers.id, opsAttendanceSessions.staffId))
      .where(
        and(
          eq(opsAttendanceSessions.status, 'open'),
          isNull(opsAttendanceSessions.missingClockOutFlaggedAt),
        ),
      );
    let flagged = 0;
    let notified = 0;
    let unreachable = 0;
    const templates = new Map<string, ShiftTemplateLike>();
    for (const t of await tx.select().from(opsShiftTemplates)) templates.set(t.id, toTemplate(t));
    for (const { s, userId } of open) {
      const t = s.shiftTemplateId ? templates.get(s.shiftTemplateId) : undefined;
      const end = t ? shiftWindow(t, s.workDate as IsoDate, s.timezone).end : null;
      if (!isMissingClockOut(s, end, rules, now)) continue;
      const claimed = await tx
        .update(opsAttendanceSessions)
        .set({ missingClockOutFlaggedAt: now })
        .where(
          and(
            eq(opsAttendanceSessions.id, s.id),
            isNull(opsAttendanceSessions.missingClockOutFlaggedAt),
          ),
        )
        .returning({ id: opsAttendanceSessions.id });
      if (!claimed.length) continue;
      flagged += 1;
      await recordAudit(tx, {
        actorUserId: options.actor?.id ?? null,
        module: 'ops',
        action: 'attendance.missing_clock_out_flagged',
        entityType: 'attendance_session',
        entityId: s.id,
        after: { workDate: s.workDate, shiftEnd: end, flaggedAt: now },
        requestId: options.requestId,
      });
      if (userId) {
        await notify(tx, {
          userIds: [userId],
          module: 'ops',
          kind: 'attendance.missing_clock_out',
          title: `Missing clock-out on ${s.workDate}`,
          body: 'Your attendance session is still open. Clock out now or request a correction with the right time.',
          link: `/ops/hr/attendance/${s.id}`,
          entityType: 'attendance_session',
          entityId: s.id,
        });
        notified += 1;
      } else unreachable += 1;
    }
    return { checked: open.length, flagged, notified, unreachable };
  });
}

// --- corrections ------------------------------------------------------------------------------

export async function createCorrection(
  db: Database,
  actor: Actor,
  input: CreateCorrectionInput,
  requestId?: string,
  now = new Date(),
) {
  const scope = await hrScope(db, actor, 'ops:attendance:record');
  let staffId: string;
  let original: SessionRow | null = null;
  if (input.sessionId) {
    const [s] = await db
      .select()
      .from(opsAttendanceSessions)
      .where(eq(opsAttendanceSessions.id, input.sessionId as OpsAttendanceSessionId));
    if (!s) notFound('Attendance session');
    original = s;
    staffId = s.staffId;
  } else staffId = selfStaff(scope);
  assertHrScope(scope, staffId, 'this attendance record');
  if (original?.status === 'superseded')
    throw new ConflictError('This session was already replaced; correct the current one.');
  const e = await loadEmployee(db, staffId);
  const { attendance: rules } = await timeSettings(db);
  const clockInAt = zonedToInstant(input.workDate, input.clockIn, e.timezone);
  const clockOutAt = zonedToInstant(
    input.clockOutDate ?? input.workDate,
    input.clockOut,
    e.timezone,
  );
  issuesError(
    validateSessionTimes({ clockInAt, clockOutAt, breakMinutes: input.breakMinutes }, rules),
  );
  if (clockOutAt.getTime() > now.getTime())
    throw new ValidationError('A correction cannot propose a time in the future.');
  return withTransaction(db, async (tx) => {
    await lockStaff(tx, 'attendance', staffId);
    if (!original) {
      const existing = await liveSessions(tx, staffId, input.workDate, input.workDate);
      const sameDay = existing.find((s) => s.workDate === input.workDate);
      if (sameDay && !rules.multipleSessionsPerDay)
        throw new ConflictError(
          'A session exists on this day: request a correction of that session.',
          {
            details: { sessionId: sameDay.id },
          },
        );
    }
    const [pendingDup] = original
      ? await tx
          .select({ id: opsAttendanceCorrections.id })
          .from(opsAttendanceCorrections)
          .where(
            and(
              eq(opsAttendanceCorrections.sessionId, original.id),
              eq(opsAttendanceCorrections.status, 'pending'),
            ),
          )
      : [];
    if (pendingDup) throw new ConflictError('A correction for this session is already pending.');
    const code = await nextCode(tx, 'attendanceCorrection', 'ops.attendance_corrections');
    const [row] = await tx
      .insert(opsAttendanceCorrections)
      .values({
        code,
        staffId: staffId as StaffMemberId,
        sessionId: original?.id ?? null,
        workDate: input.workDate,
        proposedClockInAt: clockInAt,
        proposedClockOutAt: clockOutAt,
        proposedBreakMinutes: input.breakMinutes,
        reason: input.reason,
        requestedBy: actor.id,
      })
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'attendance_correction.requested',
      entityType: 'attendance_correction',
      entityId: row!.id,
      after: row,
      requestId,
    });
    const approvers = await approverUserIds(tx, e, actor.id);
    if (approvers.length)
      await notify(tx, {
        userIds: approvers,
        module: 'ops',
        kind: 'attendance.correction_requested',
        title: `Attendance correction ${code} for ${e.fullName}`,
        body: input.reason,
        link: `/ops/hr/attendance/corrections/${row!.id}`,
        entityType: 'attendance_correction',
        entityId: row!.id,
      });
    return row!;
  });
}

export async function decideCorrection(
  db: Database,
  actor: Actor,
  id: string,
  input: DecisionInput,
  requestId?: string,
  now = new Date(),
) {
  const scope = await hrScope(db, actor, 'ops:attendance:approve');
  const { attendance: rules } = await timeSettings(db);
  return withTransaction(db, async (tx) => {
    const [c] = await tx
      .select()
      .from(opsAttendanceCorrections)
      .where(eq(opsAttendanceCorrections.id, id as OpsAttendanceCorrectionId))
      .for('update');
    if (!c) notFound('Correction');
    assertHrScope(scope, c.staffId, 'this correction');
    const to = input.decision === 'approve' ? 'approved' : 'rejected';
    throwCheck(
      checkDecision({
        from: c.status,
        to,
        actorUserId: actor.id,
        requestedByUserId: c.requestedBy,
        actorStaffId: scope.staffId,
        subjectStaffId: c.staffId,
        note: input.note,
      }),
    );
    await lockStaff(tx, 'attendance', c.staffId);
    let resultingSessionId: OpsAttendanceSessionId | null = null;
    let original: SessionRow | undefined;
    if (to === 'approved') {
      if (c.sessionId) {
        [original] = await tx
          .select()
          .from(opsAttendanceSessions)
          .where(eq(opsAttendanceSessions.id, c.sessionId))
          .for('update');
        if (!original || original.status === 'superseded')
          throw new ConflictError('The session was already replaced; this correction is stale.');
      }
      const e = await loadEmployee(tx, c.staffId);
      const existing = await liveSessions(
        tx,
        c.staffId,
        c.workDate as IsoDate,
        c.workDate as IsoDate,
      );
      assertNoClash(
        existing,
        { clockInAt: c.proposedClockInAt, clockOutAt: c.proposedClockOutAt, workDate: c.workDate },
        rules,
        now,
        original?.id,
      );
      const shift = await shiftFor(tx, e, c.workDate as IsoDate);
      const le = lateEarly(
        { clockInAt: c.proposedClockInAt, clockOutAt: c.proposedClockOutAt },
        shift?.window ?? null,
        rules,
      );
      const [created] = await tx
        .insert(opsAttendanceSessions)
        .values({
          staffId: c.staffId,
          workDate: c.workDate,
          clockInAt: c.proposedClockInAt,
          clockOutAt: c.proposedClockOutAt,
          timezone: e.timezone,
          breakMinutes: c.proposedBreakMinutes,
          source: 'correction',
          status: 'closed',
          shiftTemplateId: (shift?.template.id as OpsShiftTemplateId | undefined) ?? null,
          lateMinutes: le.lateMinutes,
          earlyDepartureMinutes: le.earlyDepartureMinutes,
          reason: `${c.code}: ${c.reason}`,
          correctionId: c.id,
          createdBy: actor.id,
        })
        .returning();
      resultingSessionId = created!.id;
      if (original)
        await tx
          .update(opsAttendanceSessions)
          .set({ status: 'superseded', supersededAt: now, supersededById: created!.id })
          .where(eq(opsAttendanceSessions.id, original.id));
    }
    const [after] = await tx
      .update(opsAttendanceCorrections)
      .set({
        status: to,
        decidedBy: actor.id,
        decidedAt: now,
        decisionNote: input.note ?? null,
        resultingSessionId,
      })
      .where(eq(opsAttendanceCorrections.id, c.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: `attendance_correction.${to}`,
      entityType: 'attendance_correction',
      entityId: c.id,
      before: { status: c.status, originalSessionId: c.sessionId },
      after: {
        status: to,
        note: input.note ?? null,
        resultingSessionId,
        supersededSessionId: original?.id ?? null,
      },
      requestId,
    });
    if (c.requestedBy !== actor.id)
      await notify(tx, {
        userIds: [c.requestedBy],
        module: 'ops',
        kind: `attendance.correction_${to}`,
        title: `Correction ${c.code} ${to}`,
        body: input.note ?? undefined,
        link: `/ops/hr/attendance/corrections/${c.id}`,
        entityType: 'attendance_correction',
        entityId: c.id,
      });
    return after!;
  });
}

export async function withdrawCorrection(
  db: Database,
  actor: Actor,
  id: string,
  requestId?: string,
) {
  await hrScope(db, actor, 'ops:attendance:record');
  return withTransaction(db, async (tx) => {
    const [c] = await tx
      .select()
      .from(opsAttendanceCorrections)
      .where(eq(opsAttendanceCorrections.id, id as OpsAttendanceCorrectionId))
      .for('update');
    if (!c) notFound('Correction');
    throwCheck(
      checkWithdraw({ from: c.status, actorUserId: actor.id, requestedByUserId: c.requestedBy }),
    );
    const [after] = await tx
      .update(opsAttendanceCorrections)
      .set({ status: 'withdrawn' })
      .where(eq(opsAttendanceCorrections.id, c.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'attendance_correction.withdrawn',
      entityType: 'attendance_correction',
      entityId: c.id,
      before: { status: c.status },
      after: { status: 'withdrawn' },
      requestId,
    });
    return after!;
  });
}

export async function listCorrections(
  db: Database,
  actor: Actor,
  query: { status?: string; staffId?: string; page?: number } = {},
) {
  const scope = await hrScope(db, actor, 'ops:attendance:read');
  if (query.staffId) assertHrScope(scope, query.staffId);
  const ids = hrScopeIds(scope);
  const page = query.page ?? 1;
  if (ids && ids.length === 0) return { rows: [], page, pageSize: PAGE_SIZE, total: 0 };
  const conds: SQL[] = [];
  if (ids) conds.push(inArray(opsAttendanceCorrections.staffId, ids));
  if (query.staffId)
    conds.push(eq(opsAttendanceCorrections.staffId, query.staffId as StaffMemberId));
  if (query.status)
    conds.push(eq(opsAttendanceCorrections.status, query.status as CorrectionRow['status']));
  const where = conds.length ? and(...conds) : undefined;
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(opsAttendanceCorrections)
    .where(where);
  const rows = await db
    .select({ c: opsAttendanceCorrections, fullName: staffMembers.fullName })
    .from(opsAttendanceCorrections)
    .innerJoin(staffMembers, eq(staffMembers.id, opsAttendanceCorrections.staffId))
    .where(where)
    .orderBy(desc(opsAttendanceCorrections.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  const canDecide = await decider(db, actor, 'ops:attendance:approve');
  return {
    rows: rows.map((r) => ({
      ...r.c,
      fullName: r.fullName,
      canDecide: r.c.status === 'pending' && canDecide(r.c.staffId, r.c.requestedBy),
    })),
    page,
    pageSize: PAGE_SIZE,
    total,
  };
}

export async function getCorrection(db: Database, actor: Actor, id: string) {
  const scope = await hrScope(db, actor, 'ops:attendance:read');
  const [c] = await db
    .select()
    .from(opsAttendanceCorrections)
    .where(eq(opsAttendanceCorrections.id, id as OpsAttendanceCorrectionId));
  if (!c) notFound('Correction');
  assertHrScope(scope, c.staffId, 'this correction');
  const e = await loadEmployee(db, c.staffId);
  const [original] = c.sessionId
    ? await db.select().from(opsAttendanceSessions).where(eq(opsAttendanceSessions.id, c.sessionId))
    : [];
  const canDecide = await decider(db, actor, 'ops:attendance:approve');
  return {
    correction: c,
    employee: e,
    original: original ?? null,
    canDecide: c.status === 'pending' && canDecide(c.staffId, c.requestedBy),
    canWithdraw: c.status === 'pending' && c.requestedBy === actor.id,
  };
}
