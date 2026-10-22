/**
 * Weekly report (MKT-032) and the read side of metrics: snapshots → domain aggregation.
 * Missing values stay missing; every aggregate carries coverage.
 */
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  marketingCampaigns,
  marketingContentItems,
  marketingMetricSnapshots,
  marketingMetricValues,
  marketingPlacements,
  marketingSocialAccounts,
  type Database,
} from '@elevate/database';
import { addDays, type CampaignId, type IsoDate } from '@elevate/shared-types';
import {
  aggregateWeekly,
  istMidnightUtc,
  latestPerPost,
  summariseGroup,
  weekLabel,
  weekStart,
  type MetricKey,
  type PostSnapshot,
  type SnapshotMetric,
} from '../domain';
import { rowById } from './common';

export async function loadPostSnapshots(
  db: Database,
  filter: { from: IsoDate; to: IsoDate } | { campaignIds: readonly CampaignId[] },
): Promise<PostSnapshot[]> {
  if ('campaignIds' in filter && filter.campaignIds.length === 0) return [];
  const rows = await db
    .select({
      s: marketingMetricSnapshots,
      accountCode: marketingSocialAccounts.code,
      campaignCode: marketingCampaigns.code,
    })
    .from(marketingMetricSnapshots)
    .innerJoin(
      marketingSocialAccounts,
      eq(marketingSocialAccounts.id, marketingMetricSnapshots.accountId),
    )
    .leftJoin(marketingPlacements, eq(marketingPlacements.id, marketingMetricSnapshots.placementId))
    .leftJoin(marketingCampaigns, eq(marketingCampaigns.id, marketingPlacements.campaignId))
    .where(
      'campaignIds' in filter
        ? inArray(marketingPlacements.campaignId, [...filter.campaignIds])
        : and(
            gte(marketingMetricSnapshots.publishedOn, filter.from),
            lte(marketingMetricSnapshots.publishedOn, filter.to),
          ),
    );
  if (rows.length === 0) return [];
  const values = await db
    .select()
    .from(marketingMetricValues)
    .where(
      inArray(
        marketingMetricValues.snapshotId,
        rows.map((r) => r.s.id),
      ),
    );
  const bySnap = new Map<string, Partial<Record<MetricKey, SnapshotMetric>>>();
  for (const v of values) {
    const m = bySnap.get(v.snapshotId) ?? {};
    m[v.metric] = { value: v.value, state: v.state };
    bySnap.set(v.snapshotId, m);
  }
  return rows.map((r) => ({
    id: r.s.id,
    accountCode: r.accountCode,
    campaignCode: r.campaignCode ?? null,
    postKey: r.s.postKey,
    postTitle: r.s.postTitle,
    publishedOn: (r.s.publishedOn as IsoDate | null) ?? null,
    capturedAt: r.s.capturedAt,
    source: r.s.source,
    metrics: bySnap.get(r.s.id) ?? {},
  }));
}

export async function weeklyReport(
  db: Database,
  options: { weekOf: IsoDate; groupBy: 'account' | 'campaign'; asOf?: Date },
) {
  const start = weekStart(options.weekOf);
  const end = addDays(start, 6);
  const snapshots = await loadPostSnapshots(db, { from: start, to: end });
  const aggregation = aggregateWeekly(snapshots, {
    weekOf: start,
    groupBy: options.groupBy,
    asOf: options.asOf ?? null,
  });
  const accounts = await db.select().from(marketingSocialAccounts);
  // Planned (by ORIGINAL publish time — MKT-037) vs published, per account, for the IST week.
  const from = istMidnightUtc(start);
  const to = istMidnightUtc(addDays(end, 1));
  const placements = await db
    .select({
      accountId: marketingPlacements.accountId,
      status: marketingPlacements.status,
      original: marketingPlacements.originalPublishAt,
      publishedAt: marketingPlacements.publishedAt,
      mode: marketingPlacements.publicationMode,
    })
    .from(marketingPlacements);
  const inWeek = (d: Date | null) => !!d && d >= from && d < to;
  const perAccount = accounts
    .filter((a) => a.status === 'live' || a.status === 'starting')
    .map((a) => {
      const mine = placements.filter((p) => p.accountId === a.id);
      const group = aggregation.groups.find((g) => g.key === a.code) ?? null;
      return {
        accountCode: a.code,
        platform: a.platform,
        integrationStatus: a.integrationStatus,
        plannedByOriginalTime: mine.filter((p) => inWeek(p.original) && p.status !== 'cancelled')
          .length,
        publishedReal: mine.filter(
          (p) => inWeek(p.publishedAt) && (p.mode === 'manual' || p.mode === 'adapter'),
        ).length,
        publishedLegacyReported: mine.filter(
          (p) => inWeek(p.publishedAt) && p.mode === 'legacy_reported',
        ).length,
        publishedSandbox: mine.filter((p) => inWeek(p.publishedAt) && p.mode === 'sandbox').length,
        postsWithData: group?.posts ?? 0,
      };
    });
  return {
    window: { from: start, to: end, label: weekLabel(start) },
    asOf: (options.asOf ?? new Date()).toISOString(),
    aggregation,
    accounts: perAccount,
    accountsWithNoData: perAccount.filter((a) => a.postsWithData === 0).map((a) => a.accountCode),
    snapshotsConsidered: snapshots.length,
  };
}

/**
 * Campaign results from verified records only: placements in the campaign, "published" only
 * with a live link (manual or adapter), and imported numbers of the latest capture per post
 * linked to those placements (missing stays missing). Leads → demos → admissions by campaign
 * come from the admissions domain, never from here.
 */
export async function campaignResults<C extends { id: CampaignId; code: string }>(
  db: Database,
  campaigns: readonly C[],
) {
  const ids = campaigns.map((c) => c.id);
  const posts = latestPerPost(await loadPostSnapshots(db, { campaignIds: ids }), null);
  const placements = ids.length
    ? await db
        .select({
          campaignId: marketingPlacements.campaignId,
          status: marketingPlacements.status,
          mode: marketingPlacements.publicationMode,
        })
        .from(marketingPlacements)
        .where(inArray(marketingPlacements.campaignId, ids))
    : [];
  return campaigns.map((c) => {
    const mine = placements.filter((p) => p.campaignId === c.id);
    return {
      ...c,
      placements: mine.length,
      publishedLive: mine.filter(
        (p) => p.status === 'published' && (p.mode === 'manual' || p.mode === 'adapter'),
      ).length,
      results: summariseGroup(
        c.code,
        posts.filter((p) => p.campaignCode === c.code),
      ),
    };
  });
}

export async function getCampaignDetail(db: Database, id: CampaignId) {
  const campaign = await rowById(db, marketingCampaigns, id, 'Campaign not found.');
  const placements = await db
    .select({
      id: marketingPlacements.id,
      code: marketingPlacements.code,
      contentItemId: marketingPlacements.contentItemId,
      title: marketingContentItems.title,
      accountCode: marketingSocialAccounts.code,
      status: marketingPlacements.status,
      mode: marketingPlacements.publicationMode,
      scheduledAt: marketingPlacements.scheduledAt,
      publishedAt: marketingPlacements.publishedAt,
    })
    .from(marketingPlacements)
    .innerJoin(
      marketingSocialAccounts,
      eq(marketingSocialAccounts.id, marketingPlacements.accountId),
    )
    .leftJoin(
      marketingContentItems,
      eq(marketingContentItems.id, marketingPlacements.contentItemId),
    )
    .where(eq(marketingPlacements.campaignId, id))
    .orderBy(asc(marketingPlacements.scheduledAt), asc(marketingPlacements.code));
  const [withResults] = await campaignResults(db, [campaign]);
  return { campaign: withResults!, placements };
}
