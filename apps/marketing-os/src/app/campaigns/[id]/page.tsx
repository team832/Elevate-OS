import type { Metadata } from 'next';
import { getDb } from '@elevate/database';
import {
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  SourceBadge,
  StatusBadge,
} from '@elevate/shared-ui';
import type { CampaignId } from '@elevate/shared-types';
import { METRIC_KEYS, coverageLabel, formatIst, modulePath } from '../../../domain';
import { can } from '@elevate/authorization';
import {
  assertCampaignVisible,
  getCampaignDetail,
  listCampaignMembers,
  memberOptions,
} from '../../../server';
import { CampaignMembers } from '../../../ui/campaign-members';
import { MetricCell, PlacementBadge } from '../../../ui/badges';
import { CAMPAIGN_STATUS_LABELS, campaignDates } from '../../../ui/campaigns';
import { campaignLeadOutcomes } from '@elevate/business-ops-os/leads';
import { CHANNEL_LABELS, courseOptions } from '../../../server/campaigns';
import { CampaignEditForm } from './edit-form';
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
      permission="marketing:campaigns:read"
      path={modulePath(`campaigns/${id}`)}
      active="campaigns"
      title="Campaign"
      searchParams={await searchParams}
    >
      {(user) => (
        <Section
          load={async () => {
            if (!/^[0-9a-f-]{36}$/i.test(id)) return <ErrorState title="Campaign not found" />;
            const db = getDb();
            await assertCampaignVisible(db, user, id);
            const { campaign: c, placements } = await getCampaignDetail(db, id as CampaignId);
            const members = await listCampaignMembers(db, id);
            const options = can(user, 'marketing:campaigns:write') ? await memberOptions(db) : null;
            const r = c.results;
            const [courses, outcomes] = await Promise.all([
              courseOptions(db),
              can(user, 'ops:leads:read') ? campaignLeadOutcomes(db, user, c.code) : null,
            ]);
            const course = courses.find((p) => p.id === c.programmeId)?.name;
            return (
              <div className="el-stack">
                <Card
                  title={`${c.code} · ${c.name}`}
                  meta={
                    <>
                      <StatusBadge tone={c.status === 'active' ? 'success' : 'neutral'}>
                        {CAMPAIGN_STATUS_LABELS[c.status]}
                      </StatusBadge>
                      {c.isSample ? <SourceBadge source="sample" /> : null}
                    </>
                  }
                  description={campaignDates(c)}
                >
                  <dl className="mkt-facts">
                    <dt>Objective</dt>
                    <dd>{c.objective ?? 'Not recorded'}</dd>
                    <dt>Course</dt>
                    <dd>{course ?? (c.programmeId ? 'Not found' : 'All or several courses')}</dd>
                    <dt>Audience</dt>
                    <dd>{c.audience ?? 'Not recorded'}</dd>
                    <dt>Channels</dt>
                    <dd>
                      {c.channels.length
                        ? c.channels.map((ch) => CHANNEL_LABELS[ch]).join(', ')
                        : 'Not recorded'}
                    </dd>
                    <dt>Posts</dt>
                    <dd>
                      {c.placements} placement{c.placements === 1 ? '' : 's'}, {c.publishedLive}{' '}
                      published with a live link
                    </dd>
                  </dl>
                </Card>
                {can(user, 'marketing:campaigns:write') ? (
                  <CampaignEditForm campaign={c} courses={courses} />
                ) : null}
                <Card
                  title="Leads, demos and admissions"
                  meta={outcomes ? <StatusBadge>Elevate OS records</StatusBadge> : undefined}
                >
                  {outcomes ? (
                    <>
                      <details className="el-explain">
                        <summary>How this is counted</summary>
                        Leads in your lead scope with an enquiry whose campaign reference is{' '}
                        {c.code}; those with a demo that was not cancelled; and those Business
                        Operations admitted (confirmed admission). Enquiries without this code are
                        not counted.
                      </details>
                      <dl className="mkt-facts">
                        <dt>Leads</dt>
                        <dd>{outcomes.leads}</dd>
                        <dt>Had a demo</dt>
                        <dd>{outcomes.demos}</dd>
                        <dt>Admitted</dt>
                        <dd>{outcomes.admissions}</dd>
                      </dl>
                    </>
                  ) : (
                    <p>
                      <strong>Not available to your role.</strong> Lead outcomes come from Business
                      Operations&apos; lead records, which your role cannot read.
                    </p>
                  )}
                </Card>
                <CampaignMembers campaignId={c.id} members={members} options={options} />
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
