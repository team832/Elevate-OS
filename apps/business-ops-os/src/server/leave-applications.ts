/**
 * Leave applications (owner decision 31 Oct 2026): anyone with a staff record applies for themselves;
 * those setting hr.leave_approver names decide, inside HR's staff scope and never their own, as with
 * attendance corrections. Approval writes the leave record attendance reads, in one transaction.
 * Every change is audited. No balances: those rules are the owner's.
 */
import { and, count, desc, eq, getTableColumns, gte, inArray, lte, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { loadRoles } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import {
  opsLeaveApplications,
  opsStaffProfiles,
  staffMembers,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  LINK_LOGIN_HELP,
  ValidationError,
} from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
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
  type LeaveStatus,
} from '../domain/leave';
import { fetchTeacherActivity } from './academic-summary';
import { attendanceStaff } from './attendance';
import { cancelLeave, manage, recordLeave } from './attendance-actions';
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

const approvers = async (db: Database) =>
  (await loadSettings(db))['hr.leave_approver'].value.who as readonly string[];

/** The form's choices. */
export const leaveTypes = async (db: Database) =>
  (await loadSettings(db))['hr.leave_types'].value.types;

export async function applyForLeave(
  db: Database,
  actor: Actor,
  body: z.output<typeof leaveApplicationBody>,
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
    // Two applications at once: the second must see the first.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ops.leave_applications:${staffId}`}))`);
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
        title: `${fullName} applied for ${row!.kind} leave, ${leaveRange(row!.fromDate, row!.toDate)}`,
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
  if (!mayApproveLeave(actor.roles, await approvers(db)))
    throw new ForbiddenError(LEAVE_NOT_APPROVER);
  const row = await withTransaction(db, async (tx) => {
    const before = await rowById(tx, opsLeaveApplications, id, 'Leave application', true);
    await manage(tx, actor, before.staffId); // HR's scope first (404), and never your own
    if (before.status !== 'pending')
      throw new InvalidStateTransitionError('This application has already been decided.');
    if (before.version !== body.version) throw new ConflictError(STALE);
    const leave =
      body.decision === 'approved'
        ? await recordLeave(
            tx,
            actor,
            {
              staffId: before.staffId,
              fromDate: before.fromDate as IsoDate,
              toDate: before.toDate as IsoDate,
              kind: before.kind,
              reason: before.reason,
              isSample: before.isSample,
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
        version: before.version + 1,
      })
      .where(eq(opsLeaveApplications.id, id))
      .returning();
    await audit(tx, actor, id, `leave.${body.decision}`, leaveAudit({ before, after }), requestId);
    await notifyHosted(tx, actor, await userIdsForStaff(tx, [before.staffId]), 'work', '/my-attendance?view=leave', {
      kind: `leave.${body.decision}`,
      title: `Your ${before.kind} leave for ${leaveRange(before.fromDate, before.toDate)} was ${body.decision}`,
      body: body.note ?? undefined,
      ...entity(id),
    });
    return after!;
  });
  // A network call, after the commit: it never holds the transaction or undoes the approval.
  if (row.status === 'approved') await flagClasses(db, actor, row);
  return row;
}

/**
 * Tell coordinators how many classes a teacher has planned while on approved leave. A flag only:
 * nothing is reassigned, and the notice names neither the type nor the reason. Past days are over.
 * shortcut: the contract gives a count, not the classes; naming them needs a new contract version.
 */
async function flagClasses(db: Database, actor: Actor, a: typeof opsLeaveApplications.$inferSelect) {
  const today = istToday(new Date());
  const from = a.fromDate < today ? today : a.fromDate;
  if (from > a.toDate) return;
  const teaches =
    (await loadRoles(db, a.appliedBy)).includes('teacher') ||
    (await attendanceStaff(db, { ids: [a.staffId], who: 'teachers' })).length > 0;
  if (!teaches) return;
  const activity = await fetchTeacherActivity(a.staffId, { from, to: a.toDate });
  const planned = activity.status === 'available' ? activity.data.sessions.planned.value : null;
  if (planned === 0) return; // no count at all is not zero: the coordinator is asked to check
  const { fullName } = await rowById(db, staffMembers, a.staffId, 'Staff member');
  const range = leaveRange(a.fromDate, a.toDate);
  const coordinators = (await userIdsWithRole(db, 'academic_coordinator')).filter(
    (u) => u !== a.appliedBy,
  );
  await notifyOthers(db, actor, coordinators, {
    kind: 'leave.classes_flagged',
    title: planned
      ? `${fullName} is on approved leave ${range}, with ${planned} ${planned === 1 ? 'class' : 'classes'} planned`
      : `${fullName} is on approved leave ${range}: check their classes`,
    body: `${planned ? '' : 'Academic OS did not give a count of the classes. '}Nothing was reassigned. Arrange cover if it is needed.`,
    link: `/academic/teachers/${a.staffId}`,
    ...entity(a.id),
  });
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
  return withTransaction(db, async (tx) => {
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
      await cancelLeave(tx, actor, before.leaveRecordId!, { reason: body.reason }, requestId);
      return rowById(tx, opsLeaveApplications, id, 'Leave application');
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
    return after!;
  });
}

const noLeaveCounts = () =>
  Object.fromEntries(LEAVE_STATUSES.map((s) => [s, 0])) as Record<LeaveStatus, number>;

/**
 * Applications, newest first, with a count per status from the same rows. Own scope = your own;
 * another person's id answers 404. HR readers see HR's staff scope; others everyone.
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
    access.scope === 'all' ? hrReachWhere(actor, await hrScopeFor(db, actor)) : undefined,
  );
  const [items, grouped] = await Promise.all([
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
  return {
    items: leaveRowsFor(items, can(actor, 'ops:attendance:manage'), await staffIdForUser(db, actor.id)),
    total: query.status ? counts[query.status] : grouped.reduce((sum, g) => sum + g.n, 0),
    counts,
    page,
    pageSize: LEAVE_PAGE_SIZE,
  };
}
export type LeaveList = Awaited<ReturnType<typeof listLeaveApplications>>;

/** Decide buttons show only for someone the server would let decide. */
export const canDecideLeave = async (db: Database, actor: Actor) =>
  can(actor, 'ops:attendance:manage') && mayApproveLeave(actor.roles, await approvers(db));
