import { describe, expect, it } from 'vitest';
import { hashPassword } from '@elevate/authentication';
import {
  opsCandidates,
  opsDecisions,
  opsEmployeeRecords,
  opsFeeRecords,
  opsLeads,
  opsLeadSources,
  opsRequisitions,
  opsResponsibilities,
  opsShiftTemplates,
  opsSops,
  opsTasks,
  opsWorkItems,
  staffMembers,
} from '@elevate/database';
import { coreSeeds, runSeeds } from '@elevate/database/seed';
import { setupTestDatabase } from '@elevate/testing';
import { seeds } from '../../seed';

const ctx = setupTestDatabase();

describe('Business Ops seeds', () => {
  it('run after the core seeds, are idempotent, and contain only fictional people', async () => {
    const context = { seedUserPassword: 'test-only-seed-password', hashPassword, log: () => {} };
    await runSeeds(ctx.db, [...coreSeeds, ...seeds], context);
    await runSeeds(ctx.db, [...coreSeeds, ...seeds], context);

    expect(await ctx.db.select().from(opsLeadSources)).toHaveLength(12);
    expect((await ctx.db.select().from(opsLeadSources)).map((s) => s.code)).toContain('UNKNOWN');
    expect(await ctx.db.select().from(opsDecisions)).toHaveLength(24);
    expect(await ctx.db.select().from(opsWorkItems)).toHaveLength(25);
    expect(await ctx.db.select().from(opsSops)).toHaveLength(51);
    expect(
      (await ctx.db.select().from(opsSops)).filter((s) => s.status === 'approved'),
    ).toHaveLength(0);
    const responsibilities = await ctx.db.select().from(opsResponsibilities);
    expect(responsibilities).toHaveLength(12);
    expect(
      responsibilities.every((r) => r.holderStaffId === null && r.backupStaffId === null),
    ).toBe(true);

    const leads = await ctx.db.select().from(opsLeads);
    expect(leads).toHaveLength(6); // 4 pipeline samples + 2 admissions samples
    for (const l of leads) {
      expect(l.studentName).toMatch(/\(fictional\)$/);
      expect(l.studentPhone).toBeNull();
      expect(l.studentEmail).toMatch(/@example\.test$/);
    }
    expect(await ctx.db.select().from(opsTasks)).toHaveLength(3);
    const staff = await ctx.db.select().from(staffMembers);
    expect(staff.length).toBe(10); // 8 core + 2 Ops fictional staff
    expect(staff.every((s) => /\(fictional\)$/.test(s.fullName))).toBe(true);

    // Slice seeds: samples stay undecided (draft / proposed), nothing invented as delivered.
    expect(await ctx.db.select().from(opsFeeRecords)).toHaveLength(3);
    expect(await ctx.db.select().from(opsEmployeeRecords)).toHaveLength(staff.length);
    for (const [table, status] of [
      [opsRequisitions, 'draft'],
      [opsCandidates, 'active'],
    ] as const)
      expect((await ctx.db.select().from(table)).map((r) => r.status)).toEqual([status]);
    // 1 proposed office-hours template + 2 "Sample — replace" templates (ops.sample-placeholders).
    expect((await ctx.db.select().from(opsShiftTemplates)).map((r) => r.status)).toEqual([
      'proposed',
      'proposed',
      'proposed',
    ]);
  });
});
