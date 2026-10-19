import { describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { hashPassword } from '@elevate/authentication';
import { opsAdmissions, opsFeeRecords, opsLeads } from '@elevate/database';
import { coreSeeds, runSeeds } from '@elevate/database/seed';
import { setupTestDatabase } from '@elevate/testing';
import { seeds } from '../../seed';
import { admissionsSampleSeeds } from '../../seed/admissions-samples';

const ctx = setupTestDatabase();

describe('ops.admissions-samples seed', () => {
  it('runs after the core and Ops seeds, is idempotent, and is fictional', async () => {
    const context = { seedUserPassword: 'test-only-seed-password', hashPassword, log: () => {} };
    const all = [
      ...coreSeeds,
      ...seeds.filter((s) => s.name !== 'ops.admissions-samples'),
      ...admissionsSampleSeeds,
    ];
    await runSeeds(ctx.db, all, context);
    await runSeeds(ctx.db, all, context);
    const leads = await ctx.db
      .select()
      .from(opsLeads)
      .where(
        inArray(opsLeads.studentEmail, ['tara.sample@example.test', 'neel.sample@example.test']),
      );
    expect(leads).toHaveLength(2);
    for (const l of leads) {
      expect(l.studentName).toMatch(/\(fictional\)$/);
      expect(l.studentPhone).toBeNull();
      expect(l.guardianPhone).toBeNull();
    }
    const admissions = await ctx.db
      .select()
      .from(opsAdmissions)
      .where(
        inArray(
          opsAdmissions.leadId,
          leads.map((l) => l.id),
        ),
      );
    expect(admissions.map((a) => a.status).sort()).toEqual(['admission_pending', 'admitted']);
    const fees = await ctx.db.select().from(opsFeeRecords);
    expect(fees).toHaveLength(3);
    expect(fees.every((f) => f.status === 'recorded' && f.notes?.includes('fictional'))).toBe(true);
  });
});
