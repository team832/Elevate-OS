import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { marketingPublishingAttempts, marketingPublishingRecords } from '@elevate/database';
import { setupTestDatabase } from '@elevate/testing';
import { POST as createIdeaRoute } from '../../src/app/api/v1/ideas/route';
import { POST as createItemRoute } from '../../src/app/api/v1/ideas/[id]/content-items/route';
import { GET as itemRoute } from '../../src/app/api/v1/content-items/[id]/route';
import { POST as submitRoute } from '../../src/app/api/v1/content-items/[id]/submit/route';
import { POST as decisionRoute } from '../../src/app/api/v1/content-items/[id]/decision/route';
import { POST as placeRoute } from '../../src/app/api/v1/content-items/[id]/placements/route';
import { GET as calendarRoute } from '../../src/app/api/v1/placements/route';
import { POST as scheduleRoute } from '../../src/app/api/v1/placements/[id]/schedule/route';
import { POST as unscheduleRoute } from '../../src/app/api/v1/placements/[id]/unschedule/route';
import { POST as publishRoute } from '../../src/app/api/v1/placements/[id]/publish/route';
import { POST as publicationRoute } from '../../src/app/api/v1/placements/[id]/publication/route';
import { POST as groupRoute } from '../../src/app/api/v1/placement-groups/route';
import {
  MockPublishingAdapter,
  setPublishingAdapterForTesting,
  type ContentItemDetail,
  type PublishingAdapter,
} from '../../src/server';
import {
  allChecklistCodes,
  call,
  makeTeam,
  seedRegistry,
  uniqueTitle,
  type Team,
} from '../helpers';

const ctx = setupTestDatabase();
let team: Team;
let day = 0;

beforeAll(async () => {
  await seedRegistry(ctx.db);
  team = await makeTeam(ctx.db);
});
afterEach(() => setPublishingAdapterForTesting(undefined));

/** A future slot (distinct day per call so tests do not collide). */
function slot(hour = 19): string {
  day += 2;
  const d = new Date(Date.UTC(2030, 0, 1 + day, hour - 5, 30));
  return d.toISOString();
}

async function approvedPlacement(
  opts: { course?: string; account?: string; approve?: boolean; scope?: object } = {},
) {
  const idea = await call<{ idea: { id: string } }>(createIdeaRoute, team.contributor, '/x', {
    json: { coursePrefix: opts.course ?? 'CLAT', title: uniqueTitle(), ...(opts.scope ?? {}) },
  });
  const item = await call<{ id: string }>(createItemRoute, team.contributor, '/x', {
    params: { id: idea.data!.idea.id },
    json: {
      title: 'Fictional reel brief',
      format: 'video_brief',
      initialVersion: { body: 'A fictional explainer.' },
    },
  });
  const placement = await call<{ placement: { id: string; code: string } }>(
    placeRoute,
    team.contributor,
    '/x',
    {
      params: { id: item.data!.id },
      json: { accountCode: opts.account ?? 'IGC' },
    },
  );
  expect(placement.status).toBe(201);
  if (opts.approve !== false) {
    await call(submitRoute, team.contributor, '/x', { params: { id: item.data!.id }, json: {} });
    const d = await call<ContentItemDetail>(itemRoute, team.manager, '/x', {
      params: { id: item.data!.id },
    });
    const ok = await call(decisionRoute, team.manager, '/x', {
      params: { id: item.data!.id },
      json: { decision: 'approve', acknowledgedRuleCodes: allChecklistCodes(d.data!.ruleCheck) },
    });
    expect(ok.status).toBe(200);
  }
  return {
    ideaId: idea.data!.idea.id,
    itemId: item.data!.id,
    placementId: placement.data!.placement.id,
    code: placement.data!.placement.code,
  };
}

describe('placements', () => {
  it('builds <IDEA>-<ACCOUNT> codes, unique per idea and account', async () => {
    const p = await approvedPlacement({ approve: false });
    expect(p.code).toMatch(/^CLAT-\d{3,}-IGC$/);
    const again = await call(placeRoute, team.contributor, '/x', {
      params: { id: p.itemId },
      json: { accountCode: 'IGC' },
    });
    expect(again.status).toBe(409);
  });

  it('refuses pure exam content on another exam page and variants off YouTube', async () => {
    const p = await approvedPlacement({ approve: false });
    const wrong = await call(placeRoute, team.contributor, '/x', {
      params: { id: p.itemId },
      json: { accountCode: 'IGI' },
    });
    expect(wrong.status).toBe(400);
    const variant = await call(placeRoute, team.contributor, '/x', {
      params: { id: p.itemId },
      json: { accountCode: 'IGC', variant: 'short' },
    });
    expect(variant.status).toBe(400);
    const yt = await call<{ placement: { code: string } }>(placeRoute, team.contributor, '/x', {
      params: { id: p.itemId },
      json: { accountCode: 'YTC', variant: 'short' },
    });
    expect(yt.data!.placement.code).toMatch(/-YTCS$/);
  });
});

describe('scheduling', () => {
  it('hard-blocks scheduling before approval and forbids contributors', async () => {
    const p = await approvedPlacement({ approve: false });
    const denied = await call(scheduleRoute, team.contributor, '/x', {
      params: { id: p.placementId },
      json: { publishAt: slot() },
    });
    expect(denied.status).toBe(403);
    const blocked = await call(scheduleRoute, team.manager, '/x', {
      params: { id: p.placementId },
      json: { publishAt: slot() },
    });
    expect(blocked.status).toBe(409);
    expect(JSON.stringify(blocked.error?.details)).toContain('NOT_APPROVED');
  });

  it('schedules an approved item, warns on slot collisions, keeps the original time', async () => {
    const a = await approvedPlacement();
    const b = await approvedPlacement();
    const at = slot();
    const first = await call<{ warnings: unknown[]; placement: { originalPublishAt: string } }>(
      scheduleRoute,
      team.director,
      '/x',
      {
        params: { id: a.placementId },
        json: { publishAt: at },
      },
    );
    expect(first.status).toBe(200);
    expect(first.data!.warnings).toEqual([]);
    const second = await call<{ warnings: { code: string }[] }>(scheduleRoute, team.manager, '/x', {
      params: { id: b.placementId },
      json: { publishAt: new Date(new Date(at).getTime() + 15 * 60_000).toISOString() },
    });
    expect(second.status).toBe(200);
    expect(second.data!.warnings.map((w) => w.code)).toContain('SLOT_COLLISION');
    const moved = await call<{ placement: { originalPublishAt: string; scheduledAt: string } }>(
      scheduleRoute,
      team.manager,
      '/x',
      {
        params: { id: a.placementId },
        json: { publishAt: slot() },
      },
    );
    expect(new Date(moved.data!.placement.originalPublishAt).toISOString()).toBe(at);
    const cal = await call<{ id: string; conflicts: { warnings: unknown[] } }[]>(
      calendarRoute,
      team.auditor,
      '/marketing/api/v1/placements?from=2030-01-01&to=2030-02-28',
    );
    expect(cal.status).toBe(200);
    expect(cal.data!.some((r) => r.id === b.placementId)).toBe(true);
    expect(
      (await call(unscheduleRoute, team.manager, '/x', { params: { id: b.placementId } })).status,
    ).toBe(200);
  });

  it('hard-blocks a second LI post on one IST day (CH-005 cadence, block)', async () => {
    const a = await approvedPlacement({ course: 'GEN', account: 'LI' });
    const b = await approvedPlacement({ course: 'GEN', account: 'LI' });
    const at = slot(9);
    expect(
      (
        await call(scheduleRoute, team.manager, '/x', {
          params: { id: a.placementId },
          json: { publishAt: at },
        })
      ).status,
    ).toBe(200);
    const later = new Date(new Date(at).getTime() + 6 * 3_600_000).toISOString();
    const res = await call(scheduleRoute, team.manager, '/x', {
      params: { id: b.placementId },
      json: { publishAt: later },
    });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.error?.details)).toContain('CADENCE_DAY');
  });

  it('rejects a time in the past', async () => {
    const p = await approvedPlacement();
    const res = await call(scheduleRoute, team.manager, '/x', {
      params: { id: p.placementId },
      json: { publishAt: '2020-01-01T10:00:00Z' },
    });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.error?.details)).toContain('IN_PAST');
  });
});

describe('publishing', () => {
  it('only publishes approved, scheduled placements and never claims a URL (mock)', async () => {
    const p = await approvedPlacement();
    const notScheduled = await call(publishRoute, team.manager, '/x', {
      params: { id: p.placementId },
    });
    expect(notScheduled.status).toBe(409);
    await call(scheduleRoute, team.manager, '/x', {
      params: { id: p.placementId },
      json: { publishAt: slot() },
    });
    expect(
      (await call(publishRoute, team.contributor, '/x', { params: { id: p.placementId } })).status,
    ).toBe(403);
    const res = await call<{
      outcome: string;
      record: { isSandbox: boolean; publishedUrl: string | null };
      message: string;
    }>(publishRoute, team.manager, '/x', { params: { id: p.placementId } });
    expect(res.status).toBe(200);
    expect(res.data!.outcome).toBe('published');
    expect(res.data!.record.isSandbox).toBe(true);
    expect(res.data!.record.publishedUrl).toBeNull();
    expect(res.data!.message).toMatch(/SANDBOX/);
  });

  it('prevents duplicate publication (same placement + version)', async () => {
    const p = await approvedPlacement();
    await call(scheduleRoute, team.manager, '/x', {
      params: { id: p.placementId },
      json: { publishAt: slot() },
    });
    let calls = 0;
    const counting: PublishingAdapter = {
      name: 'mock',
      verifyConnection: (a) => new MockPublishingAdapter().verifyConnection(a),
      publish: async (r) => {
        calls += 1;
        return new MockPublishingAdapter().publish(r);
      },
    };
    setPublishingAdapterForTesting(counting);
    const first = await call<{ outcome: string }>(publishRoute, team.manager, '/x', {
      params: { id: p.placementId },
    });
    const second = await call<{ outcome: string; duplicate: boolean }>(
      publishRoute,
      team.manager,
      '/x',
      { params: { id: p.placementId } },
    );
    expect(first.data!.outcome).toBe('published');
    expect(second.status).toBe(200);
    expect(second.data!.duplicate).toBe(true);
    expect(calls).toBe(1);
    const records = await ctx.db
      .select()
      .from(marketingPublishingRecords)
      .where(eq(marketingPublishingRecords.placementId, p.placementId as never));
    expect(records).toHaveLength(1);
  });

  it('retries failures on the same record up to the maximum, then refuses', async () => {
    const p = await approvedPlacement();
    await call(scheduleRoute, team.manager, '/x', {
      params: { id: p.placementId },
      json: { publishAt: slot() },
    });
    setPublishingAdapterForTesting({
      name: 'mock',
      verifyConnection: async () => ({ status: 'error', note: 'fictional failure' }),
      publish: async () => ({
        ok: false,
        retryable: true,
        error: 'Fictional upstream timeout',
        raw: {},
      }),
    });
    for (let i = 1; i <= 3; i++) {
      const r = await call<{ outcome: string; attemptsLeft: number }>(
        publishRoute,
        team.manager,
        '/x',
        { params: { id: p.placementId } },
      );
      expect(r.data!.outcome).toBe('failed');
      expect(r.data!.attemptsLeft).toBe(3 - i);
    }
    const exhausted = await call(publishRoute, team.manager, '/x', {
      params: { id: p.placementId },
    });
    expect(exhausted.status).toBe(409);
    expect(JSON.stringify(exhausted.error?.details)).toContain('MAX_ATTEMPTS');
    const [rec] = await ctx.db
      .select()
      .from(marketingPublishingRecords)
      .where(eq(marketingPublishingRecords.placementId, p.placementId as never));
    const attempts = await ctx.db
      .select()
      .from(marketingPublishingAttempts)
      .where(eq(marketingPublishingAttempts.recordId, rec!.id));
    expect(attempts).toHaveLength(3);
  });

  it('records a manual publication only with a live link and time', async () => {
    const p = await approvedPlacement();
    await call(scheduleRoute, team.manager, '/x', {
      params: { id: p.placementId },
      json: { publishAt: slot() },
    });
    const bad = await call(publicationRoute, team.manager, '/x', {
      params: { id: p.placementId },
      json: { publishedAt: '2026-10-10T10:00:00Z' },
    });
    expect(bad.status).toBe(400);
    const ok = await call<{ placement: { publicationMode: string; publishedUrl: string } }>(
      publicationRoute,
      team.manager,
      '/x',
      {
        params: { id: p.placementId },
        json: {
          publishedAt: '2026-10-10T10:00:00Z',
          url: 'https://www.instagram.com/p/fictional-test/',
        },
      },
    );
    expect(ok.status).toBe(201);
    expect(ok.data!.placement.publicationMode).toBe('manual');
    const dup = await call(publishRoute, team.manager, '/x', { params: { id: p.placementId } });
    expect((dup.data as { duplicate?: boolean } | undefined)?.duplicate).toBe(true);
  });
});

describe('collab groups', () => {
  it('accepts a comparison across every exam page involved and rejects solo content', async () => {
    const cross = await approvedPlacement({
      course: 'GEN',
      account: 'IGC',
      approve: false,
      scope: { scope: 'cross_exam', scopePrefixes: ['CLAT', 'IPMAT'] },
    });
    const ipmat = await call<{ placement: { id: string } }>(placeRoute, team.contributor, '/x', {
      params: { id: cross.itemId },
      json: { accountCode: 'IGI' },
    });
    const ok = await call<{ validation: { valid: boolean } }>(groupRoute, team.manager, '/x', {
      json: {
        ideaId: cross.ideaId,
        platform: 'instagram',
        placementIds: [cross.placementId, ipmat.data!.placement.id],
      },
    });
    expect(ok.status).toBe(201);
    expect(ok.data!.validation.valid).toBe(true);

    const solo = await approvedPlacement({ approve: false });
    const yt = await call<{ placement: { id: string } }>(placeRoute, team.contributor, '/x', {
      params: { id: solo.itemId },
      json: { accountCode: 'YTC' },
    });
    const bad = await call(groupRoute, team.manager, '/x', {
      json: {
        ideaId: solo.ideaId,
        platform: 'instagram',
        placementIds: [solo.placementId, yt.data!.placement.id],
      },
    });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.error?.details)).toContain('SOLO_CONTENT');
  });
});
