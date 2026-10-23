import type { AuthenticatedUser } from '@elevate/authentication';
import { EmptyState } from '@elevate/shared-ui';
import { addDays, istToday } from '../../../domain/dates';
import {
  KIND_LABELS,
  METRIC_DEFINITIONS,
  PERIOD_KINDS,
  STANDING_LABELS,
} from '../../../domain/work-report';
import {
  periodReportQuery,
  REPORT_STANDINGS,
  workReportListQuery,
} from '../../../server/eod-schemas';
import {
  MAX_PERIOD_DAYS,
  periodReport,
  PERIOD_DEFINITIONS,
  reportFilterOptions,
} from '../../../server/task-period-report';
import { workReportList } from '../../../server/work-reports';
import { BarChart, StatCard } from '../../../ui/charts';
import { fmtDate, fmtDateTime } from '../../../ui/format';
import { load } from '../../../ui/frame';
import { listHref, Pager, SearchPanel } from '../../../ui/list-controls';
import { RecordTable } from '../../../ui/record-table';
import { Segment } from '../../../ui/sections';
import { ReportPane } from '../../tasks/reports/_components/report-views';
import { StandingBadge } from '../../tasks/reports/my-reports-body';

type Params = Record<string, string | undefined>;
export const BASE = '/ops/hr/reports';
const pct = (r: number | null) => (r === null ? 'Nothing due' : `${Math.round(r * 100)}%`);

/** One row per staff member HR manages for one period; "Missing" when due and not submitted. */
export async function ByPeriod({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const parsed = workReportListQuery.safeParse(
    Object.fromEntries(Object.entries(sp).filter(([, v]) => v)),
  );
  const q = parsed.success ? parsed.data : workReportListQuery.parse({});
  const r = await load(async (db) => ({
    list: await workReportList(db, user, q),
    options: await reportFilterOptions(db, user, { hr: true }),
  }));
  if (!r.ok) return r.view;
  const { list, options } = r.data;
  return (
    <div className="el-stack">
      <SearchPanel
        action={BASE}
        hidden={{ view: 'period' }}
        search={{ name: 'q', label: 'Employee name', value: sp.q }}
        filters={[
          {
            name: 'kind',
            label: 'Report',
            type: 'select',
            anyLabel: 'Weekly',
            options: PERIOD_KINDS.filter((k) => k !== 'week').map((k) => ({
              value: k,
              label: KIND_LABELS[k],
            })),
            value: sp.kind,
          },
          { name: 'date', label: 'Any day in the period', type: 'date', value: sp.date },
          {
            name: 'standing',
            label: 'Status',
            type: 'select',
            options: REPORT_STANDINGS.map((s) => ({ value: s, label: STANDING_LABELS[s] })),
            value: sp.standing,
          },
          {
            name: 'departmentId',
            label: 'Department',
            type: 'select',
            options: options.departments,
            value: sp.departmentId,
          },
        ]}
      />
      {!parsed.success ? (
        <p className="el-field-hint">Some filters were not valid and were ignored.</p>
      ) : null}
      <p>
        <strong>
          {KIND_LABELS[q.kind]} report, {list.label}
        </strong>{' '}
        · {list.deadline ? `Due ${fmtDateTime(list.deadline)}` : 'No deadline set'} ·{' '}
        {list.due ? 'Due now' : 'Not due yet'}
      </p>
      <details className="el-explain">
        <summary>How this list is defined</summary>
        Active staff with a sign-in (for an HR-only manager, the departments in HR settings). A
        report is expected when the period holds at least one scheduled workday by HR attendance
        rules: approved holidays, approved leave and weekly offs are not workdays. With no work
        schedule the expectation is unknown and the row reads No work schedule, never Missing. A
        report is due once its deadline passes, or, with no deadline set, once the period is over;
        expected, due and not submitted shows as Missing. Late means the first submission came after
        the deadline in force when it was submitted. A missing report is not an absence. Listed by
        name; there is no ranking.
      </details>
      <RecordTable
        caption={`${list.total} ${list.total === 1 ? 'person' : 'people'}`}
        rows={list.rows}
        rowKey={(x) => x.staffId}
        rowHref={(x) =>
          x.reportId ? listHref(BASE, sp, { open: x.reportId }) : `/ops/hr/staff/${x.staffId}`
        }
        linkColumn="name"
        empty={
          <EmptyState
            title="No one matches"
            description="Clear a filter, or check which departments HR manages in HR settings."
          />
        }
        columns={[
          { key: 'name', header: 'Employee' },
          { key: 'department', header: 'Department', render: (x) => x.department ?? 'Not set' },
          {
            key: 'standing',
            header: 'Status',
            render: (x) => (
              <>
                <StandingBadge standing={x.standing} late={x.late} />
                {x.isSample ? (
                  <>
                    {' '}
                    <span className="el-badge el-badge-sample">SAMPLE DATA</span>
                  </>
                ) : null}
              </>
            ),
          },
          {
            key: 'version',
            header: 'Version',
            numeric: true,
            render: (x) => (x.currentVersion ? x.currentVersion : '—'),
          },
          {
            key: 'firstSubmittedAt',
            header: 'First submitted',
            render: (x) => (x.firstSubmittedAt ? fmtDateTime(x.firstSubmittedAt) : 'Not submitted'),
          },
          {
            key: 'reviewedAt',
            header: 'Reviewed',
            render: (x) => (x.reviewedAt ? fmtDateTime(x.reviewedAt) : 'Not yet'),
          },
        ]}
      />
      <Pager
        basePath={BASE}
        params={sp}
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
      />
      {sp.open ? (
        <ReportPane
          user={user}
          id={sp.open}
          base="/ops"
          closeHref={listHref(BASE, sp, { open: undefined })}
        />
      ) : null}
    </div>
  );
}

/**
 * Consolidated view for business leaders: each person's figures side by side, listed by name —
 * no ranking, no combined score (R13) — and the two questions the charts answer.
 */
export async function Summary({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const today = istToday(new Date());
  const params = {
    from: sp.from ?? addDays(today, -27),
    to: sp.to ?? today,
    departmentId: sp.departmentId || undefined,
    staffId: sp.staffId || undefined,
  };
  const parsed = periodReportQuery.safeParse(params);
  const r = await load(async (db) => ({
    options: await reportFilterOptions(db, user, { hr: true }),
    report: parsed.success ? await periodReport(db, user, parsed.data, { hr: true }) : null,
  }));
  if (!r.ok) return r.view;
  const { options, report } = r.data;
  const filters = (
    <SearchPanel
      action={BASE}
      hidden={{ view: 'summary' }}
      search={{
        name: 'staffId',
        label: 'Person',
        type: 'select',
        options: options.staff,
        value: sp.staffId,
      }}
      filters={[
        { name: 'from', label: 'From', type: 'date', value: params.from },
        { name: 'to', label: 'To', type: 'date', value: params.to },
        {
          name: 'departmentId',
          label: 'Department',
          type: 'select',
          options: options.departments,
          value: sp.departmentId,
        },
      ]}
    />
  );
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
  const b = report.backlog;
  const label = (day: string) => fmtDate(day).replace(/ \d{4}$/, '');
  return (
    <div className="el-stack">
      {filters}
      <p>
        {fmtDate(report.window.from)} – {fmtDate(report.window.to)}, cut-off{' '}
        {fmtDateTime(report.asOf)}
      </p>
      <ul className="el-grid ops-kpis">
        <li>
          <StatCard label="Submitted" value={t.submitted} note="Sent for review in the period" />
        </li>
        <li>
          <StatCard label="Approved or done" value={t.completed} />
        </li>
        <li>
          <StatCard
            label="On-time submission rate"
            value={pct(t.onTime.rate)}
            note={`${t.onTime.onTime} of ${t.onTime.eligible} due tasks`}
          />
        </li>
        <li>
          <StatCard label="Open at cut-off" value={t.open} note={`${t.overdue} overdue`} />
        </li>
      </ul>
      <div className="ops-panels">
        <Segment
          title={`Left out of the on-time rate (${t.onTime.excluded.length})`}
          description="Cancelled tasks and drafts never assigned."
          flush
        >
          <RecordTable
            rows={t.onTime.excluded}
            rowKey={(x) => x.taskId}
            rowHref={(x) => `/ops/tasks/${x.taskId}`}
            empty="Nothing was left out."
            columns={[
              { key: 'title', header: 'Task' },
              { key: 'why', header: 'Why' },
            ]}
          />
        </Segment>
        <Segment
          title={`Deadline changes (${t.onTime.revisions.length})`}
          description="Original → current deadline. A change after the first submission never makes it on time."
          flush
        >
          <RecordTable
            rows={t.onTime.revisions}
            rowKey={(x) => x.taskId}
            rowHref={(x) => `/ops/tasks/${x.taskId}`}
            empty="No deadline was changed."
            columns={[
              { key: 'title', header: 'Task' },
              { key: 'change', header: 'Deadline', render: (x) => `${x.from} → ${x.to}` },
              { key: 'reason', header: 'Reason', render: (x) => x.reason ?? 'Not recorded' },
            ]}
          />
        </Segment>
      </div>
      <Segment
        title="Reviewer turnaround"
        description="How quickly reviewers decide. It measures the review, not the employee, and is kept apart from on-time submission."
      >
        <p>
          {t.turnaround.medianHours === null
            ? t.turnaround.waiting
              ? `No decisions yet; ${t.turnaround.waiting} waiting.`
              : 'No submissions in the period.'
            : `Median ${t.turnaround.medianHours} h over ${t.turnaround.decided} decision${t.turnaround.decided === 1 ? '' : 's'}; ${t.turnaround.waiting} waiting.`}
        </p>
        <details className="el-explain">
          <summary>How this is counted</summary>
          {METRIC_DEFINITIONS.turnaround}
        </details>
      </Segment>
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
      <div className="ops-panels">
        <Segment
          title="Work due vs submitted over time"
          description="By day; by week for periods over 31 days."
        >
          <BarChart
            orientation="vertical"
            label="Tasks due"
            data={report.series.map((x) => ({ label: label(x.bucket), value: x.due }))}
            emptyText="No task was due in this period."
          />
          <BarChart
            orientation="vertical"
            label="Tasks submitted for review"
            data={report.series.map((x) => ({ label: label(x.bucket), value: x.submitted }))}
            emptyText="Nothing was submitted in this period."
          />
          <details className="el-explain">
            <summary>How this is counted</summary>
            Due: eligible tasks by the day of the deadline in force at the cut-off. Submitted:
            submissions for review by the day they were made. {METRIC_DEFINITIONS.onTime}
          </details>
        </Segment>
        <Segment title="Submission and review backlog" description="At the cut-off.">
          <BarChart
            label="Submission and review backlog at the cut-off"
            data={[
              {
                label: 'Due, not submitted',
                value: b.dueNotSubmitted,
                href: '/ops/hr/tasks?tab=overdue',
              },
              {
                label: 'Submitted, waiting for review',
                value: b.awaitingReview,
                href: '/ops/hr/review',
              },
              { label: 'Changes requested, not resubmitted', value: b.changesRequested },
              {
                label: 'Reports waiting for review',
                value: b.reportsAwaitingReview,
                href: '/ops/hr/reports?view=waiting',
              },
            ]}
            emptyText="Nothing is waiting."
          />
        </Segment>
      </div>
      <Segment
        title="By person"
        description="Listed by name. There is no ranking or combined score."
        flush
      >
        <RecordTable
          rows={report.people}
          rowKey={(p) => p.staffId}
          rowHref={(p) => `/ops/hr/staff/${p.staffId}`}
          empty="No one HR manages matches these filters."
          columns={[
            { key: 'name', header: 'Person' },
            { key: 'department', header: 'Department', render: (p) => p.department ?? 'Not set' },
            { key: 'assigned', header: 'Assigned', numeric: true },
            { key: 'submitted', header: 'Submitted', numeric: true },
            { key: 'completed', header: 'Approved or done', numeric: true },
            {
              key: 'onTime',
              header: 'On time',
              render: (p) =>
                p.onTime.eligible
                  ? `${p.onTime.onTime} of ${p.onTime.eligible} (${pct(p.onTime.rate)})`
                  : 'Nothing due',
            },
            { key: 'open', header: 'Open', numeric: true },
            { key: 'overdue', header: 'Overdue', numeric: true },
            { key: 'blocked', header: 'Blocked', numeric: true },
            {
              key: 'eod',
              header: 'EOD submitted / missing',
              render: (p) =>
                p.eod.days === null
                  ? `${p.eod.submitted} (${p.eod.note === 'no_schedule' ? 'no work schedule' : 'not expected'})`
                  : `${p.eod.submitted} / ${p.eod.missing}`,
            },
            { key: 'periodic', header: 'Weekly and monthly reports', numeric: true },
          ]}
        />
      </Segment>
    </div>
  );
}
