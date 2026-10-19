import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { formOptions } from '../../server/options';
import { listRisks } from '../../server/planning';
import { ActionForm } from '../../ui/action-form';
import { fmtDate, humanise, statusTone } from '../../ui/format';
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
            key: 'mitigations',
            header: 'Mitigation actions',
            render: (x) => {
              const open = x.mitigations.filter(
                (m) => m.status === 'planned' || m.status === 'in_progress',
              ).length;
              return x.mitigations.length
                ? `${open} open of ${x.mitigations.length}`
                : 'None recorded';
            },
          },
          {
            key: 'act',
            header: '',
            render: (x) =>
              canWrite ? (
                <ActionForm
                  action={`/ops/api/v1/risks/${x.id}`}
                  method="PATCH"
                  submitLabel="Set status"
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
          {
            key: 'addMitigation',
            header: '',
            render: (x) =>
              canWrite && x.status !== 'closed' && x.status !== 'resolved' ? (
                <ActionForm
                  action={`/ops/api/v1/risks/${x.id}/mitigations`}
                  submitLabel="Add mitigation action"
                  variant="secondary"
                  compact
                  fields={[
                    { name: 'action', label: 'Action', required: true },
                    {
                      name: 'ownerStaffId',
                      label: 'Owner',
                      type: 'select',
                      options: r.data.options.staff,
                    },
                    { name: 'dueDate', label: 'Due', type: 'date' },
                  ]}
                />
              ) : null,
          },
        ]}
      />
      <Card
        title="Mitigation actions"
        description="Concrete actions against each risk, issue or blocker, with an owner and a due date (IST). Dropping an action needs an outcome."
      >
        <DataTable
          rows={r.data.risks.flatMap((risk) =>
            risk.mitigations.map((m) => ({ ...m, riskCode: risk.code, riskTitle: risk.title })),
          )}
          rowKey={(m) => m.id}
          empty={<EmptyState title="No mitigation actions recorded" />}
          columns={[
            { key: 'riskCode', header: 'Risk', render: (m) => `${m.riskCode} ${m.riskTitle}` },
            { key: 'action', header: 'Action' },
            { key: 'ownerName', header: 'Owner', render: (m) => m.ownerName ?? '—' },
            {
              key: 'dueDate',
              header: 'Due',
              render: (m) => (
                <>
                  {fmtDate(m.dueDate)}
                  {m.overdue ? <StatusBadge tone="danger">Overdue</StatusBadge> : null}
                </>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (m) => (
                <StatusBadge tone={statusTone(m.status)}>{humanise(m.status)}</StatusBadge>
              ),
            },
            { key: 'outcome', header: 'Outcome', render: (m) => m.outcome ?? '—' },
            {
              key: 'act',
              header: '',
              render: (m) =>
                canWrite && (m.status === 'planned' || m.status === 'in_progress') ? (
                  <ActionForm
                    action={`/ops/api/v1/risks/${m.riskId}/mitigations/${m.id}`}
                    method="PATCH"
                    submitLabel="Update action"
                    compact
                    fields={[
                      {
                        name: 'status',
                        label: 'Status',
                        type: 'select',
                        required: true,
                        options: ['planned', 'in_progress', 'done', 'dropped']
                          .filter((v) => v !== m.status)
                          .map((v) => ({ value: v, label: humanise(v) })),
                      },
                      { name: 'outcome', label: 'Outcome' },
                    ]}
                  />
                ) : null,
            },
          ]}
        />
      </Card>
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
