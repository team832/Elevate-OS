/**
 * Users & roles (D-030, OD-009): list and inspect accounts, add a person, set
 * roles, disable/enable. Routes and pages check the permission per request;
 * these functions enforce the rules every caller must obey:
 * - nobody changes their own roles or status (another administrator must);
 * - the last active platform administrator cannot lose the role or be disabled;
 * - only @elevateeducation.in accounts are added (DB CHECK `users_email_domain` backs it);
 * - every change is audited in the same transaction.
 */
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
  assertAllowedEmail,
  loadRoles,
  revokeAllSessionsForUser,
  type AuthenticatedUser,
} from '@elevate/authentication';
import { ROLE_KEYS, requirePermission, type RoleKey } from '@elevate/authorization';
import { auditEvents, userRoles, users, type Database } from '@elevate/database';
import { recordAudit, withTransaction } from '@elevate/server-kit';
import { ConflictError, ForbiddenError, NotFoundError } from '@elevate/shared-contracts';
import type { UserId } from '@elevate/shared-types';

export const PAGE_SIZE = 25;
export const USER_SORTS = ['name', 'email', 'created', 'last_sign_in'] as const;
/** `role=none` is the "No roles yet" filter. */
export const NO_ROLES = 'none';

const roleList = z
  .array(z.enum(ROLE_KEYS))
  .max(ROLE_KEYS.length)
  .transform((r) => [...new Set(r)].sort());

export const userIdParams = z.object({ id: z.uuid().transform((v) => v as UserId) });
export const listUsersQuery = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.union([z.enum(ROLE_KEYS), z.literal(NO_ROLES)]).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  sort: z.enum(USER_SORTS).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export const addPersonBody = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .regex(/^[^@\s]+@[^@\s]+$/, { error: 'Enter an email address.' }),
  displayName: z.string().trim().min(1).max(200),
  roles: roleList.default([]),
});
export const rolesBody = z.object({ roles: roleList });
export const statusBody = z.object({ status: z.enum(['active', 'disabled']) });

export type ListUsersQuery = z.infer<typeof listUsersQuery>;

// Correlated subqueries spelled out: drizzle renders columns unqualified inside sql``.
const viaGoogle = sql<boolean>`exists (select 1 from ${auditEvents} a where a.entity_type = 'user' and a.entity_id = ${users}.id::text and a.action = 'user.created_via_google')`;
const holds = (role?: RoleKey) =>
  sql`exists (select 1 from ${userRoles} r where r.user_id = ${users}.id${role ? sql` and r.role = ${role}` : sql``})`;

export async function listUsers(db: Database, query: ListUsersQuery) {
  const where: SQL[] = [];
  if (query.q) {
    const like = `%${query.q.replace(/[\\%_]/g, '\\$&')}%`;
    where.push(or(ilike(users.displayName, like), ilike(users.email, like))!);
  }
  if (query.status) where.push(eq(users.status, query.status));
  if (query.role === NO_ROLES) where.push(sql`not ${holds()}`);
  else if (query.role) where.push(holds(query.role));

  const column = {
    name: users.displayName,
    email: users.email,
    created: users.createdAt,
    last_sign_in: users.lastLoginAt,
  }[query.sort];
  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(users)
    .where(and(...where));
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      viaGoogle,
    })
    .from(users)
    .where(and(...where))
    .orderBy(sql`${column} ${sql.raw(query.dir)} nulls last`, asc(users.id))
    .limit(PAGE_SIZE)
    .offset((query.page - 1) * PAGE_SIZE);
  const grants = rows.length
    ? await db
        .select({ userId: userRoles.userId, role: userRoles.role })
        .from(userRoles)
        .where(
          inArray(
            userRoles.userId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  const items = rows.map((r) => ({
    ...r,
    roles: grants
      .filter((g) => g.userId === r.id && (ROLE_KEYS as readonly string[]).includes(g.role))
      .map((g) => g.role)
      .sort(),
  }));
  return { items, total, page: query.page, pageSize: PAGE_SIZE };
}

const actor = alias(users, 'actor');

export async function getUserDetail(db: Database, id: UserId) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
      hasPassword: sql<boolean>`${users.passwordHash} is not null`,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      viaGoogle,
    })
    .from(users)
    .where(eq(users.id, id));
  if (!user) throw new NotFoundError('There is no account with this id.');
  const history = await db
    .select({
      id: auditEvents.id,
      at: auditEvents.at,
      action: auditEvents.action,
      actorName: actor.displayName,
      before: auditEvents.before,
      after: auditEvents.after,
    })
    .from(auditEvents)
    .leftJoin(actor, eq(actor.id, auditEvents.actorUserId))
    .where(and(eq(auditEvents.entityType, 'user'), eq(auditEvents.entityId, id)))
    .orderBy(desc(auditEvents.at))
    .limit(50);
  return { user, roles: await loadRoles(db, id), history };
}

function notSelf(user: AuthenticatedUser, id: UserId, what: string) {
  if (user.id === id) throw new ForbiddenError(`You cannot ${what}. Ask another administrator.`);
}

/**
 * Lock the active platform administrators' rows, then the target's. Always in
 * this order, so two administrators acting on each other at once queue instead
 * of deadlocking, and the last-administrator check sees committed changes.
 */
async function lockForChange(tx: Database, id: UserId) {
  const admins = await tx
    .select({ id: users.id })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(userRoles.role, 'platform_admin'), eq(users.status, 'active')))
    .for('update');
  const [target] = await tx
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(eq(users.id, id))
    .for('update');
  if (!target) throw new NotFoundError('There is no account with this id.');
  const lastAdmin = (message: string) => {
    if (!admins.some((a) => a.id !== id)) throw new ConflictError(message);
  };
  return { target, lastAdmin };
}

export async function addPerson(
  db: Database,
  user: AuthenticatedUser,
  body: z.infer<typeof addPersonBody>,
  requestId: string,
) {
  assertAllowedEmail(body.email);
  if (body.roles.length > 0) requirePermission(user, 'platform:roles:manage');
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({ email: body.email, displayName: body.displayName, passwordHash: null })
      .onConflictDoNothing()
      .returning({ id: users.id });
    if (!row) throw new ConflictError(`${body.email} already has an account.`);
    if (body.roles.length > 0)
      await tx
        .insert(userRoles)
        .values(body.roles.map((role) => ({ userId: row.id, role, grantedBy: user.id })));
    await recordAudit(tx, {
      actorUserId: user.id,
      module: 'platform',
      action: 'user.created',
      entityType: 'user',
      entityId: row.id,
      after: body,
      requestId,
    });
    return { id: row.id };
  });
}

export async function setUserRoles(
  db: Database,
  user: AuthenticatedUser,
  id: UserId,
  roles: RoleKey[],
  requestId: string,
) {
  notSelf(user, id, 'change your own roles');
  return withTransaction(db, async (tx) => {
    const { target, lastAdmin } = await lockForChange(tx, id);
    const before = await loadRoles(tx, id);
    const added = roles.filter((r) => !before.includes(r));
    const removed = before.filter((r) => !roles.includes(r));
    if (removed.includes('platform_admin') && target.status === 'active')
      lastAdmin(
        'This is the last active platform administrator. Give the role to someone else first.',
      );
    if (removed.length > 0)
      await tx
        .delete(userRoles)
        .where(and(eq(userRoles.userId, id), inArray(userRoles.role, removed)));
    if (added.length > 0)
      await tx
        .insert(userRoles)
        .values(added.map((role) => ({ userId: id, role, grantedBy: user.id })));
    if (added.length > 0 || removed.length > 0)
      await recordAudit(tx, {
        actorUserId: user.id,
        module: 'platform',
        action: 'user.roles_changed',
        entityType: 'user',
        entityId: id,
        before: { roles: before },
        after: { roles },
        requestId,
      });
    return { id, roles };
  });
}

export async function setUserStatus(
  db: Database,
  user: AuthenticatedUser,
  id: UserId,
  status: 'active' | 'disabled',
  requestId: string,
) {
  notSelf(user, id, status === 'disabled' ? 'disable your own account' : 'enable your own account');
  return withTransaction(db, async (tx) => {
    const { target, lastAdmin } = await lockForChange(tx, id);
    if (target.status === status) return { id, status, sessionsRevoked: 0 };
    if (status === 'disabled' && (await loadRoles(tx, id)).includes('platform_admin'))
      lastAdmin(
        'This is the last active platform administrator. Make someone else an administrator first.',
      );
    await tx.update(users).set({ status }).where(eq(users.id, id));
    const sessionsRevoked = status === 'disabled' ? await revokeAllSessionsForUser(tx, id) : 0;
    await recordAudit(tx, {
      actorUserId: user.id,
      module: 'platform',
      action: status === 'disabled' ? 'user.disabled' : 'user.enabled',
      entityType: 'user',
      entityId: id,
      before: { status: target.status },
      after: { status },
      metadata: { sessionsRevoked },
      requestId,
    });
    return { id, status, sessionsRevoked };
  });
}

export const auditLabel = (action: string): string =>
  ({
    'user.created_via_google': 'Account created at first Google sign-in',
    'user.created': 'Added by an administrator',
    'user.roles_changed': 'Roles changed',
    'role.bootstrapped': 'Roles granted from BOOTSTRAP_OWNER_EMAILS at sign-in',
    'user.disabled': 'Account disabled, all sessions ended',
    'user.enabled': 'Account enabled',
    'user.access_revoked': 'Access revoked after leaving (HR separation)',
  })[action] ?? action;
