import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { listDecisions } from '../../server/planning';
import { ActionForm } from '../../ui/action-form';
import { decisionTone, fmtDate } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';

export const dynamic = 'force-dynamic';

export default async function DecisionsPage() {
  const access = await gate('ops:decisions:read', '/ops/decisions');
  return (
    <Frame access={access} active="decisions">
      <PageHeader
        title="Decision log"
        description="Confirmed rules and open questions kept apart. Legacy decisions keep their namespaced IDs (LEGACY-OPSWB-D-…) and original status."
      />
      <Section>
        <Log user={access.user} />
      </Section>
      {can(access.user, 'ops:decisions:write') ? (
        <Card
          title="Record a decision"
          description="Confirmed decisions need the decision date (PLT-007)."
        >
          <ActionForm
            action="/ops/api/v1/decisions"
            submitLabel="Record"
            fields={[
              { name: 'area', label: 'Area', required: true },
              {
                name: 'statement',
                label: 'Decision or question',
                type: 'textarea',
                required: true,
              },
              {
                name: 'state',
                label: 'State',
                type: 'select',
                required: true,
                defaultValue: 'proposed',
                options: ['open', 'proposed', 'confirmed', 'provisional'].map((v) => ({
                  value: v,
                  label: v,
                })),
              },
              { name: 'decidedOn', label: 'Decided on', type: 'date' },
              { name: 'source', label: 'Source' },
              { name: 'ownerDecisionRef', label: 'Owner decision (e.g. OD-012)' },
            ]}
          />
        </Card>
      ) : null}
    </Frame>
  );
}

async function Log({ user }: { user: AuthenticatedUser }) {
  const r = await load((db) => listDecisions(db, user));
  if (!r.ok) return r.view;
  return (
    <DataTable
      caption={`${r.data.length} decision(s)`}
      rows={r.data}
      rowKey={(d) => d.id}
      empty={<EmptyState title="No decisions recorded" />}
      columns={[
        { key: 'code', header: 'ID' },
        { key: 'area', header: 'Area' },
        { key: 'statement', header: 'Decision or question' },
        {
          key: 'state',
          header: 'State',
          render: (d) => <StatusBadge tone={decisionTone(d.state)}>{d.state}</StatusBadge>,
        },
        { key: 'legacyStatus', header: 'Legacy status', render: (d) => d.legacyStatus ?? '—' },
        { key: 'decidedOn', header: 'Decided', render: (d) => fmtDate(d.decidedOn) },
        {
          key: 'ownerDecisionRef',
          header: 'Owner decision',
          render: (d) => d.ownerDecisionRef ?? '',
        },
      ]}
    />
  );
}
