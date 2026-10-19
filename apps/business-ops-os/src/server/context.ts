/**
 * Shared server helpers: the acting principal, record-level scope (`own` =
 * records whose owner/counsellor is the staff member linked to the user),
 * business-code generation and small lookups. Every service checks its
 * permission here even when the route already did (pages call services directly).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { requirePermission, type Permission, type Principal } from '@elevate/authorization';
import { departments, programmes, staffMembers, userRoles, type Database } from '@elevate/database';
import { ForbiddenError, NotFoundError, ValidationError } from '@elevate/shared-contracts';
import type { DepartmentId, ProgrammeId, StaffMemberId, UserId } from '@elevate/shared-types';
import { CODE_FORMATS, formatCode, type CodeKind } from '../domain';

export type Actor = Principal;

/** The staff record linked to a user (null when the user is not staff). */
export async function staffIdForUser(db: Database, userId: UserId): Promise<StaffMemberId | null> {
  const [row] = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(eq(staffMembers.userId, userId))
    .limit(1);
  return row?.id ?? null;
}

export type AccessScope = { scope: 'all' } | { scope: 'own'; staffId: StaffMemberId | null };

/** Permission check + scope. Throws FORBIDDEN when the permission is not held. */
export async function accessScope(
  db: Database,
  actor: Actor,
  permission: Permission,
): Promise<AccessScope> {
  const scope = requirePermission(actor, permission);
  if (scope === 'all') return { scope: 'all' };
  return { scope: 'own', staffId: await staffIdForUser(db, actor.id) };
}

/** True when the scope covers a record owned by any of `ownerStaffIds`. */
export function scopeCovers(
  access: AccessScope,
  ownerStaffIds: readonly (string | null | undefined)[],
): boolean {
  if (access.scope === 'all') return true;
  return access.staffId !== null && ownerStaffIds.includes(access.staffId);
}

export function assertScope(
  access: AccessScope,
  ownerStaffIds: readonly (string | null | undefined)[],
  what = 'this record',
): void {
  if (!scopeCovers(access, ownerStaffIds)) {
    throw new ForbiddenError(`You can only work on ${what} assigned to you.`);
  }
}

/**
 * Next business code under a transaction-scoped advisory lock (D-009: never
 * reused; the unique index is the final guard). Codes are zero-padded, so the
 * lexicographic max of well-formed codes is the numeric max.
 */
export async function nextCode(
  tx: Database,
  kind: CodeKind,
  table: string,
  column = 'code',
): Promise<string> {
  const { prefix, width } = CODE_FORMATS[kind];
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ops.code.${kind}`}))`);
  const pattern = `^${prefix}-[0-9]{${width}}$`;
  const result = await tx.execute(
    sql`SELECT max(${sql.identifier(column)}) AS max FROM ${sql.raw(table)} WHERE ${sql.identifier(column)} ~ ${pattern}`,
  );
  const rows =
    (result as unknown as { rows?: { max: string | null }[] }).rows ??
    (result as unknown as { max: string | null }[]);
  const max = rows[0]?.max ?? null;
  const n = max ? Number(max.slice(prefix.length + 1)) + 1 : 1;
  return formatCode(kind, n);
}

/** Resolve an active (not retired) programme by code. */
export async function programmeByCode(
  db: Database,
  code: string,
): Promise<{ id: ProgrammeId; code: string; name: string }> {
  const [row] = await db
    .select({
      id: programmes.id,
      code: programmes.code,
      name: programmes.name,
      status: programmes.status,
    })
    .from(programmes)
    .where(eq(programmes.code, code))
    .limit(1);
  if (!row)
    throw new ValidationError(`Unknown programme "${code}".`, {
      details: [{ location: 'body', path: ['programmeCode'], message: 'Unknown programme' }],
    });
  if (row.status === 'retired') throw new ValidationError(`Programme ${code} is retired.`);
  return { id: row.id, code: row.code, name: row.name };
}

/** Resolve a staff member who must exist and be active. */
export async function activeStaff(
  db: Database,
  id: string,
  field = 'staffId',
): Promise<{
  id: StaffMemberId;
  userId: UserId | null;
  fullName: string;
  managerId: StaffMemberId | null;
}> {
  const [row] = await db
    .select({
      id: staffMembers.id,
      userId: staffMembers.userId,
      fullName: staffMembers.fullName,
      managerId: staffMembers.managerId,
      status: staffMembers.status,
    })
    .from(staffMembers)
    .where(eq(staffMembers.id, id as StaffMemberId))
    .limit(1);
  if (!row)
    throw new ValidationError('Unknown staff member.', {
      details: [{ location: 'body', path: [field], message: 'Unknown staff member' }],
    });
  if (row.status !== 'active')
    throw new ValidationError(`${row.fullName} is not active.`, {
      details: [{ location: 'body', path: [field], message: 'Staff member is not active' }],
    });
  return row;
}

export async function departmentByCode(db: Database, code: string): Promise<DepartmentId> {
  const [row] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.code, code))
    .limit(1);
  if (!row) throw new ValidationError(`Unknown department "${code}".`);
  return row.id;
}

/** Login user ids for staff ids (staff without a login are skipped). */
export async function userIdsForStaff(
  db: Database,
  staffIds: readonly (string | null | undefined)[],
): Promise<UserId[]> {
  const ids = [...new Set(staffIds.filter((s): s is string => Boolean(s)))] as StaffMemberId[];
  if (ids.length === 0) return [];
  const rows = await db
    .select({ userId: staffMembers.userId })
    .from(staffMembers)
    .where(and(inArray(staffMembers.id, ids)));
  return rows.map((r) => r.userId).filter((u): u is UserId => Boolean(u));
}

/** Users holding a role (e.g. operations managers as the escalation fallback). */
export async function userIdsWithRole(db: Database, role: string): Promise<UserId[]> {
  const rows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(eq(userRoles.role, role as never));
  return rows.map((r) => r.userId);
}

export function notFound(what: string): never {
  throw new NotFoundError(`${what} not found.`);
}

/** Trim; empty → null. */
export function clean(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}
