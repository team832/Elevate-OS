import { getDb } from '@elevate/database';
import { Alert, Card, DataTable, EmptyState, StatusBadge } from '@elevate/shared-ui';
import { CONTENT_STATES, formatIst, modulePath } from '../domain';
import { loadDashboard } from '../server';
import { ContentStateBadge, IntegrationBadge } from '../ui/badges';
import { MarketingPage, Section, type SearchParams } from '../ui/shell';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <MarketingPage
      permission="marketing:module:access"
      path={modulePath()}
      active="dashboard"
      title="Marketing OS"
      description="Content by state, approvals waiting, what is scheduled and how each account is connected."
      searchParams={await searchParams}
    >
      {() => <Section load={async () => <Dashboard />} />}
    </MarketingPage>
  );
}

async function Dashboard() {
  const d = await loadDashboard(getDb());
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
      <div className="el-grid">
        <Card
          title="Content items by state"
          description={`${d.totalItems} items (legacy-imported items carry their tracker status).`}
        >
          <ul>
            {CONTENT_STATES.map((s) => (
              <li key={s}>
                <ContentStateBadge state={s} /> {d.itemsByState[s]}
                {d.legacyItemsByState[s] ? (
                  <span className="el-field-hint"> ({d.legacyItemsByState[s]} from legacy)</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
        <Card
          title="Accounts by integration"
          description="No live publishing adapter exists (D-014); sandbox means the mock adapter only."
        >
          <ul>
            {(['not_configured', 'sandbox', 'connected', 'error'] as const).map((s) => (
              <li key={s}>
                <IntegrationBadge status={s} /> {d.accountsByIntegration[s]}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Ideas" description="Quarantined rows share a legacy ID and wait for OD-003.">
          <p>
            {d.ideasTotal} ideas ·{' '}
            <StatusBadge tone={d.ideasQuarantined ? 'warning' : 'neutral'}>
              {d.ideasQuarantined} quarantined
            </StatusBadge>
          </p>
          <a href={modulePath('ideas')}>Open the idea tracker</a>
        </Card>
      </div>
      <Card title={`Awaiting approval (${d.awaitingApproval.length})`}>
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
      <Card title={`Scheduled in the next 7 days (${d.upcomingScheduled.length})`}>
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
      <p className="el-field-hint">As of {formatIst(d.asOf)}.</p>
    </div>
  );
}
