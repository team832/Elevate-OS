/**
 * One HR staff record: the employee profile (shared by the directory pop-up and the full page)
 * and the HR change forms, each in its own FormModal (`?act=`). Private details render only when
 * the server returned them (ops:staff_private:read).
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can, ROLES, type Permission } from '@elevate/authorization';
import { StatusBadge } from '@elevate/shared-ui';
import { EMPLOYMENT_TYPES } from '../../../domain';
import type { HrStaff, hrFormOptions } from '../../../server/hr-staff';
import { ActionForm, type FieldSpec } from '../../../ui/action-form';
import { fmtDate, humanise } from '../../../ui/format';
import { options } from '../../../ui/list-controls';
import { FormModal } from '../../../ui/record-modal';
import { DetailTable, Segment } from '../../../ui/sections';

type Level = 2 | 3;
const period = (from: string | null, to: string | null) =>
  `${from ? fmtDate(from) : 'Start not recorded'} – ${to ? fmtDate(to) : 'now'}`;

export function HrOverview({
  d,
  user,
  level,
  actHref,
}: {
  d: HrStaff;
  user: AuthenticatedUser;
  level: Level;
  /** Link that opens one of the HR forms on this page. */
  actHref: (act: string) => string;
}) {
  const p = d.profile;
  const exited = p?.employmentStatus === 'exited';
  const additional = d.departments.filter((x) => !x.isPrimary && !x.toDate);
  const manage = can(user, 'ops:staff:manage');
  return (
    <>
      <Segment
        title="Employee profile"
        level={level}
        flush
        actions={
          manage ? (
            <span className="el-inline-form">
              <a href={actHref('profile')}>Edit profile</a>
              <a href={actHref('department')}>Change department</a>
              <a href={actHref('manager')}>Change manager</a>
              {exited ? null : <a href={actHref('end')}>End employment</a>}
            </span>
          ) : undefined
        }
      >
        <DetailTable
          rows={[
            { label: 'Employee ID', value: p?.staffCode ?? 'Not recorded' },
            { label: 'Full name', value: d.staff.fullName },
            { label: 'Preferred name', value: p?.displayName ?? 'Same as full name' },
            {
              label: 'Login email',
              value: d.login ? (
                <>
                  {d.login.email}{' '}
                  {d.login.status === 'disabled' ? (
                    <StatusBadge tone="neutral">Login disabled</StatusBadge>
                  ) : null}
                </>
              ) : (
                'No login'
              ),
            },
            {
              label: 'Departments',
              value: (
                <ul>
                  <li>{d.department ? `${d.department} (main)` : 'No department yet'}</li>
                  {additional.map((x) => (
                    <li key={x.id}>{x.name}</li>
                  ))}
                </ul>
              ),
            },
            { label: 'Job title', value: d.staff.title ?? 'Not recorded' },
            {
              label: 'Employment',
              value: (
                <StatusBadge
                  tone={
                    exited ? 'neutral' : p?.employmentStatus === 'active' ? 'success' : 'warning'
                  }
                >
                  {humanise(p?.employmentStatus ?? 'not_recorded')}
                </StatusBadge>
              ),
            },
            { label: 'Employment type', value: humanise(p?.employmentType ?? 'not_recorded') },
            { label: 'Joined', value: p?.joinedOn ? fmtDate(p.joinedOn) : 'Not recorded' },
            p?.leftOn && { label: 'Last working day', value: fmtDate(p.leftOn) },
            { label: 'Reports to', value: d.manager ?? 'Nobody on record' },
            { label: 'Branch', value: d.branch ?? 'Not recorded' },
            { label: 'Work schedule', value: d.schedule ?? 'Default schedule' },
            {
              label: 'Workspaces',
              value: d.workspaces.join(', ') || 'None (from roles; none held)',
            },
            {
              label: 'Roles',
              value: d.roles.map((r) => ROLES[r].label).join(', ') || 'None',
            },
            {
              label: 'Teaching capabilities',
              value: d.capabilities.length
                ? `${d.capabilities.map((c) => c.subject).join(', ')} (a capability grants no access to students)`
                : 'None recorded',
            },
          ]}
        />
      </Segment>
      <Segment title="Department and manager history" level={level} flush>
        {d.departments.length || d.managerHistory.length ? (
          <DetailTable
            rows={[
              ...d.departments.map((x) => ({
                label: `${x.name}${x.isPrimary ? ' (main)' : ''}`,
                value: period(x.fromDate, x.toDate),
              })),
              ...d.managerHistory.map((h) => ({
                label: `Reports to ${h.managerName ?? 'nobody'}`,
                value: `${period(h.fromDate, h.toDate)}${h.reason ? ` · ${h.reason}` : ''}`,
              })),
            ]}
          />
        ) : (
          <p className="el-field-hint">
            No department or manager change recorded in Elevate OS yet.
          </p>
        )}
      </Segment>
      {'private' in d ? (
        <Segment
          title="Private details (HR only)"
          level={level}
          flush
          actions={
            can(user, 'ops:staff_private:manage') ? (
              <a href={actHref('private')}>Edit private details</a>
            ) : undefined
          }
        >
          <DetailTable
            rows={PRIVATE_FIELDS.map(([name, label]) => ({
              label,
              value: d.private?.[name] ?? 'Not recorded',
            }))}
          />
        </Segment>
      ) : null}
    </>
  );
}

const PRIVATE_FIELDS = [
  ['personalPhone', 'Personal phone', 'tel'],
  ['personalEmail', 'Personal email', 'email'],
  ['address', 'Address', 'textarea'],
  ['emergencyContactName', 'Emergency contact', 'text'],
  ['emergencyContactPhone', 'Emergency contact phone', 'tel'],
] as const;

type Options = Awaited<ReturnType<typeof hrFormOptions>>;
type Act = {
  title: string;
  permission: Permission;
  path: string;
  method?: 'PATCH' | 'PUT';
  submit: string;
  danger?: boolean;
  note?: string;
  fields: (d: HrStaff, o: Options) => FieldSpec[];
};

/** The HR forms opened by `?act=`; each route re-checks its permission on the server. */
export const HR_ACTS: Record<string, Act> = {
  profile: {
    title: 'Edit employment profile',
    permission: 'ops:staff:manage',
    path: '',
    method: 'PATCH',
    submit: 'Save profile',
    note: 'Empty fields are left as they are. Ending employment is a separate step.',
    fields: (d, o) => [
      {
        name: 'staffCode',
        label: 'Employee ID',
        defaultValue: d.profile?.staffCode ?? '',
        section: 'Identity',
      },
      {
        name: 'displayName',
        label: 'Preferred name',
        defaultValue: d.profile?.displayName ?? '',
        section: 'Identity',
      },
      { name: 'title', label: 'Job title', defaultValue: d.staff.title ?? '', section: 'Identity' },
      {
        name: 'employmentType',
        label: 'Employment type',
        type: 'select',
        options: options(EMPLOYMENT_TYPES),
        defaultValue: d.profile?.employmentType ?? 'not_recorded',
        section: 'Employment',
      },
      ...(d.profile?.employmentStatus === 'exited'
        ? []
        : [
            {
              name: 'employmentStatus',
              label: 'Employment status',
              type: 'select' as const,
              options: options(['active', 'on_notice', 'not_recorded']),
              defaultValue: d.profile?.employmentStatus ?? 'not_recorded',
              section: 'Employment',
            },
          ]),
      {
        name: 'joinedOn',
        label: 'Joined on',
        type: 'date',
        defaultValue: d.profile?.joinedOn ?? '',
        section: 'Employment',
      },
      {
        name: 'leftOn',
        label: 'Last working day',
        type: 'date',
        hint: 'Only once notice is given.',
        defaultValue: d.profile?.leftOn ?? '',
        section: 'Employment',
      },
      {
        name: 'branchId',
        label: 'Branch',
        type: 'select',
        options: o.branches,
        defaultValue: d.profile?.branchId ?? '',
        section: 'Place and schedule',
      },
      {
        name: 'workScheduleId',
        label: 'Work schedule',
        type: 'select',
        options: o.schedules,
        hint: 'Leave empty for the default schedule.',
        defaultValue: d.profile?.workScheduleId ?? '',
        section: 'Place and schedule',
      },
    ],
  },
  department: {
    title: 'Change department',
    permission: 'ops:staff:manage',
    path: '/department',
    submit: 'Record department change',
    note: 'The earlier department is kept in the history with its dates.',
    fields: (_d, o) => [
      {
        name: 'kind',
        label: 'Change',
        type: 'select',
        required: true,
        options: [
          { value: 'primary', label: 'New main department' },
          { value: 'additional', label: 'Add another department' },
          { value: 'remove', label: 'Leave an additional department' },
        ],
      },
      {
        name: 'departmentId',
        label: 'Department',
        type: 'select',
        required: true,
        options: o.departments,
      },
      { name: 'fromDate', label: 'From', type: 'date', hint: 'Empty: today.' },
    ],
  },
  manager: {
    title: 'Change manager',
    permission: 'ops:staff:manage',
    path: '/manager',
    submit: 'Record manager change',
    note: 'The earlier manager is kept in the history with its dates.',
    fields: (d, o) => [
      {
        name: 'managerId',
        label: 'Reports to',
        type: 'select',
        options: o.staff.filter((s) => s.value !== d.staff.id),
        hint: 'Leave empty if this person reports to nobody.',
      },
      { name: 'fromDate', label: 'From', type: 'date', hint: 'Empty: today.' },
      { name: 'reason', label: 'Reason', type: 'textarea' },
    ],
  },
  end: {
    title: 'End employment',
    permission: 'ops:staff:manage',
    path: '/end-employment',
    submit: 'End employment',
    danger: true,
    note: 'This disables the person’s login and signs them out everywhere. Their tasks, attendance, teaching logs and reviews stay as they are.',
    fields: () => [
      { name: 'leftOn', label: 'Last working day', type: 'date', required: true },
      { name: 'reason', label: 'Reason', type: 'textarea', required: true },
    ],
  },
  private: {
    title: 'Edit private details',
    permission: 'ops:staff_private:manage',
    path: '/private',
    method: 'PUT',
    submit: 'Save private details',
    note: 'Seen only by HR managers. Empty fields are left as they are.',
    fields: (d) =>
      PRIVATE_FIELDS.map(([name, label, type]) => ({
        name,
        label,
        type,
        defaultValue: d.private?.[name] ?? '',
      })),
  },
};

export function HrActModal({
  d,
  o,
  act,
  closeHref,
}: {
  d: HrStaff;
  o: Options;
  act: Act;
  closeHref: string;
}) {
  return (
    <FormModal
      id="hr-staff-act"
      title={`${act.title}: ${d.displayName}`}
      meta={act.note}
      closeHref={closeHref}
    >
      <ActionForm
        action={`/ops/api/v1/hr/staff/${d.staff.id}${act.path}`}
        method={act.method}
        submitLabel={act.submit}
        variant={act.danger ? 'danger' : 'primary'}
        // Router path: Next adds the /ops basePath itself (D-022).
        redirectTo={closeHref.replace(/^\/ops/, '')}
        secondary={<a href={closeHref}>Cancel</a>}
        fields={act.fields(d, o)}
      />
    </FormModal>
  );
}

/** Rows of a list on another HR page, shown on the staff record as a link (the list owns them). */
export function LinkedList({
  title,
  description,
  href,
  level,
}: {
  title: string;
  description: string;
  href: string;
  level: Level;
}) {
  return (
    <Segment title={title} level={level} description={description}>
      <a href={href}>Open {title.toLowerCase()} for this person</a>
    </Segment>
  );
}
