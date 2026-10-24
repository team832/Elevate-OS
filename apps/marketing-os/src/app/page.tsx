import { redirect } from 'next/navigation';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Alert, Card, DataTable, EmptyState, StatusBadge } from '@elevate/shared-ui';
import { toAppPath } from '@elevate/server-kit/next';
import { addDays, toIsoDate } from '@elevate/shared-types';
import { MODULE, formatIst, modulePath } from '../domain';
import { listCampaigns, memberOptions, teamWide } from '../server';
import { courseOptions } from '../server/campaigns';
import { dashboardFilters } from '../server/dashboard-filters';
import { loadOverview, type Overview } from '../server/dashboard-overview';
import { getMyPreferences } from '../server/preferences';
import { CampaignResultsTable } from '../ui/campaigns';
import {
  DecisionTiles,
  Explain,
  LeadFunnel,
  MonthlyReports,
  OverviewFilters,
  Provenance,
  TargetsChart,
  Unfiltered,
  periodText,
} from '../ui/overview';
import { MarketingPage, Section, type SearchParams } from '../ui/shell';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return (
    <MarketingPage
      permission="marketing:module:access"
      path={modulePath()}
      active="overview"
      title="Overview"
      description="What needs a decision: leads and follow-ups, work waiting for review, tasks that are late or blocked, and campaigns running."
      searchParams={sp}
    >
      {(user) =>
        // Marketing employees land on My Day; the module-wide Overview is for managers.
        teamWide(user) ? (
          <Section load={async () => <OverviewBody user={user} sp={sp} />} />
        ) : (
          redirect(toAppPath(modulePath('my-day'), MODULE.basePath))
        )
      }
    </MarketingPage>
  );
}

async function OverviewBody({ user, sp }: { user: AuthenticatedUser; sp: Awaited<SearchParams> }) {
  const db = getDb();
  const prefs = await getMyPreferences(db, user);
  const f = dashboardFilters(sp, prefs.marketing.dashboard);
  const [o, owners, campaigns, courses] = await Promise.all([
    loadOverview(db, user, f),
    memberOptions(db),
    listCampaigns(db),
    courseOptions(db),
  ]);
  return (
    <div className="el-stack">
      {o.dashboard.unreconciledConflicts.length ? (
        <Alert tone="warning" title="Owner decision needed">
          {o.dashboard.unreconciledConflicts
            .map((c) => `${c.code} (${c.ownerDecision}): ${c.title}.`)
            .join(' ')}{' '}
          <a href={modulePath('accounts')}>See accounts</a>
        </Alert>
      ) : null}
      <OverviewFilters
        f={f}
        owners={owners}
        campaigns={campaigns.map((c) => ({ id: c.id, name: `${c.code} · ${c.name}` }))}
        courses={courses}
      />
      <DecisionTiles o={o} />
      <div className="mkt-panels">
        {o.leads !== undefined ? <LeadFunnel leads={o.leads} f={f} /> : null}
        {o.targets !== undefined ? <TargetsChart targets={o.targets} f={f} /> : null}
      </div>
      <BlockedTasks o={o} />
      <AwaitingReview o={o} />
      <Scheduled o={o} />
      <Card
        title="Campaigns running"
        meta={<Provenance sample={o.running.some((c) => c.isSample)} />}
        actions={<a href={modulePath('campaigns')}>All campaigns</a>}
      >
        <Explain>
          Campaigns with status active
          {f.campaign || f.course ? ', limited to the chosen campaign and course' : ''}. Published
          counts only posts with a live link; views come from imported CSV numbers (missing is not
          zero). Open a campaign for its details.
        </Explain>
        <Unfiltered f={f} applied={['campaign', 'course']} />
        <CampaignResultsTable rows={o.running} empty="No campaign is active" />
      </Card>
      <MonthlyReports r={o.monthlyReports} f={f} />
      {can(user, 'marketing:metrics:read') ? <MetricImports o={o} /> : null}
      <p className="el-field-hint">As of {formatIst(o.asOf)}.</p>
    </div>
  );
}

function BlockedTasks({ o }: { o: Overview }) {
  const r = o.tasks.blocked;
  if (r === undefined) return null;
  return (
    <Card
      id="blocked"
      title="HR tasks and blockers"
      meta={<Provenance />}
      actions={
        r !== 'failed' && o.tasks.overdue !== 'failed' && o.tasks.overdue ? (
          <a href={o.tasks.overdue.href}>Overdue tasks in the task tracker</a>
        ) : undefined
      }
    >
      <Explain>
        Open tasks flagged blocked, from HR&apos;s task list in your scope
        {o.filters.owner ? ', for the chosen owner' : ''}; any due date. The task tracker lists the
        same tasks; open one there to see why it is blocked.
      </Explain>
      <Unfiltered f={o.filters} applied={['owner']} />
      {r === 'failed' ? (
        <p>Tasks could not be loaded.</p>
      ) : r.total ? (
        <p>
          <a href={r.href}>
            Open {r.total} blocked task{r.total === 1 ? '' : 's'} in the task tracker
          </a>
        </p>
      ) : (
        <p>No task is blocked.</p>
      )}
    </Card>
  );
}

function AwaitingReview({ o }: { o: Overview }) {
  return (
    <Card id="awaiting" title="Content awaiting review" meta={<Provenance />}>
      <Explain>
        Content items in review, oldest first
        {o.filters.campaign ? ', with a placement in the chosen campaign' : ', all campaigns'}. Open
        one to approve or request changes.
      </Explain>
      <Unfiltered f={o.filters} applied={['campaign']} />
      <DataTable
        compact
        rows={o.awaitingReview}
        rowKey={(r) => r.id}
        empty={<EmptyState title="Nothing is waiting for review" />}
        columns={[
          { key: 'idea', header: 'Idea', render: (r) => r.ideaCode ?? 'Not recorded' },
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
                'Open'
              ) : (
                <StatusBadge tone="warning">None (imported state): resubmit</StatusBadge>
              ),
          },
          { key: 'updated', header: 'Since', render: (r) => formatIst(r.updatedAt) },
        ]}
      />
    </Card>
  );
}

function Scheduled({ o }: { o: Overview }) {
  const d = o.dashboard;
  return (
    <Card
      id="scheduled"
      title="Posts scheduled in the next 7 days"
      meta={<Provenance />}
      actions={<a href={modulePath('calendar')}>Open the calendar</a>}
    >
      <Explain>
        Posts scheduled from now to {addDays(toIsoDate(o.asOf), 7)} (IST), all campaigns. Planned
        but unscheduled posts are on the calendar, not counted here.
      </Explain>
      <Unfiltered f={o.filters} applied={[]} />
      {d.overdueScheduled.length ? (
        <Alert
          tone="warning"
          title={`${d.overdueScheduled.length} scheduled post(s) are past their time without a publication record`}
        >
          {d.overdueScheduled.map((p) => p.code ?? p.id).join(', ')}: record the publication with
          its live link, or reschedule.
        </Alert>
      ) : null}
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
          { key: 'title', header: 'Content', render: (r) => r.title ?? 'Not recorded' },
        ]}
      />
    </Card>
  );
}

function MetricImports({ o }: { o: Overview }) {
  return (
    <Card
      title="Metric imports"
      meta={<Provenance manual />}
      actions={<a href={modulePath('metrics/import')}>Open metrics import</a>}
    >
      <Explain>
        Numbers come only from CSV exports imported by hand; no account is connected live. Last
        import per Instagram and YouTube account; not limited to {periodText(o.filters)}.
      </Explain>
      <Unfiltered f={o.filters} applied={[]} />
      <DataTable
        compact
        rows={o.dashboard.metricImports}
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
                <StatusBadge>No data imported yet</StatusBadge>
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
  );
}
