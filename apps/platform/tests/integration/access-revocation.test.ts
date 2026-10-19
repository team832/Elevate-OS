/**
 * Platform consumer of `ops.employee.separated` v1: disables the login and
 * deletes its sessions exactly once; a rerun is a no-op. Events are published
 * by hand against the shared contract (Business Ops is not imported here).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditEvents, eventDeliveries, sessions, staffMembers, users } from '@elevate/database';
import { publishEvent, withTransaction } from '@elevate/server-kit';
import { hrLifecycleKeys, PLATFORM_ACCESS_REVOCATION_CONSUMER } from '@elevate/shared-contracts';
import type { IsoDate, IsoDateTime } from '@elevate/shared-types';
import { createSession } from '@elevate/authentication';
import { createTestUser, setupTestDatabase, testSessionSecret } from '@elevate/testing';
import { processAccessRevocations } from '../../src/server/access-revocation';

const ctx = setupTestDatabase();

async function separatedEvent(input: { userId?: string; staffId: string }) {
  const caseId = randomUUID();
  return withTransaction(ctx.db, (tx) =>
    publishEvent(tx, {
      type: 'ops.employee.separated',
      version: 1,
      idempotencyKey: hrLifecycleKeys.separation(caseId),
      payload: {
        staffId: input.staffId as never,
        employeeCode: 'EMP-0420',
        ...(input.userId ? { userId: input.userId as never } : {}),
        caseId,
        lastWorkingDay: '2026-10-16' as IsoDate,
        separatedAt: new Date().toISOString() as IsoDateTime,
      },
    }),
  );
}

describe('platform access revocation consumer', () => {
  it('disables the user and deletes all their sessions once; rerun is a no-op', async () => {
    const leaver = await createTestUser(ctx.db, { roles: ['employee'] });
    await createSession(ctx.db, { userId: leaver.id, secret: testSessionSecret() });
    const bystander = await createTestUser(ctx.db, { roles: ['employee'] });
    const [staff] = await ctx.db
      .insert(staffMembers)
      .values({ userId: leaver.id, fullName: 'Leaver Test (fictional)' })
      .returning();
    const event = await separatedEvent({ userId: leaver.id, staffId: staff!.id });
    expect(event.created).toBe(true);

    const first = await processAccessRevocations(ctx.db);
    expect(first.processed).toBe(1);
    const [u] = await ctx.db.select().from(users).where(eq(users.id, leaver.id));
    expect(u?.status).toBe('disabled');
    expect(await ctx.db.select().from(sessions).where(eq(sessions.userId, leaver.id))).toHaveLength(
      0,
    );
    // Other users keep their sessions.
    expect(
      (await ctx.db.select().from(sessions).where(eq(sessions.userId, bystander.id))).length,
    ).toBeGreaterThan(0);
    const audits = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.action, 'user.access_revoked'), eq(auditEvents.entityId, leaver.id)),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.module).toBe('platform');
    expect((audits[0]?.metadata as { sessionsDeleted: number }).sessionsDeleted).toBe(2);
    expect((audits[0]?.metadata as { eventId: string }).eventId).toBe(event.id);

    // A new session created after revocation is NOT touched by a rerun (exactly once).
    await createSession(ctx.db, { userId: leaver.id, secret: testSessionSecret() });
    const second = await processAccessRevocations(ctx.db);
    expect(second.processed).toBe(0);
    expect(await ctx.db.select().from(sessions).where(eq(sessions.userId, leaver.id))).toHaveLength(
      1,
    );
    expect(
      await ctx.db
        .select()
        .from(auditEvents)
        .where(
          and(eq(auditEvents.action, 'user.access_revoked'), eq(auditEvents.entityId, leaver.id)),
        ),
    ).toHaveLength(1);
    const [delivery] = await ctx.db
      .select()
      .from(eventDeliveries)
      .where(
        and(
          eq(eventDeliveries.eventId, event.id),
          eq(eventDeliveries.consumer, PLATFORM_ACCESS_REVOCATION_CONSUMER),
        ),
      );
    expect(delivery?.status).toBe('processed');
  });

  it('records "no linked login" when the employee had no account', async () => {
    const [staff] = await ctx.db
      .insert(staffMembers)
      .values({ fullName: 'No Login Test (fictional)' })
      .returning();
    const event = await separatedEvent({ staffId: staff!.id });
    const result = await processAccessRevocations(ctx.db);
    expect(result.processed).toBe(1);
    const [audit] = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.action, 'user.access_revoked'), eq(auditEvents.entityId, staff!.id)),
      );
    expect((audit?.metadata as { eventId: string }).eventId).toBe(event.id);
    expect((audit?.after as { revoked: boolean }).revoked).toBe(false);
  });

  it('publishing the same separation twice stores one event', async () => {
    const [staff] = await ctx.db
      .insert(staffMembers)
      .values({ fullName: 'Twice Test (fictional)' })
      .returning();
    const caseId = randomUUID();
    const publish = () =>
      withTransaction(ctx.db, (tx) =>
        publishEvent(tx, {
          type: 'ops.employee.separated',
          version: 1,
          idempotencyKey: hrLifecycleKeys.separation(caseId),
          payload: {
            staffId: staff!.id as never,
            employeeCode: 'EMP-0421',
            caseId,
            lastWorkingDay: '2026-10-16' as IsoDate,
            separatedAt: new Date().toISOString() as IsoDateTime,
          },
        }),
      );
    const a = await publish();
    const b = await publish();
    expect(b.created).toBe(false);
    expect(b.id).toBe(a.id);
  });
});
