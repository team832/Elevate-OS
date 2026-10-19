import { insertAuditEvent, type AuditInput, type Database } from '@elevate/database';
import type { AuditEventId } from '@elevate/shared-types';

/**
 * Run `fn` in one database transaction. Everything written through `tx`
 * (business rows, audit events, outbox events, notifications) commits or rolls
 * back together. Throwing inside `fn` rolls back.
 */
export async function withTransaction<T>(
  db: Database,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => fn(tx as unknown as Database));
}

export type { AuditInput };

/**
 * Append an audit event (`core.audit_events`). Call inside the same
 * transaction as the change so the trail is exact.
 *
 *   await recordAudit(tx, { actorUserId: user.id, module: 'ops', action: 'lead.created',
 *                           entityType: 'lead', entityId: lead.id, after: lead, requestId });
 */
export function recordAudit(tx: Database, input: AuditInput): Promise<AuditEventId> {
  return insertAuditEvent(tx, input);
}
