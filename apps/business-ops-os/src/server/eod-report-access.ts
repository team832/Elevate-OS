/**
 * Work reports: settings and period helpers, who a report goes to (§11) and who may read or
 * review it (R3). Used by eod-reports, eod-review, work-reports and attachments.
 */
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { can, grantsForRole, ROLE_KEYS } from '@elevate/authorization';
import {
  opsEodReportVersions as versions,
  staffMembers,
  userRoles,
  type Database,
  type opsEodReports as reports,
} from '@elevate/database';
import type { StaffMemberId, UserId } from '@elevate/shared-types';
import type { IsoDate } from '../domain/dates';
import { isImportedReport } from '../domain/eod';
import type { Period } from '../domain/work-report';
import { accessScope, managedStaffIds, notFound, staffIdForUser, type Actor } from './context';
import { loadSettings } from './settings';

type Row = typeof reports.$inferSelect;

/** Week start and report deadlines (Ops settings; null deadline = none set). */
export async function reportSettings(db: Database) {
  const s = await loadSettings(db);
  return {
    weekStart: s['reports.week_start'].value.day,
    deadlines: {
      day: s['eod.submission_deadline'].value.time,
      week: s['reports.weekly_deadline'].value.deadline,
      month: s['reports.monthly_deadline'].value.deadline,
    },
    external: s['eod.external_delivery'].value.channel,
  };
}

/** The deadline frozen on a submitted version: null = none was set; undefined = not stored (older version). */
export const storedDeadline = (snapshot: unknown) => {
  const d = (snapshot as { deadline?: string | null } | null | undefined)?.deadline;
  return d === undefined ? undefined : d ? new Date(d) : null;
};

export const periodOfRow = (r: Pick<Row, 'periodKind' | 'periodStart' | 'periodEnd'>): Period => ({
  kind: r.periodKind,
  start: r.periodStart as IsoDate,
  end: r.periodEnd as IsoDate,
});

/** Where the employee opens their own report (notification links). */
export const ownReportPath = (r: Pick<Row, 'periodKind' | 'periodStart'>) =>
  r.periodKind === 'day'
    ? `/tasks?tab=eod&date=${r.periodStart}`
    : `/my-reports?kind=${r.periodKind}&date=${r.periodStart}`;

export const manager = alias(staffMembers, 'manager');

/** Active staff with a login who hold ops:eod:review (the choice when no manager resolves). */
async function reviewerCandidates(db: Database, exceptStaffId: string) {
  const roles = ROLE_KEYS.filter((r) => grantsForRole(r).has('ops:eod:review'));
  return db
    .selectDistinct({
      staffId: staffMembers.id,
      name: staffMembers.fullName,
      userId: staffMembers.userId,
    })
    .from(staffMembers)
    .innerJoin(userRoles, eq(userRoles.userId, staffMembers.userId))
    .where(
      and(
        inArray(userRoles.role, roles),
        eq(staffMembers.status, 'active'),
        ne(staffMembers.id, exceptStaffId as StaffMemberId),
      ),
    )
    .orderBy(asc(staffMembers.fullName)) as Promise<
    { staffId: StaffMemberId; name: string; userId: UserId }[]
  >;
}

/**
 * Who a staff member's report goes to (§11): their reporting manager when active with a login;
 * otherwise why not, and the EOD reviewers they may choose from.
 */
export async function resolveRecipient(db: Database, staffId: string) {
  const [me] = await db
    .select({
      staffName: staffMembers.fullName,
      managerId: staffMembers.managerId,
      name: manager.fullName,
      status: manager.status,
      userId: manager.userId,
    })
    .from(staffMembers)
    .leftJoin(manager, eq(manager.id, staffMembers.managerId))
    .where(eq(staffMembers.id, staffId as StaffMemberId));
  if (!me) notFound('Staff member');
  if (me.managerId && me.status === 'active' && me.userId)
    return {
      kind: 'manager' as const,
      staffName: me.staffName,
      staffId: me.managerId,
      name: me.name!,
      userId: me.userId,
    };
  const why = !me.managerId
    ? 'No reporting manager is set for you in the Staff directory.'
    : me.status !== 'active'
      ? `Your reporting manager, ${me.name}, is not active.`
      : `Your reporting manager, ${me.name}, cannot sign in.`;
  return {
    kind: 'choose' as const,
    staffName: me.staffName,
    why,
    candidates: await reviewerCandidates(db, staffId),
  };
}

/**
 * Who may read a report: its owner; all-scope task readers; whoever a version was submitted
 * to; and, when `eod.manager_history` is `current_team_all`, the current manager chain (R3).
 * Drafts are the owner's (and all-scope readers'). Anyone else gets 404.
 */
export async function readerOf(db: Database, actor: Actor, row: Row) {
  const access = await accessScope(db, actor, 'ops:tasks:read');
  const self = await staffIdForUser(db, actor.id);
  if (row.staffId === self || access.scope === 'all') return self;
  if (self && row.status !== 'draft') {
    const sent = await db
      .select({ id: versions.id })
      .from(versions)
      .where(and(eq(versions.reportId, row.id), eq(versions.submittedToStaffId, self)))
      .limit(1);
    if (sent.length) return self;
    const history = (await loadSettings(db))['eod.manager_history'].value.scope;
    if (history === 'current_team_all' && (await managedStaffIds(db, self)).includes(row.staffId))
      return self;
  }
  notFound('Report');
}

/**
 * Can this reader act on a submitted report: an EOD reviewer, or the person it was sent to.
 * Imported tracker reports were never sent, so nobody reviews them.
 */
export const canReviewReport = (actor: Actor, self: string | null, r: Row) =>
  r.status !== 'draft' &&
  !isImportedReport(r.snapshot) &&
  r.staffId !== self &&
  (can(actor, 'ops:eod:review') || (self !== null && r.submittedToStaffId === self));
