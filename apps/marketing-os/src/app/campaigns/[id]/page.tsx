import type { Metadata } from 'next';
import { getDb } from '@elevate/database';
import { Card, DataTable, EmptyState, ErrorState } from '@elevate/shared-ui';
import type { CampaignId } from '@elevate/shared-types';
import { METRIC_KEYS, coverageLabel, formatIst, modulePath } from '../../../domain';
import { getCampaignDetail } from '../../../server';
import { MetricCell, PlacementBadge } from '../../../ui/badges';
import { campaignDates } from '../../../ui/campaigns';
import { MarketingPage, Section, type SearchParams } from '../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Campaign' };

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  return (
    <MarketingPage
      permission="marketing:content:read"
      path={modulePath(`campaigns/${id}`)}
      active="campaigns"
      title="Campaign"
      searchParams={await searchParams}
    >
      {() => (
        <Section
          load={async () => {
            if (!/^[0-9a-f-]{36}$/i.test(id)) return <ErrorState title="Campaign not found" />;
            const { campaign: c, placements } = await getCampaignDetail(getDb(), id as CampaignId);
            const r = c.results;
            return (
              <div className="el-stack">
                <Card
                  title={`${c.code} · ${c.name}`}
                  description={`${campaignDates(c)} · ${c.status}${c.objective ? ` · ${c.objective}` : ''}`}
                >
                  <p>
                    {c.placements} placement{c.placements === 1 ? '' : 's'}, {c.publishedLive}{' '}
                    published with a live link.
                  </p>
                </Card>
                <Card
                  title="Results from imported numbers"
                  description={
                    r.latestCaptureAt
                      ? `Latest CSV capture of each of ${r.posts} post${r.posts === 1 ? '' : 's'} in this campaign, as of ${formatIst(r.latestCaptureAt)}. A post without a number is missing, not zero.`
                      : undefined
                  }
                  actions={<a href={modulePath('metrics/import')}>Import an export</a>}
                >
                  {r.posts === 0 ? (
                    <EmptyState
                      title="No numbers imported for this campaign's posts yet"
                      description="Numbers appear after a CSV export that includes these posts is imported. No data is not zero."
                    />
                  ) : (
                    <DataTable
                      compact
                      rows={METRIC_KEYS}
                      rowKey={(k) => k}
                      columns={[
                        { key: 'metric', header: 'Metric', render: (k) => k.replace('_', ' ') },
                        {
                          key: 'value',
                          header: 'Total',
                          numeric: true,
                          render: (k) => <MetricCell m={r.metrics[k]} />,
                        },
                        {
                          key: 'coverage',
                          header: 'Coverage',
                          render: (k) => coverageLabel(r.metrics[k]),
                        },
                      ]}
                    />
                  )}
                </Card>
                <Card title="Leads, demos and admissions">
                  <p>
                    Lead outcomes are not linked to campaigns yet. Enquiries can carry a free-text
                    campaign reference, but Business Operations does not yet report leads, demos and
                    admissions by campaign code, so nothing is counted here.
                  </p>
                </Card>
                <Card title={`Placements (${placements.length})`}>
                  <DataTable
                    compact
                    rows={placements}
                    rowKey={(p) => p.id}
                    empty={
                      <EmptyState
                        title="No placements in this campaign"
                        description="Assign a placement to this campaign from its content item."
                      />
                    }
                    columns={[
                      {
                        key: 'code',
                        header: 'Placement',
                        render: (p) =>
                          p.contentItemId ? (
                            <a href={modulePath(`content/${p.contentItemId}`)}>{p.code}</a>
                          ) : (
                            p.code
                          ),
                      },
                      { key: 'title', header: 'Content', render: (p) => p.title ?? '—' },
                      { key: 'account', header: 'Account', render: (p) => p.accountCode },
                      {
                        key: 'status',
                        header: 'Status',
                        render: (p) => <PlacementBadge status={p.status} mode={p.mode} />,
                      },
                      {
                        key: 'when',
                        header: 'Scheduled or published (IST)',
                        render: (p) => formatIst(p.publishedAt ?? p.scheduledAt),
                      },
                    ]}
                  />
                </Card>
              </div>
            );
          }}
        />
      )}
    </MarketingPage>
  );
}
