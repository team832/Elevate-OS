import type { AuthenticatedUser } from '@elevate/authentication';
import { Card, DataTable, EmptyState, PageHeader, StatTile, StatusBadge } from '@elevate/shared-ui';
import { buildOperationsReport } from '../../../server/reports/operations';
import { decisionTone, fmtDate, fmtDateTime, humanise } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';

export const dynamic = 'force-dynamic';

const DEADLINE_KINDS: Record<string, string> = {
  task: 'Task',
  milestone: 'Milestone',
  sop_review: 'SOP review',
  sop_acknowledgement: 'SOP acknowledgement',
  policy_review: 'Policy review',
};

const TILES = [
  ['Open tasks', 'openTasks'],
  ['Overdue tasks', 'overdueTasks'],
  ['Share of dated open tasks overdue', 'overdueTaskShare'],
  ['Tasks awaiting supervisor review', 'tasksAwaitingReview'],
  ['SOP versions awaiting approval', 'sopsAwaitingApproval'],
  ['Outstanding SOP acknowledgements', 'outstandingSopAcknowledgements'],
  ['SOP acknowledgement coverage', 'sopAcknowledgementCoverage'],
  ['Unresolved incidents', 'unresolvedIncidents'],
  ['Incidents past resolution target', 'incidentsBreachingTarget'],
  ['Blocked projects', 'blockedProjects'],
  ['Approvals waiting for you', 'pendingApprovalsForYou'],
  ['Unresolved integration errors', 'unresolvedIntegrationErrors'],
] as const;

/** /ops/reports/operations — operations dashboard (OPS-069). */
export default async function OperationsReportPage() {
  const access = await gate('ops:dashboard:read', '/ops/reports/operations');
  return (
    <Frame access={access} active="reports">
      <PageHeader
        title="Operations report"
        description="Point-in-time figures from Business Ops records (Asia/Kolkata dates). Counts are real counts; a rate with nothing to measure shows as missing, never 0 %. Capacity tables are sorted by name and are not a ranking."
      />
      <p>
        <a href="/ops/reports">All reports</a> ·{' '}
        <a href="/ops/operations/approvals">Your approvals</a>
      </p>
      <Section label="Calculating the operations report…">
        <Report user={access.user} />
      </Section>
    </Frame>
  );
}

async function Report({ user }: { user: AuthenticatedUser }) {
  const r = await load((db) => buildOperationsReport(db, user));
  if (!r.ok) return r.view;
  const d = r.data;
  const capacityColumns = [
    { key: 'label', header: 'Name' },
    { key: 'open', header: 'Open', numeric: true },
    { key: 'overdue', header: 'Overdue', numeric: true },
    { key: 'blocked', header: 'Blocked', numeric: true },
    { key: 'dueNext7Days', header: 'Due in 7 days', numeric: true },
  ] as const;
  return (
    <div className="el-stack">
      <p className="el-field-hint">
        As of {fmtDateTime(d.asOf)} (today in IST: {fmtDate(d.today)}).
      </p>
      <div className="el-grid">
        {TILES.map(([label, key]) => (
          <StatTile key={key} label={label} metric={d.kpis[key]} />
        ))}
      </div>
      <div className="el-grid">
        <Card title="Open tasks by department" description="Capacity view, sorted by name.">
          <DataTable
            rows={d.capacity.byDepartment}
            rowKey={(x) => x.key}
            empty={<EmptyState title="No open tasks" />}
            columns={[...capacityColumns]}
          />
        </Card>
        <Card
          title="Open tasks by owner"
          description="Capacity view, sorted by name — not a score."
        >
          <DataTable
            rows={d.capacity.byOwner}
            rowKey={(x) => x.key}
            empty={<EmptyState title="No open tasks" />}
            columns={[...capacityColumns]}
          />
        </Card>
      </div>
      <Card
        title="Deadlines in the next 7 days"
        description="Tasks, milestones, SOP and policy reviews, and acknowledgement due dates."
      >
        <DataTable
          rows={d.deadlines}
          rowKey={(x) => `${x.kind}-${x.id}`}
          empty={<EmptyState title="Nothing falls due in the next 7 days" />}
          columns={[
            { key: 'dueDate', header: 'Due', render: (x) => fmtDate(x.dueDate) },
            { key: 'kind', header: 'Type', render: (x) => DEADLINE_KINDS[x.kind] ?? x.kind },
            { key: 'title', header: 'What', render: (x) => <a href={x.link}>{x.title}</a> },
          ]}
        />
      </Card>
      <div className="el-grid">
        <Card title="SOP acknowledgements by SOP">
          <DataTable
            rows={d.acknowledgements.bySop}
            rowKey={(x) => x.id}
            empty={<EmptyState title="No SOP requires acknowledgement" />}
            columns={[
              {
                key: 'code',
                header: 'SOP',
                render: (x) => <a href={`/ops/sops/${x.id}`}>{x.code}</a>,
              },
              { key: 'acknowledged', header: 'Acknowledged', numeric: true },
              { key: 'outstanding', header: 'Outstanding', numeric: true },
              { key: 'noLogin', header: 'No login', numeric: true },
            ]}
          />
        </Card>
        <Card
          title="Unresolved incidents"
          description={
            <>
              Resolution targets are a proposal{' '}
              <StatusBadge tone={decisionTone(d.incidents.setting.decisionState)}>
                {d.incidents.setting.decisionState}
              </StatusBadge>
            </>
          }
        >
          <DataTable
            rows={d.incidents.rows}
            rowKey={(x) => x.id}
            empty={<EmptyState title="No open incidents" />}
            columns={[
              { key: 'code', header: 'Incident' },
              { key: 'title', header: 'Title' },
              { key: 'severity', header: 'Severity' },
              {
                key: 'sla',
                header: 'Target',
                render: (x) => (
                  <>
                    {x.sla.targetDate ? fmtDate(x.sla.targetDate) : 'Not rated'}{' '}
                    {x.sla.state === 'breached' ? (
                      <StatusBadge tone="danger">Past target</StatusBadge>
                    ) : null}
                  </>
                ),
              },
            ]}
          />
          <a href="/ops/incidents">Open the incident register</a>
        </Card>
      </div>
      <Card title="Blocked projects">
        <DataTable
          rows={d.blockedProjects}
          rowKey={(x) => x.id}
          empty={<EmptyState title="No project is blocked" />}
          columns={[
            { key: 'code', header: 'Project', render: (x) => `${x.code} — ${x.name}` },
            { key: 'ownerName', header: 'Owner', render: (x) => x.ownerName ?? '—' },
            { key: 'reasonLabels', header: 'Why', render: (x) => x.reasonLabels.join('; ') },
          ]}
        />
        <a href="/ops/projects">Open projects</a>
      </Card>
      <div className="el-grid">
        <Card title="Your approvals by source">
          <DataTable
            rows={d.approvals.inbox}
            rowKey={(x) => x.key}
            empty={<EmptyState title="You hold no approval rights here" />}
            columns={[
              { key: 'label', header: 'Source' },
              {
                key: 'count',
                header: 'Waiting',
                render: (x) => (x.count === null ? 'Unavailable' : String(x.count)),
              },
            ]}
          />
          <a href="/ops/operations/approvals">Open your approvals</a>
        </Card>
        <Card
          title="All pending approval requests in Business Ops"
          description="Every open request, whoever decides it."
        >
          <DataTable
            rows={d.approvals.pendingByPolicy}
            rowKey={(x) => x.policy}
            empty={<EmptyState title="No pending requests" />}
            columns={[
              { key: 'policy', header: 'Approval policy' },
              { key: 'count', header: 'Pending', numeric: true },
            ]}
          />
        </Card>
      </div>
      <Card
        title="Unresolved integration errors"
        description="Failed or dead event deliveries to Ops consumers, or of events Ops produced. Read-only here; the latest 50 are listed."
      >
        <DataTable
          rows={d.integrationErrors}
          rowKey={(x) => x.id}
          empty={<EmptyState title="No unresolved integration errors" />}
          columns={[
            { key: 'eventType', header: 'Event' },
            { key: 'consumer', header: 'Consumer' },
            { key: 'status', header: 'Status', render: (x) => humanise(x.status) },
            { key: 'attempts', header: 'Attempts', numeric: true },
            { key: 'updatedAt', header: 'Last attempt', render: (x) => fmtDateTime(x.updatedAt) },
            { key: 'lastError', header: 'Last error', render: (x) => x.lastError ?? '—' },
          ]}
        />
      </Card>
    </div>
  );
}
