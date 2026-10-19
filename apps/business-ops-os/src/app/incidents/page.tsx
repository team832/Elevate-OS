import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { INCIDENT_CATEGORIES } from '../../domain';
import { listIncidents } from '../../server/incidents';
import { formOptions } from '../../server/options';
import { ActionForm } from '../../ui/action-form';
import { fmtDateTime, humanise, statusTone } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';

export const dynamic = 'force-dynamic';

export default async function IncidentsPage() {
  const access = await gate('ops:incidents:read', '/ops/incidents');
  return (
    <Frame access={access} active="incidents">
      <PageHeader
        title="Exceptions and incidents"
        description="Refunds, waivers, special fees and extensions need authorised approval; the authority limits are open (OD-013), so they are flagged, not auto-routed."
      />
      <Section>
        <List user={access.user} canWrite={can(access.user, 'ops:incidents:write')} />
      </Section>
    </Frame>
  );
}

async function List({ user, canWrite }: { user: AuthenticatedUser; canWrite: boolean }) {
  const r = await load(async (db) => ({
    list: await listIncidents(db, user),
    options: await formOptions(db),
  }));
  if (!r.ok) return r.view;
  return (
    <div className="el-stack">
      <DataTable
        rows={r.data.list}
        rowKey={(i) => i.id}
        empty={<EmptyState title="No exceptions or incidents" />}
        columns={[
          { key: 'code', header: 'ID' },
          { key: 'occurredAt', header: 'When', render: (i) => fmtDateTime(i.occurredAt) },
          { key: 'title', header: 'Title' },
          { key: 'category', header: 'Category', render: (i) => humanise(i.category) },
          { key: 'severity', header: 'Severity' },
          {
            key: 'approval',
            header: '',
            render: (i) =>
              i.needsAuthorisedApproval ? (
                <StatusBadge tone="warning">Needs authorised approval (OD-013)</StatusBadge>
              ) : null,
          },
          {
            key: 'status',
            header: 'Status',
            render: (i) => <StatusBadge tone={statusTone(i.status)}>{i.status}</StatusBadge>,
          },
          {
            key: 'act',
            header: '',
            render: (i) =>
              canWrite && i.status !== 'closed' ? (
                <ActionForm
                  action={`/ops/api/v1/incidents/${i.id}`}
                  method="PATCH"
                  submitLabel="Update"
                  compact
                  fields={[
                    {
                      name: 'status',
                      label: 'Status',
                      type: 'select',
                      required: true,
                      options: ['open', 'in_progress', 'resolved', 'closed'].map((v) => ({
                        value: v,
                        label: v,
                      })),
                    },
                    { name: 'resolution', label: 'Resolution' },
                  ]}
                />
              ) : (
                (i.resolution ?? '')
              ),
          },
        ]}
      />
      {canWrite ? (
        <Card title="Record an exception or incident">
          <ActionForm
            action="/ops/api/v1/incidents"
            submitLabel="Record"
            fields={[
              {
                name: 'kind',
                label: 'Kind',
                type: 'select',
                required: true,
                options: [
                  { value: 'exception', label: 'Exception' },
                  { value: 'incident', label: 'Incident' },
                ],
              },
              {
                name: 'category',
                label: 'Category',
                type: 'select',
                required: true,
                options: INCIDENT_CATEGORIES.map((c) => ({ value: c, label: humanise(c) })),
              },
              { name: 'title', label: 'Title', required: true },
              {
                name: 'description',
                label: 'Description (no personal or payment details)',
                type: 'textarea',
              },
              {
                name: 'severity',
                label: 'Severity',
                type: 'select',
                required: true,
                defaultValue: 'medium',
                options: ['low', 'medium', 'high'].map((v) => ({ value: v, label: v })),
              },
              {
                name: 'ownerStaffId',
                label: 'Owner',
                type: 'select',
                options: r.data.options.staff,
              },
            ]}
          />
        </Card>
      ) : null}
    </div>
  );
}
