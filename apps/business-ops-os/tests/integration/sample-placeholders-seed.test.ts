import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@elevate/authentication';
import { opsSettings } from '@elevate/database';
import { coreSeeds, runSeeds } from '@elevate/database/seed';
import { setupTestDatabase } from '@elevate/testing';
import { seeds } from '../../seed';
import { SAMPLE_LABEL, SAMPLE_SOURCE } from '../../seed/sample-placeholders';
import { loadSettings } from '../../src/server/settings';

const ctx = setupTestDatabase();

describe('sample placeholder seed (owner request 20 Oct 2026)', () => {
  it('is idempotent, labels the value "Sample — replace" and approves nothing', async () => {
    const context = { seedUserPassword: 'test-only-seed-password', hashPassword, log: () => {} };
    const feesRow = () =>
      ctx.db.select().from(opsSettings).where(eq(opsSettings.key, 'fees.schedule'));
    await runSeeds(ctx.db, [...coreSeeds, ...seeds], context);
    const first = await feesRow();
    await runSeeds(ctx.db, [...coreSeeds, ...seeds], context);
    expect(await feesRow()).toEqual(first);

    // Settings override: proposed, sample source, valid against the schema (stored, not invalid).
    expect(first[0]).toMatchObject({ decisionState: 'proposed', source: SAMPLE_SOURCE });
    const resolved = (await loadSettings(ctx.db))['fees.schedule'];
    expect(resolved).toMatchObject({ origin: 'stored', decisionState: 'proposed' });
    expect(resolved.value.scheduleReference).toContain(SAMPLE_LABEL);
    for (const s of await ctx.db.select().from(opsSettings))
      expect(['approved', 'locked']).not.toContain(s.decisionState);
    // Runs every seed twice (idempotency); slow when the whole suite shares the machine.
  }, 120_000);
});
