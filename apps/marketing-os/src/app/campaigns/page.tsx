import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Button, Card, DataTable, EmptyState, Field, Select, TextInput } from '@elevate/shared-ui';
import { CAMPAIGN_STATUSES, modulePath } from '../../domain';
import { listCampaigns } from '../../server';
import { createCampaignAction } from '../actions/placements';
import { MarketingPage, Section, type SearchParams } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Campaigns' };

export default async function CampaignsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <MarketingPage
      permission="marketing:content:read"
      path={modulePath('campaigns')}
      active="campaigns"
      title="Campaigns"
      description="Organic campaigns that group posts. Paid campaigns and budgets are Proposed."
      searchParams={await searchParams}
    >
      {(user) => (
        <Section
          load={async () => {
            const campaigns = await listCampaigns(getDb());
            return (
              <div className="el-stack">
                <DataTable
                  compact
                  rows={campaigns}
                  rowKey={(c) => c.id}
                  empty={<EmptyState title="No campaigns yet" />}
                  columns={[
                    { key: 'code', header: 'Code', render: (c) => <strong>{c.code}</strong> },
                    { key: 'name', header: 'Name', render: (c) => c.name },
                    {
                      key: 'dates',
                      header: 'Dates',
                      render: (c) => `${c.startsOn ?? '—'} to ${c.endsOn ?? '—'}`,
                    },
                    { key: 'status', header: 'Status', render: (c) => c.status },
                    {
                      key: 'report',
                      header: 'Report',
                      render: () => (
                        <a href={modulePath('metrics/weekly?groupBy=campaign')}>
                          weekly by campaign
                        </a>
                      ),
                    },
                  ]}
                />
                {can(user, 'marketing:campaigns:write') ? (
                  <Card title="New campaign">
                    <form action={createCampaignAction} className="el-grid">
                      <Field id="code" label="Code">
                        <TextInput id="code" name="code" required placeholder="CLAT-OCT" />
                      </Field>
                      <Field id="name" label="Name">
                        <TextInput id="name" name="name" required />
                      </Field>
                      <Field id="objective" label="Objective">
                        <TextInput id="objective" name="objective" />
                      </Field>
                      <Field id="startsOn" label="Starts">
                        <TextInput id="startsOn" name="startsOn" type="date" />
                      </Field>
                      <Field id="endsOn" label="Ends">
                        <TextInput id="endsOn" name="endsOn" type="date" />
                      </Field>
                      <Field id="status" label="Status">
                        <Select id="status" name="status">
                          {CAMPAIGN_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <div>
                        <Button type="submit">Create campaign</Button>
                      </div>
                    </form>
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
