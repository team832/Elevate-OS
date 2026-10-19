import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Card, DataTable, EmptyState, PageHeader } from '@elevate/shared-ui';
import { formOptions } from '../../../server/options';
import {
  employeesInScope,
  listHolidays,
  listShiftAssignments,
  listShiftTemplates,
} from '../../../server/hr/shifts';
import { ActionForm } from '../../../ui/action-form';
import { fmtDate } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import {
  DecisionBadge,
  FilterForm,
  FilterSelect,
  minutes,
  Pager,
  TimeNav,
  timeNavItems,
  weekdays,
} from '../attendance/time-ui';

export const dynamic = 'force-dynamic';

type Sp = Record<string, string | undefined>;

export default async function ShiftsPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const access = await gate('ops:shifts:read', '/ops/hr/shifts');
  const sp = await searchParams;
  const manage = can(access.user, 'ops:shifts:manage');
  return (
    <Frame access={access} active="shifts">
      <PageHeader
        title="Shifts, assignments and holidays"
        description="Each team gets its own shift templates. Timings and the holiday calendar are owner decisions (OD-026), so new entries start as proposed."
      />
      <TimeNav current="/ops/hr/shifts" items={timeNavItems(access.user)} />
      <Section label="Loading shift templates…">
        <Templates user={access.user} manage={manage} />
      </Section>
      <Section label="Loading assignments…">
        <Assignments user={access.user} sp={sp} manage={manage} />
      </Section>
      <Section label="Loading holidays…">
        <Holidays user={access.user} />
      </Section>
    </Frame>
  );
}

async function Templates({ user, manage }: { user: AuthenticatedUser; manage: boolean }) {
  const r = await load(async (db) => ({
    templates: await listShiftTemplates(db, user),
    options: manage ? await formOptions(db) : null,
  }));
  if (!r.ok) return r.view;
  return (
    <div className="el-grid">
      <Card title="Shift templates">
        <DataTable
          rows={r.data.templates}
          rowKey={(t) => t.id}
          empty={
            <EmptyState
              title="No shift templates yet"
              description="Without a shift, days count as not scheduled and late/early is not measured."
            />
          }
          columns={[
            {
              key: 'code',
              header: 'Code',
              render: (t) => <a href={`/ops/hr/shifts/${t.id}`}>{t.code}</a>,
            },
            { key: 'name', header: 'Name' },
            {
              key: 'time',
              header: 'Time',
              render: (t) => `${t.startTime}–${t.endTime}${t.crossesMidnight ? ' (next day)' : ''}`,
            },
            { key: 'break', header: 'Unpaid break', render: (t) => minutes(t.unpaidBreakMinutes) },
            { key: 'days', header: 'Working days', render: (t) => weekdays(t.workingWeekdays) },
            {
              key: 'where',
              header: 'Location / team',
              render: (t) => [t.location, t.departmentName].filter(Boolean).join(' · ') || 'Any',
            },
            {
              key: 'n',
              header: 'Active assignments',
              numeric: true,
              render: (t) => t.activeAssignments,
            },
            {
              key: 'status',
              header: 'Decision',
              render: (t) => <DecisionBadge state={t.status} />,
            },
          ]}
        />
      </Card>
      {manage && r.data.options ? (
        <Card title="New shift template" description="Times are local to each employee’s timezone.">
          <ActionForm
            action="/ops/api/v1/hr/shifts"
            submitLabel="Create shift template"
            redirectTo="/ops/hr/shifts/{id}"
            fields={[
              { name: 'code', label: 'Code', required: true, hint: 'e.g. RECEPTION-AM' },
              { name: 'name', label: 'Name', required: true },
              { name: 'startTime', label: 'Start', required: true, hint: 'HH:MM, 24-hour' },
              { name: 'endTime', label: 'End', required: true, hint: 'HH:MM, 24-hour' },
              { name: 'crossesMidnight', label: 'Ends the next day (overnight)', type: 'checkbox' },
              {
                name: 'unpaidBreakMinutes',
                label: 'Unpaid break (minutes)',
                type: 'number',
                defaultValue: '0',
              },
              {
                name: 'workingWeekdays',
                label: 'Working weekdays',
                type: 'json',
                required: true,
                defaultValue: '[1,2,3,4,5,6]',
                hint: 'A list such as [1,2,3,4,5,6] (0 = Sunday).',
              },
              { name: 'location', label: 'Location' },
              {
                name: 'departmentId',
                label: 'Department',
                type: 'select',
                options: r.data.options.departments,
              },
              { name: 'notes', label: 'Notes', type: 'textarea' },
            ]}
          />
        </Card>
      ) : null}
    </div>
  );
}

async function Assignments({
  user,
  sp,
  manage,
}: {
  user: AuthenticatedUser;
  sp: Sp;
  manage: boolean;
}) {
  const page = Math.max(1, Number(sp.page) || 1);
  const r = await load(async (db) => ({
    people: await employeesInScope(db, user, 'ops:shifts:read'),
    templates: await listShiftTemplates(db, user),
    list: await listShiftAssignments(db, user, {
      staffId: sp.staffId || undefined,
      includeCancelled: sp.includeCancelled === 'true' ? 'true' : undefined,
      page,
    }),
  }));
  if (!r.ok) return r.view;
  const { people, templates, list } = r.data;
  const peopleOptions = people.map((p) => ({ value: p.staffId, label: p.fullName }));
  return (
    <div className="el-grid">
      <Card
        title="Shift assignments"
        description="Overlapping assignments for one person are refused unless the split-shift setting allows them."
      >
        <FilterForm action="/ops/hr/shifts">
          <FilterSelect
            name="staffId"
            label="Employee"
            value={sp.staffId}
            anyLabel="Everyone in scope"
            options={peopleOptions}
          />
          <FilterSelect
            name="includeCancelled"
            label="Cancelled"
            value={sp.includeCancelled}
            anyLabel="Hide cancelled"
            options={[{ value: 'true', label: 'Show cancelled' }]}
          />
        </FilterForm>
        <DataTable
          caption={`${list.total} assignment(s)`}
          rows={list.rows}
          rowKey={(a) => a.id}
          empty={<EmptyState title="No assignments in this view" />}
          columns={[
            { key: 'name', header: 'Employee', render: (a) => a.fullName },
            {
              key: 'shift',
              header: 'Shift',
              render: (a) => <a href={`/ops/hr/shifts/${a.shiftTemplateId}`}>{a.templateCode}</a>,
            },
            { key: 'from', header: 'From', render: (a) => fmtDate(a.fromDate) },
            {
              key: 'to',
              header: 'To',
              render: (a) => (a.toDate ? fmtDate(a.toDate) : 'Open-ended'),
            },
            {
              key: 'status',
              header: 'Status',
              render: (a) =>
                a.status === 'active' ? 'Active' : `Cancelled: ${a.cancelReason ?? ''}`,
            },
          ]}
        />
        <Pager
          base="/ops/hr/shifts"
          params={sp}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
        />
      </Card>
      {manage ? (
        <Card
          title="Assign a shift"
          description="End or cancel an assignment from its shift template page."
        >
          {templates.filter((t) => t.status !== 'retired').length === 0 ? (
            <EmptyState title="Create a shift template first" />
          ) : (
            <ActionForm
              action="/ops/api/v1/hr/shift-assignments"
              submitLabel="Assign shift"
              fields={[
                {
                  name: 'staffId',
                  label: 'Employee',
                  type: 'select',
                  required: true,
                  options: peopleOptions,
                },
                {
                  name: 'shiftTemplateId',
                  label: 'Shift',
                  type: 'select',
                  required: true,
                  options: templates
                    .filter((t) => t.status !== 'retired')
                    .map((t) => ({ value: t.id, label: `${t.code} ${t.startTime}–${t.endTime}` })),
                },
                { name: 'fromDate', label: 'From', type: 'date', required: true },
                { name: 'toDate', label: 'To (leave empty for open-ended)', type: 'date' },
                { name: 'note', label: 'Note' },
              ]}
            />
          )}
        </Card>
      ) : null}
    </div>
  );
}

async function Holidays({ user }: { user: AuthenticatedUser }) {
  const r = await load((db) => listHolidays(db, user, {}));
  if (!r.ok) return r.view;
  const manage = can(user, 'ops:leave:manage');
  return (
    <div className="el-grid">
      <Card
        title="Company holiday calendar"
        description="Separate from the Academic teaching calendar. Holidays without a location apply everywhere."
      >
        <DataTable
          rows={r.data}
          rowKey={(h) => h.id}
          empty={
            <EmptyState
              title="No holidays recorded"
              description="Until HR records the owner’s holiday list, leave counts and schedules treat every working weekday as a working day."
            />
          }
          columns={[
            { key: 'date', header: 'Date', render: (h) => fmtDate(h.holidayDate) },
            { key: 'name', header: 'Holiday' },
            { key: 'loc', header: 'Location', render: (h) => h.location ?? 'All locations' },
            { key: 'state', header: 'Decision', render: (h) => <DecisionBadge state={h.status} /> },
            {
              key: 'act',
              header: '',
              render: (h) =>
                manage ? (
                  <div className="el-inline-form">
                    {h.status === 'proposed' ? (
                      <ActionForm
                        action={`/ops/api/v1/hr/holidays/${h.id}`}
                        method="PATCH"
                        submitLabel="Mark approved"
                        extra={{ status: 'approved' }}
                        variant="secondary"
                        compact
                      />
                    ) : null}
                    <ActionForm
                      action={`/ops/api/v1/hr/holidays/${h.id}`}
                      method="PATCH"
                      submitLabel="Withdraw"
                      extra={{ status: 'withdrawn' }}
                      variant="danger"
                      compact
                    />
                  </div>
                ) : null,
            },
          ]}
        />
      </Card>
      {manage ? (
        <Card
          title="Record a holiday"
          description="Recorded as proposed. Mark it approved once the owner confirms it."
        >
          <ActionForm
            action="/ops/api/v1/hr/holidays"
            submitLabel="Record holiday"
            fields={[
              { name: 'holidayDate', label: 'Date', type: 'date', required: true },
              { name: 'name', label: 'Name', required: true },
              { name: 'location', label: 'Location (empty = all locations)' },
              { name: 'note', label: 'Source or note' },
            ]}
          />
        </Card>
      ) : null}
    </div>
  );
}
