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
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  opsAttendanceBreaks,
  opsAttendanceCorrections,
  opsAttendanceSessions,
  opsShiftTemplates,
  staffMembers,
  type Database,
  type OpsAttendanceSessionId,
  type OpsShiftTemplateId,
} from '@elevate/database';
import { notify } from '@elevate/notifications';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, ForbiddenError, ValidationError } from '@elevate/shared-contracts';
import type { IsoDate, StaffMemberId, UserId } from '@elevate/shared-types';
import {
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
import { accessScope, nextCode, type Actor } from '../context';
import { assertHrScope, hrCovers, hrScope, hrScopeIds, type HrScope } from '../hr-scope';
import { notifyOthers, opsAudit, rowById } from '../ops-common';
import { approvedLeaveByDate } from './leave';
import {
  approverUserIds,
  checkedDecision,
  decider,
  emptyPage,
  employeeSchedule,
  issuesError,
  loadEmployee,
  loadScheduleContext,
  loadTemplates,
  lockStaff,
  paginate,
  throwCheck,
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

const auditSession = opsAudit('attendance_session');
const auditCorrection = opsAudit('attendance_correction');

type SessionRow = typeof opsAttendanceSessions.$inferSelect;
type Shift = { template: ShiftTemplateLike; window: { start: Date; end: Date } };
type Times = { clockInAt: Date; clockOutAt: Date | null };

// --- helpers ----------------------------------------------------------------------------------

/** The shift that applies to `workDate` for the employee, and its UTC window. */
export async function shiftFor(
  db: Database,
  e: TimeEmployee,
  workDate: IsoDate,
): Promise<Shift | null> {
  const ctx = await loadScheduleContext(db, [e.staffId], workDate, workDate);
  const settings = await timeSettings(db);
  const [day] = employeeSchedule(e, ctx, workDate, workDate, settings.countProposedHolidays);
  if (!day || day.status !== 'scheduled') return null;
  const template = templateOn(workDate, ctx.assignmentsByStaff.get(e.staffId) ?? [], ctx.templates);
  if (!template) return null;
  return { template, window: shiftWindow(template, workDate, e.timezone) };
}

/** Session columns measured against the shift: template, late and early minutes. */
export function shiftMeasures(shift: Shift | null, times: Times, rules: AttendanceRules) {
  const le = lateEarly(times, shift?.window ?? null, rules);
  return {
    shiftTemplateId: (shift?.template.id as OpsShiftTemplateId | undefined) ?? null,
    lateMinutes: le.lateMinutes,
    earlyDepartureMinutes: le.earlyDepartureMinutes,
  };
}

async function templateById(db: Database, id: string | null) {
  const [t] = id
    ? await db
        .select()
        .from(opsShiftTemplates)
        .where(eq(opsShiftTemplates.id, id as OpsShiftTemplateId))
    : [];
  return t ? toTemplate(t) : null;
}

const openSession = (tx: Database, staffId: StaffMemberId) =>
  tx
    .select()
    .from(opsAttendanceSessions)
    .where(
      and(eq(opsAttendanceSessions.staffId, staffId), eq(opsAttendanceSessions.status, 'open')),
    );

const runningBreak = (tx: Database, sessionId: OpsAttendanceSessionId) =>
  tx
    .select()
    .from(opsAttendanceBreaks)
    .where(and(eq(opsAttendanceBreaks.sessionId, sessionId), isNull(opsAttendanceBreaks.endAt)));

/** Non-superseded sessions of one employee within ± 1 day of a work date. */
async function liveSessions(tx: Database, staffId: string, workDate: IsoDate) {
  return tx
    .select()
    .from(opsAttendanceSessions)
    .where(
      and(
        eq(opsAttendanceSessions.staffId, staffId as StaffMemberId),
        ne(opsAttendanceSessions.status, 'superseded'),
        gte(opsAttendanceSessions.workDate, addDays(workDate, -1)),
        lte(opsAttendanceSessions.workDate, addDays(workDate, 1)),
      ),
    );
}

/** Refuse overlaps and (unless allowed) a second session on the same work date. */
function assertNoClash(
  existing: readonly SessionRow[],
  candidate: Times & { workDate: string },
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

function sessionView(s: SessionRow, now: Date) {
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
    const [open] = await openSession(tx, staffId);
    if (open) throw new ConflictError('You are already clocked in. Clock out first.');
    const times = { clockInAt: now, clockOutAt: null };
    assertNoClash(await liveSessions(tx, staffId, workDate), { ...times, workDate }, rules, now);
    const [row] = await tx
      .insert(opsAttendanceSessions)
      .values({
        staffId,
        workDate,
        clockInAt: now,
        timezone: e.timezone,
        source: 'self',
        status: 'open',
        ...shiftMeasures(shift, times, rules),
        reason: input.note ?? null,
        createdBy: actor.id,
      })
      .returning();
    await auditSession(tx, actor, row!.id, 'attendance.clocked_in', { after: row }, requestId);
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
    const [before] = await openSession(tx, staffId).for('update');
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
    const change = {
      before: { clockOutAt: null, status: before.status },
      after: { clockOutAt: now, breakMinutes: after!.breakMinutes, early: le.early },
    };
    await auditSession(tx, actor, before.id, 'attendance.clocked_out', change, requestId);
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
    const [session] = await openSession(tx, staffId);
    if (!session) throw new ConflictError('Clock in before recording a break.');
    const [openBreak] = await runningBreak(tx, session.id);
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
    const verb = action === 'start' ? 'started' : 'ended';
    const change = { after: row };
    await auditSession(tx, actor, session.id, `attendance.break_${verb}`, change, requestId);
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
  const [breakNow] = open ? await runningBreak(db, open.id) : [];
  const shift = await shiftFor(db, e, today);
  return {
    linked: true as const,
    employee: e,
    today,
    open: open ? sessionView(open, now) : null,
    runningBreak: breakNow ?? null,
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
    const existing = await liveSessions(tx, input.staffId, input.workDate);
    if (!clockOutAt && existing.some((s) => s.status === 'open'))
      throw new ConflictError('This employee already has an open session.');
    assertNoClash(existing, { clockInAt, clockOutAt, workDate: input.workDate }, rules, now);
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
        ...shiftMeasures(shift, { clockInAt, clockOutAt }, rules),
        reason: input.reason,
        createdBy: actor.id,
      })
      .returning();
    await auditSession(tx, actor, row!.id, 'attendance.manual_entry', { after: row }, requestId);
    await notifyOthers(tx, actor, e.userId ? [e.userId as UserId] : [], {
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
  if (ids?.length === 0) return emptyPage(query.page ?? 1);
  const s = opsAttendanceSessions;
  const where = and(
    ids ? inArray(s.staffId, ids) : undefined,
    query.staffId ? eq(s.staffId, query.staffId as StaffMemberId) : undefined,
    query.from ? gte(s.workDate, query.from) : undefined,
    query.to ? lte(s.workDate, query.to) : undefined,
    query.source ? eq(s.source, query.source) : undefined,
    query.status === 'missing_clock_out'
      ? and(eq(s.status, 'open'), isNotNull(s.missingClockOutFlaggedAt))
      : query.status
        ? eq(s.status, query.status)
        : undefined,
  );
  return paginate(db, s, where, query.page, async (limit, offset) => {
    const rows = await db
      .select({ s, fullName: staffMembers.fullName, shiftCode: opsShiftTemplates.code })
      .from(s)
      .innerJoin(staffMembers, eq(staffMembers.id, s.staffId))
      .leftJoin(opsShiftTemplates, eq(opsShiftTemplates.id, s.shiftTemplateId))
      .where(where)
      .orderBy(desc(s.workDate), desc(s.clockInAt))
      .limit(limit)
      .offset(offset);
    return rows.map((r) => ({
      ...sessionView(r.s, now),
      fullName: r.fullName,
      shiftCode: r.shiftCode,
    }));
  });
}

export async function getAttendanceSession(
  db: Database,
  actor: Actor,
  id: string,
  now = new Date(),
) {
  const scope = await hrScope(db, actor, 'ops:attendance:read');
  const s = await rowById(db, opsAttendanceSessions, id, 'Attendance session');
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
  const [replacedBy] = s.supersededById
    ? await db
        .select()
        .from(opsAttendanceSessions)
        .where(eq(opsAttendanceSessions.id, s.supersededById))
    : [];
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
  const staffId = query.staffId ?? selfStaff(scope);
  assertHrScope(scope, staffId);
  const e = await loadEmployee(db, staffId);
  const { from, to } = monthRange(query.month ?? zonedDate(now, e.timezone).slice(0, 7));
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
    const unflagged = isNull(opsAttendanceSessions.missingClockOutFlaggedAt);
    const open = await tx
      .select({ s: opsAttendanceSessions, userId: staffMembers.userId })
      .from(opsAttendanceSessions)
      .innerJoin(staffMembers, eq(staffMembers.id, opsAttendanceSessions.staffId))
      .where(and(eq(opsAttendanceSessions.status, 'open'), unflagged));
    const counts = { checked: open.length, flagged: 0, notified: 0, unreachable: 0 };
    const templates = await loadTemplates(tx);
    for (const { s, userId } of open) {
      const t = s.shiftTemplateId ? templates.get(s.shiftTemplateId) : undefined;
      const end = t ? shiftWindow(t, s.workDate as IsoDate, s.timezone).end : null;
      if (!isMissingClockOut(s, end, rules, now)) continue;
      const claimed = await tx
        .update(opsAttendanceSessions)
        .set({ missingClockOutFlaggedAt: now })
        .where(and(eq(opsAttendanceSessions.id, s.id), unflagged))
        .returning({ id: opsAttendanceSessions.id });
      if (!claimed.length) continue;
      counts.flagged += 1;
      const change = { after: { workDate: s.workDate, shiftEnd: end, flaggedAt: now } };
      const event = 'attendance.missing_clock_out_flagged';
      await auditSession(tx, options.actor, s.id, event, change, options.requestId);
      if (!userId) {
        counts.unreachable += 1;
        continue;
      }
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
      counts.notified += 1;
    }
    return counts;
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
  const original = input.sessionId
    ? await rowById(db, opsAttendanceSessions, input.sessionId, 'Attendance session')
    : null;
  const staffId = original?.staffId ?? selfStaff(scope);
  assertHrScope(scope, staffId, 'this attendance record');
  if (original?.status === 'superseded')
    throw new ConflictError('This session was already replaced; correct the current one.');
  const e = await loadEmployee(db, staffId);
  const { attendance: rules } = await timeSettings(db);
  const clockInAt = zonedToInstant(input.workDate, input.clockIn, e.timezone);
  const clockOutDate = input.clockOutDate ?? input.workDate;
  const clockOutAt = zonedToInstant(clockOutDate, input.clockOut, e.timezone);
  issuesError(
    validateSessionTimes({ clockInAt, clockOutAt, breakMinutes: input.breakMinutes }, rules),
  );
  if (clockOutAt.getTime() > now.getTime())
    throw new ValidationError('A correction cannot propose a time in the future.');
  return withTransaction(db, async (tx) => {
    await lockStaff(tx, 'attendance', staffId);
    if (!original) {
      const existing = await liveSessions(tx, staffId, input.workDate);
      const sameDay = existing.find((s) => s.workDate === input.workDate);
      if (sameDay && !rules.multipleSessionsPerDay)
        throw new ConflictError(
          'A session exists on this day: request a correction of that session.',
          { details: { sessionId: sameDay.id } },
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
    const change = { after: row };
    await auditCorrection(tx, actor, row!.id, 'attendance_correction.requested', change, requestId);
    const approvers = await approverUserIds(tx, e, actor.id);
    await notifyOthers(tx, actor, approvers, {
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
    const c = await rowById(tx, opsAttendanceCorrections, id, 'Correction', true);
    assertHrScope(scope, c.staffId, 'this correction');
    const to = checkedDecision(actor, scope, c, input);
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
      const workDate = c.workDate as IsoDate;
      const times = { clockInAt: c.proposedClockInAt, clockOutAt: c.proposedClockOutAt };
      const existing = await liveSessions(tx, c.staffId, workDate);
      assertNoClash(existing, { ...times, workDate }, rules, now, original?.id);
      const shift = await shiftFor(tx, e, workDate);
      const [created] = await tx
        .insert(opsAttendanceSessions)
        .values({
          staffId: c.staffId,
          workDate,
          ...times,
          timezone: e.timezone,
          breakMinutes: c.proposedBreakMinutes,
          source: 'correction',
          status: 'closed',
          ...shiftMeasures(shift, times, rules),
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
    const note = input.note ?? null;
    const [after] = await tx
      .update(opsAttendanceCorrections)
      .set({
        status: to,
        decidedBy: actor.id,
        decidedAt: now,
        decisionNote: note,
        resultingSessionId,
      })
      .where(eq(opsAttendanceCorrections.id, c.id))
      .returning();
    const change = {
      before: { status: c.status, originalSessionId: c.sessionId },
      after: { status: to, note, resultingSessionId, supersededSessionId: original?.id ?? null },
    };
    await auditCorrection(tx, actor, c.id, `attendance_correction.${to}`, change, requestId);
    await notifyOthers(tx, actor, [c.requestedBy], {
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
    const c = await rowById(tx, opsAttendanceCorrections, id, 'Correction', true);
    throwCheck(
      checkWithdraw({ from: c.status, actorUserId: actor.id, requestedByUserId: c.requestedBy }),
    );
    const [after] = await tx
      .update(opsAttendanceCorrections)
      .set({ status: 'withdrawn' })
      .where(eq(opsAttendanceCorrections.id, c.id))
      .returning();
    const change = { before: { status: c.status }, after: { status: 'withdrawn' } };
    await auditCorrection(tx, actor, c.id, 'attendance_correction.withdrawn', change, requestId);
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
  if (ids?.length === 0) return emptyPage(query.page ?? 1);
  const c = opsAttendanceCorrections;
  const where = and(
    ids ? inArray(c.staffId, ids) : undefined,
    query.staffId ? eq(c.staffId, query.staffId as StaffMemberId) : undefined,
    query.status ? eq(c.status, query.status as (typeof c.$inferSelect)['status']) : undefined,
  );
  return paginate(db, c, where, query.page, async (limit, offset) => {
    const rows = await db
      .select({ c, fullName: staffMembers.fullName })
      .from(c)
      .innerJoin(staffMembers, eq(staffMembers.id, c.staffId))
      .where(where)
      .orderBy(desc(c.createdAt))
      .limit(limit)
      .offset(offset);
    const canDecide = await decider(db, actor, 'ops:attendance:approve');
    return rows.map((r) => ({
      ...r.c,
      fullName: r.fullName,
      canDecide: r.c.status === 'pending' && canDecide(r.c.staffId, r.c.requestedBy),
    }));
  });
}

export async function getCorrection(db: Database, actor: Actor, id: string) {
  const scope = await hrScope(db, actor, 'ops:attendance:read');
  const c = await rowById(db, opsAttendanceCorrections, id, 'Correction');
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
