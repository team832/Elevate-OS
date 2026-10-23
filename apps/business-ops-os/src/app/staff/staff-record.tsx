/**
 * One staff member, shared by the directory pop-up (`/ops/staff?open=<id>`) and
 * the full route (`/ops/staff/<id>`), plus the edit flow in its own FormModal.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import type { getStaffDetail } from '../../server/organisation';
import { ActionForm } from '../../ui/action-form';
import { humanise } from '../../ui/format';
import { options } from '../../ui/list-controls';
import { FormModal } from '../../ui/record-modal';
import { DetailTable, Segment } from '../../ui/sections';

export type StaffDetail = Awaited<ReturnType<typeof getStaffDetail>>;

export function StaffProfile({
  d,
  user,
  editHref,
  level,
}: {
  d: StaffDetail;
  user: AuthenticatedUser;
  editHref: string;
  level: 2 | 3;
}) {
  return (
    <Segment
      title="Profile"
      level={level}
      flush
      actions={
        <span className="el-inline-form">
          {can(user, 'ops:hr:read') ? <a href={`/ops/hr/staff/${d.staff.id}`}>HR record</a> : null}
          {can(user, 'ops:teachers:read') ? (
            <a href={`/ops/teachers/${d.staff.id}`}>Teacher profile</a>
          ) : null}
          {can(user, 'ops:organisation:manage') ? <a href={editHref}>Edit staff record</a> : null}
        </span>
      }
    >
      <DetailTable
        rows={[
          { label: 'Title', value: d.staff.title ?? 'Not recorded' },
          { label: 'Department', value: d.department?.name ?? 'No department' },
          { label: 'Reports to', value: d.manager?.fullName ?? 'Nobody on record' },
          {
            label: 'Direct reports',
            value: d.reports.length ? (
              <ul>
                {d.reports.map((x) => (
                  <li key={x.id}>{x.fullName}</li>
                ))}
              </ul>
            ) : (
              'None'
            ),
          },
          {
            label: 'Employment type',
            value: humanise(d.profile?.employmentType ?? 'not_recorded'),
          },
          { label: 'Role labels', value: d.profile?.roleLabels.join(', ') || 'None' },
          { label: 'Status', value: humanise(d.staff.status) },
          { label: 'Login', value: d.staff.userId ? 'Linked' : 'None' },
        ]}
      />
    </Segment>
  );
}

export function StaffEditModal({ d, closeHref }: { d: StaffDetail; closeHref: string }) {
  return (
    <FormModal
      id="staff-edit"
      title={`Edit staff record: ${d.staff.fullName}`}
      closeHref={closeHref}
    >
      <p className="el-field-hint">
        Department and manager changes keep their history in HR:{' '}
        <a href={`/ops/hr/staff/${d.staff.id}?act=department`}>change department</a> or{' '}
        <a href={`/ops/hr/staff/${d.staff.id}?act=manager`}>change manager</a>.
      </p>
      <ActionForm
        action={`/ops/api/v1/staff/${d.staff.id}`}
        method="PATCH"
        submitLabel="Save staff record"
        // Router path: Next adds the /ops basePath itself (D-022).
        redirectTo={closeHref.replace(/^\/ops/, '')}
        secondary={<a href={closeHref}>Cancel</a>}
        fields={[
          { name: 'title', label: 'Title', defaultValue: d.staff.title ?? '', section: 'Role' },
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            required: true,
            defaultValue: d.staff.status,
            options: options(['active', 'on_leave', 'inactive']),
            section: 'Role',
          },
        ]}
      />
    </FormModal>
  );
}
