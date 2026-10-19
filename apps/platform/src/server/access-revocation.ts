/**
 * Access revocation consumer (OPS-048 ↔ platform): when Business Ops OS
 * publishes `ops.employee.separated` v1, the platform — owner of core.users
 * and core.sessions — disables the linked login and deletes every session of
 * that user, once per event (`processEvents` records the delivery under
 * `platform.access-revocation`; a rerun is a no-op). The result is audited as
 * `user.access_revoked` (module platform) with the session count and the
 * event id, which Business Ops reads to complete its checklist item.
 *
 * A scheduler is a wave-3 integration item: call `processAccessRevocations(db)`
 * from a job runner (no platform job route exists yet).
 */
import { eq } from 'drizzle-orm';
import { sessions, users, type Database } from '@elevate/database';
import { processEvents, recordAudit } from '@elevate/server-kit';
import { PLATFORM_ACCESS_REVOCATION_CONSUMER } from '@elevate/shared-contracts';
import type { UserId } from '@elevate/shared-types';

export { PLATFORM_ACCESS_REVOCATION_CONSUMER };

export async function processAccessRevocations(
  db: Database,
  options: { maxAttempts?: number } = {},
) {
  return processEvents(db, {
    consumer: PLATFORM_ACCESS_REVOCATION_CONSUMER,
    maxAttempts: options.maxAttempts ?? 5,
    handlers: {
      'ops.employee.separated': async (event, { db: tx }) => {
        const userId = event.payload.userId as UserId | undefined;
        if (!userId) {
          await recordAudit(tx, {
            actorType: 'system',
            module: 'platform',
            action: 'user.access_revoked',
            entityType: 'staff_member',
            entityId: event.payload.staffId,
            after: { revoked: false, reason: 'no linked login' },
            metadata: { eventId: event.id, sessionsDeleted: 0, alreadyDisabled: false },
          });
          return;
        }
        const [before] = await tx
          .select({ id: users.id, status: users.status })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');
        if (!before) throw new Error(`User ${userId} from ${event.type} not found`);
        if (before.status !== 'disabled')
          await tx.update(users).set({ status: 'disabled' }).where(eq(users.id, userId));
        const deleted = await tx
          .delete(sessions)
          .where(eq(sessions.userId, userId))
          .returning({ id: sessions.id });
        await recordAudit(tx, {
          actorType: 'system',
          module: 'platform',
          action: 'user.access_revoked',
          entityType: 'user',
          entityId: userId,
          before: { status: before.status },
          after: { status: 'disabled' },
          metadata: {
            eventId: event.id,
            staffId: event.payload.staffId,
            employeeCode: event.payload.employeeCode,
            sessionsDeleted: deleted.length,
            alreadyDisabled: before.status === 'disabled',
          },
        });
      },
    },
  });
}
