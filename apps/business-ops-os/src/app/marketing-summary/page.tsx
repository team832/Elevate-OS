import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import type { Metric } from '@elevate/shared-contracts';
import { formatMetricValue, PageHeader } from '@elevate/shared-ui';
import { rangeOf } from '../../server/overview';
import { buildAdmissionsFunnel, buildAdmissionsReport } from '../../server/reports/admissions';
import { fetchMarketingSummary } from '../../server/summaries';
import { MarketingPanel } from '../../ui/cross-module';
import { fmtDateTime, humanise } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';
import { listHref } from '../../ui/list-controls';
import { RecordTable } from '../../ui/record-table';
import { Segment } from '../../ui/sections';
import { RangeFilter } from '../_components/range-filter';
import { WorkspaceLink } from '../_components/workspace-link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Marketing summary' };

type Params = { from?: string; to?: string };
const BASE = '/ops/marketing-summary';
const shown = (m: Metric) => (m.status === 'missing' ? 'Missing' : formatMetricValue(m));

/**
 * /ops/marketing-summary — campaign figures from Marketing OS's summary contract and the leads
 * Business Ops holds, by source, for the period (owner brief 22 Oct 2026 §5, §9). Read only. The
 * link into Marketing OS shows only to its members.
 */
export default async function MarketingSummaryPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const access = await gate('ops:dashboard:read', BASE);
  const at = rangeOf(await searchParams);
  return (
    <Frame access={access} active="marketing-summary">
      <PageHeader
        title="Marketing summary"
        description="Posts, reach and attributed leads from Marketing OS, and the leads Business Operations received by source, for the period. Read only."
        actions={
          <WorkspaceLink user={access.user} workspace="marketing">
            Open Marketing OS
          </WorkspaceLink>
        }
      />
      <div className="el-stack">
        <RangeFilter base={BASE} at={at} />
        <Section label="Loading marketing figures…">
          <Summary user={access.user} range={at.range} />
        </Section>
      </div>
    </Frame>
  );
}

async function Summary({
  user,
  range,
}: {
  user: AuthenticatedUser;
  range: ReturnType<typeof rangeOf>['range'];
}) {
  const leads = can(user, 'ops:admissions:read');
  const r = await load((db) =>
    Promise.all([
      fetchMarketingSummary(range),
      leads ? buildAdmissionsReport(db, user, range) : null,
      leads ? buildAdmissionsFunnel(db, user, range) : null,
    ]),
  );
  if (!r.ok) return r.view;
  const [marketing, report, funnel] = r.data;
  const reportHref = listHref('/ops/reports/admissions', { ...range });
  return (
    <>
      <MarketingPanel result={marketing} />
      {marketing.status === 'available' ? (
        <Segment
          title="Accounts and data sources"
          description="Per social account, as Marketing OS reports it. A scheduled post is not counted as published."
          flush
        >
          <RecordTable
            caption="Accounts"
            rows={marketing.data.accounts}
            rowKey={(a) => a.accountCode}
            empty="Marketing OS lists no accounts."
            columns={[
              { key: 'accountCode', header: 'Account' },
              { key: 'platform', header: 'Platform', render: (a) => humanise(a.platform) },
              { key: 'connection', header: 'Connection', render: (a) => humanise(a.connection) },
              {
                key: 'posts',
                header: 'Posts published',
                numeric: true,
                render: (a) => shown(a.postsPublished),
              },
              { key: 'reach', header: 'Reach', numeric: true, render: (a) => shown(a.reach) },
            ]}
          />
          <RecordTable
            caption="Data sources"
            rows={marketing.data.dataSources}
            rowKey={(s) => s.name}
            empty="No data source is connected."
            columns={[
              { key: 'name', header: 'Data source' },
              { key: 'connection', header: 'Connection', render: (s) => humanise(s.connection) },
              {
                key: 'lastSyncAt',
                header: 'Last sync',
                render: (s) => (s.lastSyncAt ? fmtDateTime(s.lastSyncAt) : 'Never'),
              },
            ]}
          />
        </Segment>
      ) : null}
      {report && funnel ? (
        <Segment
          title="Leads by source"
          description={`Leads first received in the period by the source of their first enquiry; demo conversion by source and campaign needs attribution access.${report.scope === 'own' ? ' Only your own leads.' : ''} As of ${fmtDateTime(report.asOf)}.`}
          actions={<a href={`${reportHref}#pipeline`}>Admissions report</a>}
          flush
        >
          <RecordTable
            caption="Leads received"
            rows={report.bySource}
            rowKey={(s) => s.sourceCode}
            empty="No leads were received in this period."
            columns={[
              { key: 'label', header: 'Source' },
              { key: 'count', header: 'Leads', numeric: true },
            ]}
          />
          {funnel.demoConversion.bySource ? (
            <RecordTable
              caption="Demo conversion by source and campaign"
              rows={funnel.demoConversion.bySource}
              rowKey={(g) => g.group}
              empty="No demo class in this period."
              columns={[
                { key: 'group', header: 'Source · campaign' },
                { key: 'demos', header: 'Demos', numeric: true },
                { key: 'decided', header: 'With an outcome', numeric: true },
                { key: 'converted', header: 'Converted', numeric: true },
                {
                  key: 'ratePct',
                  header: 'Conversion',
                  numeric: true,
                  render: (g) => (g.ratePct === null ? 'Not enough data' : `${g.ratePct}%`),
                },
              ]}
            />
          ) : null}
        </Segment>
      ) : null}
    </>
  );
}
