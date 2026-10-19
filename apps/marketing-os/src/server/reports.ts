/**
 * Weekly report (MKT-032) and the read side of metrics: snapshots → domain aggregation.
 * Missing values stay missing; every aggregate carries coverage.
 */
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  marketingCampaigns,
  marketingMetricSnapshots,
  marketingMetricValues,
  marketingPlacements,
  marketingSocialAccounts,
  type Database,
} from '@elevate/database';
import { addDays, type IsoDate } from '@elevate/shared-types';
import {
  aggregateWeekly,
  istDate,
  istMidnightUtc,
  weekLabel,
  weekStart,
  type MetricKey,
  type PostSnapshot,
  type SnapshotMetric,
} from '../domain';

export async function loadPostSnapshots(
  db: Database,
  range: { from: IsoDate; to: IsoDate },
): Promise<PostSnapshot[]> {
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
      and(
        gte(marketingMetricSnapshots.publishedOn, range.from),
        lte(marketingMetricSnapshots.publishedOn, range.to),
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

/** Latest capture date across all snapshots (for "as of" labels); null when none. */
export async function latestCapture(db: Database): Promise<IsoDate | null> {
  const rows = await db
    .select({ at: marketingMetricSnapshots.capturedAt })
    .from(marketingMetricSnapshots);
  if (rows.length === 0) return null;
  return istDate(new Date(Math.max(...rows.map((r) => r.at.getTime()))));
}
