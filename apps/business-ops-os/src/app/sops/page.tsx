import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { SOP_STATUS_LABELS, type SopStatus } from '../../domain';
import { formOptions } from '../../server/options';
import { listSops } from '../../server/sops';
import { ActionForm } from '../../ui/action-form';
import { decisionTone } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';

export const dynamic = 'force-dynamic';

export default async function SopsPage() {
  const access = await gate('ops:sops:read', '/ops/sops');
  return (
    <Frame access={access} active="sops">
      <PageHeader
        title="SOP register"
        description="Every SOP shows whether it is proposed or approved. Imported legacy registers are drafts or register entries only — none is approved (OD-028)."
      />
      <Section>
        <Register user={access.user} />
      </Section>
      {can(access.user, 'ops:sops:write') ? (
        <Section label="Loading form…">
          <NewSop />
        </Section>
      ) : null}
    </Frame>
  );
}

async function Register({ user }: { user: AuthenticatedUser }) {
  const r = await load((db) => listSops(db, user));
  if (!r.ok) return r.view;
  return (
    <DataTable
      caption={`${r.data.length} SOP(s)`}
      rows={r.data}
      rowKey={(s) => s.id}
      empty={<EmptyState title="No SOPs yet" />}
      columns={[
        { key: 'code', header: 'Code', render: (s) => <a href={`/ops/sops/${s.id}`}>{s.code}</a> },
        { key: 'title', header: 'Title' },
        { key: 'departmentName', header: 'Department', render: (s) => s.departmentName ?? '—' },
        { key: 'owner', header: 'Owner', render: (s) => s.ownerName ?? s.ownerRole ?? '—' },
        { key: 'reviewerName', header: 'Reviewer', render: (s) => s.reviewerName ?? '—' },
        {
          key: 'status',
          header: 'Status',
          render: (s) => SOP_STATUS_LABELS[s.status as SopStatus],
        },
        {
          key: 'decision',
          header: 'Policy state',
          render: (s) => (
            <StatusBadge tone={decisionTone(s.decisionState)}>
              {s.decisionState === 'approved'
                ? 'Approved'
                : s.decisionState === 'retired'
                  ? 'Retired'
                  : 'Proposed'}
            </StatusBadge>
          ),
        },
        {
          key: 'version',
          header: 'Current version',
          render: (s) =>
            s.currentVersion ? `${s.currentVersion.label} (${s.currentVersion.status})` : '—',
        },
        {
          key: 'legacy',
          header: 'Source',
          render: (s) =>
            s.legacySource ? `${s.legacySource} — "${s.legacyStatus}"` : 'Elevate OS',
        },
      ]}
    />
  );
}

async function NewSop() {
  const r = await load((db) => formOptions(db));
  if (!r.ok) return r.view;
  return (
    <Card
      title="New SOP"
      description="Starts as draft 0.1. A reviewer who is not the owner must recommend it before approval."
    >
      <ActionForm
        action="/ops/api/v1/sops"
        submitLabel="Create SOP"
        redirectTo="/ops/sops/{id}"
        fields={[
          { name: 'title', label: 'Title', required: true },
          { name: 'process', label: 'Process' },
          {
            name: 'departmentId',
            label: 'Department',
            type: 'select',
            options: r.data.departments,
          },
          { name: 'ownerStaffId', label: 'Owner', type: 'select', options: r.data.staff },
          { name: 'reviewerStaffId', label: 'Reviewer', type: 'select', options: r.data.staff },
          { name: 'backupStaffId', label: 'Backup', type: 'select', options: r.data.staff },
          {
            name: 'riskLevel',
            label: 'Risk',
            type: 'select',
            options: ['low', 'medium', 'high'].map((v) => ({ value: v, label: v })),
          },
          { name: 'content', label: 'Procedure (draft)', type: 'textarea' },
        ]}
      />
    </Card>
  );
}
