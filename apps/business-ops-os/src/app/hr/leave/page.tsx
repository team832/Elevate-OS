import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { DataTable, EmptyState, PageHeader } from '@elevate/shared-ui';
import { listLeaveRequests } from '../../../server/hr/leave';
import { employeesInScope } from '../../../server/hr/shifts';
import { fmtDate } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import {
  EmployeeFilter,
  FilterDate,
  FilterForm,
  FilterSelect,
  isIso,
  oneOf,
  pageOf,
  Pager,
  RequestStatus,
  SubNav,
  TimeNav,
  type Sp,
} from '../attendance/time-ui';

export const dynamic = 'force-dynamic';

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
    { href: '/ops/hr/leave?view=mine', label: 'My requests' },
    { href: '/ops/hr/leave?view=to_decide', label: 'Waiting for my decision', show: approver },
    { href: '/ops/hr/leave?view=all', label: 'All in my scope' },
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
      <TimeNav current="/ops/hr/leave" user={access.user} />
      <SubNav label="Leave views" current={`/ops/hr/leave?view=${view}`} items={views} />
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
  const r = await load(async (db) => ({
    people: await employeesInScope(db, user, 'ops:leave:read'),
    list: await listLeaveRequests(db, user, {
      view: sp.view as 'mine' | 'to_decide' | 'all',
      status: oneOf<never>(STATUSES, sp.status),
      staffId: sp.staffId || undefined,
      from: isIso(sp.from) ? (sp.from as never) : undefined,
      to: isIso(sp.to) ? (sp.to as never) : undefined,
      page: pageOf(sp),
    }),
  }));
  if (!r.ok) return r.view;
  const { people, list } = r.data;
  return (
    <div className="el-stack">
      <FilterForm action="/ops/hr/leave">
        <input type="hidden" name="view" value={sp.view} />
        <EmployeeFilter people={people} value={sp.staffId} />
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
      <Pager base="/ops/hr/leave" params={sp} list={list} />
    </div>
  );
}
