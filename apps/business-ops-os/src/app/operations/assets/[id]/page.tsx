import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { MANUAL_ASSET_TARGETS, RETURN_CONDITIONS } from '../../../../domain/hr/assets';
import { getAsset } from '../../../../server/hr/assets';
import { employeeOptions } from '../../../../server/hr/employees';
import { ActionForm } from '../../../../ui/action-form';
import { fmtDate, fmtDateTime, humanise } from '../../../../ui/format';
import { Frame, gate, load, Section } from '../../../../ui/frame';
import { hrTone, options } from '../../../../ui/hr-records';

export const dynamic = 'force-dynamic';

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:assets:read', `/ops/operations/assets/${id}`);
  return (
    <Frame access={access} active="assets">
      <p>
        <a href="/ops/operations/assets">All assets</a>
      </p>
      <Section label="Loading asset…">
        <Detail user={access.user} id={id} />
      </Section>
    </Frame>
  );
}

async function Detail({ user, id }: { user: AuthenticatedUser; id: string }) {
  const manage = can(user, 'ops:assets:manage');
  const r = await load(async (db) => ({
    d: await getAsset(db, user, id),
    employees: manage ? await employeeOptions(db) : [],
  }));
  if (!r.ok) return r.view;
  const { d, employees } = r.data;
  const a = d.asset;
  const targets = MANUAL_ASSET_TARGETS[a.status];
  return (
    <div className="el-stack">
      <PageHeader
        title={`${a.code} ${a.name}`}
        description={`${a.category}${a.serialNumber ? ` · serial ${a.serialNumber}` : ''}`}
        actions={<StatusBadge tone={hrTone(a.status)}>{humanise(a.status)}</StatusBadge>}
      />
      {a.notes ? <p>{a.notes}</p> : null}
      <div className="el-grid">
        <Card title="Current holder">
          {d.open ? (
            <p>
              <a href={`/ops/hr/employees/${d.open.staffId}`}>{d.open.staffName}</a> since{' '}
              {fmtDate(d.open.assignedOn)}
              {d.open.expectedReturnOn ? `, due back ${fmtDate(d.open.expectedReturnOn)}` : ''}
            </p>
          ) : (
            <p>Not assigned.</p>
          )}
          {manage && d.open ? (
            <ActionForm
              action={`/ops/api/v1/hr/assets/${a.id}/return`}
              submitLabel="Record return"
              fields={[
                {
                  name: 'condition',
                  label: 'Condition on return',
                  type: 'select',
                  required: true,
                  options: options(RETURN_CONDITIONS),
                  hint: 'Damaged sends the asset to repair; lost marks it lost.',
                },
                { name: 'notes', label: 'Notes' },
              ]}
            />
          ) : null}
          {manage && !d.open && a.status === 'available' ? (
            employees.length ? (
              <ActionForm
                action={`/ops/api/v1/hr/assets/${a.id}/assign`}
                submitLabel="Assign asset"
                fields={[
                  {
                    name: 'staffId',
                    label: 'Employee',
                    type: 'select',
                    required: true,
                    options: employees,
                  },
                  {
                    name: 'assignedOn',
                    label: 'Handed over on',
                    type: 'date',
                    hint: 'Default: today.',
                  },
                  { name: 'expectedReturnOn', label: 'Due back on', type: 'date' },
                  { name: 'notes', label: 'Notes' },
                ]}
              />
            ) : (
              <EmptyState
                title="No employee to assign to"
                description="Assets go to employees with an employee record."
              />
            )
          ) : null}
        </Card>
        {manage ? (
          <Card title="Edit asset">
            <ActionForm
              action={`/ops/api/v1/hr/assets/${a.id}`}
              method="PATCH"
              submitLabel="Save asset"
              variant="secondary"
              fields={[
                { name: 'name', label: 'Name', defaultValue: a.name },
                { name: 'category', label: 'Category', defaultValue: a.category },
                {
                  name: 'serialNumber',
                  label: 'Serial number',
                  defaultValue: a.serialNumber ?? '',
                },
                { name: 'notes', label: 'Notes', type: 'textarea', defaultValue: a.notes ?? '' },
                ...(targets.length
                  ? [
                      {
                        name: 'status',
                        label: 'Change status to',
                        type: 'select' as const,
                        options: options(targets),
                        hint: 'Assigned assets change status only through “Record return”.',
                      },
                    ]
                  : []),
              ]}
            />
          </Card>
        ) : null}
      </div>
      <Card title="Assignment history">
        <DataTable
          rows={d.history}
          rowKey={(h) => h.id}
          empty={<EmptyState title="Never assigned" />}
          columns={[
            {
              key: 'staffName',
              header: 'Employee',
              render: (h) => <a href={`/ops/hr/employees/${h.staffId}`}>{h.staffName}</a>,
            },
            { key: 'assignedOn', header: 'Handed over', render: (h) => fmtDate(h.assignedOn) },
            {
              key: 'expectedReturnOn',
              header: 'Due back',
              render: (h) => fmtDate(h.expectedReturnOn),
            },
            {
              key: 'returnedAt',
              header: 'Returned',
              render: (h) => (h.returnedAt ? fmtDateTime(h.returnedAt) : 'Still assigned'),
            },
            {
              key: 'conditionOnReturn',
              header: 'Condition',
              render: (h) => humanise(h.conditionOnReturn),
            },
            { key: 'notes', header: 'Notes', render: (h) => h.notes ?? '—' },
          ]}
        />
        {d.hiddenAssignments > 0 ? (
          <p className="el-field-hint">
            {d.hiddenAssignments} earlier assignment(s) to people outside your team are not shown.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
