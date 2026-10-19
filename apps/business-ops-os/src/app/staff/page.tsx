import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { getDirectory } from '../../server/organisation';
import { formOptions } from '../../server/options';
import { ActionForm } from '../../ui/action-form';
import { humanise, statusTone } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';

export const dynamic = 'force-dynamic';

export default async function StaffPage() {
  const access = await gate('ops:organisation:read', '/ops/staff');
  return (
    <Frame access={access} active="staff">
      <PageHeader
        title="Staff directory and responsibilities"
        description="Departments, people, reporting lines and who holds each responsibility with a backup. Business Ops stewards these records."
      />
      <Alert tone="info" title="Where HR records are">
        Employee records, private HR details, documents and compensation are under{' '}
        <a href="/ops/hr/employees">Employees</a>; department heads and the reporting tree under{' '}
        <a href="/ops/hr/departments">Departments and reporting lines</a> (D-028). Payroll and
        biometric devices are out of scope. Named holders and backups are owner decision OD-009.
      </Alert>
      <Section>
        <Directory user={access.user} />
      </Section>
    </Frame>
  );
}

async function Directory({ user }: { user: AuthenticatedUser }) {
  const r = await load(async (db) => ({
    d: await getDirectory(db, user),
    options: await formOptions(db),
  }));
  if (!r.ok) return r.view;
  const { d, options } = r.data;
  const manage = can(user, 'ops:organisation:manage');
  return (
    <div className="el-stack">
      <Card
        title="Responsibility gaps (OPS-015)"
        description="Active responsibilities with no holder, no backup, or the same person as both. Critical ones first."
      >
        <DataTable
          rows={d.gaps}
          rowKey={(g) => g.code}
          empty={<EmptyState title="No gaps" />}
          columns={[
            { key: 'code', header: 'Code' },
            { key: 'title', header: 'Responsibility' },
            {
              key: 'critical',
              header: '',
              render: (g) =>
                g.critical ? <StatusBadge tone="danger">Critical</StatusBadge> : null,
            },
            { key: 'labels', header: 'Gaps', render: (g) => g.labels.join('; ') },
          ]}
        />
      </Card>
      <Card title="Staff">
        <DataTable
          rows={d.staff}
          rowKey={(s) => s.id}
          empty={<EmptyState title="No staff yet" />}
          columns={[
            {
              key: 'fullName',
              header: 'Name',
              render: (s) => <a href={`/ops/staff/${s.id}`}>{s.fullName}</a>,
            },
            { key: 'title', header: 'Title', render: (s) => s.title ?? '—' },
            { key: 'departmentName', header: 'Department', render: (s) => s.departmentName ?? '—' },
            { key: 'managerName', header: 'Reports to', render: (s) => s.managerName ?? '—' },
            {
              key: 'roleLabels',
              header: 'Role labels',
              render: (s) => s.roleLabels.join(', ') || '—',
            },
            { key: 'hasLogin', header: 'Login', render: (s) => (s.hasLogin ? 'Yes' : 'No') },
            {
              key: 'status',
              header: 'Status',
              render: (s) => (
                <StatusBadge tone={statusTone(s.status === 'active' ? 'accepted' : 'open')}>
                  {humanise(s.status)}
                </StatusBadge>
              ),
            },
          ]}
        />
      </Card>
      <Card
        title="Departments"
        description="13 provisional departments from the legacy model (D-026); confirming them is an owner decision."
      >
        <DataTable
          rows={d.departments}
          rowKey={(x) => x.id}
          columns={[
            { key: 'code', header: 'Code' },
            { key: 'name', header: 'Name' },
            {
              key: 'status',
              header: 'Status',
              render: (x) => (
                <StatusBadge tone={x.status === 'active' ? 'success' : 'warning'}>
                  {x.status}
                </StatusBadge>
              ),
            },
            { key: 'headcount', header: 'Staff', numeric: true },
          ]}
        />
      </Card>
      <Card title="Responsibilities">
        <DataTable
          rows={d.responsibilities}
          rowKey={(x) => x.id}
          empty={<EmptyState title="No responsibilities recorded" />}
          columns={[
            { key: 'code', header: 'Code' },
            { key: 'title', header: 'Function / process' },
            {
              key: 'accountableRole',
              header: 'Accountable role',
              render: (x) => x.accountableRole ?? '—',
            },
            {
              key: 'holderName',
              header: 'Holder',
              render: (x) => x.holderName ?? <StatusBadge tone="warning">Not named</StatusBadge>,
            },
            {
              key: 'backupName',
              header: 'Backup',
              render: (x) => x.backupName ?? <StatusBadge tone="warning">None</StatusBadge>,
            },
            {
              key: 'handOverToRole',
              header: 'Hands over to',
              render: (x) => x.handOverToRole ?? '—',
            },
          ]}
        />
      </Card>
      {manage ? (
        <div className="el-grid">
          <Card title="Add staff member">
            <ActionForm
              action="/ops/api/v1/staff"
              submitLabel="Add"
              redirectTo="/ops/staff/{id}"
              fields={[
                { name: 'fullName', label: 'Full name', required: true },
                { name: 'title', label: 'Title' },
                {
                  name: 'departmentId',
                  label: 'Department',
                  type: 'select',
                  options: options.departments,
                },
                { name: 'managerId', label: 'Reports to', type: 'select', options: options.staff },
                {
                  name: 'employmentType',
                  label: 'Employment type',
                  type: 'select',
                  required: true,
                  defaultValue: 'not_recorded',
                  options: ['full_time', 'part_time', 'contract', 'visiting', 'not_recorded'].map(
                    (v) => ({ value: v, label: humanise(v) }),
                  ),
                },
                { name: 'roleLabels', label: 'Role labels (comma separated)', type: 'list' },
              ]}
            />
          </Card>
          <Card title="Add responsibility">
            <ActionForm
              action="/ops/api/v1/responsibilities"
              submitLabel="Add"
              fields={[
                { name: 'title', label: 'Function / process', required: true },
                { name: 'accountableRole', label: 'Accountable role' },
                { name: 'holderStaffId', label: 'Holder', type: 'select', options: options.staff },
                { name: 'backupStaffId', label: 'Backup', type: 'select', options: options.staff },
                { name: 'handOverToRole', label: 'Hands over to (role)' },
                { name: 'critical', label: 'Critical process', type: 'checkbox' },
              ]}
            />
          </Card>
        </div>
      ) : null}
    </div>
  );
}
