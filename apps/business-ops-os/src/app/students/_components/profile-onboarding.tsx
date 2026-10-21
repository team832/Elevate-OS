/**
 * Profile tab "Onboarding checklist" (owner brief §8): items from the versioned templates (or
 * added by hand), append-only statuses with owner, due date, notes and evidence, and the books
 * and materials handed over. Forms open in a FormModal by `?action=` (item / material /
 * onboarding-item); every change is checked and audited on the server. Server component.
 */
import type { ReactNode } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import { StatusBadge } from '@elevate/shared-ui';
import {
  MATERIAL_MOVES,
  ONBOARDING_ITEM_KINDS,
  ONBOARDING_STATUS_LABELS,
  ONBOARDING_STATUSES,
  type OnboardingStatus,
} from '../../../domain/onboarding';
import { getOnboarding } from '../../../server/onboarding';
import { formOptions } from '../../../server/options';
import { ActionForm, type FieldSpec } from '../../../ui/action-form';
import { fmtDate, fmtDateTime, humanise } from '../../../ui/format';
import { load } from '../../../ui/frame';
import { listHref } from '../../../ui/list-controls';
import { FormModal } from '../../../ui/record-modal';
import { RecordTable } from '../../../ui/record-table';
import { StatCard } from '../../../ui/charts';
import { Segment } from '../../../ui/sections';

const TONE: Record<OnboardingStatus, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  not_started: 'neutral',
  in_progress: 'info',
  completed: 'success',
  blocked: 'danger',
  not_applicable: 'neutral',
};
const pick = (values: readonly string[], labels?: Record<string, string>) =>
  values.map((v) => ({ value: v, label: labels?.[v] ?? humanise(v) }));

export async function OnboardingTab({
  identityId,
  admissionId,
  user,
  action,
  itemId,
  base,
}: {
  identityId: string;
  admissionId: string;
  user: AuthenticatedUser;
  action?: string;
  itemId?: string;
  base: string;
}) {
  const r = await load(async (db) => {
    const data = await getOnboarding(db, user, identityId);
    return { ...data, staff: data.canEdit ? (await formOptions(db)).staff : [] };
  });
  if (!r.ok) return r.view;
  const { items, materials, counts, canEdit, staff } = r.data;
  const here = listHref(base, { tab: 'onboarding' });
  const done = here.replace(/^\/ops/, '');
  const open = (a: string, item?: string) => listHref(base, { tab: 'onboarding', action: a, item });
  const api = `/ops/api/v1/students/${identityId}`;
  const selected = items.find((i) => i.id === itemId);
  const ownerField: FieldSpec = {
    name: 'ownerStaffId',
    label: 'Owner',
    type: 'select',
    options: staff,
    defaultValue: selected?.ownerStaffId ?? undefined,
    section: 'Owner and due date',
  };
  const dueField: FieldSpec = {
    name: 'dueDate',
    label: 'Due date',
    type: 'date',
    defaultValue: selected?.dueDate ?? undefined,
    section: 'Owner and due date',
  };
  const forms: Record<string, { title: string; form: () => ReactNode } | false> = {
    item: Boolean(selected) && {
      title: `Update: ${selected?.label}`,
      form: () => (
        <>
          <RecordTable
            caption="Status history (newest first)"
            rows={selected!.history}
            rowKey={(h) => h.id}
            empty="No status recorded yet."
            columns={[
              { key: 'at', header: 'When', render: (h) => fmtDateTime(h.at) },
              {
                key: 'status',
                header: 'Status',
                render: (h) => ONBOARDING_STATUS_LABELS[h.status],
              },
              { key: 'by', header: 'By', render: (h) => h.actorName },
              { key: 'note', header: 'Note', render: (h) => h.note ?? '—' },
              { key: 'ref', header: 'Evidence', render: (h) => h.evidenceRef ?? '—' },
            ]}
          />
          <ActionForm
            action={`${api}/onboarding/${selected!.id}`}
            submitLabel="Record status"
            redirectTo={done}
            secondary={<a href={here}>Cancel</a>}
            fields={[
              {
                name: 'status',
                label: 'Status',
                type: 'select',
                required: true,
                defaultValue: selected!.status,
                options: pick(ONBOARDING_STATUSES, ONBOARDING_STATUS_LABELS),
                hint:
                  selected!.kind === 'material'
                    ? 'Completes by itself when the materials are recorded as issued.'
                    : 'Not applicable takes the item off the checklist (kept in the history).',
                section: 'Status',
              },
              {
                name: 'note',
                label: 'Note',
                type: 'textarea',
                hint: 'Required when blocked: say what is blocking it.',
                section: 'Status',
              },
              {
                name: 'evidenceRef',
                label: 'Evidence reference',
                hint:
                  selected!.kind === 'biometric'
                    ? 'The biometric system’s enrolment reference only. Never biometric data.'
                    : 'Receipt number, form number or similar.',
                section: 'Status',
              },
              ownerField,
              dueField,
            ]}
          />
        </>
      ),
    },
    material: selected?.kind === 'material' && {
      title: `Materials: ${selected.label}`,
      form: () => (
        <ActionForm
          action={`${api}/materials`}
          submitLabel="Record materials"
          redirectTo={done}
          extra={{ itemId: selected!.id }}
          secondary={<a href={here}>Cancel</a>}
          fields={[
            {
              name: 'kind',
              label: 'What happened',
              type: 'select',
              required: true,
              options: pick(MATERIAL_MOVES),
              section: 'Materials',
            },
            {
              name: 'quantity',
              label: 'Quantity',
              type: 'number',
              required: true,
              defaultValue: '1',
              hint: `Copies of this item. Held now: ${selected.held}; it completes at ${selected.required}.`,
              section: 'Materials',
            },
            { name: 'edition', label: 'Edition', section: 'Materials' },
            { name: 'issuedOn', label: 'Date', type: 'date', required: true, section: 'Materials' },
            { name: 'note', label: 'Note', type: 'textarea', section: 'Materials' },
          ]}
        />
      ),
    },
    'onboarding-item': {
      title: 'Add a checklist item',
      form: () => (
        <ActionForm
          action={`${api}/onboarding`}
          submitLabel="Add item"
          redirectTo={done}
          extra={{ action: 'add', admissionId }}
          secondary={<a href={here}>Cancel</a>}
          fields={[
            { name: 'label', label: 'Item', required: true, section: 'Item' },
            {
              name: 'itemKey',
              label: 'Short key',
              required: true,
              hint: 'Lower-case letters, digits and _, e.g. hostel_form.',
              section: 'Item',
            },
            {
              name: 'kind',
              label: 'Kind',
              type: 'select',
              required: true,
              options: pick(ONBOARDING_ITEM_KINDS),
              section: 'Item',
            },
            { ...ownerField, defaultValue: undefined },
            { ...dueField, defaultValue: undefined },
          ]}
        />
      ),
    },
  };
  const form = canEdit && action ? forms[action] : undefined;
  const issued = items.flatMap((i) => i.materials.map((m) => ({ ...m, item: i.label })));
  return (
    <>
      {items.length ? (
        <ul className="el-grid ops-kpis" aria-label="Onboarding progress">
          <li>
            <StatCard
              label="Completed"
              value={`${counts.completed} of ${counts.total - counts.notApplicable}`}
              note={`${counts.notApplicable} not applicable`}
            />
          </li>
          <li>
            <StatCard label="Blocked" value={counts.blocked} />
          </li>
          <li>
            <StatCard label="Overdue" value={counts.overdue} />
          </li>
          {materials.complete === null ? null : (
            <li>
              <StatCard
                label="Material sets issued"
                value={`${materials.issued} of ${materials.required}`}
                note={materials.complete ? 'Complete' : 'Not complete'}
              />
            </li>
          )}
        </ul>
      ) : null}
      <Segment
        title="Onboarding checklist"
        flush
        description="Built from the template versions that applied when it was created; a later template change never rewrites it."
        actions={
          canEdit ? (
            <>
              <ActionForm
                action={`${api}/onboarding`}
                submitLabel={items.length ? 'Add new template items' : 'Create checklist'}
                compact
                variant="secondary"
                extra={{ action: 'generate', admissionId }}
              />
              <a href={open('onboarding-item')}>Add an item</a>
            </>
          ) : null
        }
      >
        <RecordTable
          caption="Checklist items"
          rows={items}
          rowKey={(i) => i.id}
          empty="No checklist items. Create the checklist from the templates or add an item."
          columns={[
            { key: 'item', header: 'Item', render: (i) => i.label },
            {
              key: 'status',
              header: 'Status',
              render: (i) => (
                <>
                  <StatusBadge tone={TONE[i.status]}>
                    {ONBOARDING_STATUS_LABELS[i.status]}
                  </StatusBadge>
                  {i.overdue ? <StatusBadge tone="danger">Overdue</StatusBadge> : null}
                  {i.kind === 'material' ? ` ${i.held} of ${i.required} issued` : null}
                </>
              ),
            },
            { key: 'owner', header: 'Owner', render: (i) => i.ownerName ?? 'Unassigned' },
            {
              key: 'due',
              header: 'Due',
              render: (i) => (i.dueDate ? fmtDate(i.dueDate) : 'No due date'),
            },
            {
              key: 'last',
              header: 'Last update',
              render: (i) =>
                i.latest
                  ? `${fmtDateTime(i.latest.at)} by ${i.latest.actorName}${i.latest.note ? `: ${i.latest.note}` : ''}${i.latest.evidenceRef ? ` (ref ${i.latest.evidenceRef})` : ''}`
                  : 'Not updated yet',
            },
            {
              key: 'source',
              header: 'Source',
              render: (i) => i.template ?? 'Added by hand',
            },
            ...(canEdit
              ? [
                  {
                    key: 'actions',
                    header: 'Actions',
                    render: (i: (typeof items)[number]) => (
                      <>
                        <a href={open('item', i.id)}>Update</a>
                        {i.kind === 'material' ? (
                          <>
                            {' · '}
                            <a href={open('material', i.id)}>Materials</a>
                          </>
                        ) : null}
                      </>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Segment>
      <Segment title="Books and materials handed over" flush>
        <RecordTable
          rows={issued}
          rowKey={(m) => m.id}
          empty="No materials recorded."
          columns={[
            { key: 'date', header: 'Date', render: (m) => fmtDate(m.issuedOn) },
            { key: 'item', header: 'Item', render: (m) => m.item },
            { key: 'kind', header: 'What', render: (m) => humanise(m.kind) },
            { key: 'qty', header: 'Quantity', numeric: true, render: (m) => m.quantity },
            { key: 'ed', header: 'Edition', render: (m) => m.edition ?? 'Not recorded' },
            { key: 'by', header: 'Recorded by', render: (m) => m.actorName },
          ]}
        />
      </Segment>
      {form ? (
        <FormModal id="onboarding-form" title={form.title} closeHref={here}>
          {form.form()}
        </FormModal>
      ) : null}
    </>
  );
}
