/**
 * Job "Clear expired sign-ins" (F-11): old sessions, expired idempotency keys and expired sign-in
 * attempt counts would otherwise grow without limit. Never touches the audit trail or the outbox,
 * which are kept on purpose.
 */
import { purgeExpiredLoginAttempts, purgeOldSessions } from '@elevate/authentication';
import type { Database } from '@elevate/database';
import { purgeExpiredIdempotencyKeys, recordAudit } from '@elevate/server-kit';
import type { Actor } from './context';

export async function runHousekeeping(db: Database, actor: Actor, requestId: string) {
  const result = {
    sessions: await purgeOldSessions(db),
    idempotencyKeys: await purgeExpiredIdempotencyKeys(db),
    loginAttempts: await purgeExpiredLoginAttempts(db),
  };
  await recordAudit(db, {
    actorUserId: actor.id,
    module: 'ops',
    requestId,
    action: 'housekeeping.run',
    entityType: 'system',
    entityId: 'housekeeping',
    after: result,
  });
  return result;
}
