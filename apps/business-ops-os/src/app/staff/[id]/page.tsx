import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { getStaffDetail } from '../../../server/organisation';
import { formOptions } from '../../../server/options';
import { ActionForm } from '../../../ui/action-form';
import { fmtDateTime, humanise } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';

export const dynamic = 'force-dynamic';

export default async function StaffMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:organisation:read', `/ops/staff/${id}`);
  return (
    <Frame access={access} active="staff">
      <Section>
        <Detail user={access.user} id={id} />
      </Section>
    </Frame>
  );
}

async function Detail({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load(async (db) => ({
    d: await getStaffDetail(db, user, id),
    options: await formOptions(db),
  }));
  if (!r.ok) return r.view;
  const { d, options } = r.data;
  const manage = can(user, 'ops:organisation:manage');
  return (
    <div className="el-stack">
      <PageHeader
        title={d.staff.fullName}
        description={`${d.staff.title ?? 'No title'} · ${d.department?.name ?? 'No department'} · reports to ${d.manager?.fullName ?? 'nobody on record'}`}
      />
      <Card
        title="Profile"
        description={
          d.employeeCode ? (
            <>
              Employee {d.employeeCode}:{' '}
              <a href={`/ops/hr/employees/${d.staff.id}`}>open the HR record</a> for employment
              details, documents and history.
            </>
          ) : (
            'No HR employee record yet. HR can register this staff member under Employees.'
          )
        }
      >
        <p>
          Employment type: {humanise(d.profile?.employmentType ?? 'not_recorded')} · Role labels:{' '}
          {d.profile?.roleLabels.join(', ') || '—'} · Status: {humanise(d.staff.status)} · Login:{' '}
          {d.staff.userId ? 'linked' : 'none'}
        </p>
        <p>Direct reports: {d.reports.map((x) => x.fullName).join(', ') || 'none'}</p>
        {manage ? (
          <ActionForm
            action={`/ops/api/v1/staff/${d.staff.id}`}
            method="PATCH"
            submitLabel="Save"
            variant="secondary"
            fields={[
              { name: 'title', label: 'Title', defaultValue: d.staff.title ?? '' },
              {
                name: 'managerId',
                label: 'Reports to',
                type: 'select',
                options: options.staff.filter((s) => s.value !== d.staff.id),
                defaultValue: d.staff.managerId ?? '',
              },
              {
                name: 'departmentId',
                label: 'Department',
                type: 'select',
                options: options.departments,
                defaultValue: d.staff.departmentId ?? '',
              },
              {
                name: 'status',
                label: 'Status',
                type: 'select',
                required: true,
                defaultValue: d.staff.status,
                options: ['active', 'on_leave', 'inactive'].map((v) => ({
                  value: v,
                  label: humanise(v),
                })),
              },
            ]}
          />
        ) : null}
      </Card>
      <Card
        title="Onboarding checklist"
        description="Document references only (e.g. where a signed acknowledgement is filed); no files are stored."
      >
        <DataTable
          rows={d.onboarding}
          rowKey={(i) => i.id}
          empty={
            <EmptyState
              title="No checklist yet"
              action={
                manage ? (
                  <ActionForm
                    action={`/ops/api/v1/staff/${d.staff.id}/onboarding`}
                    submitLabel="Start onboarding checklist"
                  />
                ) : undefined
              }
            />
          }
          columns={[
            { key: 'title', header: 'Item' },
            {
              key: 'status',
              header: 'Status',
              render: (i) => (
                <StatusBadge tone={i.status === 'done' ? 'success' : 'warning'}>
                  {humanise(i.status)}
                </StatusBadge>
              ),
            },
            {
              key: 'documentRef',
              header: 'Document reference',
              render: (i) => i.documentRef ?? '—',
            },
            { key: 'completedAt', header: 'Completed', render: (i) => fmtDateTime(i.completedAt) },
            {
              key: 'act',
              header: '',
              render: (i) =>
                manage ? (
                  <ActionForm
                    action={`/ops/api/v1/onboarding-items/${i.id}`}
                    method="PATCH"
                    submitLabel="Update"
                    compact
                    fields={[
                      {
                        name: 'status',
                        label: 'Status',
                        type: 'select',
                        required: true,
                        options: ['pending', 'done', 'not_applicable'].map((v) => ({
                          value: v,
                          label: humanise(v),
                        })),
                      },
                      { name: 'documentRef', label: 'Reference' },
                    ]}
                  />
                ) : null,
            },
          ]}
        />
      </Card>
    </div>
  );
}
