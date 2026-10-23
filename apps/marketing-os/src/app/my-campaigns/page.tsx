import type { Metadata } from 'next';
import { getDb } from '@elevate/database';
import { Card, DataTable, EmptyState } from '@elevate/shared-ui';
import { modulePath } from '../../domain';
import { CAMPAIGN_MEMBER_ROLE_LABELS, campaignResults, myCampaigns } from '../../server';
import { CampaignResultsTable } from '../../ui/campaigns';
import { MarketingPage, Section, type SearchParams } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Assigned campaigns' };

export default async function MyCampaignsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <MarketingPage
      permission="marketing:campaigns:read"
      path={modulePath('my-campaigns')}
      active="my-campaigns"
      title="Assigned campaigns"
      description="Campaigns you are currently an owner or member of. A marketing manager adds and removes members."
      searchParams={await searchParams}
    >
      {(user) => (
        <Section
          load={async () => {
            const db = getDb();
            const mine = await myCampaigns(db, user);
            if (!mine)
              return (
                <EmptyState
                  title="No staff record"
                  description="Your account is not linked to a staff record, so no campaign can be assigned to you. HR links staff records in the Staff directory."
                />
              );
            const results = await campaignResults(
              db,
              mine.map((m) => m.campaign),
            );
            return (
              <div className="el-stack">
                <Card title="My role">
                  <DataTable
                    compact
                    rows={mine}
                    rowKey={(m) => m.campaign.id}
                    empty={
                      <EmptyState
                        title="No campaign is assigned to you"
                        description="Ask your marketing manager to add you to a campaign."
                      />
                    }
                    columns={[
                      {
                        key: 'campaign',
                        header: 'Campaign',
                        render: (m) => (
                          <a href={modulePath(`campaigns/${m.campaign.id}`)}>
                            {m.campaign.code} · {m.campaign.name}
                          </a>
                        ),
                      },
                      {
                        key: 'role',
                        header: 'Role',
                        render: (m) => CAMPAIGN_MEMBER_ROLE_LABELS[m.role],
                      },
                      { key: 'from', header: 'Since', render: (m) => m.fromDate },
                    ]}
                  />
                </Card>
                {results.length ? (
                  <Card title="Results from imported numbers">
                    <CampaignResultsTable rows={results} empty="No campaign is assigned to you" />
                  </Card>
                ) : null}
              </div>
            );
          }}
        />
      )}
    </MarketingPage>
  );
}
