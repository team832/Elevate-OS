import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { getOrgChart, listDepartmentsWithHeads } from '../../../server/hr/org-history';
import { formOptions } from '../../../server/options';
import { ActionForm } from '../../../ui/action-form';
import { fmtDate, humanise } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';

export const dynamic = 'force-dynamic';

export default async function DepartmentsPage() {
  const access = await gate('ops:organisation:read', '/ops/hr/departments');
  return (
    <Frame access={access} active="hr-departments">
      <PageHeader
        title="Departments and reporting lines"
        description="Who heads each department (with the full succession), and who reports to whom. Responsibilities and backups stay on the staff directory."
        actions={<a href="/ops/staff">Staff directory and responsibilities</a>}
      />
      <Section label="Loading departments…">
        <Departments user={access.user} />
      </Section>
      <Section label="Loading reporting lines…">
        <OrgChart user={access.user} />
      </Section>
    </Frame>
  );
}

async function Departments({ user }: { user: AuthenticatedUser }) {
  const manage = can(user, 'ops:organisation:manage');
  const r = await load(async (db) => ({
    depts: await listDepartmentsWithHeads(db, user),
    options: manage ? await formOptions(db) : null,
  }));
  if (!r.ok) return r.view;
  const { depts, options } = r.data;
  return (
    <Card
      title="Departments"
      description="Provisional departments come from the legacy model; confirming them is an owner decision (D-026). A new head’s start ends the previous head’s tenure the day before."
    >
      <DataTable
        rows={depts}
        rowKey={(d) => d.id}
        empty={<EmptyState title="No departments recorded" />}
        columns={[
          { key: 'name', header: 'Department' },
          {
            key: 'status',
            header: 'Status',
            render: (d) => (
              <StatusBadge
                tone={
                  d.status === 'active'
                    ? 'success'
                    : d.status === 'archived'
                      ? 'neutral'
                      : 'warning'
                }
              >
                {humanise(d.status)}
              </StatusBadge>
            ),
          },
          { key: 'headcount', header: 'Staff', numeric: true },
          {
            key: 'head',
            header: 'Head',
            render: (d) =>
              d.currentHead ? (
                <a href={`/ops/hr/employees/${d.currentHead.staffId}`}>
                  {d.currentHead.fullName} (since {fmtDate(d.currentHead.startsOn)})
                </a>
              ) : (
                <StatusBadge tone="warning">No head named</StatusBadge>
              ),
          },
          {
            key: 'history',
            header: 'Previous heads',
            render: (d) => {
              const past = d.headHistory.filter((h) => h.endsOn !== null);
              return past.length
                ? past
                    .map((h) => `${h.fullName} (${fmtDate(h.startsOn)} – ${fmtDate(h.endsOn)})`)
                    .join('; ')
                : '—';
            },
          },
          ...(manage && options
            ? [
                {
                  key: 'act',
                  header: '',
                  render: (d: (typeof depts)[number]) =>
                    d.status === 'archived' ? null : (
                      <details>
                        <summary>{d.currentHead ? 'Change head' : 'Appoint head'}</summary>
                        <ActionForm
                          action={`/ops/api/v1/departments/${d.id}/heads`}
                          submitLabel="Appoint head"
                          compact
                          fields={[
                            {
                              name: 'staffId',
                              label: 'Head',
                              type: 'select',
                              required: true,
                              options: options.staff,
                            },
                            {
                              name: 'startsOn',
                              label: 'From',
                              type: 'date',
                              hint: 'Default: today.',
                            },
                            { name: 'reason', label: 'Reason' },
                          ]}
                        />
                        {d.currentHead ? (
                          <ActionForm
                            action={`/ops/api/v1/departments/${d.id}/heads`}
                            method="PATCH"
                            submitLabel="End current head’s tenure"
                            variant="secondary"
                            compact
                            fields={[
                              {
                                name: 'endsOn',
                                label: 'Last day',
                                type: 'date',
                                hint: 'Default: today.',
                              },
                              { name: 'reason', label: 'Reason', required: true },
                            ]}
                          />
                        ) : null}
                      </details>
                    ),
                },
              ]
            : []),
        ]}
      />
    </Card>
  );
}

async function OrgChart({ user }: { user: AuthenticatedUser }) {
  const r = await load((db) => getOrgChart(db, user));
  if (!r.ok) return r.view;
  const detached = r.data.filter((n) => n.detached).length;
  return (
    <Card
      title="Reporting lines"
      description="Everyone who is active or on leave, under their manager. Change a manager on the employee’s profile; loops are refused."
    >
      {detached > 0 ? (
        <p className="el-field-error" role="alert">
          {detached} person(s) are shown at the top level because their recorded manager is missing
          or their reporting line loops. Fix their manager on the profile.
        </p>
      ) : null}
      <DataTable
        rows={r.data}
        rowKey={(n) => n.id}
        empty={<EmptyState title="No staff recorded" />}
        columns={[
          {
            key: 'fullName',
            header: 'Name',
            render: (n) => (
              <span style={{ paddingLeft: `${n.depth * 1.5}rem` }}>
                {n.employeeCode ? (
                  <a href={`/ops/hr/employees/${n.id}`}>{n.fullName}</a>
                ) : (
                  <a href={`/ops/staff/${n.id}`}>{n.fullName}</a>
                )}
                {n.detached ? ' (manager missing or loop)' : ''}
              </span>
            ),
          },
          { key: 'title', header: 'Designation', render: (n) => n.title ?? '—' },
          { key: 'departmentName', header: 'Department', render: (n) => n.departmentName ?? '—' },
          { key: 'directReports', header: 'Direct reports', numeric: true },
          {
            key: 'employeeCode',
            header: 'Employee code',
            render: (n) => n.employeeCode ?? 'No employee record',
          },
        ]}
      />
    </Card>
  );
}
