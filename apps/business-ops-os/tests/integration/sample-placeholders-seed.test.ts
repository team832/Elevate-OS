import { describe, expect, it } from 'vitest';
import { eq, inArray, like } from 'drizzle-orm';
import { hashPassword } from '@elevate/authentication';
import {
  opsHolidays,
  opsLeaveLedgerEntries,
  opsLeaveTypes,
  opsPolicies,
  opsPolicyVersions,
  opsSettings,
  opsShiftAssignments,
  opsShiftTemplates,
  staffMembers,
} from '@elevate/database';
import { coreSeeds, runSeeds } from '@elevate/database/seed';
import { setupTestDatabase } from '@elevate/testing';
import { seeds } from '../../seed';
import {
  SAMPLE_HOLIDAYS,
  SAMPLE_LABEL,
  SAMPLE_LEAVE_TYPES,
  SAMPLE_POLICIES,
  SAMPLE_SHIFTS,
  SAMPLE_SOURCE,
} from '../../seed/sample-placeholders';
import { loadSettings } from '../../src/server/settings';

const ctx = setupTestDatabase();
const NOT_DECIDED = ['approved', 'locked'];

describe('sample placeholder seed (owner request 20 Oct 2026)', () => {
  it('is idempotent, labels every row "Sample — replace" and approves nothing', async () => {
    const context = { seedUserPassword: 'test-only-seed-password', hashPassword, log: () => {} };
    await runSeeds(ctx.db, [...coreSeeds, ...seeds], context);
    const snapshot = async () => ({
      shifts: await ctx.db
        .select()
        .from(opsShiftTemplates)
        .where(like(opsShiftTemplates.name, `${SAMPLE_LABEL}%`)),
      holidays: await ctx.db.select().from(opsHolidays),
      leaveTypes: await ctx.db.select().from(opsLeaveTypes),
      settings: await ctx.db.select().from(opsSettings).where(eq(opsSettings.key, 'fees.schedule')),
      policies: await ctx.db.select().from(opsPolicies),
      versions: await ctx.db.select().from(opsPolicyVersions),
    });
    const first = await snapshot();
    await runSeeds(ctx.db, [...coreSeeds, ...seeds], context);
    expect(await snapshot()).toEqual(first);

    // Shift templates: 2 samples, proposed, nobody assigned.
    const shifts = await ctx.db
      .select()
      .from(opsShiftTemplates)
      .where(
        inArray(
          opsShiftTemplates.code,
          SAMPLE_SHIFTS.map((s) => s.code),
        ),
      );
    expect(shifts).toHaveLength(2);
    expect(shifts.find((s) => s.code === 'SAMPLE-SIKAR-DAY')).toMatchObject({
      startTime: '09:30',
      endTime: '18:00',
      unpaidBreakMinutes: 60,
      workingWeekdays: [1, 2, 3, 4, 5, 6],
      location: 'Sikar',
    });
    expect(shifts.find((s) => s.code === 'SAMPLE-ONLINE')).toMatchObject({
      startTime: '11:00',
      endTime: '18:00',
    });
    expect(await ctx.db.select().from(opsShiftAssignments)).toHaveLength(0);

    // Holidays: only national holidays on/after 20 Oct 2026 (Republic Day 2027).
    const holidays = await ctx.db.select().from(opsHolidays);
    expect(holidays.map((h) => h.holidayDate)).toEqual(['2027-01-26']);
    expect(SAMPLE_HOLIDAYS.every((h) => h.holidayDate >= '2026-10-20')).toBe(true);

    const leaveTypes = await ctx.db.select().from(opsLeaveTypes);
    expect(leaveTypes.map((t) => t.code).sort()).toEqual(
      SAMPLE_LEAVE_TYPES.map((t) => t.code).sort(),
    );
    expect(leaveTypes.find((t) => t.code === 'SAMPLE_UNPAID')?.paid).toBe(false);
    // No allocations: balances stay "not configured".
    expect(await ctx.db.select().from(opsLeaveLedgerEntries)).toHaveLength(0);

    for (const row of [
      ...shifts.map((s) => ({ label: s.name, state: s.status })),
      ...holidays.map((h) => ({ label: h.name, state: h.status })),
      ...leaveTypes.map((t) => ({ label: t.name, state: t.status })),
    ]) {
      expect(row.label).toContain(SAMPLE_LABEL);
      expect(row.state).toBe('proposed');
    }

    // Settings override: proposed, sample source, valid against the schema (stored, not invalid).
    const [fees] = await ctx.db
      .select()
      .from(opsSettings)
      .where(eq(opsSettings.key, 'fees.schedule'));
    expect(fees).toMatchObject({ decisionState: 'proposed', source: SAMPLE_SOURCE });
    const resolved = (await loadSettings(ctx.db))['fees.schedule'];
    expect(resolved.origin).toBe('stored');
    expect(resolved.decisionState).toBe('proposed');
    expect(resolved.value.scheduleReference).toContain(SAMPLE_LABEL);
    for (const s of await ctx.db.select().from(opsSettings))
      expect(NOT_DECIDED).not.toContain(s.decisionState);

    // Policies: 3 drafts, version 1 draft, no effective date, fictional accountable staff.
    const policies = await ctx.db
      .select()
      .from(opsPolicies)
      .where(like(opsPolicies.title, `${SAMPLE_LABEL}%`));
    expect(policies).toHaveLength(SAMPLE_POLICIES.length);
    const staff = await ctx.db.select().from(staffMembers);
    for (const p of policies) {
      expect(p.status).toBe('draft');
      expect(p.approvedVersionId).toBeNull();
      const accountable = staff.find((s) => s.id === p.accountableStaffId);
      expect(accountable?.fullName).toMatch(/\(fictional\)$/);
      const versions = await ctx.db
        .select()
        .from(opsPolicyVersions)
        .where(eq(opsPolicyVersions.policyId, p.id));
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({
        versionNumber: 1,
        status: 'draft',
        effectiveDate: null,
        sourceReference: SAMPLE_SOURCE,
      });
    }
    expect(policies.map((p) => p.area).sort()).toEqual(['attendance', 'data_protection', 'leave']);
  });
});
