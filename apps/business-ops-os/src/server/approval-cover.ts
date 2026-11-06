/**
 * Approval cover while away (F4-10). Someone who approves leave, handles requests to HR or approves
 * fee discounts and waivers names a cover and IST dates; on those days the cover sees and decides
 * those items with the approver's right and reach, recorded `on_behalf_of` the approver. Every other
 * rule still holds: nobody decides their own item or the approver's, the maker never approves. One
 * approver's covers never overlap; covers are revoked, never deleted; every change is audited.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { loadRoles } from '@elevate/authentication';
import { can, ROLES } from '@elevate/authorization';
import {
  opsApprovalDelegations as covers,
  staffMembers,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  isoDateSchema,
} from '@elevate/shared-contracts';
import type { UserId } from '@elevate/shared-types';
import { addDays, istToday, type IsoDate } from '../domain/dates';
import { leaveRange, mayApproveLeave } from '../domain/leave';
import { activeStaff, notFound, type Actor } from './context';
import { fieldError, groupBy, notifyOthers, opsAudit, rowById } from './ops-common';
import { loadSettings } from './settings';

export const COVER_KINDS = ['leave', 'hr_request', 'fee_approval'] as const;
export type CoverKind = (typeof COVER_KINDS)[number];
export const COVER_KIND_LABELS: Record<CoverKind, string> = {
  leave: 'Leave applications',
  hr_request: 'Requests to HR',
  fee_approval: 'Fee discounts and waivers',
};
export const COVER_PAGE = '/ops/approval-cover';
const NOT_APPROVER =
  'You do not approve leave, requests to HR or fee discounts, so there is nothing to cover.';

type Settings = Awaited<ReturnType<typeof loadSettings>>;
/** The approval right each kind needs: the same checks its decision path makes. */
const RIGHT: Record<CoverKind, (p: Actor, s: Settings) => boolean> = {
  leave: (p, s) =>
    can(p, 'ops:attendance:manage') && mayApproveLeave(p.roles, s['hr.leave_approver'].value.who),
  hr_request: (p) => can(p, 'ops:hr_requests:manage'),
  fee_approval: (p) => can(p, 'ops:admissions:approve'),
};

/** The kinds of item this person approves (none: nothing to cover). */
export async function approvalKinds(db: Database, p: Actor): Promise<CoverKind[]> {
  const s = await loadSettings(db);
  return COVER_KINDS.filter((k) => RIGHT[k](p, s));
}

/**
 * Who may cover, now: active staff with an active login and a role setting hr.approval_cover
 * lists, one row per role, narrowed by `where`. Checked when naming and on every use.
 */
async function eligible(db: Database, where: SQL) {
  const roles = (await loadSettings(db))['hr.approval_cover'].value.roles;
  return db
    .select({ id: staffMembers.id, name: staffMembers.fullName, role: userRoles.role })
    .from(staffMembers)
    .innerJoin(users, eq(users.id, staffMembers.userId))
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(
      and(
        eq(staffMembers.status, 'active'),
        eq(users.status, 'active'),
        inArray(userRoles.role, [...roles]),
        where,
      ),
    )
    .orderBy(asc(staffMembers.fullName), asc(userRoles.role));
}

/**
 * The approvers `coverUserId` acts for on `onDate` (IST) for `kind`, as principals: the cover still
 * may cover (eligible), a live cover whose dates include the day, from an active approver who
 * still holds that right.
 */
export async function coverPrincipals(
  tx: Database,
  coverUserId: string,
  kind: CoverKind,
  onDate: string = istToday(new Date()),
): Promise<Actor[]> {
  if (!(await eligible(tx, eq(users.id, coverUserId as UserId))).length) return [];
  const rows = await tx
    .select({ id: covers.approverUserId })
    .from(covers)
    .innerJoin(users, eq(users.id, covers.approverUserId))
    .where(
      and(
        eq(covers.coverUserId, coverUserId as UserId),
        isNull(covers.revokedAt),
        lte(covers.fromDate, onDate),
        gte(covers.toDate, onDate),
        eq(users.status, 'active'),
      ),
    );
  if (!rows.length) return [];
  const s = await loadSettings(tx);
  const out: Actor[] = [];
  for (const { id } of rows) {
    const p: Actor = { id, roles: await loadRoles(tx, id) };
    if (RIGHT[kind](p, s)) out.push(p);
  }
  return out;
}

/**
 * Approver user ids the cover may act for on `onDate` (IST, default today) for `kind`. A decision
 * made through one writes `on_behalf_of` = that approver; the caller still refuses items that
 * belong to the cover or to that approver.
 */
export const activeCoverFor = async (
  tx: Database,
  coverUserId: string,
  kind: CoverKind,
  onDate?: string,
): Promise<UserId[]> => (await coverPrincipals(tx, coverUserId, kind, onDate)).map((p) => p.id);

export const coverBody = z
  .object({
    coverStaffId: z.uuid('Choose who covers for you'),
    fromDate: isoDateSchema,
    toDate: isoDateSchema,
    note: z.string().trim().max(500).nullish(),
  })
  .strict()
  .refine((b) => b.toDate >= b.fromDate, {
    path: ['toDate'],
    message: 'The last day cannot be before the first day',
  });

const audit = opsAudit('approval_cover');
const entity = (id: string) => ({ entityType: 'approval_cover', entityId: id, link: COVER_PAGE });
type CoverRow = typeof covers.$inferSelect;

export type CoverState = 'upcoming' | 'active' | 'ended' | 'revoked';
/** Upcoming, active (IST today within the dates), ended or revoked. */
export const coverState = (
  r: Pick<CoverRow, 'fromDate' | 'toDate' | 'revokedAt'>,
  today: string,
): CoverState =>
  r.revokedAt ? 'revoked' : today < r.fromDate ? 'upcoming' : today > r.toDate ? 'ended' : 'active';

const nameOf = async (db: Database, userId: string) => {
  const [r] = await db
    .select({ name: users.displayName })
    .from(users)
    .where(eq(users.id, userId as UserId));
  return r?.name ?? 'A colleague';
};

/**
 * Who may be named: active staff with a working login and a role from setting hr.approval_cover,
 * never the approver. Labelled with their roles.
 */
export async function coverOptions(db: Database, actor: Actor) {
  const rows = await eligible(db, ne(users.id, actor.id as UserId));
  return [...groupBy(rows, (r) => r.id).values()].map((rs) => ({
    value: rs[0]!.id as string,
    label: `${rs[0]!.name} (${rs.map((r) => ROLES[r.role]?.label ?? r.role).join(', ')})`,
  }));
}

/** Name a cover for your approvals on these dates. Refuses yourself, past starts and overlaps. */
export async function createCover(
  db: Database,
  actor: Actor,
  body: z.output<typeof coverBody>,
  requestId?: string,
) {
  if (!(await approvalKinds(db, actor)).length) throw new ForbiddenError(NOT_APPROVER);
  const cover = await activeStaff(db, body.coverStaffId, 'coverStaffId');
  if (cover.userId === actor.id)
    throw fieldError('coverStaffId', 'Choose someone other than yourself.');
  if (!(await coverOptions(db, actor)).some((o) => o.value === cover.id))
    throw fieldError(
      'coverStaffId',
      `${cover.fullName} cannot be named as cover (no working login, or a role the setting "Who may be named as approval cover" does not list).`,
    );
  if (body.fromDate < istToday(new Date()))
    throw fieldError('fromDate', 'A cover cannot start in the past.');
  if (body.toDate > addDays(body.fromDate as IsoDate, 365))
    throw fieldError('toDate', 'A cover lasts a year at most. Check the dates.');
  return withTransaction(db, async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ops.cover.${actor.id}`}))`);
    const [clash] = await tx
      .select()
      .from(covers)
      .where(
        and(
          eq(covers.approverUserId, actor.id),
          isNull(covers.revokedAt),
          lte(covers.fromDate, body.toDate),
          gte(covers.toDate, body.fromDate),
        ),
      )
      .limit(1);
    if (clash)
      throw new ConflictError(
        `You already have a cover for ${leaveRange(clash.fromDate, clash.toDate)}. Revoke it first, or choose other dates.`,
      );
    const [row] = await tx
      .insert(covers)
      .values({
        approverUserId: actor.id,
        coverUserId: cover.userId!,
        fromDate: body.fromDate,
        toDate: body.toDate,
        note: body.note || null,
        createdBy: actor.id,
      })
      .returning();
    await audit(tx, actor, row!.id, 'approval_cover.created', { after: row }, requestId);
    await notifyOthers(tx, actor, [cover.userId!], {
      kind: 'approval_cover.named',
      title: `${await nameOf(tx, actor.id)} named you as approval cover, ${leaveRange(row!.fromDate, row!.toDate)}`,
      ...entity(row!.id),
    });
    return row!;
  });
}

/** End a cover early: the approver, or the cover stepping down. Audited; the row stays. */
export async function revokeCover(db: Database, actor: Actor, id: string, requestId?: string) {
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, covers, id, 'Cover', true);
    if (before.approverUserId !== actor.id && before.coverUserId !== actor.id) notFound('Cover');
    const state = coverState(before, istToday(new Date()));
    if (state === 'revoked' || state === 'ended')
      throw new InvalidStateTransitionError(`This cover has already ${state}.`);
    const [after] = await tx
      .update(covers)
      .set({ revokedAt: new Date(), revokedBy: actor.id })
      .where(eq(covers.id, id))
      .returning();
    await audit(tx, actor, id, 'approval_cover.revoked', { before, after }, requestId);
    await notifyOthers(tx, actor, [before.approverUserId, before.coverUserId], {
      kind: 'approval_cover.revoked',
      title: `${await nameOf(tx, actor.id)} ended the approval cover for ${leaveRange(before.fromDate, before.toDate)}`,
      ...entity(id),
    });
    return after!;
  });
}

/** Covers you gave and covers you hold, newest first, with names and states; what you approve. */
export async function myCovers(db: Database, actor: Actor) {
  const rows = await db
    .select()
    .from(covers)
    .where(or(eq(covers.approverUserId, actor.id), eq(covers.coverUserId, actor.id)))
    .orderBy(desc(covers.fromDate), desc(covers.createdAt));
  const ids = [...new Set(rows.flatMap((r) => [r.approverUserId, r.coverUserId]))];
  const names = new Map(
    ids.length
      ? (
          await db
            .select({ id: users.id, name: users.displayName })
            .from(users)
            .where(inArray(users.id, ids))
        ).map((u) => [u.id as string, u.name])
      : [],
  );
  const today = istToday(new Date());
  const shaped = rows.map((r) => ({
    ...r,
    approverName: names.get(r.approverUserId) ?? 'Staff member',
    coverName: names.get(r.coverUserId) ?? 'Staff member',
    state: coverState(r, today),
  }));
  return {
    kinds: await approvalKinds(db, actor),
    given: shaped.filter((r) => r.approverUserId === actor.id),
    held: shaped.filter((r) => r.coverUserId === actor.id),
  };
}
