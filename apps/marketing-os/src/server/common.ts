/** Helpers shared by the Marketing services: row lookup with 404 and audit rows. */
import { eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Database } from '@elevate/database';
import { NotFoundError, recordAudit, type AuditInput } from '@elevate/server-kit';
import type { Actor } from './access';

/** One row by id (optionally locked FOR UPDATE), or NOT_FOUND with `message`. */
export async function rowById<T extends PgTable & { id: PgColumn }>(
  db: Database,
  table: T,
  id: string,
  message: string,
  lock = false,
): Promise<T['$inferSelect']> {
  const q = db
    .select()
    .from(table as PgTable)
    .where(eq(table.id, id))
    .limit(1);
  const [row] = lock ? await q.for('update') : await q;
  if (!row) throw new NotFoundError(message);
  return row as T['$inferSelect'];
}

export const auditMarketing = (
  tx: Database,
  actor: Actor,
  input: Omit<AuditInput, 'actorUserId' | 'module'>,
) => recordAudit(tx, { ...input, actorUserId: actor.id, module: 'marketing' });
