/**
 * Switch portal accounts off (F4-13), in the caller's transaction: the live accounts matching
 * `where` are locked and disabled, their logins' sessions and live setup codes end, and each is
 * audited on its student. Used by "Switch off" and by archiving a guardian.
 */
import { and, isNull, type SQL } from 'drizzle-orm';
import { revokeAllSessionsForUser, revokeSetupCodes } from '@elevate/authentication';
import { portalAccounts, type Database } from '@elevate/database';
import type { Actor } from './context';
import { opsAudit } from './ops-common';

export async function switchOffPortalAccounts(
  tx: Database,
  actor: Actor,
  where: SQL,
  requestId?: string,
  reason?: string,
) {
  const now = new Date();
  const live = await tx
    .update(portalAccounts)
    .set({ disabledAt: now, disabledBy: actor.id })
    .where(and(where, isNull(portalAccounts.disabledAt)))
    .returning();
  for (const userId of new Set(live.map((a) => a.userId))) {
    await revokeSetupCodes(tx, userId, now);
    await revokeAllSessionsForUser(tx, userId, now);
  }
  for (const a of live)
    await opsAudit('student')(
      tx,
      actor,
      a.studentId,
      'portal.access_disabled',
      { after: { accountId: a.id }, metadata: reason ? { reason } : undefined },
      requestId,
    );
  return live;
}
