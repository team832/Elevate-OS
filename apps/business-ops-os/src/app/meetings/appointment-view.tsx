/**
 * Appointment pieces shared by the meetings list, the pop-up and the full route:
 * badges (type text + status text, never colour alone), the record sections, and
 * the change flows (each its own FormModal, `act=<key>`; never a modal on a modal).
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { StatusBadge, type Tone } from '@elevate/shared-ui';
import {
  APPOINTMENT_TYPE_LABELS,
  canMoveAppointment,
  isGroupType,
  type AppointmentStatus,
  type AppointmentType,
} from '../../domain/appointments';
import type { getAppointment } from '../../server/appointments';
import { ActionForm, type FieldSpec } from '../../ui/action-form';
import { fmtDate, fmtDateTime, humanise } from '../../ui/format';
import { FormModal, type ModalTab } from '../../ui/record-modal';
import { RecordTable } from '../../ui/record-table';
import { DetailTable, Segment } from '../../ui/sections';
import { eventTabs, type EventAct } from './event-view';

const STATUS_TONE: Record<AppointmentStatus, Tone> = {
  proposed: 'neutral',
  scheduled: 'info',
  confirmed: 'success',
  rescheduled: 'warning',
  completed: 'success',
  cancelled: 'neutral',
};

const REMINDER_TEXT: Record<string, string> = {
  pending: 'Reminder pending',
  sent_in_app: 'Teacher notified in Elevate OS; email/SMS simulated, not sent',
  simulated: 'No in-app login to notify; email/SMS simulated, not sent',
  not_applicable: 'No reminder needed',
};

export function TypeBadge({ type }: { type: AppointmentType }) {
  return (
    <StatusBadge tone={type === 'parent_teacher_meeting' ? 'info' : 'neutral'}>
      {APPOINTMENT_TYPE_LABELS[type]}
    </StatusBadge>
  );
}

export function ApptStatus({ status }: { status: AppointmentStatus }) {
  return <StatusBadge tone={STATUS_TONE[status]}>{humanise(status)}</StatusBadge>;
}

export const SampleBadge = ({ show }: { show: boolean | null }) =>
  show ? <span className="el-badge el-badge-sample">SAMPLE DATA</span> : null;

export const modeText = (mode: string, location?: string | null) =>
  mode === 'offline'
    ? `Offline, ${location ?? 'Sikar centre'}`
    : `Online${location ? `, ${location}` : ''}`;

type Detail = Awaited<ReturnType<typeof getAppointment>>;

export const APPOINTMENT_ACTS = ['confirm', 'reschedule', 'complete', 'cancel'] as const;
export type AppointmentAct = (typeof APPOINTMENT_ACTS)[number];

const ACTIONS: Record<
  AppointmentAct,
  { to: AppointmentStatus; label: string; fields: FieldSpec[]; variant?: 'danger' }
> = {
  confirm: { to: 'confirmed', label: 'Confirm appointment', fields: [] },
  reschedule: {
    to: 'rescheduled',
    label: 'Reschedule',
    fields: [
      {
        name: 'startsAt',
        label: 'New start (IST)',
        type: 'datetime',
        required: true,
        section: 'New time',
      },
      {
        name: 'endsAt',
        label: 'New end (IST)',
        type: 'datetime',
        hint: 'Leave empty to keep the same length.',
        section: 'New time',
      },
      { name: 'reason', label: 'Reason', type: 'textarea', required: true, section: 'New time' },
    ],
  },
  complete: {
    to: 'completed',
    label: 'Record outcome',
    fields: [
      { name: 'outcome', label: 'Outcome', type: 'textarea', required: true, section: 'Outcome' },
      { name: 'nextStep', label: 'Follow-up action', section: 'Follow-up' },
      { name: 'followUpOn', label: 'Follow-up date', type: 'date', section: 'Follow-up' },
    ],
  },
  cancel: {
    to: 'cancelled',
    label: 'Cancel appointment',
    variant: 'danger',
    fields: [
      {
        name: 'reason',
        label: 'Reason for cancelling',
        type: 'textarea',
        required: true,
        section: 'Cancel',
      },
    ],
  },
};

/** Links to the change flows the user may run now (shown in the Details header bar). */
function actionLinks(a: Detail, user: AuthenticatedUser, actHref: (act: AppointmentAct) => string) {
  if (!can(user, 'ops:appointments:manage'))
    return (
      <span className="el-field-hint">
        Changing appointments needs permission to manage appointments.
      </span>
    );
  const open = APPOINTMENT_ACTS.filter((x) => canMoveAppointment(a.status, ACTIONS[x].to));
  if (open.length === 0)
    return <span className="el-field-hint">No further changes ({a.status}).</span>;
  return (
    <span className="el-inline-form">
      {open.map((x) => (
        <a key={x} href={actHref(x)}>
          {ACTIONS[x].label}
        </a>
      ))}
    </span>
  );
}

export function appointmentTabs(
  a: Detail,
  user: AuthenticatedUser,
  actHref: (act: AppointmentAct | EventAct) => string,
  level: 2 | 3,
): ModalTab[] {
  const history: ModalTab = {
    key: 'history',
    label: 'History',
    count: a.changes.length,
    content: <ChangeHistory a={a} level={level} />,
  };
  if (isGroupType(a.type))
    return [...eventTabs(a, user, actHref, level, actionLinks(a, user, actHref)), history];
  return [
    {
      key: 'details',
      label: 'Details',
      content: (
        <Segment title="Appointment" level={level} flush actions={actionLinks(a, user, actHref)}>
          <DetailTable
            rows={[
              { label: 'Type', value: <TypeBadge type={a.type} /> },
              { label: 'Status', value: <ApptStatus status={a.status} /> },
              {
                label: 'When',
                value: `${fmtDateTime(a.startsAt)} to ${fmtDateTime(a.endsAt)} (${a.timezone})`,
              },
              { label: 'Teacher / counsellor', value: a.staffName },
              { label: 'Student', value: a.personName },
              { label: 'Mode', value: modeText(a.mode, a.location) },
              { label: 'Subject', value: a.subject ?? 'Not recorded' },
              { label: 'Purpose', value: a.purpose ?? 'Not recorded' },
              {
                label: 'Reminder',
                value: REMINDER_TEXT[a.reminderStatus] ?? humanise(a.reminderStatus),
              },
              !!a.outcome && { label: 'Outcome', value: a.outcome },
              !!(a.nextStep || a.followUpOn) && {
                label: 'Follow-up',
                value: `${a.nextStep ?? 'Follow up'}${a.followUpOn ? ` by ${fmtDate(a.followUpOn)}` : ''}`,
              },
              !!a.cancelReason && { label: 'Cancelled because', value: a.cancelReason },
            ]}
          />
        </Segment>
      ),
    },
    {
      key: 'participants',
      label: 'Participants',
      count: a.participants.length,
      content: (
        <Segment title="Participants" level={level} flush>
          <RecordTable
            rows={a.participants}
            rowKey={(p) => p.id}
            empty="No participants recorded."
            columns={[
              {
                key: 'name',
                header: 'Name',
                render: (p) => p.name,
              },
              { key: 'role', header: 'Role', render: (p) => humanise(p.role) },
            ]}
          />
        </Segment>
      ),
    },
    history,
  ];
}

function ChangeHistory({ a, level }: { a: Detail; level: 2 | 3 }) {
  return (
    <Segment title="Change history" level={level} flush>
      <RecordTable
        rows={a.changes}
        rowKey={(c) => c.id}
        empty="No changes since it was booked."
        columns={[
          { key: 'at', header: 'When', render: (c) => fmtDateTime(c.at) },
          { key: 'field', header: 'Change', render: (c) => humanise(c.field) },
          {
            key: 'value',
            header: 'From → to',
            render: (c) =>
              c.field.endsWith('_at')
                ? `${fmtDateTime(c.previousValue)} → ${fmtDateTime(c.newValue)}`
                : `${humanise(c.previousValue)} → ${humanise(c.newValue)}`,
          },
          { key: 'reason', header: 'Reason', render: (c) => c.reason ?? 'None given' },
          { key: 'actor', header: 'By', render: (c) => c.actorName ?? 'System' },
        ]}
      />
    </Segment>
  );
}

/** One change flow in its own FormModal; null when the move is not allowed now. */
export function AppointmentActModal({
  act,
  a,
  user,
  closeHref,
}: {
  act: AppointmentAct;
  a: Detail;
  user: AuthenticatedUser;
  closeHref: string;
}) {
  const x = ACTIONS[act];
  if (!can(user, 'ops:appointments:manage') || !canMoveAppointment(a.status, x.to)) return null;
  return (
    <FormModal
      id={`appointment-${act}`}
      title={`${x.label}: ${a.personName}`}
      meta={`${APPOINTMENT_TYPE_LABELS[a.type]}, ${fmtDateTime(a.startsAt)} with ${a.staffName}`}
      closeHref={closeHref}
    >
      <ActionForm
        action={`/ops/api/v1/appointments/${a.id}`}
        method="PATCH"
        submitLabel={x.label}
        fields={x.fields}
        extra={{ action: act }}
        variant={x.variant}
        // Router path: Next adds the /ops basePath itself (D-022).
        redirectTo={closeHref.replace(/^\/ops/, '')}
        secondary={<a href={closeHref}>Back</a>}
      />
    </FormModal>
  );
}
