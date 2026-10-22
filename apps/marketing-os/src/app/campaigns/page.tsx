import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Button, Card, Field, Select, TextInput } from '@elevate/shared-ui';
import { CAMPAIGN_STATUSES, modulePath } from '../../domain';
import { campaignResults, listCampaigns } from '../../server';
import { CampaignResultsTable } from '../../ui/campaigns';
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
      description="Organic campaigns that group posts, with results from imported numbers only. Paid campaigns and budgets are Proposed."
      searchParams={await searchParams}
    >
      {(user) => (
        <Section
          load={async () => {
            const db = getDb();
            const campaigns = await campaignResults(db, await listCampaigns(db));
            return (
              <div className="el-stack">
                <details className="el-explain">
                  <summary>How these results are counted</summary>
                  Placements assigned to the campaign. Published counts only posts with a live link
                  (sandbox and legacy-tracker posts are not counted). Views add up the latest
                  imported CSV numbers of each campaign post; a post without numbers is missing, not
                  zero. Leads, demos and admissions by campaign are not shown yet.
                </details>
                <CampaignResultsTable rows={campaigns} empty="No campaigns yet" />
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
