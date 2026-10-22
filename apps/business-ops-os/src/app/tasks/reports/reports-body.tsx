import type { AuthenticatedUser } from '@elevate/authentication';
import { addDays, istToday } from '../../../domain/dates';
import { periodReportQuery } from '../../../server/eod-schemas';
import {
  MAX_PERIOD_DAYS,
  PERIOD_DEFINITIONS,
  periodReport,
  reportFilterOptions,
} from '../../../server/task-period-report';
import { BarChart, StatCard } from '../../../ui/charts';
import { fmtDate, fmtDateTime } from '../../../ui/format';
import { load, Section } from '../../../ui/frame';
import { listHref } from '../../../ui/list-controls';
import { RecordTable } from '../../../ui/record-table';
import { Segment } from '../../../ui/sections';
import { TasksHeader, type BodyProps } from '../_components/bodies';
import { taskPaths, type Params } from '../_components/task-views';

function Filters({
  q,
  options,
  action,
}: {
  q: Params;
  action: string;
  options: Awaited<ReturnType<typeof reportFilterOptions>>;
}) {
  const select = (
    name: string,
    label: string,
    items: { value: string; label: string }[],
    any: string,
  ) => (
    <div className="el-field">
      <label htmlFor={`report-${name}`}>{label}</label>
      <select id={`report-${name}`} name={name} className="el-select" defaultValue={q[name] ?? ''}>
        <option value="">{any}</option>
        {items.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <form method="get" action={action} className="el-card ops-search">
      <div className="ops-filter-grid">
        {(['from', 'to'] as const).map((k) => (
          <div className="el-field" key={k}>
            <label htmlFor={`report-${k}`}>{k === 'from' ? 'From' : 'To'}</label>
            <input
              id={`report-${k}`}
              name={k}
              type="date"
              className="el-input"
              defaultValue={q[k]}
              required
            />
          </div>
        ))}
        {select('staffId', 'Person', options.staff, 'Everyone you may see')}
        {select('departmentId', 'Department', options.departments, 'All departments')}
      </div>
      <div className="el-form-actions">
        <button type="submit" className="el-button el-button-primary">
          Show report
        </button>
      </div>
    </form>
  );
}

async function Report({ user, sp, base }: { user: AuthenticatedUser; sp: Params; base: string }) {
  const { tasks } = taskPaths(base);
  const API = `${base}/api/v1/task-reports`;
  const today = istToday(new Date());
  const params = {
    from: sp.from ?? addDays(today, -6),
    to: sp.to ?? today,
    staffId: sp.staffId || undefined,
    departmentId: sp.departmentId || undefined,
  };
  const parsed = periodReportQuery.safeParse(params);
  const r = await load(async (db) => ({
    options: await reportFilterOptions(db, user),
    report: parsed.success ? await periodReport(db, user, parsed.data) : null,
  }));
  if (!r.ok) return r.view;
  const { options, report } = r.data;
  const filters = <Filters q={params} options={options} action={`${tasks}/reports`} />;
  if (!report)
    return (
      <div className="el-stack">
        {filters}
        <p role="alert">
          Check the dates: the start must be on or before the end, and a period is at most{' '}
          {MAX_PERIOD_DAYS} days.
        </p>
      </div>
    );
  const t = report.totals;
  return (
    <div className="el-stack">
      {filters}
      <p className="el-inline-form">
        <span>
          {fmtDate(report.window.from)} – {fmtDate(report.window.to)}, cut-off{' '}
          {fmtDateTime(report.asOf)}
        </span>
        <a href={listHref(API, params, { format: 'pdf' })}>Download PDF</a>
        <a href={listHref(API, params, { format: 'csv' })}>Download CSV</a>
      </p>
      <ul className="el-grid ops-kpis">
        <li>
          <StatCard label="Assigned during period" value={t.assigned} />
        </li>
        <li>
          <StatCard label="Completed during period" value={t.completed} />
        </li>
        <li>
          <StatCard label="Open at cut-off" value={t.open} />
        </li>
        <li>
          <StatCard label="Overdue at cut-off" value={t.overdue} />
        </li>
        <li>
          <StatCard label="Blocked at cut-off" value={t.blocked} />
        </li>
        <li>
          <StatCard
            label="EOD reports missing"
            value={t.eodMissing}
            note="Calendar days with no submitted report, per person"
          />
        </li>
      </ul>
      <details className="el-explain">
        <summary>How these are counted</summary>
        <dl>
          {PERIOD_DEFINITIONS.map(([term, text]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </details>
      <Segment title="By person" flush>
        <RecordTable
          rows={report.people}
          rowKey={(p) => p.staffId}
          empty="No one in your scope matches these filters."
          columns={[
            { key: 'name', header: 'Person' },
            { key: 'department', header: 'Department', render: (p) => p.department ?? 'Not set' },
            { key: 'assigned', header: 'Assigned', numeric: true },
            { key: 'completed', header: 'Completed', numeric: true },
            { key: 'open', header: 'Open at cut-off', numeric: true },
            { key: 'overdue', header: 'Overdue at cut-off', numeric: true },
            { key: 'blocked', header: 'Blocked', numeric: true },
            {
              key: 'eod',
              header: 'EOD submitted / acknowledged / missing',
              render: (p) =>
                p.eod.days === null
                  ? `${p.eod.submitted} submitted (not expected: no login or inactive)`
                  : `${p.eod.submitted} / ${p.eod.acknowledged} / ${p.eod.missing} of ${p.eod.days} calendar days`,
            },
          ]}
        />
      </Segment>
      <Segment
        title="EOD coverage"
        description="Days without a submitted report. A missing report is not absence."
      >
        <BarChart
          label="End-of-day reports missing per person"
          data={report.people.map((p) => ({ label: p.name, value: p.eod.missing }))}
          emptyText="No one in this report is expected to submit end-of-day reports."
        />
      </Segment>
      <Segment title={`Blocked at cut-off (${report.blockers.length})`} flush>
        <RecordTable
          rows={report.blockers}
          rowKey={(b) => b.taskId}
          rowHref={(b) => `${tasks}/${b.taskId}`}
          empty="No task was blocked at the cut-off."
          columns={[
            { key: 'title', header: 'Task' },
            { key: 'owner', header: 'Owner' },
            {
              key: 'ageDays',
              header: 'Blocked for (days)',
              numeric: true,
              render: (b) => b.ageDays ?? 'Not recorded',
            },
            { key: 'reason', header: 'Reason', render: (b) => b.reason ?? 'Not recorded' },
          ]}
        />
      </Segment>
      <Segment title={`Decisions waiting (${report.decisions.length})`} flush>
        <RecordTable
          rows={report.decisions}
          rowKey={(d) => `${d.taskId}-${d.what}`}
          rowHref={(d) => `${tasks}/${d.taskId}`}
          empty="Nothing is waiting for a review or a reply."
          columns={[
            { key: 'title', header: 'Task' },
            { key: 'owner', header: 'Owner' },
            { key: 'what', header: 'Waiting for' },
            { key: 'since', header: 'Since', render: (d) => fmtDateTime(d.since) },
            { key: 'detail', header: 'Detail', render: (d) => d.detail ?? '' },
          ]}
        />
      </Segment>
      <Segment title={`EOD revisions requested (${report.revisions.length})`} flush>
        <RecordTable
          rows={report.revisions}
          rowKey={(x) => x.reportId}
          rowHref={(x) => `${tasks}/inbox?open=${x.reportId}`}
          empty="No report is waiting for a revision."
          columns={[
            { key: 'name', header: 'Person' },
            { key: 'reportDate', header: 'Report day', render: (x) => fmtDate(x.reportDate) },
            { key: 'since', header: 'Requested', render: (x) => fmtDateTime(x.since) },
          ]}
        />
      </Segment>
    </div>
  );
}

/** `<base>/tasks/reports`: a period's task and EOD figures for the caller's scope, with downloads. */
export function TaskReportsBody({ user, base, searchParams: sp }: BodyProps) {
  return (
    <>
      <TasksHeader
        user={user}
        base={base}
        current="reports"
        title="Task and EOD reports"
        description="What was assigned, completed and left open in a period, from each task's dated history."
      />
      <Section>
        <Report user={user} sp={sp} base={base} />
      </Section>
    </>
  );
}
