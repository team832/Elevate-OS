import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { istToday, type IsoDate } from '../../../domain/dates';
import { monthRange } from '../../../domain/hr/calendar';
import { buildTimesheets } from '../../../server/hr/timesheets';
import { employeesInScope } from '../../../server/hr/shifts';
import { formOptions } from '../../../server/options';
import { fmtDate } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import {
  EmployeeFilter,
  FilterDate,
  FilterForm,
  FilterSelect,
  isIso,
  measuredColumns,
  minutes,
  TimeNav,
  type Sp,
} from '../attendance/time-ui';

export const dynamic = 'force-dynamic';

export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const access = await gate('ops:hr_reports:read', '/ops/hr/timesheets');
  const sp = await searchParams;
  const month = monthRange(istToday(new Date()).slice(0, 7));
  const from = (isIso(sp.from) ? sp.from : month.from) as IsoDate;
  const to = (isIso(sp.to) ? sp.to : month.to) as IsoDate;
  const q = new URLSearchParams({ from, to });
  if (sp.staffId) q.set('staffId', sp.staffId);
  if (sp.departmentId) q.set('departmentId', sp.departmentId);
  return (
    <Frame access={access} active="timesheets">
      <PageHeader
        title="Timesheets"
        description="Scheduled hours come from assigned shifts; worked hours from closed sessions minus breaks. The difference is shown as unapproved, because overtime approval does not exist yet. Attendance alone is not a performance measure."
        actions={
          can(access.user, 'ops:hr_reports:export') ? (
            <a
              className="el-button el-button-secondary"
              href={`/ops/api/v1/hr/timesheets/export?${q.toString()}`}
            >
              Download employee CSV
            </a>
          ) : undefined
        }
      />
      <TimeNav current="/ops/hr/timesheets" user={access.user} />
      <Section label="Loading timesheets…">
        <Sheets
          user={access.user}
          from={from}
          to={to}
          staffId={sp.staffId}
          departmentId={sp.departmentId}
        />
      </Section>
    </Frame>
  );
}

async function Sheets({
  user,
  from,
  to,
  staffId,
  departmentId,
}: {
  user: AuthenticatedUser;
  from: IsoDate;
  to: IsoDate;
  staffId?: string;
  departmentId?: string;
}) {
  const r = await load(async (db) => ({
    data: await buildTimesheets(db, user, {
      from,
      to,
      staffId: staffId || undefined,
      departmentId: departmentId || undefined,
    }),
    people: await employeesInScope(db, user, 'ops:hr_reports:read'),
    departments: (await formOptions(db)).departments,
  }));
  if (!r.ok) return r.view;
  const { data, people, departments } = r.data;
  const one = staffId ? data.people[0] : undefined;
  return (
    <div className="el-stack">
      <FilterForm action="/ops/hr/timesheets" submitLabel="Show timesheets">
        <FilterDate name="from" label="From" value={from} />
        <FilterDate name="to" label="To" value={to} />
        <FilterSelect
          name="departmentId"
          label="Department"
          value={departmentId}
          anyLabel="All departments"
          options={departments}
        />
        <EmployeeFilter people={people} value={staffId} />
      </FilterForm>
      <Card title={`Totals, ${fmtDate(from)} – ${fmtDate(to)}`}>
        <DataTable
          rows={[data.totals]}
          rowKey={() => 'totals'}
          columns={[
            { key: 'n', header: 'Employees', numeric: true, render: (t) => t.employees },
            ...measuredColumns((t: typeof data.totals) => t),
            { key: 'l', header: 'Late', numeric: true, render: (t) => t.lateCount },
            { key: 'e', header: 'Early', numeric: true, render: (t) => t.earlyCount },
            {
              key: 'm',
              header: 'Missing clock-outs',
              numeric: true,
              render: (t) => t.missingClockOuts,
            },
            {
              key: 'x',
              header: 'Unresolved exceptions',
              numeric: true,
              render: (t) => t.unresolvedExceptions,
            },
            { key: 'v', header: 'Leave days', numeric: true, render: (t) => t.approvedLeaveDays },
          ]}
        />
      </Card>
      <DataTable
        caption="Per employee"
        rows={data.people}
        rowKey={(p) => p.staffId}
        empty={<EmptyState title="Nobody in your scope for this selection" />}
        columns={[
          {
            key: 'name',
            header: 'Employee',
            render: (p) => (
              <a href={`/ops/hr/timesheets?from=${from}&to=${to}&staffId=${p.staffId}`}>
                {p.fullName}
              </a>
            ),
          },
          { key: 'dept', header: 'Department', render: (p) => p.departmentName ?? '—' },
          ...measuredColumns((p: (typeof data.people)[number]) => p.summary),
          { key: 'l', header: 'Late', numeric: true, render: (p) => p.summary.lateCount },
          { key: 'e', header: 'Early', numeric: true, render: (p) => p.summary.earlyCount },
          {
            key: 'x',
            header: 'Exceptions',
            numeric: true,
            render: (p) => p.summary.unresolvedExceptions,
          },
          {
            key: 'v',
            header: 'Leave days',
            numeric: true,
            render: (p) => p.summary.approvedLeaveDays,
          },
        ]}
      />
      {one?.days ? (
        <Card title={`Daily: ${one.fullName}`}>
          <DataTable
            rows={one.days}
            rowKey={(d) => d.date}
            columns={[
              { key: 'date', header: 'Date', render: (d) => fmtDate(d.date) },
              {
                key: 'sched',
                header: 'Scheduled',
                render: (d) =>
                  d.schedule.status === 'scheduled'
                    ? `${minutes(d.schedule.minutes)} (${d.schedule.templateCode})`
                    : d.schedule.reason === 'holiday'
                      ? `Holiday: ${d.schedule.holidayName ?? ''}`
                      : d.schedule.reason === 'non_working_day'
                        ? 'Non-working day'
                        : 'Not scheduled',
              },
              {
                key: 'worked',
                header: 'Worked',
                render: (d) =>
                  d.workedMinutes === null
                    ? d.openSession
                      ? 'Open session'
                      : '—'
                    : minutes(d.workedMinutes),
              },
              {
                key: 'flags',
                header: 'Flags',
                render: (d) => (
                  <>
                    {d.late ? <StatusBadge tone="warning">Late</StatusBadge> : null}
                    {d.early ? <StatusBadge tone="warning">Left early</StatusBadge> : null}
                    {d.missingClockOut ? (
                      <StatusBadge tone="warning">Missing clock-out</StatusBadge>
                    ) : null}
                    {d.pendingCorrections ? (
                      <StatusBadge tone="info">Correction pending</StatusBadge>
                    ) : null}
                    {d.leaveDays ? (
                      <StatusBadge tone="info">Leave {d.leaveDays}</StatusBadge>
                    ) : null}
                  </>
                ),
              },
              {
                key: 'link',
                header: '',
                render: (d) =>
                  d.sessions ? (
                    <a
                      href={`/ops/hr/attendance?staffId=${one.staffId}&from=${d.date}&to=${d.date}`}
                    >
                      Sessions
                    </a>
                  ) : null,
              },
            ]}
          />
        </Card>
      ) : null}
    </div>
  );
}
