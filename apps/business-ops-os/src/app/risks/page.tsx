import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { formOptions } from '../../server/options';
import { listRisks } from '../../server/planning';
import { ActionForm } from '../../ui/action-form';
import { fmtDate, statusTone } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';

export const dynamic = 'force-dynamic';

export default async function RisksPage() {
  const access = await gate('ops:risks:read', '/ops/risks');
  return (
    <Frame access={access} active="risks">
      <PageHeader
        title="Risks, issues and blockers"
        description="Open high-severity items and items with no owner are flagged (OPS-023)."
      />
      <Section>
        <Register user={access.user} canWrite={can(access.user, 'ops:risks:write')} />
      </Section>
    </Frame>
  );
}

async function Register({ user, canWrite }: { user: AuthenticatedUser; canWrite: boolean }) {
  const r = await load(async (db) => ({
    risks: await listRisks(db, user),
    options: await formOptions(db),
  }));
  if (!r.ok) return r.view;
  const levels = ['low', 'medium', 'high'].map((v) => ({ value: v, label: v }));
  return (
    <div className="el-stack">
      <DataTable
        rows={r.data.risks}
        rowKey={(x) => x.id}
        empty={<EmptyState title="Nothing recorded" />}
        columns={[
          { key: 'code', header: 'ID' },
          { key: 'kind', header: 'Kind' },
          { key: 'title', header: 'Title' },
          {
            key: 'severity',
            header: 'Severity',
            render: (x) => (
              <StatusBadge tone={x.severity === 'high' ? 'danger' : 'neutral'}>
                {x.severity}
              </StatusBadge>
            ),
          },
          { key: 'ownerName', header: 'Owner', render: (x) => x.ownerName ?? '—' },
          {
            key: 'status',
            header: 'Status',
            render: (x) => <StatusBadge tone={statusTone(x.status)}>{x.status}</StatusBadge>,
          },
          {
            key: 'flags',
            header: 'Flags',
            render: (x) =>
              x.flags.map((f) => (
                <StatusBadge key={f} tone="warning">
                  {f.replace('_', ' ')}
                </StatusBadge>
              )),
          },
          { key: 'targetDate', header: 'Target', render: (x) => fmtDate(x.targetDate) },
          {
            key: 'act',
            header: '',
            render: (x) =>
              canWrite ? (
                <ActionForm
                  action={`/ops/api/v1/risks/${x.id}`}
                  method="PATCH"
                  submitLabel="Set"
                  compact
                  fields={[
                    {
                      name: 'status',
                      label: 'Status',
                      type: 'select',
                      required: true,
                      options: ['open', 'mitigating', 'resolved', 'closed', 'accepted'].map(
                        (v) => ({ value: v, label: v }),
                      ),
                    },
                  ]}
                />
              ) : null,
          },
        ]}
      />
      {canWrite ? (
        <Card title="Record a risk, issue or blocker">
          <ActionForm
            action="/ops/api/v1/risks"
            submitLabel="Record"
            fields={[
              {
                name: 'kind',
                label: 'Kind',
                type: 'select',
                required: true,
                options: ['risk', 'issue', 'blocker'].map((v) => ({ value: v, label: v })),
              },
              { name: 'title', label: 'Title', required: true },
              { name: 'description', label: 'Description', type: 'textarea' },
              { name: 'likelihood', label: 'Likelihood', type: 'select', options: levels },
              { name: 'impact', label: 'Impact', type: 'select', options: levels },
              {
                name: 'ownerStaffId',
                label: 'Owner',
                type: 'select',
                options: r.data.options.staff,
              },
              { name: 'mitigation', label: 'Mitigation', type: 'textarea' },
              { name: 'targetDate', label: 'Target date', type: 'date' },
            ]}
          />
        </Card>
      ) : null}
    </div>
  );
}
