/**
 * Cross-module: Business Ops deactivates a staff member (`updateStaff`), which
 * publishes `ops.employee.separated` once (deactivation hook → wiring); the
 * platform job route runs the consumer and disables the login.
 */
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { integrationEvents, staffMembers, users } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { authedRequest, callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { insertEmployee, updateStaff } from '@elevate/business-ops-os/server';
import { POST as runRevocations } from '../../src/app/api/v1/jobs/access-revocations/route';

const ctx = setupTestDatabase();

describe('staff deactivation → access revocation', () => {
  it('publishes once; only a platform admin runs the job; the login is disabled', async () => {
    const hr = await createTestUser(ctx.db, { roles: ['hr_manager'] });
    const ops = await createTestUser(ctx.db, { roles: ['operations_manager'] });
    const admin = await createTestUser(ctx.db, { roles: ['platform_admin'] });
    const leaver = await createTestUser(ctx.db, { roles: ['employee'] });
    const { staffId } = await withTransaction(ctx.db, (tx) =>
      insertEmployee(tx, hr, {
        fullName: 'Leaving Employee (fictional)',
        employmentStatus: 'active',
        userId: leaver.id,
      }),
    );
    await updateStaff(ctx.db, ops, staffId, { status: 'inactive' });
    const events = await ctx.db
      .select()
      .from(integrationEvents)
      .where(eq(integrationEvents.type, 'ops.employee.separated'));
    expect(events.map((e) => (e.payload as { staffId: string }).staffId)).toEqual([staffId]);

    const path = '/api/v1/jobs/access-revocations';
    for (const u of [hr, ops])
      expect((await callRoute(runRevocations, authedRequest(u, path, { json: {} }))).status).toBe(
        403,
      );
    const run = await callRoute<{ processed: number }>(
      runRevocations,
      authedRequest(admin, path, { json: {} }),
    );
    expect(run).toMatchObject({ status: 200, data: { processed: 1 } });
    const [u] = await ctx.db.select().from(users).where(eq(users.id, leaver.id));
    expect(u?.status).toBe('disabled');
    const [s] = await ctx.db.select().from(staffMembers).where(eq(staffMembers.id, staffId));
    expect(s?.status).toBe('inactive');
  });
});
