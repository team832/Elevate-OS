import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { opsShiftTemplates } from '@elevate/database';
import { POST as runCheck } from '../../src/app/api/v1/hr/attendance/missing-clock-out-check/route';
import { SEED_SHIFT, seedHrTime } from '../../seed/hr-time';
import { employee, post } from './hr-time-fixtures';

const ctx = setupTestDatabase();

describe('missing clock-out job route', () => {
  it('needs ops:jobs:run; returns counts', async () => {
    const emp = await employee(ctx.db, ['employee']);
    expect((await callRoute(runCheck, post(emp))).status).toBe(403);
    const ops = await createTestUser(ctx.db, { roles: ['operations_manager'] });
    const r = await callRoute<{ checked: number; flagged: number }>(runCheck, post(ops));
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ checked: 0, flagged: 0 });
  });
});

describe('hr-time seed', () => {
  it('is idempotent and seeds only a proposed template with no assignments', async () => {
    await createTestUser(ctx.db, {
      roles: ['operations_manager'],
      email: 'operations-manager@example.test',
    });
    await seedHrTime(ctx.db);
    await seedHrTime(ctx.db);
    const rows = await ctx.db
      .select()
      .from(opsShiftTemplates)
      .where(eq(opsShiftTemplates.code, SEED_SHIFT.code));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'proposed', startTime: '11:00', endTime: '18:00' });
  });
});
