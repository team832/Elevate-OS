import { beforeAll, describe, expect, it } from 'vitest';
import { setupTestDatabase } from '@elevate/testing';
import {
  GET as listCampaigns,
  POST as createCampaignRoute,
} from '../../src/app/api/v1/campaigns/route';
import { PUT as placementCampaign } from '../../src/app/api/v1/placements/[id]/campaign/route';
import { GET as settingsRoute } from '../../src/app/api/v1/settings/route';
import { GET as rulesRoute } from '../../src/app/api/v1/rules/route';
import { createContentItem, createIdea, createPlacement } from '../../src/server';
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
