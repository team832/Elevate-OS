import { EmptyState, PageHeader, StatusBadge, Subnav, type Tone } from '@elevate/shared-ui';
import { STANDING_LABELS, type Standing } from '../../../domain/work-report';
import { NO_STAFF_RECORD } from '../../../server/staff-tasks';
import { myReports } from '../../../server/work-reports';
import { StatCard } from '../../../ui/charts';
import { fmtDateTime } from '../../../ui/format';
import { load, Section } from '../../../ui/frame';
import { listHref, Pager } from '../../../ui/list-controls';
import { RecordTable } from '../../../ui/record-table';
import type { BodyProps } from '../_components/bodies';
import type { Params } from '../_components/task-common';
import { ReportEditor } from './_components/report-views';

export const STANDING_TONES: Record<Standing, Tone> = {
  missing: 'danger',
  not_started: 'neutral',
  not_expected: 'neutral',
  no_schedule: 'neutral',
  draft: 'neutral',
  submitted: 'info',
  revision_requested: 'warning',
  acknowledged: 'success',
};

export const StandingBadge = ({ standing, late }: { standing: Standing; late: boolean }) => (
  <>
    <StatusBadge tone={STANDING_TONES[standing]}>{STANDING_LABELS[standing]}</StatusBadge>
    {late ? (
      <>
        {' '}
        <StatusBadge tone="warning">Late</StatusBadge>
      </>
    ) : null}
  </>
);

const KINDS = { week: 'weekly', month: 'monthly' } as const;
const deadlineNote = (d: string | null) => (d ? `Due ${fmtDateTime(d)}` : 'No deadline set');

async function Reports({
  user,
  base,
  sp,
  kind,
}: Omit<BodyProps, 'searchParams'> & { sp: Params; kind: keyof typeof KINDS }) {
  const BASE = `${base}/my-reports`;
  const r = await load((db) =>
    myReports(db, user, kind, { page: Number(sp.page) || 1, date: sp.date }),
  );
  if (!r.ok) return r.view;
  if (!r.data) return <EmptyState title="No reports to show" description={NO_STAFF_RECORD} />;
  const d = r.data;
  const open = (start: string) => listHref(BASE, { kind }, { date: start });
  return (
    <div className="el-stack">
      <ul className="el-grid ops-kpis">
        {d.recent.map((x) => (
          <li key={x.period.start}>
            <StatCard
              label={x.label}
              value={`${STANDING_LABELS[x.standing]}${x.late ? ', late' : ''}`}
              note={deadlineNote(x.deadline)}
              href={open(x.period.start)}
              current={x.period.start === d.selected.start}
            />
          </li>
        ))}
      </ul>
      <ReportEditor user={user} base={base} period={d.selected} />
      <RecordTable
        caption={`Your ${KINDS[kind]} reports (${d.total})`}
        rows={d.rows}
        rowKey={(x) => x.id}
        rowHref={(x) => open(x.period.start)}
        linkColumn="label"
        empty="No reports yet. Save a draft above to start one."
        columns={[
          { key: 'label', header: 'Period' },
          {
            key: 'standing',
            header: 'Status',
            render: (x) => <StandingBadge standing={x.standing} late={x.late} />,
          },
          { key: 'deadline', header: 'Deadline', render: (x) => deadlineNote(x.deadline) },
          { key: 'version', header: 'Version', numeric: true, render: (x) => x.currentVersion },
          {
            key: 'submittedAt',
            header: 'Submitted',
            render: (x) => (x.submittedAt ? fmtDateTime(x.submittedAt) : 'Not submitted'),
          },
          {
            key: 'reviewedAt',
            header: 'Reviewed',
            render: (x) => (x.reviewedAt ? fmtDateTime(x.reviewedAt) : 'Not yet'),
          },
        ]}
      />
      <Pager basePath={BASE} params={sp} page={d.page} pageSize={d.pageSize} total={d.total} />
    </div>
  );
}

/**
 * `<base>/my-reports` (brief 23 Oct 2026 §7, §13, §16): the employee's weekly and monthly
 * reports — draft, submit, versions and review comments. Daily reports stay on the tasks page.
 */
export function MyReportsBody({ user, base, searchParams: sp }: BodyProps) {
  const kind = sp.kind === 'month' ? 'month' : 'week';
  return (
    <>
      <PageHeader
        title="My reports"
        description="Weekly and monthly reports built from your tasks, work updates and other records. Add your own words and submit them to your manager."
        tabs={
          <Subnav
            label="Report kinds"
            items={[
              [`${base}/my-reports?kind=week`, 'Weekly'],
              [`${base}/my-reports?kind=month`, 'Monthly'],
              [`${base}/tasks?tab=eod`, 'End-of-day'],
            ]}
            current={`${base}/my-reports?kind=${kind}`}
          />
        }
      />
      <Section>
        <Reports user={user} base={base} sp={sp} kind={kind} />
      </Section>
    </>
  );
}
