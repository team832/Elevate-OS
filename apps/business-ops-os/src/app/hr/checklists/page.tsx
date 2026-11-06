/**
 * Team (HR) → Joining and leaving (F4-09): each staff member's joining or leaving checklist with
 * item status, who and when (`?open=<id>`), and the versioned templates they are started from.
 * HR reads within its staff reach; starting and marking need ops:staff:manage, templates
 * ops:hr_settings:manage. Asset register: ../assets.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { OPS_STAFF_CHECKLIST_EVENTS as EVENTS } from '@elevate/database';
import { ButtonLink, EmptyState, PageHeader, StatusBadge, Tabs } from '@elevate/shared-ui';
import {
  CHECKLIST_EVENT_LABELS,
  CHECKLIST_ITEM_STATUS_LABELS,
  checklistTemplates,
  getStaffChecklist,
  listStaffChecklists,
  staffRecordOptions,
  type ChecklistEvent,
} from '../../../server/hr-staff-records';
import { ActionForm } from '../../../ui/action-form';
import { fmtDateTime } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { listHref, Pager } from '../../../ui/list-controls';
import { FormModal, RecordModal } from '../../../ui/record-modal';
import { RecordTable } from '../../../ui/record-table';
import { Segment } from '../../../ui/sections';
import type { Params } from '../../tasks/_components/task-common';
import { HrRecordsNav } from './nav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Joining and leaving' };

const BASE = '/ops/hr/checklists';
const API = '/ops/api/v1/hr';
const TONE = { pending: 'warning', done: 'success', not_applicable: 'neutral' } as const;
const STATUS_OPTIONS = Object.entries(CHECKLIST_ITEM_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));
const EVENT_OPTIONS = EVENTS.map((e) => ({ value: e, label: CHECKLIST_EVENT_LABELS[e] }));

export default async function StaffChecklistsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const access = await gate('ops:hr:read', BASE);
  const sp = await searchParams;
  const event = EVENTS.find((e) => e === sp.event);
  return (
    <Frame access={access} active="hr-checklists">
      <PageHeader
        title="Joining and leaving"
        description="Each staff member's joining or leaving checklist, with who marked each item and when. Start one from the current template; later template changes never alter a checklist already started."
        tabs={<HrRecordsNav current={BASE} />}
        actions={
          <ButtonLink href={listHref(`${API}/staff-records/checklists`, { event })} download>
            Download (spreadsheet)
          </ButtonLink>
        }
      />
      <Section label="Loading checklists…">
        <Checklists user={access.user} sp={sp} event={event} />
      </Section>
      <Section label="Loading templates…">
        <Templates user={access.user} />
      </Section>
      {sp.open ? <ChecklistModal user={access.user} sp={sp} id={sp.open} /> : null}
    </Frame>
  );
}

async function Checklists({
  user,
  sp,
  event,
}: {
  user: AuthenticatedUser;
  sp: Params;
  event: ChecklistEvent | undefined;
}) {
  const manage = can(user, 'ops:staff:manage');
  const r = await load(async (db) => ({
    list: await listStaffChecklists(db, user, { event, page: Math.max(1, Number(sp.page) || 1) }),
    people: manage ? await staffRecordOptions(db, user) : [],
  }));
  if (!r.ok) return r.view;
  const { list, people } = r.data;
  return (
    <div className="el-stack">
      {manage ? (
        <details>
          <summary>Start a checklist</summary>
          <ActionForm
            action={`${API}/checklists`}
            submitLabel="Start checklist"
            redirectTo={`${BASE}?open={id}`}
            fields={[
              {
                name: 'staffId',
                label: 'Staff member',
                type: 'select',
                required: true,
                options: people,
                emptyHint: 'No staff member in your reach yet.',
              },
              {
                name: 'event',
                label: 'Checklist',
                type: 'select',
                required: true,
                options: EVENT_OPTIONS,
              },
            ]}
          />
        </details>
      ) : null}
      <Tabs
        idBase="staff-checklists"
        label="Checklist"
        selected={event ?? 'all'}
        items={[
          { key: 'all', label: 'All', href: BASE },
          ...EVENTS.map((e) => ({
            key: e,
            label: CHECKLIST_EVENT_LABELS[e],
            href: listHref(BASE, { event: e }),
          })),
        ]}
      >
        <RecordTable
          caption={`${list.total} checklist${list.total === 1 ? '' : 's'}`}
          rows={list.rows}
          rowKey={(c) => c.id}
          rowHref={(c) => listHref(BASE, sp, { open: c.id })}
          linkColumn="staffName"
          sampleOf={(c) => c.isSample}
          empty={
            <EmptyState
              title="No checklists yet"
              description={
                manage
                  ? 'Start one above when someone joins or gives notice.'
                  : 'HR starts one when someone joins or gives notice.'
              }
            />
          }
          columns={[
            { key: 'staffName', header: 'Staff member' },
            { key: 'event', header: 'Checklist', render: (c) => CHECKLIST_EVENT_LABELS[c.event] },
            {
              key: 'pending',
              header: 'Open items',
              render: (c) =>
                c.pending ? (
                  <StatusBadge tone="warning">{`${c.pending} of ${c.items} open`}</StatusBadge>
                ) : (
                  <StatusBadge tone="success">All {c.items} closed</StatusBadge>
                ),
            },
            { key: 'version', header: 'Template', render: (c) => `Version ${c.version}` },
            { key: 'createdAt', header: 'Started (IST)', render: (c) => fmtDateTime(c.createdAt) },
          ]}
        />
        <Pager
          basePath={BASE}
          params={sp}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
        />
      </Tabs>
    </div>
  );
}

async function Templates({ user }: { user: AuthenticatedUser }) {
  const r = await load((db) => checklistTemplates(db, user));
  if (!r.ok) return r.view;
  const edit = can(user, 'ops:hr_settings:manage');
  return (
    <Segment
      title="Templates"
      description="Proposed items (owner to confirm). Publishing a new version leaves checklists already started as they are."
    >
      <div className="el-stack">
        {EVENTS.map((e) => {
          const active = r.data.find((t) => t.event === e && t.status === 'active');
          return (
            <section key={e} aria-label={`${CHECKLIST_EVENT_LABELS[e]} template`}>
              <h3>
                {CHECKLIST_EVENT_LABELS[e]}
                {active ? `, version ${active.version}` : ''}
              </h3>
              {active ? (
                <ul>
                  {active.items.map((i) => (
                    <li key={i.key}>{i.label}</li>
                  ))}
                </ul>
              ) : (
                <p className="el-field-hint">No template published yet.</p>
              )}
              {edit ? (
                <details>
                  <summary>{`Publish a new ${CHECKLIST_EVENT_LABELS[e].toLowerCase()} version`}</summary>
                  <ActionForm
                    action={`${API}/checklist-templates`}
                    submitLabel="Publish version"
                    extra={{ event: e }}
                    fields={[
                      {
                        name: 'items',
                        label: 'Items, one per line',
                        type: 'textarea',
                        required: true,
                        defaultValue: active?.items.map((i) => i.label).join('\n'),
                      },
                    ]}
                  />
                </details>
              ) : null}
            </section>
          );
        })}
      </div>
    </Segment>
  );
}

async function ChecklistModal({
  user,
  sp,
  id,
}: {
  user: AuthenticatedUser;
  sp: Params;
  id: string;
}) {
  const close = listHref(BASE, sp, { open: undefined });
  const r = await load((db) => getStaffChecklist(db, user, id));
  if (!r.ok)
    return (
      <FormModal id="staff-checklist" title="Checklist" closeHref={close}>
        {r.view}
      </FormModal>
    );
  const c = r.data;
  const manage = can(user, 'ops:staff:manage');
  return (
    <RecordModal
      id="staff-checklist"
      title={`${CHECKLIST_EVENT_LABELS[c.event]} checklist: ${c.staffName}`}
      meta={<span className="el-field-hint">Template version {c.version}</span>}
      closeHref={close}
      returnId={c.id}
    >
      <RecordTable
        caption={`${c.items.filter((i) => i.status === 'pending').length} of ${c.items.length} open`}
        rows={c.items}
        rowKey={(i) => i.id}
        columns={[
          { key: 'label', header: 'Item' },
          {
            key: 'status',
            header: 'Status',
            render: (i) => (
              <StatusBadge tone={TONE[i.status]}>
                {CHECKLIST_ITEM_STATUS_LABELS[i.status]}
              </StatusBadge>
            ),
          },
          {
            key: 'who',
            header: 'Marked by',
            render: (i) =>
              i.doneAt ? `${i.doneByName ?? 'Staff member'}, ${fmtDateTime(i.doneAt)}` : 'Not yet',
          },
          { key: 'note', header: 'Note', render: (i) => i.note ?? '' },
          ...(manage
            ? [
                {
                  key: 'act',
                  header: '',
                  render: (i: (typeof c.items)[number]) => (
                    <ActionForm
                      action={`${API}/checklist-items/${i.id}`}
                      submitLabel="Save"
                      labelSuffix={` — ${i.label}`}
                      compact
                      fields={[
                        {
                          name: 'status',
                          label: 'Status',
                          type: 'select',
                          required: true,
                          options: STATUS_OPTIONS,
                          defaultValue: i.status,
                        },
                        { name: 'note', label: 'Note', defaultValue: i.note ?? undefined },
                      ]}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
    </RecordModal>
  );
}
