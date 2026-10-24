import { DataTable, EmptyState, SourceBadge } from '@elevate/shared-ui';
import { formatIst, modulePath, type AggregateGroup } from '../domain';
import { MetricCell } from './badges';

export interface CampaignRow {
  id: string;
  code: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  status: string;
  isSample?: boolean;
  placements: number;
  publishedLive: number;
  results: AggregateGroup;
}

export const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  ended: 'Ended',
  cancelled: 'Cancelled',
};

export const campaignDates = (c: Pick<CampaignRow, 'startsOn' | 'endsOn'>) =>
  `${c.startsOn ?? 'no start date'} to ${c.endsOn ?? 'no end date'}`;

/** Campaigns with their verified results (placements, live posts, imported numbers). */
export function CampaignResultsTable({
  rows,
  empty,
}: {
  rows: readonly CampaignRow[];
  empty: string;
}) {
  return (
    <DataTable
      compact
      rows={rows}
      rowKey={(c) => c.id}
      empty={<EmptyState title={empty} />}
      columns={[
        {
          key: 'code',
          header: 'Campaign',
          render: (c) => (
            <>
              <a href={modulePath(`campaigns/${c.id}`)}>
                <strong>{c.code}</strong>
              </a>{' '}
              {c.name} {c.isSample ? <SourceBadge source="sample" /> : null}
            </>
          ),
        },
        { key: 'dates', header: 'Dates', render: campaignDates },
        {
          key: 'status',
          header: 'Status',
          render: (c) => CAMPAIGN_STATUS_LABELS[c.status] ?? c.status,
        },
        { key: 'placements', header: 'Placements', numeric: true, render: (c) => c.placements },
        {
          key: 'live',
          header: 'Published (live link)',
          numeric: true,
          render: (c) => c.publishedLive,
        },
        {
          key: 'posts',
          header: 'Posts with imported numbers',
          numeric: true,
          render: (c) => c.results.posts,
        },
        {
          key: 'views',
          header: 'Views',
          numeric: true,
          render: (c) =>
            c.results.posts ? (
              <MetricCell m={c.results.metrics.views} />
            ) : (
              <span className="el-field-hint">no numbers imported</span>
            ),
        },
        {
          key: 'asof',
          header: 'Numbers as of',
          render: (c) => (c.results.latestCaptureAt ? formatIst(c.results.latestCaptureAt) : '—'),
        },
      ]}
    />
  );
}
