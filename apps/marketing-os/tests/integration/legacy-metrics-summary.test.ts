import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNotNull } from 'drizzle-orm';
import {
  marketingContentItems,
  marketingIdeas,
  marketingMetricSnapshots,
  marketingMetricValues,
  marketingPlacements,
  marketingSocialAccounts,
} from '@elevate/database';
import { marketingSummaryV1Schema } from '@elevate/shared-contracts';
import { buildRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { GET as quarantineRoute } from '../../src/app/api/v1/ideas/quarantine/route';
import {
  GET as importsRoute,
  POST as importRoute,
} from '../../src/app/api/v1/metrics/imports/route';
import { GET as weeklyRoute } from '../../src/app/api/v1/metrics/weekly/route';
import { GET as dashboardRoute } from '../../src/app/api/v1/dashboard/route';
import { GET as summaryRoute } from '../../src/app/api/internal/v1/summary/route';
import { createIdea, importLegacyMarketing } from '../../src/server';
import { call, legacy, makeTeam, type Team } from '../helpers';

const ctx = setupTestDatabase();
let team: Team;
let firstRun: Awaited<ReturnType<typeof importLegacyMarketing>>;

beforeAll(async () => {
  firstRun = await importLegacyMarketing(ctx.db, legacy);
  team = await makeTeam(ctx.db);
});

describe('legacy import', () => {
  it('imports everything once and is idempotent', async () => {
    expect(firstRun.accounts.inserted).toBe(10);
    expect(firstRun.rules.inserted).toBe(45);
    expect(firstRun.ideas.inserted).toBe(59);
    expect(firstRun.ideas.quarantined).toBe(8);
    expect(firstRun.placements.inserted).toBe(36);
    expect(firstRun.placements.ambiguous).toBe(2);
    expect(firstRun.postAudit.inserted).toBe(60);
    const before = {
      ideas: (await ctx.db.select().from(marketingIdeas)).length,
      items: (await ctx.db.select().from(marketingContentItems)).length,
      placements: (await ctx.db.select().from(marketingPlacements)).length,
      snapshots: (await ctx.db.select().from(marketingMetricSnapshots)).length,
    };
    const second = await importLegacyMarketing(ctx.db, legacy);
    expect(
      second.ideas.inserted +
        second.placements.inserted +
        second.postAudit.inserted +
        second.accounts.inserted,
    ).toBe(0);
    expect({
      ideas: (await ctx.db.select().from(marketingIdeas)).length,
      items: (await ctx.db.select().from(marketingContentItems)).length,
      placements: (await ctx.db.select().from(marketingPlacements)).length,
      snapshots: (await ctx.db.select().from(marketingMetricSnapshots)).length,
    }).toEqual(before);
  });

  it('quarantines the 4 duplicate-ID groups with proposed (unapplied) renumbering', async () => {
    const res = await call<
      {
        legacyCode: string;
        ideas: {
          code: string | null;
          proposedCode: string | null;
          proposedCodeStatus: string | null;
        }[];
        ambiguousPlacements: unknown[];
      }[]
    >(quarantineRoute, team.auditor, '/x');
    expect(res.data!.map((g) => g.legacyCode).sort()).toEqual([
      'CLAT-027',
      'COM-005',
      'CUET-002',
      'GEN-012',
    ]);
    for (const g of res.data!) {
      expect(g.ideas).toHaveLength(2);
      expect(g.ideas.every((i) => i.code === null)).toBe(true);
      expect(
        g.ideas.filter((i) => i.proposedCode).every((i) => i.proposedCodeStatus === 'proposed'),
      ).toBe(true);
    }
    expect(res.data!.find((g) => g.legacyCode === 'CLAT-027')!.ambiguousPlacements).toHaveLength(1);
  });

  it('never reissues legacy or proposed numbers', async () => {
    const clat = await createIdea(ctx.db, team.manager, {
      coursePrefix: 'CLAT',
      title: 'Fictional new CLAT idea after import',
    });
    expect(clat.idea.code).toBe('CLAT-029'); // 027 used twice (quarantined), 028 proposed
    const gen = await createIdea(ctx.db, team.manager, {
      coursePrefix: 'GEN',
      title: 'Fictional new GEN idea after import',
    });
    expect(gen.idea.code).toBe('GEN-015');
  });

  it('keeps blank audit cells missing, not zero, and labels the source', async () => {
    const values = await ctx.db
      .select({ v: marketingMetricValues, label: marketingMetricSnapshots.sourceLabel })
      .from(marketingMetricValues)
      .innerJoin(
        marketingMetricSnapshots,
        eq(marketingMetricSnapshots.id, marketingMetricValues.snapshotId),
      )
      .where(
        and(
          eq(marketingMetricSnapshots.source, 'manual_audit'),
          eq(marketingMetricValues.metric, 'views'),
        ),
      );
    const missing = values.filter((r) => r.v.state === 'missing');
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((r) => r.v.value === null)).toBe(true);
    expect(values.every((r) => /manual audit/i.test(r.label))).toBe(true);
  });
});

const IG_CSV = [
  'Permalink,Description,Publish time,Post type,Views,Reach,Likes,Comments,Shares,Saves,Impressions',
  'https://www.instagram.com/p/fictional-a/,Fictional post A,12/10/2026 18:00,Reel,1200,900,40,3,0,5,1500',
  'https://www.instagram.com/p/fictional-b/,Fictional post B,13/10/2026 19:00,Carousel,,450,,1,2,,',
  'https://www.instagram.com/p/fictional-c/,Fictional post C,31/02/2026 10:00,Reel,10,10,1,0,0,0,10',
  ',,14/10/2026,Reel,5,5,5,5,5,5,5',
  'https://www.instagram.com/p/fictional-d/,Fictional post D,14/10/2026,Reel,abc,1,1,1,1,1,1',
].join('\n');

describe('metrics import and weekly report', () => {
  it('validates, rejects bad rows with reasons and keeps missing distinct from zero', async () => {
    const dry = await call<{ dryRun: boolean; rowsAccepted: number; rowsRejected: number }>(
      importRoute,
      team.contributor,
      '/x',
      {
        json: {
          accountCode: 'IGC',
          fileName: 'fictional.csv',
          csv: IG_CSV,
          dateFormat: 'DD/MM/YYYY',
          dryRun: true,
        },
      },
    );
    expect(dry.status).toBe(200);
    expect(dry.data).toMatchObject({ dryRun: true, rowsAccepted: 2, rowsRejected: 3 });
    expect(
      (
        await ctx.db
          .select()
          .from(marketingMetricSnapshots)
          .where(eq(marketingMetricSnapshots.source, 'csv_import'))
      ).length,
    ).toBe(0);

    const res = await call<{
      importId: string;
      rejected: { rowNumber: number; reasons: string[] }[];
    }>(importRoute, team.contributor, '/x', {
      json: {
        accountCode: 'IGC',
        fileName: 'fictional.csv',
        csv: IG_CSV,
        dateFormat: 'DD/MM/YYYY',
        capturedAt: '2026-10-16T12:00:00+05:30',
      },
    });
    expect(res.status).toBe(201);
    expect(res.data!.rejected.map((r) => r.rowNumber)).toEqual([4, 5, 6]);
    const snaps = await ctx.db
      .select()
      .from(marketingMetricSnapshots)
      .where(eq(marketingMetricSnapshots.source, 'csv_import'));
    expect(snaps.map((s) => s.publishedOn).sort()).toEqual(['2026-10-12', '2026-10-13']);
    const b = snaps.find((s) => s.postTitle === 'Fictional post B')!;
    const vals = await ctx.db
      .select()
      .from(marketingMetricValues)
      .where(eq(marketingMetricValues.snapshotId, b.id));
    const byKey = Object.fromEntries(vals.map((v) => [v.metric, v]));
    expect(byKey.views).toMatchObject({ state: 'missing', value: null });
    expect(byKey.shares).toMatchObject({ state: 'reported', value: 2 });
    const a = snaps.find((s) => s.postTitle === 'Fictional post A')!;
    const aVals = await ctx.db
      .select()
      .from(marketingMetricValues)
      .where(eq(marketingMetricValues.snapshotId, a.id));
    expect(aVals.find((v) => v.metric === 'shares')).toMatchObject({ state: 'reported', value: 0 });
    expect(aVals.find((v) => v.metric === 'views')!.value).toBe(1200);
    expect(aVals.find((v) => v.metric === 'impressions')!.value).toBe(1500);
    expect(aVals.find((v) => v.metric === 'watch_hours')).toMatchObject({
      state: 'not_applicable',
      value: null,
    });

    const again = await call<{ duplicate: boolean }>(importRoute, team.contributor, '/x', {
      json: {
        accountCode: 'IGC',
        fileName: 'fictional.csv',
        csv: IG_CSV,
        dateFormat: 'DD/MM/YYYY',
      },
    });
    expect(again.status).toBe(200);
    expect(again.data!.duplicate).toBe(true);
    expect(
      (
        await call(importRoute, team.auditor, '/x', {
          json: { accountCode: 'IGC', fileName: 'x.csv', csv: IG_CSV, dateFormat: 'DD/MM/YYYY' },
        })
      ).status,
    ).toBe(403);
    expect((await call(importsRoute, team.auditor, '/x')).status).toBe(200);
  });

  it('aggregates weekly with coverage, never summing missing as zero', async () => {
    const res = await call<{
      aggregation: {
        groups: {
          key: string;
          posts: number;
          metrics: Record<
            string,
            { status: string; value: number | null; withData: number; applicable: number }
          >;
        }[];
      };
      accountsWithNoData: string[];
    }>(weeklyRoute, team.auditor, '/marketing/api/v1/metrics/weekly?week=2026-10-14');
    expect(res.status).toBe(200);
    const igc = res.data!.aggregation.groups.find((g) => g.key === 'IGC')!;
    expect(igc.posts).toBe(2);
    expect(igc.metrics.views).toMatchObject({
      status: 'partial',
      value: 1200,
      withData: 1,
      applicable: 2,
    });
    expect(igc.metrics.reach).toMatchObject({ status: 'ok', value: 1350 });
    expect(igc.metrics.watch_hours!.status).toBe('not_applicable');
    expect(res.data!.accountsWithNoData).toContain('YTC');
  });
});

describe('MarketingSummaryV1 internal route', () => {
  const token = 'test-only-internal-token-for-vitest-runs-0001';
  it('requires the service token and returns a valid contract with missing ≠ zero', async () => {
    const anon = await callRoute(summaryRoute, buildRequest('/marketing/api/internal/v1/summary'));
    expect(anon.status).toBe(401);
    const res = await callRoute<unknown>(
      summaryRoute,
      buildRequest('/marketing/api/internal/v1/summary?from=2026-10-05&to=2026-10-18', {
        headers: { authorization: `Bearer ${token}`, 'x-elevate-caller': 'ops' },
      }),
    );
    expect(res.status).toBe(200);
    const summary = marketingSummaryV1Schema.parse(res.data);
    expect(summary.metrics.followerGrowth.status).toBe('missing');
    expect(summary.metrics.followerGrowth.value).toBeNull();
    expect(summary.metrics.postsPublished.status).toBe('estimated'); // legacy-reported publications
    expect(summary.metrics.totalReach.status).not.toBe('ok'); // partial coverage
    expect(summary.accounts.find((a) => a.accountCode === 'YTC')!.reach.status).toBe('missing');
    const academic = await callRoute(
      summaryRoute,
      buildRequest('/marketing/api/internal/v1/summary', {
        headers: { authorization: `Bearer ${token}`, 'x-elevate-caller': 'academic' },
      }),
    );
    expect(academic.status).toBe(403);
  });
});

describe('dashboard', () => {
  it('counts items by state and accounts by integration status', async () => {
    const res = await call<{
      itemsByState: Record<string, number>;
      accountsByIntegration: Record<string, number>;
      ideasQuarantined: number;
    }>(dashboardRoute, team.auditor, '/x');
    expect(res.status).toBe(200);
    expect(res.data!.ideasQuarantined).toBe(8);
    expect(Object.values(res.data!.itemsByState).reduce((a, b) => a + b, 0)).toBe(34);
    expect(res.data!.accountsByIntegration.not_configured).toBe(10);
    const linked = await ctx.db
      .select()
      .from(marketingPlacements)
      .where(isNotNull(marketingPlacements.contentItemId));
    expect(linked).toHaveLength(34);
    const accounts = await ctx.db.select().from(marketingSocialAccounts);
    expect(accounts.every((a) => a.integrationStatus !== 'connected')).toBe(true);
  });
});
