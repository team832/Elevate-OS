import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import {
  EMPLOYEE_SORTS,
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_TYPES,
  type EmploymentStatus,
} from '../../../domain/hr/employees';
import {
  employeeFilterOptions,
  listEmployees,
  staffWithoutEmployeeRecord,
} from '../../../server/hr/employees';
import { employeeListQuery } from '../../../server/hr/schemas';
import { formOptions } from '../../../server/options';
import { ActionForm } from '../../../ui/action-form';
import { fmtDate, humanise } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { hrTone, FilterForm, options, Pager } from '../../../ui/hr-records';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | undefined>;

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const access = await gate('ops:employees:read', '/ops/hr/employees');
  const sp = await searchParams;
  return (
    <Frame access={access} active="hr-employees">
      <PageHeader
        title="Employees"
        description="Employee records: who works here, in which department and role, who they report to. Private HR details, documents and pay are on each profile for the people allowed to see them."
        actions={<a href="/ops/hr/departments">Departments and reporting lines</a>}
      />
      <Section label="Loading employees…">
        <Directory user={access.user} sp={sp} />
      </Section>
      {can(access.user, 'ops:employees:manage') ? (
        <Section label="Loading form…">
          <NewEmployee user={access.user} />
        </Section>
      ) : null}
    </Frame>
  );
}

async function Directory({ user, sp }: { user: AuthenticatedUser; sp: SearchParams }) {
  const parsed = employeeListQuery.safeParse(
    Object.fromEntries(Object.entries(sp).filter(([, v]) => v !== undefined && v !== '')),
  );
  const query = parsed.success ? parsed.data : employeeListQuery.parse({});
  const r = await load(async (db) => ({
    list: await listEmployees(db, user, query),
    filters: await employeeFilterOptions(db, user),
  }));
  if (!r.ok) return r.view;
  const { list, filters } = r.data;
  const hr = list.recordTier;
  const sortOptions = EMPLOYEE_SORTS.filter((s) => hr || (s !== 'start_date' && s !== 'status'));
  return (
    <Card
      title={`${list.total} employee${list.total === 1 ? '' : 's'}`}
      description={
        hr
          ? 'Separated employees are hidden unless you filter for them.'
          : 'Directory view: work contact details only. Employment details are visible to HR, your manager and you.'
      }
    >
      <div className="el-stack">
        {!parsed.success ? (
          <p className="el-field-error" role="alert">
            Some filters were not valid and were ignored.
          </p>
        ) : null}
        <FilterForm
          action="/ops/hr/employees"
          submitLabel="Apply filters"
          resetHref="/ops/hr/employees"
          fields={[
            { name: 'q', label: 'Name, code, designation or email', value: query.q },
            {
              name: 'departmentId',
              label: 'Department',
              type: 'select',
              options: filters.departments,
              value: query.departmentId,
            },
            {
              name: 'location',
              label: 'Work location',
              type: 'select',
              options: filters.locations,
              value: query.location,
            },
            ...(hr
              ? [
                  {
                    name: 'status',
                    label: 'Employment status',
                    type: 'select' as const,
                    options: EMPLOYMENT_STATUSES.map((s) => ({
                      value: s,
                      label: EMPLOYMENT_STATUS_LABELS[s],
                    })),
                    value: query.status,
                    anyLabel: 'Current (not separated)',
                  },
                  {
                    name: 'employmentType',
                    label: 'Employment type',
                    type: 'select' as const,
                    options: options(EMPLOYMENT_TYPES),
                    value: query.employmentType,
                  },
                ]
              : []),
            {
              name: 'sort',
              label: 'Sort by',
              type: 'select',
              options: options(sortOptions),
              value: query.sort,
              anyLabel: 'Name',
            },
            {
              name: 'dir',
              label: 'Order',
              type: 'select',
              options: [
                { value: 'asc', label: 'Ascending' },
                { value: 'desc', label: 'Descending' },
              ],
              value: query.dir,
              anyLabel: 'Ascending',
            },
          ]}
        />
        <DataTable
          rows={list.items}
          rowKey={(e) => e.staffId}
          empty={
            <EmptyState
              title={
                query.q || query.departmentId || query.status
                  ? 'No employee matches these filters'
                  : 'No employee records yet'
              }
              description={
                query.q || query.departmentId || query.status
                  ? 'Change or clear the filters.'
                  : 'HR creates employee records with "Add employee" below, or registers existing staff members.'
              }
            />
          }
          columns={[
            {
              key: 'employeeCode',
              header: 'Code',
              render: (e) => <a href={`/ops/hr/employees/${e.staffId}`}>{e.employeeCode}</a>,
            },
            {
              key: 'fullName',
              header: 'Name',
              render: (e) => <a href={`/ops/hr/employees/${e.staffId}`}>{e.fullName}</a>,
            },
            { key: 'title', header: 'Designation', render: (e) => e.title ?? '—' },
            { key: 'departmentName', header: 'Department', render: (e) => e.departmentName ?? '—' },
            { key: 'managerName', header: 'Reports to', render: (e) => e.managerName ?? '—' },
            { key: 'workEmail', header: 'Work email', render: (e) => e.workEmail ?? '—' },
            { key: 'workLocation', header: 'Location', render: (e) => e.workLocation ?? '—' },
            ...(hr
              ? [
                  {
                    key: 'status',
                    header: 'Status',
                    render: (e: (typeof list.items)[number]) =>
                      e.record ? (
                        <StatusBadge tone={hrTone(e.record.employmentStatus)}>
                          {EMPLOYMENT_STATUS_LABELS[e.record.employmentStatus as EmploymentStatus]}
                        </StatusBadge>
                      ) : (
                        '—'
                      ),
                  },
                  {
                    key: 'type',
                    header: 'Type',
                    render: (e: (typeof list.items)[number]) =>
                      e.record ? humanise(e.record.employmentType) : '—',
                  },
                  {
                    key: 'start',
                    header: 'Start date',
                    render: (e: (typeof list.items)[number]) =>
                      e.record ? fmtDate(e.record.employmentStartDate) : '—',
                  },
                ]
              : []),
          ]}
        />
        <Pager
          basePath="/ops/hr/employees"
          params={sp}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
        />
      </div>
    </Card>
  );
}

async function NewEmployee({ user }: { user: AuthenticatedUser }) {
  const r = await load(async (db) => ({
    options: await formOptions(db),
    unregistered: await staffWithoutEmployeeRecord(db, user),
  }));
  if (!r.ok) return r.view;
  const { options: o, unregistered } = r.data;
  const common = [
    {
      name: 'workEmail',
      label: 'Work email',
      type: 'email' as const,
      hint: 'Stored in lower case; must be unique.',
    },
    { name: 'workPhone', label: 'Work phone', type: 'tel' as const },
    { name: 'workLocation', label: 'Work location' },
    {
      name: 'employmentType',
      label: 'Employment type',
      type: 'select' as const,
      options: options(EMPLOYMENT_TYPES),
    },
    { name: 'employmentStartDate', label: 'Start date', type: 'date' as const },
    {
      name: 'employmentStatus',
      label: 'Status',
      type: 'select' as const,
      options: [
        { value: 'onboarding', label: 'Onboarding (not started yet)' },
        { value: 'active', label: 'Active (already working)' },
      ],
      hint: 'Defaults to onboarding for a new employee.',
    },
  ];
  return (
    <div className="el-grid">
      <Card
        title="Add employee"
        description="Creates the staff record and an employee record with the next EMP code. Roles and sign-in are given by a platform administrator, not here."
      >
        <ActionForm
          action="/ops/api/v1/hr/employees"
          submitLabel="Add employee"
          redirectTo="/ops/hr/employees/{id}"
          fields={[
            { name: 'fullName', label: 'Display name', required: true },
            { name: 'title', label: 'Designation' },
            { name: 'departmentId', label: 'Department', type: 'select', options: o.departments },
            { name: 'managerId', label: 'Reports to', type: 'select', options: o.staff },
            ...common,
          ]}
        />
      </Card>
      <Card
        title="Register an existing staff member"
        description="For people already in the staff directory without an employee record. Department, designation and manager are taken from the staff record."
      >
        {unregistered.length === 0 ? (
          <EmptyState title="Every staff member already has an employee record" />
        ) : (
          <ActionForm
            action="/ops/api/v1/hr/employees"
            submitLabel="Create employee record"
            redirectTo="/ops/hr/employees/{id}"
            fields={[
              {
                name: 'existingStaffId',
                label: 'Staff member',
                type: 'select',
                required: true,
                options: unregistered.map((s) => ({ value: s.id as string, label: s.fullName })),
              },
              ...common,
            ]}
          />
        )}
      </Card>
    </div>
  );
}
