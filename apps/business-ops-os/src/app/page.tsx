import { can } from '@elevate/authorization';
import type { AuthenticatedUser } from '@elevate/authentication';
import {
  Alert,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  StatTile,
  StatusBadge,
} from '@elevate/shared-ui';
import { buildDashboard, myWork } from '../server/dashboard';
import { buildOperationsReport } from '../server/reports/operations';
import { CrossModulePanels } from '../ui/cross-module';
import { decisionTone } from '../ui/format';
import { Frame, gate, load, Section } from '../ui/frame';

export const dynamic = 'force-dynamic';

/** /ops — management dashboard (OPS-024) for managers/director/auditor; "my work" for others. */
export default async function HomePage() {
  const access = await gate('ops:module:access', '/ops');
  return (
    <Frame access={access} active="home">
      {can(access.user, 'ops:dashboard:read') ? (
        <>
          <PageHeader
            title="Operations dashboard"
            description="Defined KPIs (hover-free definitions under each tile), workload, and the Academic and Marketing summaries. Missing data is shown as missing, never as zero."
          />
          <Section label="Calculating KPIs…">
            <Dashboard user={access.user} />
          </Section>
          <Section label="Loading operations…">
            <Operations user={access.user} />
          </Section>
        </>
      ) : (
        <>
          <PageHeader
            title="My work"
            description="Your follow-ups, admissions and tasks in Business Ops OS."
          />
          <Section>
            <MyWork user={access.user} />
          </Section>
        </>
      )}
    </Frame>
  );
}

async function Dashboard({ user }: { user: AuthenticatedUser }) {
  const r = await load((db) => buildDashboard(db, user));
  if (!r.ok) return r.view;
  const d = r.data;
  return (
    <div className="el-stack">
      <p className="el-field-hint">
        As of {new Date(d.asOf).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST · window{' '}
        {d.window.from} to {d.window.to} (Mon–Sun, Asia/Kolkata). Conversion uses the cohort week{' '}
        {d.cohort.from}–{d.cohort.to} with a {d.cohort.windowDays}-day window{' '}
        <StatusBadge tone={decisionTone(d.cohort.setting.decisionState)}>
          {d.cohort.setting.decisionState}
        </StatusBadge>
        . Targets are not set (OD-027).
      </p>
      <div className="el-grid">
        <StatTile label="New leads" metric={d.kpis.newLeads} />
        <StatTile label="Lead → admission conversion" metric={d.kpis.conversion} />
        <StatTile
          label="Counselling & demo follow-up compliance"
          metric={d.kpis.followUpCompliance}
        />
        <StatTile label="Task completion rate" metric={d.kpis.taskCompletionRate} />
        <StatTile label="Overdue work" metric={d.kpis.overdueWork} />
        <StatTile label="Unresolved blockers" metric={d.kpis.unresolvedBlockers} />
      </div>
      <p className="el-field-hint">
        Overdue: {d.breakdown.overdueTasks} task(s), {d.breakdown.overdueFollowUps} follow-up(s).
        Blockers: {d.breakdown.blockerRegisterItems} register item(s), {d.breakdown.blockedTasks}{' '}
        blocked task(s).
      </p>
      <Card
        title="Workload per staff member"
        description="Assigned open items (tasks, follow-ups, admissions). A capacity view, sorted by name — not a performance score and not a ranking."
      >
        <DataTable
          rows={d.workload.rows}
          rowKey={(r) => r.staffId}
          empty={<EmptyState title="No active staff" />}
          columns={[
            { key: 'fullName', header: 'Staff member' },
            { key: 'openTasks', header: 'Open tasks', numeric: true },
            { key: 'openFollowUps', header: 'Open follow-ups', numeric: true },
            { key: 'openAdmissions', header: 'Open admissions', numeric: true },
            { key: 'totalOpenItems', header: 'Total', numeric: true },
          ]}
        />
        {d.workload.unassigned > 0 ? (
          <Alert tone="warning">{d.workload.unassigned} open item(s) have no owner.</Alert>
        ) : null}
      </Card>
      {d.crossModule ? <CrossModulePanels summaries={d.crossModule} /> : null}
    </div>
  );
}

async function Operations({ user }: { user: AuthenticatedUser }) {
  const r = await load((db) => buildOperationsReport(db, user));
  if (!r.ok) return r.view;
  const k = r.data.kpis;
  return (
    <Card
      title="Operations"
      description="Tasks, SOPs, incidents and approvals right now. The full breakdown is in the operations report."
    >
      <div className="el-grid">
        <StatTile label="Overdue tasks" metric={k.overdueTasks} />
        <StatTile label="SOP versions awaiting approval" metric={k.sopsAwaitingApproval} />
        <StatTile
          label="Outstanding SOP acknowledgements"
          metric={k.outstandingSopAcknowledgements}
        />
        <StatTile label="Incidents past resolution target" metric={k.incidentsBreachingTarget} />
        <StatTile label="Approvals waiting for you" metric={k.pendingApprovalsForYou} />
        <StatTile label="Unresolved integration errors" metric={k.unresolvedIntegrationErrors} />
      </div>
      <p>
        <a href="/ops/reports/operations">Open the operations report</a> ·{' '}
        <a href="/ops/operations/approvals">Open your approvals</a>
      </p>
    </Card>
  );
}

async function MyWork({ user }: { user: AuthenticatedUser }) {
  const r = await load((db) => myWork(db, user));
  if (!r.ok) return r.view;
  if (!r.data.linked)
    return (
      <EmptyState
        title="Not linked to a staff record"
        description="Ask an operations manager to link your login to your staff record."
      />
    );
  return (
    <div className="el-grid">
      <Card title="Follow-ups due today">
        <p className="el-stat-value">{r.data.followUpsDue}</p>
        <a href="/ops/leads?flag=overdue">Open leads</a>
      </Card>
      <Card title="Overdue follow-ups">
        <p className="el-stat-value">{r.data.followUpsOverdue}</p>
      </Card>
      <Card title="Open admissions">
        <p className="el-stat-value">{r.data.openAdmissions}</p>
        <a href="/ops/admissions">Admissions</a>
      </Card>
      <Card title="My open tasks">
        <p className="el-stat-value">{r.data.openTasks}</p>
        <a href="/ops/tasks?view=mine">Tasks</a>
      </Card>
      <Card title="Approvals">
        <a href="/ops/operations/approvals">See what is waiting for your decision</a>
      </Card>
    </div>
  );
}
