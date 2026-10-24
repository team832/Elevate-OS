/**
 * `<base>/leads/stages`: lead stage settings (owner brief 23 Oct 2026 §11). Everyone who reads
 * leads sees the list; managers (`ops:leads:assign`) rename, reorder, switch off and add stages.
 * Keys never change and system stages are never deleted, so history and reports stay readable.
 */
import type { ReactNode } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { listLeadStages } from '../../server/lead-stages';
import { ActionForm } from '../../ui/action-form';
import { humanise } from '../../ui/format';
import { load, Section } from '../../ui/frame';
import { options } from '../../ui/list-controls';
import { RecordTable } from '../../ui/record-table';
import { Segment } from '../../ui/sections';
import { NO_STAGES } from './lead-stage-record';
import '../ops.css';

export function LeadStagesBody({
  user,
  base,
  tabs,
}: {
  user: AuthenticatedUser;
  base: string;
  tabs?: ReactNode;
}) {
  return (
    <>
      <PageHeader
        title="Lead stages"
        description={
          <>
            The stages a lead moves through, separate from the admission status. Renaming or
            switching off a stage keeps every lead&rsquo;s history.{' '}
            <a href={`${base}/leads`}>All leads</a>
          </>
        }
        tabs={tabs}
      />
      <Section>
        <Stages user={user} base={base} />
      </Section>
    </>
  );
}

async function Stages({ user, base }: { user: AuthenticatedUser; base: string }) {
  const r = await load((db) => listLeadStages(db, user));
  if (!r.ok) return r.view;
  const stages = r.data;
  const manage = can(user, 'ops:leads:assign');
  const api = `${base}/api/v1/lead-stages`;
  return (
    <div className="el-stack">
      <RecordTable
        caption={`${stages.length} stage${stages.length === 1 ? '' : 's'}`}
        rows={stages}
        rowKey={(s) => s.id}
        empty={<EmptyState title="Lead stages are not set up yet" description={NO_STAGES} />}
        columns={[
          { key: 'sortOrder', header: 'Order' },
          { key: 'label', header: 'Label' },
          { key: 'key', header: 'Key (fixed)' },
          { key: 'kind', header: 'Kind', render: (s) => humanise(s.kind) },
          {
            key: 'reason',
            header: 'Reason',
            render: (s) => (s.requiresReason ? 'Needed' : 'Optional'),
          },
          {
            key: 'active',
            header: 'Status',
            render: (s) => (
              <StatusBadge tone={s.active ? 'success' : 'neutral'}>
                {s.active ? 'On' : 'Off'}
                {s.isSystem ? ' · system' : ''}
              </StatusBadge>
            ),
          },
          ...(manage
            ? [
                {
                  key: 'edit',
                  header: 'Change',
                  render: (s: (typeof stages)[number]) => (
                    <>
                      <ActionForm
                        action={`${api}/${s.key}`}
                        method="PATCH"
                        submitLabel="Save"
                        labelSuffix={` ${s.label}`}
                        compact
                        fields={[
                          { name: 'label', label: 'Label', defaultValue: s.label, required: true },
                          {
                            name: 'sortOrder',
                            label: 'Order',
                            type: 'number',
                            defaultValue: String(s.sortOrder),
                          },
                          {
                            name: 'active',
                            label: 'On',
                            type: 'checkbox',
                            defaultValue: String(s.active),
                          },
                        ]}
                      />
                      {s.isSystem ? null : (
                        <ActionForm
                          action={`${api}/${s.key}`}
                          method="DELETE"
                          submitLabel="Delete unused stage"
                          labelSuffix={` ${s.label}`}
                          variant="danger"
                          compact
                        />
                      )}
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />
      {manage ? (
        <Segment
          title="Add a stage"
          description="Converted stays the only won stage: it is set when Business Operations confirms the admission."
        >
          <ActionForm
            action={api}
            submitLabel="Add stage"
            resetOnSuccess
            fields={[
              { name: 'label', label: 'Label', required: true },
              {
                name: 'key',
                label: 'Key',
                required: true,
                hint: 'Lower case letters, digits and _ (e.g. call_back_later). It never changes.',
              },
              { name: 'sortOrder', label: 'Order', type: 'number', defaultValue: '500' },
              {
                name: 'kind',
                label: 'Kind',
                type: 'select',
                required: true,
                defaultValue: 'open',
                options: options(['open', 'parked', 'lost']),
              },
              { name: 'requiresReason', label: 'Reason needed', type: 'checkbox' },
            ]}
          />
        </Segment>
      ) : null}
    </div>
  );
}
