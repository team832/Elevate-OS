import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { SOP_PUBLICATION_LABELS, SOP_STATUS_LABELS, type SopStatus } from '../../domain';
import { formOptions } from '../../server/options';
import { listOutstandingAcknowledgements, listSops } from '../../server/sops';
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
      <Section label="Loading acknowledgements…">
        <Acknowledgements user={access.user} />
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
          key: 'publication',
          header: 'Published',
          render: (s) => (
            <>
              {SOP_PUBLICATION_LABELS[s.publicationState]}
              {s.reviewDue === 'overdue' ? (
                <StatusBadge tone="danger">Review overdue</StatusBadge>
              ) : null}
              {s.reviewDue === 'due_soon' ? (
                <StatusBadge tone="warning">Review due soon</StatusBadge>
              ) : null}
            </>
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

async function Acknowledgements({ user }: { user: AuthenticatedUser }) {
  const r = await load((db) => listOutstandingAcknowledgements(db, user));
  if (!r.ok) return r.view;
  return (
    <Card
      title="Outstanding acknowledgements"
      description="Approved SOP versions that staff must confirm they have read. Open an SOP to see who is still to acknowledge."
    >
      <DataTable
        rows={r.data.bySop}
        rowKey={(x) => x.id}
        empty={<EmptyState title="No SOP currently requires acknowledgement" />}
        columns={[
          {
            key: 'code',
            header: 'SOP',
            render: (x) => <a href={`/ops/sops/${x.id}`}>{x.code}</a>,
          },
          { key: 'title', header: 'Title' },
          { key: 'required', header: 'Required', numeric: true },
          { key: 'acknowledged', header: 'Acknowledged', numeric: true },
          { key: 'outstanding', header: 'Outstanding', numeric: true },
          { key: 'noLogin', header: 'No login', numeric: true },
        ]}
      />
    </Card>
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
