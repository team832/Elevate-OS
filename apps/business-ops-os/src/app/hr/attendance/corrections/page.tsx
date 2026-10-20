import type { AuthenticatedUser } from '@elevate/authentication';
import { DataTable, EmptyState, PageHeader } from '@elevate/shared-ui';
import { listCorrections } from '../../../../server/hr/attendance';
import { fmtDate, fmtDateTime } from '../../../../ui/format';
import { Frame, gate, load, Section } from '../../../../ui/frame';
import {
  FilterForm,
  FilterSelect,
  oneOf,
  pageOf,
  Pager,
  RequestStatus,
  TimeNav,
  type Sp,
} from '../time-ui';

export const dynamic = 'force-dynamic';

const STATUSES = [
  { value: 'pending', label: 'Pending decision' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'withdrawn', label: 'Withdrawn' },
];

export default async function CorrectionsPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const access = await gate('ops:attendance:read', '/ops/hr/attendance/corrections');
  const sp = await searchParams;
  return (
    <Frame access={access} active="attendance">
      <PageHeader
        title="Attendance corrections"
        description="Requests to fix a recorded time or add a missed day. Approval keeps the original session as superseded and records the corrected times as a new session."
      />
      <TimeNav current="/ops/hr/attendance/corrections" user={access.user} />
      <Section label="Loading corrections…">
        <List user={access.user} sp={sp} />
      </Section>
    </Frame>
  );
}

async function List({ user, sp }: { user: AuthenticatedUser; sp: Sp }) {
  const status = oneOf(STATUSES, sp.status);
  const r = await load((db) => listCorrections(db, user, { status, page: pageOf(sp) }));
  if (!r.ok) return r.view;
  return (
    <div className="el-stack">
      <FilterForm action="/ops/hr/attendance/corrections">
        <FilterSelect name="status" label="Status" value={status} options={STATUSES} />
      </FilterForm>
      <DataTable
        caption={`${r.data.total} correction(s)`}
        rows={r.data.rows}
        rowKey={(c) => c.id}
        empty={<EmptyState title="No corrections in this view" />}
        columns={[
          {
            key: 'code',
            header: 'Request',
            render: (c) => <a href={`/ops/hr/attendance/corrections/${c.id}`}>{c.code}</a>,
          },
          { key: 'name', header: 'Employee', render: (c) => c.fullName },
          { key: 'date', header: 'Work date', render: (c) => fmtDate(c.workDate) },
          {
            key: 'kind',
            header: 'Kind',
            render: (c) => (c.sessionId ? 'Fix a session' : 'Missed day'),
          },
          { key: 'reason', header: 'Reason' },
          { key: 'at', header: 'Requested', render: (c) => fmtDateTime(c.createdAt) },
          { key: 'status', header: 'Status', render: (c) => <RequestStatus status={c.status} /> },
          {
            key: 'act',
            header: '',
            render: (c) =>
              c.canDecide ? <a href={`/ops/hr/attendance/corrections/${c.id}`}>Review</a> : null,
          },
        ]}
      />
      <Pager base="/ops/hr/attendance/corrections" params={sp} list={r.data} />
    </div>
  );
}
