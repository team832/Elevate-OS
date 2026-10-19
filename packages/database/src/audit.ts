import type { AuditEventId, ModuleKey, UserId } from '@elevate/shared-types';
import type { Database } from './client';
import { auditEvents } from './schema/core';

export interface AuditInput {
  /** `user` requires `actorUserId`. Use `system` for jobs and `service` for internal API calls. */
  actorType?: 'user' | 'system' | 'service';
  actorUserId?: UserId | null;
  module: ModuleKey;
  /** Dotted verb, e.g. `lead.created`, `approval.decided`. */
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append an audit event. Call it inside the same transaction as the change it
 * describes so the audit row exists if and only if the change committed.
 * (Re-exported by @elevate/server-kit as `recordAudit`.)
 */
export async function insertAuditEvent(db: Database, input: AuditInput): Promise<AuditEventId> {
  const actorType = input.actorType ?? (input.actorUserId ? 'user' : 'system');
  const [row] = await db
    .insert(auditEvents)
    .values({
      actorType,
      actorUserId: input.actorUserId ?? null,
      module: input.module,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: input.before === undefined ? null : (input.before as object),
      after: input.after === undefined ? null : (input.after as object),
      requestId: input.requestId ?? null,
      metadata: input.metadata ?? null,
    })
    .returning({ id: auditEvents.id });
  if (!row) throw new Error('audit insert returned no row');
  return row.id;
}
