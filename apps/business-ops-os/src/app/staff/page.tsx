import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { ButtonLink, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { EMPLOYMENT_TYPES } from '../../domain';
import { getDirectory, getStaffDetail } from '../../server/organisation';
import { formOptions } from '../../server/options';
import { ActionForm } from '../../ui/action-form';
import { humanise } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';
import { listHref, options, SearchPanel } from '../../ui/list-controls';
import { FormModal, RecordModal } from '../../ui/record-modal';
import { RecordTable } from '../../ui/record-table';
import { Segment } from '../../ui/sections';
import { StaffEditModal, StaffProfile } from './staff-record';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Staff directory' };

type Params = Record<string, string | undefined>;
const BASE = '/ops/staff';
const STATUSES = ['active', 'on_leave', 'inactive'];

export default async function StaffPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:organisation:read', BASE);
  const sp = await searchParams;
  return (
    <Frame access={access} active="staff">
      <PageHeader
        title="Staff directory"
        description="Everyone on staff, their department and who they report to. Teachers and counsellors are staff."
        actions={
          can(access.user, 'ops:organisation:manage') ? (
            <ButtonLink
              variant="primary"
              href={listHref(BASE, sp, { new: '1', open: undefined, act: undefined })}
            >
              Add staff member
            </ButtonLink>
          ) : undefined
        }
      />
      <Section>
        <Directory user={access.user} sp={sp} />
      </Section>
      {sp.open ? (
        <Section label="Loading staff member…">
          <OpenStaff user={access.user} sp={sp} id={sp.open} />
        </Section>
      ) : null}
    </Frame>
  );
}

async function Directory({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const manage = can(user, 'ops:organisation:manage');
  const r = await load(async (db) => {
    const [d, o] = await Promise.all([
      getDirectory(db, user),
      manage && sp.new && !sp.open ? formOptions(db) : null,
    ]);
    return { d, o };
  });
  if (!r.ok) return r.view;
  const { d, o } = r.data;
  const q = sp.q?.trim().toLowerCase();
  const rows = d.staff.filter(
    (s) =>
      (!q || s.fullName.toLowerCase().includes(q)) &&
      (!sp.department || s.departmentId === sp.department) &&
      (!sp.status || s.status === sp.status),
  );
  const close = (patch: Params) => listHref(BASE, sp, patch);
  return (
    <div className="el-stack">
      <SearchPanel
        action={BASE}
        search={{ name: 'q', label: 'Name', value: sp.q }}
        filters={[
          {
            name: 'department',
            label: 'Department',
            type: 'select',
            value: sp.department,
            options: d.departments.map((x) => ({ value: x.id, label: x.name })),
          },
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            value: sp.status,
            options: options(STATUSES),
          },
        ]}
      />
      <RecordTable
        caption={`${rows.length} staff member${rows.length === 1 ? '' : 's'}`}
        rows={rows}
        rowKey={(s) => s.id}
        rowHref={(s) => close({ open: s.id, act: undefined, new: undefined })}
        linkColumn="fullName"
        empty={<EmptyState title="No staff match" description="Clear a filter to see everyone." />}
        columns={[
          { key: 'fullName', header: 'Name' },
          { key: 'title', header: 'Title', render: (s) => s.title ?? 'Not recorded' },
          {
            key: 'departmentName',
            header: 'Department',
            render: (s) => s.departmentName ?? 'None',
          },
          { key: 'managerName', header: 'Reports to', render: (s) => s.managerName ?? 'Nobody' },
          {
            key: 'roleLabels',
            header: 'Role labels',
            render: (s) => s.roleLabels.join(', ') || 'None',
          },
          { key: 'hasLogin', header: 'Login', render: (s) => (s.hasLogin ? 'Yes' : 'No') },
          {
            key: 'status',
            header: 'Status',
            render: (s) => (
              <StatusBadge tone={s.status === 'active' ? 'success' : 'warning'}>
                {humanise(s.status)}
              </StatusBadge>
            ),
          },
        ]}
      />
      <Segment
        title="Departments"
        flush
        description="13 provisional departments from the legacy model; confirming them is an owner decision. Open one to list its staff."
      >
        <RecordTable
          rows={d.departments}
          rowKey={(x) => x.id}
          rowHref={(x) => listHref(BASE, { department: x.id })}
          linkColumn="name"
          columns={[
            { key: 'name', header: 'Department' },
            { key: 'code', header: 'Code' },
            {
              key: 'status',
              header: 'Status',
              render: (x) => (
                <StatusBadge tone={x.status === 'active' ? 'success' : 'warning'}>
                  {humanise(x.status)}
                </StatusBadge>
              ),
            },
            { key: 'headcount', header: 'Staff', numeric: true },
          ]}
        />
      </Segment>
      {o ? (
        <FormModal id="staff-new" title="Add staff member" closeHref={close({ new: undefined })}>
          <ActionForm
            action="/ops/api/v1/staff"
            submitLabel="Add staff member"
            // Router path: Next adds the /ops basePath itself (D-022).
            redirectTo="/staff?open={id}"
            secondary={<a href={close({ new: undefined })}>Cancel</a>}
            fields={[
              { name: 'fullName', label: 'Full name', required: true, section: 'Person' },
              { name: 'title', label: 'Title', section: 'Person' },
              {
                name: 'departmentId',
                label: 'Department',
                type: 'select',
                options: o.departments,
                section: 'Role',
              },
              {
                name: 'managerId',
                label: 'Reports to',
                type: 'select',
                options: o.staff,
                section: 'Role',
              },
              {
                name: 'employmentType',
                label: 'Employment type',
                type: 'select',
                required: true,
                defaultValue: 'not_recorded',
                options: options(EMPLOYMENT_TYPES),
                section: 'Role',
              },
              {
                name: 'roleLabels',
                label: 'Role labels (comma separated)',
                type: 'list',
                section: 'Role',
              },
            ]}
          />
        </FormModal>
      ) : null}
    </div>
  );
}

/** The `?open=` record loads on its own, so a failure stays inside the modal and the list stays. */
async function OpenStaff({ user, sp, id }: { user: AuthenticatedUser; sp: Params; id: string }) {
  const close = (patch: Params) => listHref(BASE, sp, patch);
  const edit = sp.act === 'edit' && can(user, 'ops:organisation:manage');
  const r = await load(async (db) =>
    Promise.all([getStaffDetail(db, user, id), edit ? formOptions(db) : null]),
  );
  if (!r.ok)
    return (
      <RecordModal
        id="staff-modal"
        title="Staff member"
        closeHref={close({ open: undefined, act: undefined })}
      >
        {r.view}
      </RecordModal>
    );
  const [d, o] = r.data;
  return o ? (
    <StaffEditModal d={d} o={o} closeHref={close({ act: undefined })} />
  ) : (
    <RecordModal
      id="staff-modal"
      title={d.staff.fullName}
      meta={d.staff.title ?? undefined}
      fullHref={`${BASE}/${d.staff.id}`}
      closeHref={close({ open: undefined, act: undefined })}
      returnId={d.staff.id}
    >
      <StaffProfile d={d} user={user} editHref={close({ act: 'edit' })} level={3} />
    </RecordModal>
  );
}
