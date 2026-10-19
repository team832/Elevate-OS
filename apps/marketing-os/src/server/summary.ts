/**
 * MarketingSummaryV1 (MKT-037, PLT-009) for Business Ops dashboards and the platform.
 * Every metric is ok / estimated / missing — missing is never zero; sandbox "publications"
 * from the mock adapter are never counted as published.
 */
import { and, eq, gte, isNull, lt } from 'drizzle-orm';
import {
  approvals,
  marketingIdeas,
  marketingMetricImports,
  marketingPlacements,
  marketingSocialAccounts,
  type Database,
} from '@elevate/database';
import {
  marketingSummaryV1Schema,
  metric,
  type MarketingSummaryV1,
  type Metric,
} from '@elevate/shared-contracts';
import { addDays, toIsoDateTime, type IsoDate } from '@elevate/shared-types';
import { aggregateMetric, istMidnightUtc, latestPerPost } from '../domain';
import { getPublishingAdapter } from './adapters/publishing';
import { contentApprovalPolicy } from './content';
import { loadPostSnapshots } from './reports';

type PlacementLite = {
  accountId: string;
  publishedAt: Date | null;
  mode: string | null;
  status: string;
};

function publishedMetric(
  rows: readonly PlacementLite[],
  meta: Parameters<typeof metric.ok>[1],
): Metric {
  const real = rows.filter((p) => p.mode === 'manual' || p.mode === 'adapter').length;
  const legacy = rows.filter((p) => p.mode === 'legacy_reported').length;
  return legacy > 0
    ? metric.estimated(
        real + legacy,
        `${legacy} publication(s) come from the legacy tracker (reported, not verified in Elevate OS); sandbox publications are excluded.`,
        meta,
      )
    : metric.ok(real, meta);
}

function reachMetric(
  posts: Awaited<ReturnType<typeof loadPostSnapshots>>,
  meta: Parameters<typeof metric.ok>[1],
): Metric {
  if (posts.length === 0) {
    return metric.missing(
      'No metric snapshots exist for posts published in this window (no export imported).',
      meta,
    );
  }
  const agg = aggregateMetric(posts, 'reach');
  if (agg.status === 'not_applicable')
    return metric.missing('The imported platforms do not report reach.', meta);
  if (agg.value === null)
    return metric.missing(`Reach was not reported for any of ${agg.applicable} post(s).`, meta);
  if (agg.status === 'ok') return metric.ok(agg.value, meta);
  return metric.estimated(
    agg.value,
    `Sum over ${agg.withData} of ${agg.applicable} post(s) with reach reported (a lower bound; missing values are not counted as 0).`,
    meta,
  );
}

export async function buildMarketingSummary(
  db: Database,
  window: { from: IsoDate; to: IsoDate },
  now: Date = new Date(),
): Promise<MarketingSummaryV1> {
  const w = { from: window.from, to: window.to, label: `${window.from} to ${window.to} (IST)` };
  const fromUtc = istMidnightUtc(window.from);
  const toUtc = istMidnightUtc(addDays(window.to, 1));
  const m = (definition: string, unit: Metric['unit'] = 'count') => ({
    definition,
    window: w,
    unit,
  });

  const ideas = await db
    .select({ id: marketingIdeas.id })
    .from(marketingIdeas)
    .where(
      and(
        isNull(marketingIdeas.legacyRef),
        gte(marketingIdeas.createdAt, fromUtc),
        lt(marketingIdeas.createdAt, toUtc),
      ),
    );
  const approved = await db
    .select({ id: approvals.id })
    .from(approvals)
    .where(
      and(
        eq(approvals.policy, contentApprovalPolicy.key),
        eq(approvals.status, 'approved'),
        gte(approvals.decidedAt, fromUtc),
        lt(approvals.decidedAt, toUtc),
      ),
    );
  const placements = await db
    .select({
      accountId: marketingPlacements.accountId,
      status: marketingPlacements.status,
      scheduledAt: marketingPlacements.scheduledAt,
      publishedAt: marketingPlacements.publishedAt,
      mode: marketingPlacements.publicationMode,
    })
    .from(marketingPlacements);
  const inWindow = (d: Date | null) => !!d && d >= fromUtc && d < toUtc;
  const scheduled = placements.filter((p) => p.status === 'scheduled' && inWindow(p.scheduledAt));
  const published = placements.filter((p) => p.status === 'published' && inWindow(p.publishedAt));
  const posts = latestPerPost(await loadPostSnapshots(db, window), now);
  const accounts = await db.select().from(marketingSocialAccounts);
  const lastImport = (
    await db.select({ at: marketingMetricImports.createdAt }).from(marketingMetricImports)
  ).reduce<Date | null>((acc, r) => (!acc || r.at > acc ? r.at : acc), null);
  const adapter = getPublishingAdapter();

  const summary: MarketingSummaryV1 = {
    contract: 'marketing.summary',
    version: 1,
    generatedAt: toIsoDateTime(now),
    window: w,
    metrics: {
      ideasCaptured: metric.ok(
        ideas.length,
        m('Ideas created in Elevate OS in the window (legacy imports excluded).'),
      ),
      contentApproved: metric.ok(
        approved.length,
        m('Content approval decisions "approved" made in the window.'),
      ),
      postsScheduled: metric.ok(
        scheduled.length,
        m('Placements currently scheduled with a publish time in the window.'),
      ),
      postsPublished: publishedMetric(
        published,
        m(
          'Placements published in the window with a live link (manual record or real adapter); sandbox excluded.',
        ),
      ),
      totalReach: reachMetric(
        posts,
        m('Sum of reach (lifetime at capture) for posts published in the window.'),
      ),
      engagementRate: metric.missing(
        'Not computed across platforms: the engagement definitions differ (MKT-032); see the weekly report.',
        m('Engagement rate across accounts.', 'percent'),
      ),
      followerGrowth: metric.missing(
        'No follower data source is connected (Metricool not connected, OD-006).',
        m('Net follower change in the window.'),
      ),
      leadsAttributed: metric.missing(
        'Lead attribution is owned by Business Ops; the enquiry handoff (MKT-036) is not built yet.',
        m('Leads attributed to marketing content.'),
      ),
    },
    accounts: accounts
      .filter((a) => a.status !== 'retired')
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((a) => {
        const mine = posts.filter((p) => p.accountCode === a.code);
        return {
          accountCode: a.code,
          platform: a.platform,
          connection: a.integrationStatus,
          postsPublished: publishedMetric(
            published.filter((p) => p.accountId === a.id),
            m(`Placements published on ${a.code} in the window (sandbox excluded).`),
          ),
          reach: reachMetric(mine, m(`Sum of reach for ${a.code} posts published in the window.`)),
        };
      }),
    dataSources: [
      {
        name: `Publishing adapter (${adapter.name})`,
        connection: adapter.name === 'mock' ? 'sandbox' : 'not_configured',
        lastSyncAt: null,
      },
      { name: 'Metricool', connection: 'not_configured', lastSyncAt: null },
      {
        name: 'Metrics CSV import (manual exports)',
        connection: 'not_configured',
        lastSyncAt: lastImport ? toIsoDateTime(lastImport) : null,
      },
    ],
  };
  return marketingSummaryV1Schema.parse(summary);
}
