import type { AuthenticatedUser } from '@elevate/authentication';
import type { Metric } from '@elevate/shared-contracts';
import { Card, DataTable, EmptyState, PageHeader, StatTile } from '@elevate/shared-ui';
import { ADMISSION_STATUS_LABELS, PIPELINE_ORDER, type AdmissionStatus } from '../../../domain';
import { admissionsReportQuery } from '../../../server/admissions-schemas';
import { buildAdmissionsReport } from '../../../server/reports/admissions';
import { fmtDate, fmtDateTime } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';

export const dynamic = 'force-dynamic';

export default async function AdmissionsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:admissions:read', '/ops/reports/admissions');
  const sp = await searchParams;
  const parsed = admissionsReportQuery.safeParse({
    from: sp.from || undefined,
    to: sp.to || undefined,
  });
  const query =
    parsed.success && (!parsed.data.from || !parsed.data.to || parsed.data.from <= parsed.data.to)
      ? parsed.data
      : {};
  return (
    <Frame access={access} active="reports">
      <PageHeader
        title="Admissions report"
        description="Counts from the admissions records in Business Ops. Each figure states what it counts and for which dates (Asia/Kolkata). A rate with nothing to divide by shows as missing, not 0 %. No targets are set (OD-027)."
      />
      <form
        method="get"
        action="/ops/reports/admissions"
        className="el-inline-form"
        aria-label="Report period"
      >
        {(['from', 'to'] as const).map((name) => (
          <div key={name} className="el-field">
            <label htmlFor={`report-${name}`}>{name === 'from' ? 'From' : 'To'}</label>
            <input
              id={`report-${name}`}
              name={name}
              type="date"
              className="el-input"
              defaultValue={sp[name] ?? ''}
            />
          </div>
        ))}
        <button type="submit" className="el-button el-button-secondary">
          Show this period
        </button>
        <a href="/ops/reports/admissions">This week</a>
      </form>
      {sp.from || sp.to ? (
        query.from || query.to ? null : (
          <p className="el-field-hint" role="status">
            The dates were not valid (or From was after To); showing this week instead.
          </p>
        )
      ) : null}
      <Section label="Loading the report…">
        <Report user={access.user} query={query} />
      </Section>
    </Frame>
  );
}

function Tiles({ tiles }: { tiles: [string, Metric][] }) {
  return (
    <div className="el-grid">
      {tiles.map(([label, metric]) => (
        <StatTile key={label} label={label} metric={metric} />
      ))}
    </div>
  );
}

async function Report({
  user,
  query,
}: {
  user: AuthenticatedUser;
  query: { from?: string; to?: string };
}) {
  const r = await load((db) => buildAdmissionsReport(db, user, query));
  if (!r.ok) return r.view;
  const d = r.data;
  const k = d.kpis;
  const statuses: AdmissionStatus[] = [...PIPELINE_ORDER, 'on_hold', 'lost'];
  return (
    <div className="el-stack">
      <p className="el-field-hint">
        Period {fmtDate(d.window.from)} – {fmtDate(d.window.to)} · as of {fmtDateTime(d.asOf)}
        {d.scope === 'own' ? ' · only your own leads and admissions' : ''}
      </p>
      <Card title="Enquiries and pipeline">
        <Tiles
          tiles={[
            ['New enquiries', k.newEnquiries],
            ['Counselling sessions coming up', k.counselling.upcoming],
            ['Past sessions without an outcome', k.counselling.pastUnrecorded],
            ['Demos in the next 7 days', k.upcomingDemos],
            ['Applications awaiting a decision', k.decisions.awaitingDecision],
            ['Fee approvals waiting for an approver', k.decisions.awaitingApproval],
            ['Offers awaiting the family', k.decisions.offersAwaitingResponse],
            ['Overdue follow-ups', k.overdueFollowUps],
          ]}
        />
      </Card>
      <Card
        title="Conversion"
        description={`Cohort ${fmtDate(d.cohort.from)} – ${fmtDate(d.cohort.to)}, ${d.cohort.windowDays}-day window (setting ${d.cohort.setting.decisionState}).`}
      >
        <Tiles tiles={[['Lead → admission conversion', k.conversion]]} />
      </Card>
      <Card
        title="Enrolment handoff to Academic OS"
        description="Requests published in the period and what happened to them."
      >
        <Tiles
          tiles={[
            ['Requests sent', k.handoff.requested],
            ['Confirmed by Academic OS', k.handoff.confirmed],
            ['Rejected by Academic OS', k.handoff.rejected],
            ['Failed after all retries', k.handoff.failed],
            ['Still waiting', k.handoff.awaiting],
            ['Handoff success rate', k.handoff.successRate],
          ]}
        />
      </Card>
      <div className="el-grid">
        <Card
          title="New leads by first source"
          description="Leads whose first enquiry falls in the period."
        >
          <DataTable
            rows={d.bySource}
            rowKey={(s) => s.sourceCode}
            empty={<EmptyState title="No new leads in this period" />}
            columns={[
              { key: 'source', header: 'Source', render: (s) => s.label },
              { key: 'count', header: 'Leads', render: (s) => s.count, numeric: true },
            ]}
          />
        </Card>
        <Card
          title="Admission cases by status"
          description="Right now; merged duplicates excluded."
        >
          <DataTable
            rows={statuses.map((s) => ({ s, n: d.byStatus[s] }))}
            rowKey={(x) => x.s}
            columns={[
              { key: 'status', header: 'Status', render: (x) => ADMISSION_STATUS_LABELS[x.s] },
              { key: 'n', header: 'Cases', render: (x) => x.n, numeric: true },
            ]}
          />
        </Card>
        <Card title="Closed cases by reason" description="Cases closed as lost in the period.">
          <DataTable
            rows={d.closures}
            rowKey={(c) => c.reasonCode}
            empty={<EmptyState title="No cases closed in this period" />}
            columns={[
              { key: 'reason', header: 'Reason', render: (c) => c.label },
              { key: 'count', header: 'Cases', render: (c) => c.count, numeric: true },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
