import type { AuthenticatedUser } from '@elevate/authentication';
import {
  Card,
  DataTable,
  EmptyState,
  Field,
  formatMetricValue,
  PageHeader,
  Select,
  StatTile,
} from '@elevate/shared-ui';
import type { Metric } from '@elevate/shared-contracts';
import { APPLICATION_STAGE_LABELS, APPLICATION_STAGES } from '../../../domain';
import { buildHrReport, HR_REPORT_PERIODS, type HrReportPeriod } from '../../../server/reports/hr';
import { fmtDate } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';

export const dynamic = 'force-dynamic';

const NOT_AVAILABLE = 'Not available';
const Tile = ({ label, metric }: { label: string; metric: Metric }) => (
  <StatTile label={label} metric={metric} missingLabel={NOT_AVAILABLE} />
);

/** /ops/reports/hr — headcount, recruitment and lifecycle, attendance and leave for one period. */
export default async function HrReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:hr_reports:read', '/ops/reports/hr');
  const sp = await searchParams;
  const period: HrReportPeriod = sp.period === 'last_month' ? 'last_month' : 'this_month';
  return (
    <Frame access={access} active="reports">
      <PageHeader
        title="HR report"
        description="Figures from the HR records in Business Ops, for Asia/Kolkata calendar days. Each tile says what it counts. A figure that cannot be measured shows as not available with the reason, never as 0. No targets are set."
      />
      <form
        method="get"
        action="/ops/reports/hr"
        className="el-inline-form"
        aria-label="Report period"
      >
        <Field id="hr-period" label="Period">
          <Select id="hr-period" name="period" defaultValue={period}>
            {Object.entries(HR_REPORT_PERIODS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <button type="submit" className="el-button el-button-secondary">
          Show this period
        </button>
      </form>
      <Section label="Loading the HR report…">
        <Report user={access.user} period={period} />
      </Section>
    </Frame>
  );
}

async function Report({ user, period }: { user: AuthenticatedUser; period: HrReportPeriod }) {
  const r = await load((db) => buildHrReport(db, user, { period }));
  if (!r.ok) return r.view;
  const d = r.data;
  const l = d.lifecycle;
  return (
    <div className="el-stack">
      <p className="el-field-hint">
        {d.window.label}: {fmtDate(d.window.from)} – {fmtDate(d.window.to)}
        {d.scope === 'own' ? ' · only you and your reporting chain' : ''}
      </p>
      <Card title="People">
        <div className="el-grid">
          <Tile label="Active employees" metric={d.activeEmployees} />
          <Tile label="Joining in the next 30 days" metric={d.joining.metric} />
        </div>
      </Card>
      <div className="el-grid">
        <Card title="Employees by department" description="Current employees, not separated.">
          <DataTable
            rows={d.byDepartment}
            rowKey={(x) => x.departmentId ?? 'none'}
            empty={<EmptyState title="No departments recorded yet" />}
            columns={[
              { key: 'department', header: 'Department', render: (x) => x.departmentName },
              {
                key: 'employees',
                header: 'Employees',
                numeric: true,
                render: (x) =>
                  x.metric.status === 'missing'
                    ? `${NOT_AVAILABLE}: ${x.metric.reason}`
                    : formatMetricValue(x.metric),
              },
            ]}
          />
        </Card>
        <Card
          title="Upcoming joining dates"
          description={
            d.joining.withoutStartDate
              ? `${d.joining.withoutStartDate} onboarding employee(s) have no start date recorded.`
              : undefined
          }
        >
          <DataTable
            rows={d.joining.employees}
            rowKey={(x) => x.staffId}
            empty={
              <EmptyState
                title={
                  d.joining.metric.status === 'missing'
                    ? NOT_AVAILABLE
                    : 'Nobody is due to join in the next 30 days'
                }
                description={
                  d.joining.metric.status === 'missing' ? d.joining.metric.reason : undefined
                }
              />
            }
            columns={[
              {
                key: 'employee',
                header: 'Employee',
                render: (x) => (
                  <a href={`/ops/hr/employees/${x.staffId}`}>{`${x.employeeCode} ${x.fullName}`}</a>
                ),
              },
              { key: 'startDate', header: 'Start date', render: (x) => fmtDate(x.startDate) },
            ]}
          />
        </Card>
      </div>
      <Card title="Recruitment pipeline" description="Applications at each stage now.">
        <div className="el-grid">
          {APPLICATION_STAGES.map((s) => (
            <Tile key={s} label={APPLICATION_STAGE_LABELS[s]} metric={l.pipelineByStage[s]} />
          ))}
          <Tile label="Open requisitions" metric={l.openRequisitions} />
          <Tile label="Unfilled openings" metric={l.unfilledOpenings} />
        </div>
      </Card>
      <Card title="Onboarding and offboarding">
        <div className="el-grid">
          <Tile label="Onboarding checklist completion" metric={l.onboardingCompletionRate} />
          <Tile label="Open onboarding cases" metric={l.openOnboardingCases} />
          <Tile label="Pending offboarding items" metric={l.pendingOffboardingItems} />
          <Tile label="Separations in the period" metric={l.separationsInWindow} />
        </div>
      </Card>
      <Card title="Attendance and leave">
        <div className="el-grid">
          <Tile label="Open attendance exceptions" metric={d.time.attendanceExceptionsOpen} />
          <Tile label="Leave awaiting approval" metric={d.time.leaveRequestsAwaitingApproval} />
          <Tile label="Scheduled hours" metric={d.time.scheduledHours} />
          <Tile label="Recorded hours" metric={d.time.recordedHours} />
        </div>
      </Card>
    </div>
  );
}
