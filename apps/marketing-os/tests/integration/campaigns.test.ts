import { beforeAll, describe, expect, it } from 'vitest';
import { marketingMetricSnapshots, marketingMetricValues } from '@elevate/database';
import { defineRoute } from '@elevate/server-kit';
import { setupTestDatabase } from '@elevate/testing';
import {
  GET as listCampaigns,
  POST as createCampaignRoute,
} from '../../src/app/api/v1/campaigns/route';
import { PUT as placementCampaign } from '../../src/app/api/v1/placements/[id]/campaign/route';
import { GET as settingsRoute } from '../../src/app/api/v1/settings/route';
import { GET as rulesRoute } from '../../src/app/api/v1/rules/route';
import { GET as dashboardRoute } from '../../src/app/api/v1/dashboard/route';
import {
  campaignResults,
  createCampaign,
  createContentItem,
  createIdea,
  createPlacement,
  getAccountByCode,
  getCampaignDetail,
  setPlacementCampaign,
} from '../../src/server';
import { call, makeTeam, seedRegistry, uniqueTitle, type Team } from '../helpers';

const ctx = setupTestDatabase();
let team: Team;

beforeAll(async () => {
  await seedRegistry(ctx.db);
  team = await makeTeam(ctx.db);
});

describe('campaigns', () => {
  it('managers create organic campaigns; contributors cannot; codes are unique', async () => {
    const body = {
      code: 'CLAT-OCT-TEST',
      name: 'Fictional October push',
      startsOn: '2026-10-01',
      endsOn: '2026-10-31',
    };
    expect((await call(createCampaignRoute, team.contributor, '/x', { json: body })).status).toBe(
      403,
    );
    const ok = await call<{ id: string; status: string }>(createCampaignRoute, team.manager, '/x', {
      json: body,
    });
    expect(ok.status).toBe(201);
    expect(ok.data!.status).toBe('draft');
    expect((await call(createCampaignRoute, team.manager, '/x', { json: body })).status).toBe(409);
    expect(
      (
        await call(createCampaignRoute, team.manager, '/x', {
          json: { ...body, code: 'X2', startsOn: '2026-11-01' },
        })
      ).status,
    ).toBe(400);
    const list = await call<{ code: string }[]>(listCampaigns, team.auditor, '/x');
    expect(list.data!.map((c) => c.code)).toContain('CLAT-OCT-TEST');

    const { idea } = await createIdea(ctx.db, team.manager, {
      coursePrefix: 'CLAT',
      title: uniqueTitle(),
    });
    const item = await createContentItem(ctx.db, team.manager, idea.id, {
      title: 'Fictional',
      format: 'post',
    });
    const { placement } = await createPlacement(ctx.db, team.manager, item.id, {
      accountCode: 'IGC',
    });
    const set = await call<{ campaignId: string }>(placementCampaign, team.manager, '/x', {
      method: 'PUT',
      params: { id: placement.id },
      json: { campaignId: ok.data!.id },
    });
    expect(set.data!.campaignId).toBe(ok.data!.id);
    const missing = await call(placementCampaign, team.manager, '/x', {
      method: 'PUT',
      params: { id: placement.id },
      json: { campaignId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(missing.status).toBe(404);
  });
});

describe('settings and rules', () => {
  it('exposes open owner decisions as proposed settings', async () => {
    const res = await call<{
      policies: { key: string; status: string; ownerDecision: string | null; value: unknown }[];
    }>(settingsRoute, team.auditor, '/x');
    const approvers = res.data!.policies.find((p) => p.key === 'approval.approver_roles')!;
    expect(approvers).toMatchObject({
      status: 'proposed',
      ownerDecision: 'OD-002',
      value: ['marketing_manager', 'director'],
    });
    expect(res.data!.policies.find((p) => p.ownerDecision === 'OD-003')!.status).toBe('proposed');
    expect((await call(settingsRoute, team.teacher, '/x')).status).toBe(403);
    const rules = await call<unknown[]>(rulesRoute, team.auditor, '/x');
    expect(rules.data).toHaveLength(45);
  });
});

describe('campaign results (verified data only)', () => {
  it('counts imported numbers of campaign posts, keeps missing distinct from zero', async () => {
    const make = (code: string) =>
      createCampaign(ctx.db, team.manager, { code, name: `Fictional ${code}`, status: 'active' });
    const [withPost, empty] = [await make('RES-ONE'), await make('RES-EMPTY')];
    const { idea } = await createIdea(ctx.db, team.manager, {
      coursePrefix: 'CLAT',
      title: uniqueTitle(),
    });
    const item = await createContentItem(ctx.db, team.manager, idea.id, {
      title: 'Fictional campaign post',
      format: 'post',
    });
    const { placement } = await createPlacement(ctx.db, team.manager, item.id, {
      accountCode: 'IGC',
    });
    await setPlacementCampaign(ctx.db, team.manager, placement.id, withPost.id);
    const account = await getAccountByCode(ctx.db, 'IGC');
    const [snap] = await ctx.db
      .insert(marketingMetricSnapshots)
      .values({
        source: 'csv_import',
        sourceLabel: 'Fictional CSV',
        accountId: account.id,
        placementId: placement.id,
        matchStatus: 'matched_link',
        postKey: 'https://www.instagram.com/p/fictional-campaign/',
        publishedOn: '2026-10-12',
        capturedAt: new Date('2026-10-16T06:30:00Z'),
      })
      .returning();
    await ctx.db.insert(marketingMetricValues).values([
      { snapshotId: snap!.id, metric: 'views', value: 500, state: 'reported' },
      { snapshotId: snap!.id, metric: 'reach', value: null, state: 'missing' },
    ]);

    const [one, none] = await campaignResults(ctx.db, [withPost, empty]);
    expect(one).toMatchObject({ placements: 1, publishedLive: 0 });
    expect(one!.results.posts).toBe(1);
    expect(one!.results.metrics.views).toMatchObject({ status: 'ok', value: 500 });
    expect(one!.results.metrics.reach).toMatchObject({ status: 'missing', value: null });
    expect(one!.results.latestCaptureAt).toEqual(new Date('2026-10-16T06:30:00Z'));
    expect(none).toMatchObject({ placements: 0, publishedLive: 0 });
    expect(none!.results).toMatchObject({ posts: 0, latestCaptureAt: null });

    const detail = await getCampaignDetail(ctx.db, withPost.id);
    expect(detail.placements.map((p) => p.code)).toEqual([placement.code]);
    await expect(
      getCampaignDetail(ctx.db, '00000000-0000-4000-8000-000000000000' as typeof withPost.id),
    ).rejects.toThrow('Campaign not found.');
  });

  it('overview shows when numbers were last imported, null when never', async () => {
    const res = await call<{
      metricImports: { accountCode: string; lastImportedAt: string | null }[];
    }>(dashboardRoute, team.manager, '/x');
    expect(res.status).toBe(200);
    expect(res.data!.metricImports.length).toBeGreaterThan(0);
    expect(res.data!.metricImports.every((r) => r.lastImportedAt === null)).toBe(true);
  });
});

describe('marketing privacy (BRIEF §7)', () => {
  // Any route gated by these permissions answers 403 to marketing roles: no KYC, guardians,
  // fees, feedback, academic reviews or HR records reach Marketing.
  it.each([
    'ops:module:access',
    'ops:students:read',
    'ops:student_private:read',
    'ops:kyc:verify',
    'ops:guardians:write',
    'ops:fees:read',
    'ops:fees:record',
    'ops:feedback:read',
    'ops:student_reports:review',
    'ops:teachers:read',
    'ops:admissions:read',
    'academic:module:access',
    'academic:students:read',
    'academic:reviews:read',
    'academic:progress:read',
  ] as const)('%s routes refuse marketing managers and contributors', async (permission) => {
    const route = defineRoute({ permission }, async () => ({ leaked: true }));
    for (const user of [team.manager, team.contributor]) {
      const res = await call<{ leaked?: boolean }>(route, user, '/x');
      expect(res.status).toBe(403);
      expect(res.data?.leaked).toBeUndefined();
    }
  });
});
