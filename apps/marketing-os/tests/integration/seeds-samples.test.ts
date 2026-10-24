/**
 * Marketing sample set (brief 23 Oct 2026 §12–§15, §25): through the services, labelled, in every
 * state the brief lists, idempotent, owned by the two fictional employees.
 */
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@elevate/authentication';
import {
  marketingCalendarItems,
  marketingCampaignMembers,
  marketingCampaigns,
  marketingIdeas,
  marketingOptimisationCategories,
  marketingOptimisationItems,
  marketingOptimisationObservations,
  marketingTargets,
  staffMembers,
  users,
} from '@elevate/database';
import { coreSeeds, MARKETING_EMPLOYEES, runSeeds } from '@elevate/database/seed';
import { setupTestDatabase } from '@elevate/testing';
import { seeds } from '../../seed';
import { SAMPLE_CALENDAR, SAMPLE_IDEAS } from '../../seed/samples';

const ctx = setupTestDatabase();
const context = { seedUserPassword: 'test-only-seed-password', hashPassword, log: () => {} };

describe('marketing sample seed', () => {
  it('seeds the labelled set through the services, once', async () => {
    await runSeeds(ctx.db, [...coreSeeds, ...seeds], context);
    const before = await Promise.all(
      [
        marketingCampaigns,
        marketingIdeas,
        marketingCalendarItems,
        marketingOptimisationItems,
        marketingTargets,
      ].map((t) => ctx.db.$count(t)),
    );
    await runSeeds(ctx.db, [...coreSeeds, ...seeds], context);
    const after = await Promise.all(
      [
        marketingCampaigns,
        marketingIdeas,
        marketingCalendarItems,
        marketingOptimisationItems,
        marketingTargets,
      ].map((t) => ctx.db.$count(t)),
    );
    expect(after).toEqual(before);

    expect(
      (await ctx.db.select().from(marketingOptimisationCategories)).map((c) => c.key).sort(),
    ).toEqual(['aio', 'geo', 'seo']);
    const ideas = await ctx.db
      .select()
      .from(marketingIdeas)
      .where(eq(marketingIdeas.isSample, true));
    expect(ideas.map((i) => i.title).sort()).toEqual(
      SAMPLE_IDEAS.map((i) => `${i.title} (sample proposal)`).sort(),
    );
    expect(new Set(ideas.map((i) => i.status))).toEqual(
      new Set(['idea', 'submitted', 'approved', 'changes_requested']),
    );

    const items = await ctx.db.select().from(marketingCalendarItems);
    expect(items.every((i) => i.isSample)).toBe(true);
    expect(new Set(items.map((i) => i.status))).toEqual(
      new Set([
        'idea',
        'planned',
        'in_production',
        'submitted',
        'approved',
        'scheduled',
        'published',
        'changes_requested',
        'cancelled',
      ]),
    );
    expect(items).toHaveLength(SAMPLE_CALENDAR.length + 1); // + the approved idea put on the calendar
    const published = items.find((i) => i.status === 'published')!;
    expect(published).toMatchObject({ publishedUrl: null });
    expect(published.publicationEvidence).toMatch(/nothing was posted/);
    expect(items.some((i) => i.ideaId)).toBe(true);

    const work = await ctx.db.select().from(marketingOptimisationItems);
    expect(work.map((w) => [w.categoryKey, w.reviewState]).sort()).toEqual([
      ['aio', 'submitted'],
      ['geo', 'draft'],
      ['seo', 'approved'],
    ]);
    const observations = await ctx.db.select().from(marketingOptimisationObservations);
    expect(observations).toHaveLength(3);
    expect(
      observations.every((o) => o.source === 'manual' && /typed by hand/i.test(o.result)),
    ).toBe(true);

    const targets = await ctx.db.select().from(marketingTargets);
    expect(new Set(targets.map((t) => t.scope))).toEqual(new Set(['employee', 'team', 'campaign']));
    expect(targets.every((t) => t.isSample)).toBe(true);
    expect((await ctx.db.select().from(marketingCampaigns)).every((c) => c.isSample)).toBe(true);

    // Owned by the two fictional employees, members of their campaigns, no password set by db:seed.
    const employees = await ctx.db
      .select({ staffId: staffMembers.id, passwordHash: users.passwordHash })
      .from(users)
      .innerJoin(staffMembers, eq(staffMembers.userId, users.id))
      .where(eq(users.email, MARKETING_EMPLOYEES[0].email));
    expect(employees[0]!.passwordHash).toBeNull();
    expect(items.filter((i) => i.ownerStaffId === employees[0]!.staffId).length).toBeGreaterThan(0);
    expect(await ctx.db.$count(marketingCampaignMembers)).toBe(4);
  });
});
