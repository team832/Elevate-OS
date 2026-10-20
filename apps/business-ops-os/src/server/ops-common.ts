/**
 * Helpers shared by the operations services (tasks, SOPs, policies, registers):
 * row lookup with 404, audit rows, notifications that skip the actor, the
 * audit-log history of one record and the approval history of versioned records.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { auditEvents, staffMembers, users, type Database } from '@elevate/database';
import { notify, type NotifyInput } from '@elevate/notifications';
import { listApprovalHistory, recordAudit, type AuditInput } from '@elevate/server-kit';
import type { UserId } from '@elevate/shared-types';
import { notFound, type Actor } from './context';

/** Drop undefined fields (a PATCH body becomes an update set). */
export const defined = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/** One row by id (optionally locked FOR UPDATE), or NOT_FOUND "<what> not found.". */
export async function rowById<T extends PgTable & { id: PgColumn }>(
  db: Database,
  table: T,
  id: string,
  what: string,
  lock = false,
): Promise<T['$inferSelect']> {
  const q = db
    .select()
    .from(table as PgTable)
    .where(eq(table.id, id))
    .limit(1);
  const [row] = lock ? await q.for('update') : await q;
  if (!row) notFound(what);
  return row as T['$inferSelect'];
}

export type AuditData = Pick<AuditInput, 'before' | 'after' | 'metadata'>;

/** Audit writer for one entity type; a null actor is the system (jobs). */
export const opsAudit =
  (entityType: string) =>
  (
    tx: Database,
    actor: Actor | null | undefined,
    entityId: string | null | undefined,
    action: string,
    data: AuditData = {},
    requestId?: string,
  ) =>
    recordAudit(tx, {
      actorUserId: actor?.id ?? null,
      module: 'ops',
      action,
      entityType,
      entityId,
      requestId,
      ...data,
    });

/** In-app notification to `userIds` except the actor (an empty list sends nothing). */
export const notifyOthers = (
  tx: Database,
  actor: Actor,
  userIds: readonly UserId[],
  input: Omit<NotifyInput, 'userIds' | 'module'>,
) => notify(tx, { ...input, module: 'ops', userIds: userIds.filter((u) => u !== actor.id) });

/** Audit events of one ops record with the actor's name, newest first. */
export const auditTrail = (db: Database, entityType: string, entityId: string, limit: number) =>
  db
    .select({ e: auditEvents, actorName: users.displayName })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(
      and(
        eq(auditEvents.module, 'ops'),
        eq(auditEvents.entityType, entityType),
        eq(auditEvents.entityId, entityId),
      ),
    )
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .limit(limit);

type ApprovalRow = Awaited<ReturnType<typeof listApprovalHistory>>[number];

/** Core approval history of every version, in version order, with per-version fields added. */
export async function versionApprovals<V extends { id: string }, X extends object>(
  db: Database,
  subjectType: string,
  versions: readonly V[],
  extra: (a: ApprovalRow, v: V) => X,
) {
  const out: (ApprovalRow & X)[] = [];
  for (const v of versions)
    for (const a of await listApprovalHistory(db, { module: 'ops', subjectType, subjectId: v.id }))
      out.push({ ...a, ...extra(a, v) });
  return out;
}

/** Staff id → login user id, from one load of the staff table. */
export async function staffUserLookup(db: Database) {
  const staff = await db
    .select({ id: staffMembers.id, userId: staffMembers.userId })
    .from(staffMembers);
  return (sid: string | null) => staff.find((s) => s.id === sid)?.userId ?? null;
}
