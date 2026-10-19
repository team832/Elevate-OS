import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { DataTable, EmptyState, PageHeader } from '@elevate/shared-ui';
import { listLeaveRequests } from '../../../server/hr/leave';
import { employeesInScope } from '../../../server/hr/shifts';
import { fmtDate } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import {
  FilterDate,
  FilterForm,
  FilterSelect,
  isIso,
  Pager,
  RequestStatus,
  TimeNav,
  timeNavItems,
} from '../attendance/time-ui';

export const dynamic = 'force-dynamic';

type Sp = Record<string, string | undefined>;
const STATUSES = [
  { value: 'pending', label: 'Pending decision' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default async function LeavePage({ searchParams }: { searchParams: Promise<Sp> }) {
  const access = await gate('ops:leave:read', '/ops/hr/leave');
  const sp = await searchParams;
  const approver = can(access.user, 'ops:leave:approve');
  const view =
    sp.view === 'mine' || sp.view === 'to_decide' || sp.view === 'all'
      ? sp.view
      : approver
        ? 'to_decide'
        : 'mine';
  const views = [
    { key: 'mine', label: 'My requests', show: true },
    { key: 'to_decide', label: 'Waiting for my decision', show: approver },
    { key: 'all', label: 'All in my scope', show: true },
  ];
  return (
    <Frame access={access} active="leave">
      <PageHeader
        title="Leave"
        description="Requests count working days only: non-working days of the employee’s shift and holidays are excluded. Nobody approves their own leave."
        actions={
          can(access.user, 'ops:leave:manage') ? (
            <a href="/ops/hr/leave/types">Manage leave types</a>
          ) : undefined
        }
      />
      <TimeNav current="/ops/hr/leave" items={timeNavItems(access.user)} />
      <nav className="el-subnav" aria-label="Leave views">
        {views
          .filter((v) => v.show)
          .map((v) => (
            <a
              key={v.key}
              href={`/ops/hr/leave?view=${v.key}`}
              aria-current={v.key === view ? 'page' : undefined}
            >
              {v.label}
            </a>
          ))}
      </nav>
      {can(access.user, 'ops:leave:request') ? (
        <p>
          To request leave, use <a href="/ops/hr/attendance/me">My attendance &amp; leave</a>.
        </p>
      ) : null}
      <Section label="Loading leave requests…">
        <List user={access.user} sp={{ ...sp, view }} />
      </Section>
    </Frame>
  );
}

async function List({ user, sp }: { user: AuthenticatedUser; sp: Sp }) {
  const page = Math.max(1, Number(sp.page) || 1);
  const status = STATUSES.some((s) => s.value === sp.status) ? (sp.status as never) : undefined;
  const r = await load(async (db) => ({
    people: await employeesInScope(db, user, 'ops:leave:read'),
    list: await listLeaveRequests(db, user, {
      view: sp.view as 'mine' | 'to_decide' | 'all',
      status,
      staffId: sp.staffId || undefined,
      from: isIso(sp.from) ? (sp.from as never) : undefined,
      to: isIso(sp.to) ? (sp.to as never) : undefined,
      page,
    }),
  }));
  if (!r.ok) return r.view;
  const { people, list } = r.data;
  return (
    <div className="el-stack">
      <FilterForm action="/ops/hr/leave">
        <input type="hidden" name="view" value={sp.view} />
        <FilterSelect
          name="staffId"
          label="Employee"
          value={sp.staffId}
          anyLabel="Everyone in scope"
          options={people.map((p) => ({ value: p.staffId, label: p.fullName }))}
        />
        <FilterSelect name="status" label="Status" value={sp.status} options={STATUSES} />
        <FilterDate name="from" label="Overlapping from" value={sp.from} />
        <FilterDate name="to" label="to" value={sp.to} />
      </FilterForm>
      <DataTable
        caption={`${list.total} request(s)`}
        rows={list.rows}
        rowKey={(x) => x.id}
        empty={
          <EmptyState
            title={
              sp.view === 'to_decide'
                ? 'Nothing is waiting for your decision'
                : 'No leave requests in this view'
            }
          />
        }
        columns={[
          {
            key: 'code',
            header: 'Request',
            render: (x) => <a href={`/ops/hr/leave/${x.id}`}>{x.code}</a>,
          },
          { key: 'name', header: 'Employee', render: (x) => x.fullName },
          { key: 'type', header: 'Type', render: (x) => x.typeName },
          {
            key: 'dates',
            header: 'Dates',
            render: (x) =>
              `${fmtDate(x.startDate)}${x.startPart !== 'full' ? ` (${x.startPart.replace('_', ' ')})` : ''} – ${fmtDate(x.endDate)}${x.endPart !== 'full' && x.endDate !== x.startDate ? ` (${x.endPart.replace('_', ' ')})` : ''}`,
          },
          { key: 'days', header: 'Working days', numeric: true, render: (x) => x.workingDays },
          { key: 'status', header: 'Status', render: (x) => <RequestStatus status={x.status} /> },
          {
            key: 'act',
            header: '',
            render: (x) => (x.canDecide ? <a href={`/ops/hr/leave/${x.id}`}>Review</a> : null),
          },
        ]}
      />
      <Pager
        base="/ops/hr/leave"
        params={sp}
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
      />
    </div>
  );
}
