import { redirect } from 'next/navigation';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Alert, Card, DataTable, EmptyState, StatusBadge } from '@elevate/shared-ui';
import { addDays, toIsoDate } from '@elevate/shared-types';
import { followUpDaySummary } from '@elevate/business-ops-os/leads';
import { taskDaySummary } from '@elevate/business-ops-os/work';
import { toAppPath } from '@elevate/server-kit/next';
import { MODULE, formatIst, modulePath } from '../domain';
import { campaignResults, listCampaigns, loadDashboard, teamWide } from '../server';
import { CampaignResultsTable } from '../ui/campaigns';
import { OverviewTiles, PipelineCharts } from '../ui/overview';
import { MarketingPage, Section, type SearchParams } from '../ui/shell';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <MarketingPage
      permission="marketing:module:access"
      path={modulePath()}
      active="overview"
      title="Overview"
      description="Today's marketing work: posts due this week, approvals waiting, running campaigns and when metric numbers were last imported."
      searchParams={await searchParams}
    >
      {(user) =>
        // Marketing employees land on My day; the module-wide Overview is for managers.
        teamWide(user) ? (
          <Section load={async () => <Overview user={user} />} />
        ) : (
          redirect(toAppPath(modulePath('my-day'), MODULE.basePath))
        )
      }
    </MarketingPage>
  );
}

const failed = () => 'failed' as const;

async function Overview({ user }: { user: AuthenticatedUser }) {
  const db = getDb();
  const d = await loadDashboard(db);
  if (d.totalItems === 0 && d.accountCount === 0) {
    return (
      <EmptyState
        title="Nothing here yet"
        description="No accounts or content exist. Run `npm run db:seed` to import the legacy registry, or create an idea."
        action={
          <a className="el-button el-button-primary" href={modulePath('ideas/new')}>
            New idea
          </a>
        }
      />
    );
  }
  const running = await campaignResults(
    db,
    (await listCampaigns(db)).filter((c) => c.status === 'active'),
  );
  // Shared Business Ops summaries in the user's scope; a failure is shown in words, never as 0.
  const [followUps, tasks] = await Promise.all([
    can(user, 'ops:leads:read') ? followUpDaySummary(db, user).catch(failed) : undefined,
    can(user, 'ops:tasks:read') ? taskDaySummary(db, user).catch(failed) : undefined,
  ]);
  const today = toIsoDate(new Date(d.asOf));
  return (
    <div className="el-stack">
      {d.unreconciledConflicts.length ? (
        <Alert tone="warning" title="Owner decision needed">
          {d.unreconciledConflicts
            .map((c) => `${c.code} (${c.ownerDecision}): ${c.title}.`)
            .join(' ')}{' '}
          <a href={modulePath('accounts')}>See accounts</a>
        </Alert>
      ) : null}
      <OverviewTiles
        due={d.upcomingScheduled.length}
        awaiting={d.awaitingApproval.length}
        running={running.length}
        ideas={d.ideasTotal}
        quarantined={d.ideasQuarantined}
        followUps={followUps}
        tasks={tasks}
      />
      <PipelineCharts d={d} />
      <Card
        title="Campaigns running"
        description="Campaigns with status active. Published counts only posts with a live link; views come from imported CSV numbers (missing is not zero)."
        actions={<a href={modulePath('campaigns')}>All campaigns</a>}
      >
        <CampaignResultsTable rows={running} empty="No campaign is active" />
      </Card>
      {can(user, 'marketing:metrics:read') ? (
        <Card
          title="Metric imports"
          description="Numbers come only from CSV exports imported by hand; no account is connected live. Last import per Instagram and YouTube account."
          actions={<a href={modulePath('metrics/import')}>Open metrics import</a>}
        >
          <DataTable
            compact
            rows={d.metricImports}
            rowKey={(r) => r.accountCode}
            empty={<EmptyState title="No Instagram or YouTube accounts yet" />}
            columns={[
              { key: 'account', header: 'Account', render: (r) => r.accountCode },
              {
                key: 'imported',
                header: 'Last imported',
                render: (r) =>
                  r.lastImportedAt ? (
                    formatIst(r.lastImportedAt)
                  ) : (
                    <StatusBadge>no data imported yet</StatusBadge>
                  ),
              },
              {
                key: 'captured',
                header: 'Export taken at',
                render: (r) => formatIst(r.lastCapturedAt),
              },
            ]}
          />
        </Card>
      ) : null}
      <Card
        title="Content due this week"
        description={`Placements scheduled from now to ${addDays(today, 7)} (IST). Planned but unscheduled posts are on the calendar, not counted here.`}
        actions={<a href={modulePath('calendar')}>Open the content calendar</a>}
      >
        <DataTable
          compact
          rows={d.upcomingScheduled}
          rowKey={(r) => r.id}
          empty={<EmptyState title="Nothing scheduled in the next 7 days" />}
          columns={[
            { key: 'when', header: 'When (IST)', render: (r) => formatIst(r.scheduledAt) },
            { key: 'account', header: 'Account', render: (r) => r.accountCode },
            {
              key: 'code',
              header: 'Placement',
              render: (r) =>
                r.contentItemId ? (
                  <a href={modulePath(`content/${r.contentItemId}`)}>{r.code}</a>
                ) : (
                  r.code
                ),
            },
            { key: 'title', header: 'Content', render: (r) => r.title ?? '—' },
          ]}
        />
      </Card>
      {d.overdueScheduled.length ? (
        <Alert
          tone="warning"
          title={`${d.overdueScheduled.length} scheduled placement(s) are past their time without a publication record`}
        >
          {d.overdueScheduled.map((o) => o.code ?? o.id).join(', ')} — record the publication (with
          its live link) or reschedule. Legacy rows keep their tracker status until someone confirms
          them.
        </Alert>
      ) : null}
      <Card
        id="awaiting"
        title="Awaiting approval"
        description="Content items in review, oldest first. Open one to approve or request changes."
      >
        <DataTable
          compact
          rows={d.awaitingApproval}
          rowKey={(r) => r.id}
          empty={<EmptyState title="Nothing is waiting for approval" />}
          columns={[
            { key: 'idea', header: 'Idea', render: (r) => r.ideaCode ?? '—' },
            {
              key: 'title',
              header: 'Content',
              render: (r) => <a href={modulePath(`content/${r.id}`)}>{r.title}</a>,
            },
            {
              key: 'request',
              header: 'Approval request',
              render: (r) =>
                r.hasApprovalRequest ? (
                  'open'
                ) : (
                  <StatusBadge tone="warning">none — imported state; resubmit</StatusBadge>
                ),
            },
            { key: 'updated', header: 'Since', render: (r) => formatIst(r.updatedAt) },
          ]}
        />
      </Card>
      <p className="el-field-hint">As of {formatIst(d.asOf)}.</p>
    </div>
  );
}
