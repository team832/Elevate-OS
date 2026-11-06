/**
 * Leave applications (owner decision 31 Oct 2026): anyone with a staff record applies for themselves;
 * those setting hr.leave_approver names decide, inside HR's staff scope and never their own, as with
 * attendance corrections, or their approval cover on the approver's behalf (F4-10). Approval writes
 * the leave record attendance reads, in one transaction. Every change is audited. Balances
 * (F4-12, leave-balances.ts) only warn unless the setting "Leave balances" says refuse.
 */
import { and, count, desc, eq, getTableColumns, gte, inArray, lte, ne, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { can } from '@elevate/authorization';
import {
  notifications,
  opsLeaveApplications,
  opsLeaveRecords,
  opsStaffProfiles,
  staffMembers,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import { notify } from '@elevate/notifications';
import { sendInternal, withTransaction } from '@elevate/server-kit';
import {
  academicHrLeaveV1Schema,
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  LINK_LOGIN_HELP,
  ValidationError,
} from '@elevate/shared-contracts';
import type { StaffMemberId, UserId } from '@elevate/shared-types';
import { istToday, type IsoDate } from '../domain/dates';
import {
  cancelRefusal,
  LEAVE_HOLDS_DATES,
  LEAVE_NOT_APPROVER,
  LEAVE_STATUSES,
  leaveAudit,
  leaveDatesProblem,
  leaveRange,
  leaveRowsFor,
  mayApproveLeave,
  RESEND_TO_ACADEMIC,
  type LeaveStatus,
} from '../domain/leave';
import { academicUrl } from './academic-summary';
import { refusal } from './assessments';
import { activeCoverFor, coverPrincipals } from './approval-cover';
import { attendanceStaff, hrAttendanceStaff } from './attendance';
import { cancelLeave, holdLeaveDates, manage, OWN_RECORD, writeLeave } from './attendance-actions';
import { attendanceManagers } from './attendance-corrections';
import type {
  leaveApplicationBody,
  leaveCancelBody,
  leaveDecisionBody,
  leaveListQuery,
} from './attendance-schemas';
import {
  accessScope,
  notFound,
  staffIdForUser,
  userIdsForStaff,
  userIdsWithRole,
  type Actor,
} from './context';
import { balanceNotes, refuseOverBalance } from './leave-balances';
import { fieldError, notifyOthers, opsAudit, rowById } from './ops-common';
import { hrReachWhere, hrScopeFor } from './organisation';
import { loadSettings } from './settings';
import { linkOr, notifyHosted } from './task-links';

const audit = opsAudit('leave_application');
export const LEAVE_PAGE_SIZE = 25;
const NO_STAFF = `Your login is not linked to a staff record yet, so you cannot apply for leave. ${LINK_LOGIN_HELP}`;
const STALE =
  'This application has changed since you opened it. Reload the page and check it again.';
const entity = (id: string) => ({ entityType: 'leave_application', entityId: id });
const HR_LEAVE = '/academic/api/internal/v1/teacher-unavailability/hr-leave';
const HR_LEAVE_TAB = '/ops/hr/attendance?tab=calendar';

const approvers = async (db: Database) =>
  (await loadSettings(db))['hr.leave_approver'].value.who as readonly string[];

/** The form's choices. */
export const leaveTypes = async (db: Database) =>
  (await loadSettings(db))['hr.leave_types'].value.types;

export async function applyForLeave(
  db: Database,
  actor: Actor,
  body: z.input<typeof leaveApplicationBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:attendance:request');
  const staffId = await staffIdForUser(db, actor.id);
  if (!staffId) throw new ValidationError(NO_STAFF);
  const settings = await loadSettings(db);
  if (!settings['hr.leave_types'].value.types.includes(body.kind))
    throw fieldError('kind', 'Choose a leave type from the list');
  const problem = leaveDatesProblem(body.fromDate, body.toDate, istToday(new Date()));
  if (problem) throw fieldError(problem.path, problem.message);
  const who: readonly string[] = settings['hr.leave_approver'].value.who;
  return withTransaction(db, async (tx) => {
    await holdLeaveDates(tx, staffId, body.fromDate, body.toDate);
    const [clash] = await tx
      .select(getTableColumns(opsLeaveApplications))
      .from(opsLeaveApplications)
      .where(
        and(
          eq(opsLeaveApplications.staffId, staffId),
          inArray(opsLeaveApplications.status, LEAVE_HOLDS_DATES),
          lte(opsLeaveApplications.fromDate, body.toDate),
          gte(opsLeaveApplications.toDate, body.fromDate),
        ),
      )
      .limit(1);
    if (clash)
      throw new ConflictError(
        `You already have ${clash.status === 'approved' ? 'approved leave' : 'a pending application'} for ${leaveRange(clash.fromDate, clash.toDate)}. Choose other dates, or cancel that first.`,
      );
    await refuseOverBalance(tx, { ...body, staffId });
    const [row] = await tx
      .insert(opsLeaveApplications)
      .values({ ...body, staffId, appliedBy: actor.id })
      .returning();
    await audit(tx, actor, row!.id, 'leave.applied', leaveAudit({ after: row }), requestId);
    const { fullName } = await rowById(tx, staffMembers, staffId, 'Staff member');
    const deciders = await attendanceManagers(tx, staffId, (roles) => mayApproveLeave(roles, who));
    for (const id of deciders)
      await notifyOthers(tx, actor, [id], {
        kind: 'leave.applied',
        title: `${fullName} applied for ${row!.kind} leave, ${leaveRange(row!.fromDate, row!.toDate, row!.dayPart)}`,
        link: await linkOr(tx, id, 'ops:attendance:manage', '/ops/hr/attendance?tab=leave', 'work', '/my-attendance'),
        ...entity(row!.id),
      });
    return row!;
  });
}

export async function decideLeave(
  db: Database,
  actor: Actor,
  id: string,
  body: z.output<typeof leaveDecisionBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:attendance:manage');
  const who = await approvers(db);
  const { row, leave } = await withTransaction(db, async (tx) => {
    const before = await rowById(tx, opsLeaveApplications, id, 'Leave application', true);
    const onBehalfOf = await leaveDecider(tx, actor, before.staffId, who);
    if (before.status !== 'pending')
      throw new InvalidStateTransitionError('This application has already been decided.');
    if (before.version !== body.version) throw new ConflictError(STALE);
    const leave =
      body.decision === 'approved'
        ? await writeLeave(
            tx,
            actor,
            {
              staffId: before.staffId,
              fromDate: before.fromDate as IsoDate,
              toDate: before.toDate as IsoDate,
              kind: before.kind,
              reason: before.reason,
              dayPart: before.dayPart,
              isSample: before.isSample,
              applicationId: before.id,
            },
            requestId,
          )
        : null;
    const [after] = await tx
      .update(opsLeaveApplications)
      .set({
        status: body.decision,
        decidedBy: actor.id,
        decidedAt: new Date(),
        decisionNote: body.note ?? null,
        leaveRecordId: leave?.id ?? null,
        onBehalfOf,
        version: before.version + 1,
      })
      .where(eq(opsLeaveApplications.id, id))
      .returning();
    await audit(tx, actor, id, `leave.${body.decision}`, leaveAudit({ before, after }), requestId);
    const cover = onBehalfOf && `Decided by approval cover for ${await displayName(tx, onBehalfOf)}.`;
    await notifyHosted(tx, actor, await userIdsForStaff(tx, [before.staffId]), 'work', '/my-attendance?view=leave', {
      kind: `leave.${body.decision}`,
      title: `Your ${before.kind} leave for ${leaveRange(before.fromDate, before.toDate, before.dayPart)} was ${body.decision}`,
      body: [body.note, cover].filter(Boolean).join(' ') || undefined,
      ...entity(id),
    });
    return { row: after!, leave };
  });
  if (leave) await coverClasses(db, actor, leave, row.onBehalfOf);
  return row;
}

const reaches = async (db: Database, p: Actor, staffId: string) =>
  (await hrAttendanceStaff(db, p, { ids: [staffId] })).length > 0;

/**
 * Who decides this person's leave: the actor in their own right (null), or the approver they cover
 * for today (F4-10), with that approver's role and reach. Nobody decides their own leave, and a
 * cover never decides the approver's own.
 */
async function leaveDecider(tx: Database, actor: Actor, staffId: string, who: readonly string[]) {
  if ((await staffIdForUser(tx, actor.id)) === staffId) throw new ForbiddenError(OWN_RECORD);
  const approver = mayApproveLeave(actor.roles, who);
  if (approver && (await reaches(tx, actor, staffId))) return null;
  for (const p of await coverPrincipals(tx, actor.id, 'leave'))
    if ((await staffIdForUser(tx, p.id)) !== staffId && (await reaches(tx, p, staffId))) return p.id;
  if (approver) notFound('Staff member');
  throw new ForbiddenError(LEAVE_NOT_APPROVER);
}

const displayName = async (db: Database, userId: string) =>
  (await db.select({ name: users.displayName }).from(users).where(eq(users.id, userId as UserId)))[0]
    ?.name ?? 'an approver';

/** Staff Ops counts as teachers: a teacher login, or a subject in the Teachers directory. */
export async function teachingStaff(db: Database, staffIds: readonly string[]) {
  const ids = [...new Set(staffIds)] as StaffMemberId[];
  if (!ids.length) return new Set<string>();
  const byRole = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .innerJoin(userRoles, eq(userRoles.userId, staffMembers.userId))
    .where(and(inArray(staffMembers.id, ids), eq(userRoles.role, 'teacher')));
  const byDirectory = await attendanceStaff(db, { ids, who: 'teachers' });
  return new Set<string>([...byRole, ...byDirectory].map((s) => s.id));
}

/**
 * D-134, called after the commit, never inside a transaction: Academic lists a teacher's classes in
 * approved leave as needing cover, or stops when the leave is cancelled, and coordinators are told.
 * Every leave is sent (Academic keeps it only for someone it plans classes for), so a cancel is
 * never skipped. An unreachable Academic never undoes the leave: coordinators and the HR person
 * are asked to check, and HR can use "Send to Academic again". Nothing is reassigned; neither the
 * type nor the reason leaves Ops.
 */
export async function coverClasses(
  db: Database,
  actor: Actor,
  leave: typeof opsLeaveRecords.$inferSelect,
  /** The approver a cover decided for (F4-10): told in the cover's place when Academic is down. */
  onBehalfOf?: UserId | null,
) {
  const { fromDate, toDate, status } = leave;
  const sent = await sendInternal(academicUrl(HR_LEAVE), academicHrLeaveV1Schema, {
    caller: 'ops',
    actingUserId: actor.id,
    body: { opsLeaveRecordId: leave.id, staffId: leave.staffId, fromDate, toDate, status },
    timeoutMs: 5000, // HR is waiting on the approval; a retry is safe (one record per leave)
  });
  if (toDate < istToday(new Date())) return sent; // past days are over: nobody to tell
  const about = { entityType: 'leave_record', entityId: leave.id };
  const told = await db
    .select({ kind: notifications.kind })
    .from(notifications)
    .where(
      and(eq(notifications.entityType, about.entityType), eq(notifications.entityId, leave.id)),
    );
  const approved = status === 'approved';
  const n = sent.ok ? sent.data.classes : 0;
  const kind = !sent.ok
    ? (told.length > 0 || (await teachingStaff(db, [leave.staffId])).size > 0) && 'check'
    : approved
      ? n > 0 && 'flagged'
      : (n > 0 || told.some((t) => t.kind === 'leave.classes_check')) && 'unflagged';
  if (!kind) return sent;
  const { fullName } = await rowById(db, staffMembers, leave.staffId, 'Staff member');
  const range = leaveRange(fromDate, toDate, leave.dayPart);
  // shortcut: the contract has no day part, so Academic lists the whole day; send the half once it does.
  const half = leave.dayPart
    ? ' This is half-day leave, and Academic OS cannot yet tell the halves apart, so every class that day is listed.'
    : '';
  const what = approved
    ? `${fullName} is on approved leave ${range}`
    : `${fullName}'s approved leave ${range} was cancelled`;
  const classes = `${n} ${n === 1 ? 'class' : 'classes'}`;
  const why = sent.ok
    ? ''
    : sent.status === 0
      ? sent.error.message === 'Timed out'
        ? 'Academic OS did not answer in time'
        : 'Academic OS could not be reached'
      : 'Academic OS did not accept it';
  const notice = {
    ...about,
    kind: `leave.classes_${kind}`,
    title:
      kind === 'check'
        ? `${what}: check their classes`
        : kind === 'flagged'
          ? `${what}: ${classes} ${n === 1 ? 'needs' : 'need'} cover`
          : what,
    body:
      kind === 'check'
        ? `${why}; check their classes, or use ${RESEND_TO_ACADEMIC} (HR: Attendance, Holidays and recorded leave). Nothing was reassigned.`
        : kind === 'flagged'
          ? `Academic OS lists them as needing cover. Nothing was reassigned.${half}`
          : `${n ? classes : 'Their classes'} in those dates no longer need cover for this leave.`,
  };
  const own = await userIdsForStaff(db, [leave.staffId]);
  const coordinators = (await userIdsWithRole(db, 'academic_coordinator')).filter(
    (u) => !own.includes(u),
  );
  await notifyOthers(db, actor, coordinators, {
    ...notice,
    link: `/academic/teachers/${leave.staffId}`,
  });
  if (kind === 'check') {
    const check = { ...notice, module: 'ops', link: HR_LEAVE_TAB } as const;
    // A cover cannot use Send to Academic again (approvers only): the approver they acted for can.
    await notify(db, { ...check, userIds: [onBehalfOf ?? actor.id] });
    if (onBehalfOf)
      await notify(db, {
        ...check,
        userIds: [actor.id],
        body: `${why}; check their classes. ${await displayName(db, onBehalfOf)}, whom you covered for, is told and can send it again. Nothing was reassigned.`,
      });
  }
  return sent;
}

/**
 * "Send to Academic again" (D-134): a leave record's current state, approved or cancelled, once
 * more. Academic keeps one record per leave, so repeating it changes nothing. Leave approvers only.
 */
export async function resendLeaveToAcademic(db: Database, actor: Actor, id: string) {
  await accessScope(db, actor, 'ops:attendance:manage');
  if (!mayApproveLeave(actor.roles, await approvers(db)))
    throw new ForbiddenError(LEAVE_NOT_APPROVER);
  const leave = await rowById(db, opsLeaveRecords, id, 'Leave');
  await manage(db, actor, leave.staffId);
  const sent = await coverClasses(db, actor, leave);
  if (!sent.ok) throw refusal(sent);
  return sent.data;
}

export async function cancelLeaveApplication(
  db: Database,
  actor: Actor,
  id: string,
  body: z.output<typeof leaveCancelBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:attendance:request');
  const own = await staffIdForUser(db, actor.id);
  const { row, leave } = await withTransaction(db, async (tx) => {
    const before = await rowById(tx, opsLeaveApplications, id, 'Leave application', true);
    const mine = before.staffId === own;
    if (!mine) {
      if (!can(actor, 'ops:attendance:manage')) notFound('Leave application');
      await manage(tx, actor, before.staffId);
    }
    const refusal = cancelRefusal(before.status, mine);
    if (refusal)
      throw refusal.forbidden
        ? new ForbiddenError(refusal.message)
        : new InvalidStateTransitionError(refusal.message);
    if (before.version !== body.version) throw new ConflictError(STALE);
    if (before.status === 'approved') {
      if (!body.reason) throw fieldError('reason', 'Say why the leave is cancelled');
      // cancelLeave checks the approver and closes this application: one path, however HR cancels.
      const leave = await cancelLeave(
        tx,
        actor,
        before.leaveRecordId!,
        { reason: body.reason },
        requestId,
      );
      return { row: await rowById(tx, opsLeaveApplications, id, 'Leave application'), leave };
    }
    const [after] = await tx
      .update(opsLeaveApplications)
      .set({
        status: 'cancelled',
        cancelledBy: actor.id,
        cancelledAt: new Date(),
        cancelReason: body.reason ?? null,
        version: before.version + 1,
      })
      .where(eq(opsLeaveApplications.id, id))
      .returning();
    await audit(tx, actor, id, 'leave.cancelled', leaveAudit({ before, after }), requestId);
    return { row: after!, leave: null };
  });
  if (leave) await coverClasses(db, actor, leave);
  return row;
}

const noLeaveCounts = () =>
  Object.fromEntries(LEAVE_STATUSES.map((s) => [s, 0])) as Record<LeaveStatus, number>;

/**
 * HR's staff scope, widened by the approvers this reader covers for today (F4-10), never to an
 * approver's own leave (a cover never decides it); undefined = everyone.
 */
async function leaveReach(db: Database, actor: Actor) {
  const own = hrReachWhere(actor, await hrScopeFor(db, actor));
  if (!own) return undefined;
  const parts = [own];
  for (const p of await coverPrincipals(db, actor.id, 'leave')) {
    const theirs = await staffIdForUser(db, p.id);
    parts.push(
      and(
        hrReachWhere(p, await hrScopeFor(db, p)) ?? sql`true`,
        theirs ? ne(opsLeaveApplications.staffId, theirs) : sql`true`,
      )!,
    );
  }
  return or(...parts);
}

/**
 * Applications, newest first, with a count per status from the same rows, each with its type's
 * balance (F4-12) and how far a pending one goes over it. Own scope = your own; another person's
 * id answers 404. HR readers see HR's staff scope (and a cover the approver's); others everyone.
 */
export async function listLeaveApplications(
  db: Database,
  actor: Actor,
  query: Partial<z.output<typeof leaveListQuery>>,
) {
  const access = await accessScope(db, actor, 'ops:attendance:read');
  const page = query.page ?? 1;
  const none = { items: [], total: 0, counts: noLeaveCounts(), page, pageSize: LEAVE_PAGE_SIZE };
  if (access.scope === 'own' && query.staffId && query.staffId !== access.staffId)
    notFound('Staff member');
  if (access.scope === 'own' && !access.staffId) return none;
  const staffId = access.scope === 'own' ? access.staffId : query.staffId;
  const who = and(
    staffId ? eq(opsLeaveApplications.staffId, staffId as StaffMemberId) : undefined,
    access.scope === 'all' ? await leaveReach(db, actor) : undefined,
  );
  const [rows, grouped] = await Promise.all([
    db
      .select({
        ...getTableColumns(opsLeaveApplications),
        staffName: sql<string>`coalesce(${opsStaffProfiles.displayName}, ${staffMembers.fullName})`,
      })
      .from(opsLeaveApplications)
      .innerJoin(staffMembers, eq(staffMembers.id, opsLeaveApplications.staffId))
      .leftJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
      .where(and(who, query.status ? eq(opsLeaveApplications.status, query.status) : undefined))
      .orderBy(desc(opsLeaveApplications.createdAt), desc(opsLeaveApplications.id))
      .limit(LEAVE_PAGE_SIZE)
      .offset((page - 1) * LEAVE_PAGE_SIZE),
    db
      .select({ status: opsLeaveApplications.status, n: count() })
      .from(opsLeaveApplications)
      .innerJoin(staffMembers, eq(staffMembers.id, opsLeaveApplications.staffId))
      .where(who)
      .groupBy(opsLeaveApplications.status),
  ]);
  const counts = noLeaveCounts();
  for (const g of grouped) counts[g.status] = g.n;
  const notes = await balanceNotes(db, rows);
  const covered = rows.flatMap((r) => (r.onBehalfOf ? [r.decidedBy!, r.onBehalfOf] : []));
  const names = new Map(
    covered.length
      ? (
          await db
            .select({ id: users.id, name: users.displayName })
            .from(users)
            .where(inArray(users.id, [...new Set(covered)]))
        ).map((u) => [u.id as string, u.name])
      : [],
  );
  const items = rows.map((r, i) => ({
    ...r,
    balance: notes[i]!.balance,
    overBy: r.status === 'pending' ? notes[i]!.overBy : 0,
    /** Approval cover (F4-10): "Decided by <cover> on behalf of <approver>". */
    decidedFor: r.onBehalfOf
      ? `Decided by ${names.get(r.decidedBy!) ?? 'a cover'} on behalf of ${names.get(r.onBehalfOf) ?? 'an approver'}`
      : null,
  }));
  return {
    items: leaveRowsFor(items, can(actor, 'ops:attendance:manage'), await staffIdForUser(db, actor.id)),
    total: query.status ? counts[query.status] : grouped.reduce((sum, g) => sum + g.n, 0),
    counts,
    page,
    pageSize: LEAVE_PAGE_SIZE,
  };
}
export type LeaveList = Awaited<ReturnType<typeof listLeaveApplications>>;

/** Decide buttons show only for someone the server would let decide: an approver, or their cover today. */
export const canDecideLeave = async (db: Database, actor: Actor) =>
  can(actor, 'ops:attendance:manage') &&
  (mayApproveLeave(actor.roles, await approvers(db)) ||
    (await activeCoverFor(db, actor.id, 'leave')).length > 0);
