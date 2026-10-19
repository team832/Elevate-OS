import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { getAttendanceProvider } from '../../../server/adapters/attendance-provider';
import { listAttendance } from '../../../server/hr/attendance';
import { employeesInScope } from '../../../server/hr/shifts';
import { ActionForm } from '../../../ui/action-form';
import { fmtDate } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import {
  FilterDate,
  FilterForm,
  FilterSelect,
  HM_HINT,
  isIso,
  localTime,
  minutes,
  Pager,
  SessionStatus,
  SOURCE_LABELS,
  TimeNav,
  timeNavItems,
} from './time-ui';

export const dynamic = 'force-dynamic';

const STATUSES = [
  { value: 'open', label: 'Clocked in (open)' },
  { value: 'missing_clock_out', label: 'Missing clock-out' },
  { value: 'closed', label: 'Closed' },
  { value: 'superseded', label: 'Superseded by a correction' },
];
const SOURCES = Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }));

type Sp = Record<string, string | undefined>;

export default async function AttendancePage({ searchParams }: { searchParams: Promise<Sp> }) {
  const access = await gate('ops:attendance:read', '/ops/hr/attendance');
  const sp = await searchParams;
  const provider = await getAttendanceProvider().status();
  return (
    <Frame access={access} active="attendance">
      <PageHeader
        title="Staff attendance"
        description="Sessions of staff in your scope. Corrections never overwrite a session: the original is kept as superseded. This is staff attendance only, not class attendance, and not a performance measure."
      />
      <TimeNav current="/ops/hr/attendance" items={timeNavItems(access.user)} />
      {provider.connection !== 'connected' ? (
        <Alert
          tone="info"
          title="No attendance device or provider is connected; manual and CSV only."
        />
      ) : null}
      <Section label="Loading sessions…">
        <SessionList user={access.user} sp={sp} />
      </Section>
      {can(access.user, 'ops:attendance:manage') || can(access.user, 'ops:jobs:run') ? (
        <Section label="Loading form…">
          <ManagerTools user={access.user} />
        </Section>
      ) : null}
    </Frame>
  );
}

async function SessionList({ user, sp }: { user: AuthenticatedUser; sp: Sp }) {
  const page = Math.max(1, Number(sp.page) || 1);
  const status = STATUSES.some((s) => s.value === sp.status) ? (sp.status as never) : undefined;
  const source = SOURCES.some((s) => s.value === sp.source) ? (sp.source as never) : undefined;
  const r = await load(async (db) => ({
    people: await employeesInScope(db, user, 'ops:attendance:read'),
    list: await listAttendance(db, user, {
      staffId: sp.staffId || undefined,
      from: isIso(sp.from) ? (sp.from as never) : undefined,
      to: isIso(sp.to) ? (sp.to as never) : undefined,
      status,
      source,
      page,
    }),
  }));
  if (!r.ok) return r.view;
  const { people, list } = r.data;
  return (
    <div className="el-stack">
      <FilterForm action="/ops/hr/attendance">
        <FilterSelect
          name="staffId"
          label="Employee"
          value={sp.staffId}
          anyLabel="Everyone in scope"
          options={people.map((p) => ({
            value: p.staffId,
            label: p.employeeCode ? `${p.fullName} (${p.employeeCode})` : p.fullName,
          }))}
        />
        <FilterDate name="from" label="From" value={sp.from} />
        <FilterDate name="to" label="To" value={sp.to} />
        <FilterSelect name="status" label="Status" value={sp.status} options={STATUSES} />
        <FilterSelect name="source" label="Source" value={sp.source} options={SOURCES} />
      </FilterForm>
      <DataTable
        caption={`${list.total} session(s)`}
        rows={list.rows}
        rowKey={(s) => s.id}
        empty={
          <EmptyState
            title="No sessions match these filters"
            description="Clear the filters, record a manual entry or import a CSV."
          />
        }
        columns={[
          {
            key: 'date',
            header: 'Date',
            render: (s) => <a href={`/ops/hr/attendance/${s.id}`}>{fmtDate(s.workDate)}</a>,
          },
          { key: 'name', header: 'Employee', render: (s) => s.fullName },
          {
            key: 'in',
            header: 'In',
            render: (s) => localTime(s.clockInAt, s.timezone, s.workDate),
          },
          {
            key: 'out',
            header: 'Out',
            render: (s) => localTime(s.clockOutAt, s.timezone, s.workDate),
          },
          { key: 'worked', header: 'Worked', render: (s) => minutes(s.workedMinutes) },
          { key: 'shift', header: 'Shift', render: (s) => s.shiftCode ?? 'Not scheduled' },
          {
            key: 'flags',
            header: 'Flags',
            render: (s) => (
              <>
                {s.flags.late ? (
                  <StatusBadge tone="warning">Late {minutes(s.lateMinutes)}</StatusBadge>
                ) : null}
                {s.flags.early ? (
                  <StatusBadge tone="warning">
                    Left {minutes(s.earlyDepartureMinutes)} early
                  </StatusBadge>
                ) : null}
              </>
            ),
          },
          { key: 'source', header: 'Source', render: (s) => SOURCE_LABELS[s.source] ?? s.source },
          {
            key: 'status',
            header: 'Status',
            render: (s) => (
              <SessionStatus status={s.status} missingClockOut={s.flags.missingClockOut} />
            ),
          },
        ]}
      />
      <Pager
        base="/ops/hr/attendance"
        params={sp}
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
      />
    </div>
  );
}

async function ManagerTools({ user }: { user: AuthenticatedUser }) {
  const r = await load((db) => employeesInScope(db, user, 'ops:attendance:read'));
  if (!r.ok) return r.view;
  return (
    <div className="el-grid">
      {can(user, 'ops:attendance:manage') ? (
        <Card
          title="Record a manual entry"
          description="For a day the employee could not clock in. Times are in the employee’s timezone. A reason is required and the entry is audited; the employee is notified."
        >
          <ActionForm
            action="/ops/api/v1/hr/attendance"
            submitLabel="Record manual entry"
            redirectTo="/ops/hr/attendance/{id}"
            fields={[
              {
                name: 'staffId',
                label: 'Employee',
                type: 'select',
                required: true,
                options: r.data
                  .filter((p) => p.staffStatus === 'active')
                  .map((p) => ({ value: p.staffId, label: p.fullName })),
              },
              { name: 'workDate', label: 'Work date', type: 'date', required: true },
              { name: 'clockIn', label: 'Clock-in', required: true, hint: HM_HINT },
              {
                name: 'clockOut',
                label: 'Clock-out (leave empty if still working)',
                hint: HM_HINT,
              },
              {
                name: 'clockOutDate',
                label: 'Clock-out date (only if after midnight)',
                type: 'date',
              },
              {
                name: 'breakMinutes',
                label: 'Unpaid break (minutes)',
                type: 'number',
                defaultValue: '0',
              },
              { name: 'reason', label: 'Reason', type: 'textarea', required: true },
            ]}
          />
        </Card>
      ) : null}
      {can(user, 'ops:jobs:run') ? (
        <Card
          title="Missing clock-out check"
          description="No scheduler runs yet. This flags sessions still open after shift end plus the grace period (or after the maximum session length) and notifies each employee once."
        >
          <ActionForm
            action="/ops/api/v1/hr/attendance/missing-clock-out-check"
            submitLabel="Run missing clock-out check"
            variant="secondary"
          />
        </Card>
      ) : null}
    </div>
  );
}
