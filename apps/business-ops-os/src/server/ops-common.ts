/**
 * Helpers shared by the Ops services: row lookup with 404, audit rows and
 * notifications that skip the actor.
 */
import { eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Database } from '@elevate/database';
import { notify, type NotifyInput } from '@elevate/notifications';
import { recordAudit, type AuditInput } from '@elevate/server-kit';
import { ValidationError } from '@elevate/shared-contracts';
import type { UserId } from '@elevate/shared-types';
import { notFound, type Actor } from './context';

/** A 400 pointing at one body field, shown next to that field in the form. */
export const fieldError = (path: string, message: string) =>
  new ValidationError(message, { details: [{ location: 'body', path: [path], message }] });

/** Drop undefined fields (a PATCH body becomes an update set). */
export const defined = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/**
 * `Promise.all` for code that may run on a transaction: awaits one at a time, because a
 * transaction's single pg client must not run two queries at once (deprecated, removed in pg@9).
 * Drizzle queries are lazy, so pass them as they are; wrap eager async calls in `() =>`.
 */
export async function inOrder<T extends readonly unknown[]>(
  items: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K] extends () => infer R ? R : T[K]> }> {
  const out: unknown[] = [];
  for (const item of items) out.push(await (typeof item === 'function' ? item() : item));
  return out as never;
}

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
