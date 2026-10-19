import { describe, expect, it } from 'vitest';
import { createTestUser, setupTestDatabase } from '@elevate/testing';
import { opsEmployeeRecords, staffMembers } from '@elevate/database';
import { seedEmployeeRecords } from '../../seed/hr-records';

const ctx = setupTestDatabase();

describe('HR records seed', () => {
  it('registers fictional staff once (idempotent) and skips anyone not marked fictional', async () => {
    const mgr = await createTestUser(ctx.db, {
      roles: ['operations_manager'],
      email: 'operations-manager@example.test',
    });
    await ctx.db
      .insert(staffMembers)
      .values([
        { fullName: 'Seed Person A (fictional)', userId: mgr.id },
        { fullName: 'Seed Person B (fictional)' },
        { fullName: 'Unmarked Person' },
      ]);
    await seedEmployeeRecords(ctx.db);
    await seedEmployeeRecords(ctx.db);
    const rows = await ctx.db.select().from(opsEmployeeRecords);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.employeeCode)).size).toBe(2);
    expect(rows.every((r) => r.employmentStatus === 'active')).toBe(true);
  });
});
