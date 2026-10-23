/**
 * The staff list shared by HR → Staff Directory (`/ops/hr/staff`, HR's department scope) and the
 * organisation directory (`/ops/staff`, everyone). Filters, search and page live in the URL and
 * run on the server; 25 a page.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can, ROLES } from '@elevate/authorization';
import { OPS_EMPLOYMENT_STATUSES } from '@elevate/database';
import { ROLE_KEYS } from '@elevate/shared-types';
import { EmptyState, StatusBadge } from '@elevate/shared-ui';
import { EMPLOYMENT_TYPES } from '../../domain';
import { formOptions } from '../../server/options';
import { getDirectory } from '../../server/organisation';
import { ActionForm } from '../../ui/action-form';
import { humanise } from '../../ui/format';
import { load } from '../../ui/frame';
import { listHref, options, Pager, SearchPanel } from '../../ui/list-controls';
import { FormModal } from '../../ui/record-modal';
import { RecordTable } from '../../ui/record-table';
import { Segment } from '../../ui/sections';

export type Params = Record<string, string | undefined>;

const tone = (s: string) => (s === 'active' ? 'success' : s === 'exited' ? 'neutral' : 'warning');

export async function Directory({
  user,
  sp,
  base,
  view,
}: {
  user: AuthenticatedUser;
  sp: Params;
  base: string;
  view: 'hr' | 'organisation';
}) {
  const manage = can(user, 'ops:organisation:manage');
  const r = await load(async (db) => {
    const [d, o] = await Promise.all([
      getDirectory(db, user, sp, view),
      manage && sp.new && !sp.open ? formOptions(db) : null,
    ]);
    return { d, o };
  });
  if (!r.ok) return r.view;
  const { d, o } = r.data;
  const close = (patch: Params) => listHref(base, sp, patch);
  const select = (name: string, label: string, opts: { value: string; label: string }[]) => ({
    name,
    label,
    type: 'select' as const,
    value: sp[name],
    options: opts,
  });
  return (
    <div className="el-stack">
      <SearchPanel
        action={base}
        search={{ name: 'q', label: 'Name or employee ID', value: sp.q }}
        filters={[
          select(
            'department',
            'Department',
            d.departments.map((x) => ({ value: x.id, label: x.name })),
          ),
          select(
            'manager',
            'Reports to',
            d.managers.map((x) => ({ value: x.id, label: x.fullName })),
          ),
          select(
            'branch',
            'Branch',
            d.branches.map((x) => ({ value: x.id, label: x.name })),
          ),
          select(
            'role',
            'Role',
            ROLE_KEYS.map((k) => ({ value: k, label: ROLES[k].label })),
          ),
          select('employment', 'Employment', options(OPS_EMPLOYMENT_STATUSES)),
          select('status', 'Record status', options(['active', 'on_leave', 'inactive'])),
        ]}
      />
      {view === 'hr' && d.scope ? (
        <details className="el-explain">
          <summary>Who is listed</summary>
          Staff in the departments HR covers (HR Settings → Staff HR manages, a proposed setting),
          counting additional departments, plus staff with no department yet so HR can place them.
        </details>
      ) : null}
      <RecordTable
        caption={`${d.total} staff member${d.total === 1 ? '' : 's'}`}
        rows={d.staff}
        rowKey={(s) => s.id}
        rowHref={(s) => close({ open: s.id, act: undefined, new: undefined })}
        linkColumn="displayName"
        empty={<EmptyState title="No staff match" description="Clear a filter to see everyone." />}
        columns={[
          { key: 'displayName', header: 'Name' },
          { key: 'staffCode', header: 'Employee ID', render: (s) => s.staffCode ?? 'Not recorded' },
          { key: 'title', header: 'Job title', render: (s) => s.title ?? 'Not recorded' },
          {
            key: 'departmentName',
            header: 'Department',
            render: (s) => s.departmentName ?? 'None',
          },
          { key: 'managerName', header: 'Reports to', render: (s) => s.managerName ?? 'Nobody' },
          { key: 'branchName', header: 'Branch', render: (s) => s.branchName ?? 'Not recorded' },
          {
            key: 'roles',
            header: 'Roles',
            render: (s) =>
              s.roles.map((k) => ROLES[k].label).join(', ') || (s.hasLogin ? 'None' : 'No login'),
          },
          {
            key: 'employmentStatus',
            header: 'Employment',
            render: (s) => (
              <StatusBadge tone={tone(s.employmentStatus)}>
                {humanise(s.employmentStatus)}
              </StatusBadge>
            ),
          },
        ]}
      />
      <Pager basePath={base} params={sp} page={d.page} pageSize={d.pageSize} total={d.total} />
      {view === 'organisation' ? (
        <Segment
          title="Departments"
          flush
          description="13 provisional departments from the legacy model; confirming them is an owner decision. Open one to list its staff."
        >
          <RecordTable
            rows={d.departments}
            rowKey={(x) => x.id}
            rowHref={(x) => listHref(base, { department: x.id })}
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
      ) : null}
      {o ? (
        <FormModal id="staff-new" title="Add staff member" closeHref={close({ new: undefined })}>
          <ActionForm
            action="/ops/api/v1/staff"
            submitLabel="Add staff member"
            // Router path: Next adds the /ops basePath itself (D-022).
            redirectTo={`${base.replace(/^\/ops/, '')}?open={id}`}
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
