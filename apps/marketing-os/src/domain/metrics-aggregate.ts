/**
 * Weekly aggregation (MKT-029, MKT-032; docs/ALGORITHMS.md §9). Never sums a missing value
 * as zero: every aggregate carries coverage ("reported for 3 of 5 posts") and a status.
 *
 * 1. Keep snapshots of posts published in the IST week (Monday–Sunday) captured ≤ asOf.
 * 2. One snapshot per post (account + post key): the latest capture; ties broken by source
 *    priority (csv_import, adapter, manual_audit) then id.
 * 3. Group by account or campaign.
 * 4. Per metric: sum the reported/estimated values; coverage = posts with a value / posts
 *    where the metric applies. Status: ok (all posts reported), estimated (all have a value,
 *    some estimated), partial (some posts have no value — the sum is a lower bound),
 *    missing (no post has a value; value null), not_applicable (no post can have it).
 */
import { addDays, type IsoDate } from '@elevate/shared-types';
import { weekStart } from './week';
import { METRIC_KEYS, type MetricKey, type MetricState, type SnapshotSource } from './vocabulary';

export interface SnapshotMetric {
  value: number | null;
  state: MetricState;
}

export interface PostSnapshot {
  id: string;
  accountCode: string;
  campaignCode: string | null;
  postKey: string;
  postTitle: string | null;
  publishedOn: IsoDate | null;
  capturedAt: Date;
  source: SnapshotSource;
  metrics: Partial<Record<MetricKey, SnapshotMetric>>;
}

export type AggregateStatus = 'ok' | 'estimated' | 'partial' | 'missing' | 'not_applicable';

export interface AggregatedMetric {
  status: AggregateStatus;
  value: number | null;
  withData: number;
  applicable: number;
}

export interface AggregateGroup {
  key: string;
  posts: number;
  metrics: Record<MetricKey, AggregatedMetric>;
  /** Instagram (saves + shares) ÷ reach over posts that report all three (MKT-032). */
  saveShareRate: { value: number | null; withData: number; posts: number };
  medianViews: { value: number | null; withData: number };
  bestPost: { postKey: string; title: string | null; views: number } | null;
  /** MKT-032: fewer than 6 posts → "pattern not reliable yet". */
  patternReliable: boolean;
  sources: SnapshotSource[];
  latestCaptureAt: Date | null;
}

export interface WeeklyAggregation {
  weekStart: IsoDate;
  weekEnd: IsoDate;
  groupBy: 'account' | 'campaign';
  groups: AggregateGroup[];
}

const SOURCE_PRIORITY: Record<SnapshotSource, number> = {
  csv_import: 0,
  adapter: 1,
  manual_audit: 2,
};
export const RELIABLE_PATTERN_MIN_POSTS = 6;

/** Latest snapshot per post (deterministic tie-break). */
export function latestPerPost(
  snapshots: readonly PostSnapshot[],
  asOf: Date | null,
): PostSnapshot[] {
  const best = new Map<string, PostSnapshot>();
  for (const s of snapshots) {
    if (asOf && s.capturedAt.getTime() > asOf.getTime()) continue;
    const key = `${s.accountCode}|${s.postKey}`;
    const cur = best.get(key);
    if (
      !cur ||
      s.capturedAt.getTime() > cur.capturedAt.getTime() ||
      (s.capturedAt.getTime() === cur.capturedAt.getTime() &&
        (SOURCE_PRIORITY[s.source] < SOURCE_PRIORITY[cur.source] ||
          (SOURCE_PRIORITY[s.source] === SOURCE_PRIORITY[cur.source] && s.id < cur.id)))
    ) {
      best.set(key, s);
    }
  }
  return [...best.values()];
}

export function aggregateMetric(posts: readonly PostSnapshot[], key: MetricKey): AggregatedMetric {
  let applicable = 0;
  let withData = 0;
  let estimated = 0;
  let sum = 0;
  for (const p of posts) {
    const m = p.metrics[key];
    if (m?.state === 'not_applicable') continue;
    applicable += 1;
    if ((m?.state === 'reported' || m?.state === 'estimated') && m.value !== null) {
      withData += 1;
      sum += m.value;
      if (m.state === 'estimated') estimated += 1;
    }
  }
  if (applicable === 0)
    return { status: 'not_applicable', value: null, withData: 0, applicable: 0 };
  if (withData === 0) return { status: 'missing', value: null, withData, applicable };
  const value = Math.round(sum * 100) / 100;
  if (withData < applicable) return { status: 'partial', value, withData, applicable };
  return { status: estimated > 0 ? 'estimated' : 'ok', value, withData, applicable };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function has(m: SnapshotMetric | undefined): m is { value: number; state: MetricState } {
  return !!m && (m.state === 'reported' || m.state === 'estimated') && m.value !== null;
}

export function summariseGroup(key: string, posts: readonly PostSnapshot[]): AggregateGroup {
  const metrics = {} as Record<MetricKey, AggregatedMetric>;
  for (const k of METRIC_KEYS) metrics[k] = aggregateMetric(posts, k);
  let num = 0;
  let den = 0;
  let rateWithData = 0;
  const views: { p: PostSnapshot; v: number }[] = [];
  for (const p of posts) {
    const { saves, shares, reach } = p.metrics;
    if (has(saves) && has(shares) && has(reach) && reach.value > 0) {
      num += saves.value + shares.value;
      den += reach.value;
      rateWithData += 1;
    }
    if (has(p.metrics.views)) views.push({ p, v: p.metrics.views.value });
  }
  views.sort((a, b) => b.v - a.v || a.p.postKey.localeCompare(b.p.postKey));
  const top = views[0];
  const captures = posts.map((p) => p.capturedAt.getTime());
  return {
    key,
    posts: posts.length,
    metrics,
    saveShareRate: {
      value: den > 0 ? Math.round((num / den) * 10000) / 100 : null,
      withData: rateWithData,
      posts: posts.length,
    },
    medianViews: { value: median(views.map((x) => x.v)), withData: views.length },
    bestPost: top ? { postKey: top.p.postKey, title: top.p.postTitle, views: top.v } : null,
    patternReliable: posts.length >= RELIABLE_PATTERN_MIN_POSTS,
    sources: [...new Set(posts.map((p) => p.source))].sort(),
    latestCaptureAt: captures.length ? new Date(Math.max(...captures)) : null,
  };
}

export function aggregateWeekly(
  snapshots: readonly PostSnapshot[],
  options: { weekOf: IsoDate; groupBy: 'account' | 'campaign'; asOf?: Date | null },
): WeeklyAggregation {
  const start = weekStart(options.weekOf);
  const end = addDays(start, 6);
  const inWeek = latestPerPost(snapshots, options.asOf ?? null).filter(
    (s) => s.publishedOn !== null && s.publishedOn >= start && s.publishedOn <= end,
  );
  const groups = new Map<string, PostSnapshot[]>();
  for (const s of inWeek) {
    const key = options.groupBy === 'account' ? s.accountCode : (s.campaignCode ?? '(no campaign)');
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }
  return {
    weekStart: start,
    weekEnd: end,
    groupBy: options.groupBy,
    groups: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, posts]) => summariseGroup(key, posts)),
  };
}

/** "reported for 3 of 5 posts" — the coverage sentence used on screens. */
export function coverageLabel(m: AggregatedMetric): string {
  if (m.status === 'not_applicable') return 'not reported by this platform';
  return `reported for ${m.withData} of ${m.applicable} post${m.applicable === 1 ? '' : 's'}`;
}
