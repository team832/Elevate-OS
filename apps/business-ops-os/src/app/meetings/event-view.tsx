/**
 * Event and webinar pieces (brief §12): the record tabs (details, participants with how each
 * was added, messages with their honest status) and the event flows, each its own FormModal
 * (`act=<key>`; never a modal on a modal). Scheduling sends nothing: a message is previewed
 * first and sent only by "Send", which without a provider is recorded as simulated.
 */
import type { ReactNode } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { StatusBadge } from '@elevate/shared-ui';
import { MESSAGE_CHANNELS } from '../../domain/appointments';
import { CLASS_CATEGORY_LABELS, CLASS_CATEGORY_OPTIONS } from '../../domain/demos';
import { EVENT_POPULATIONS } from '../../domain/policies';
import { getMessagingAdapter } from '../../server/adapters/messaging';
import type { getAppointment } from '../../server/appointments';
import { ActionForm, type FieldSpec } from '../../ui/action-form';
import { fmtDateTime, humanise } from '../../ui/format';
import { FormModal, type ModalTab } from '../../ui/record-modal';
import { RecordTable } from '../../ui/record-table';
import { DetailTable, Segment } from '../../ui/sections';

type Detail = Awaited<ReturnType<typeof getAppointment>>;
type Option = { value: string; label: string };

export const EVENT_ACTS = ['edit', 'add', 'participant', 'remove', 'message', 'send'] as const;
export type EventAct = (typeof EVENT_ACTS)[number];

const POPULATION_OPTIONS = EVENT_POPULATIONS.map((p) => ({
  value: p,
  label: { lead: 'Leads', demo: 'Demo students', active: 'Active students', past: 'Past students' }[
    p
  ],
}));

const MESSAGE_STATUS: Record<string, string> = {
  draft: 'Draft — not sent',
  simulated: 'Simulated — not sent (no messaging provider connected)',
  sent: 'Sent through the provider',
};

export const MessageBadge = ({ status }: { status: string }) => (
  <StatusBadge
    tone={status === 'sent' ? 'success' : status === 'simulated' ? 'warning' : 'neutral'}
  >
    {MESSAGE_STATUS[status]}
  </StatusBadge>
);

/** Audience filter fields (one value each from the form; the API takes lists). */
export function audienceFields(programmes: readonly Option[], section: string): FieldSpec[] {
  return [
    {
      name: 'audience.populations',
      label: 'Who',
      type: 'select',
      options: POPULATION_OPTIONS,
      hint: 'Empty: everyone allowed by setting “Event and webinar audience”, when another filter is set.',
      section,
    },
    {
      name: 'audience.programmeCodes',
      label: 'Programme',
      type: 'select',
      options: programmes,
      section,
    },
    {
      name: 'audience.stages',
      label: 'Class / category',
      type: 'select',
      options: CLASS_CATEGORY_OPTIONS,
      section,
    },
  ];
}

function audienceText(a: Detail['audience']) {
  const parts = Object.entries(a ?? {})
    .filter(([, v]) => Array.isArray(v) && v.length)
    .map(
      ([k, v]) =>
        `${humanise(k)}: ${(v as string[]).map((x) => CLASS_CATEGORY_LABELS[x] ?? humanise(x)).join(', ')}`,
    );
  return parts.length ? parts.join(' · ') : 'No filter (participants added by name)';
}

const activeParticipants = (a: Detail) =>
  a.participants.filter((p) => p.kind !== 'staff' && !p.removedAt);

export function eventTabs(
  a: Detail,
  user: AuthenticatedUser,
  actHref: (act: EventAct) => string,
  level: 2 | 3,
  /** Status change links (confirm, reschedule, cancel, record outcome). */
  statusActions: ReactNode,
): ModalTab[] {
  const manage = can(user, 'ops:appointments:manage');
  const links = (acts: [EventAct, string][]) =>
    manage ? (
      <span className="el-inline-form">
        {acts.map(([act, label]) => (
          <a key={act} href={actHref(act)}>
            {label}
          </a>
        ))}
      </span>
    ) : null;
  const people = a.participants.filter((p) => p.kind !== 'staff');
  return [
    {
      key: 'event',
      label: 'Event',
      content: (
        <Segment
          title="Event"
          level={level}
          flush
          actions={
            <>
              {statusActions} {links([['edit', 'Edit details']])}
            </>
          }
        >
          <DetailTable
            rows={[
              { label: 'Title', value: a.title ?? 'Not recorded' },
              { label: 'Owner', value: a.staffName },
              {
                label: 'When',
                value: `${fmtDateTime(a.startsAt)} to ${fmtDateTime(a.endsAt)} (${a.timezone})`,
              },
              {
                label: 'Where',
                value:
                  a.mode === 'online'
                    ? (a.onlineLink ?? 'Online, link not added yet')
                    : (a.location ?? 'Sikar centre'),
              },
              { label: 'Capacity', value: a.capacity ?? 'No limit' },
              { label: 'Audience filter', value: audienceText(a.audience) },
              { label: 'Audience', value: `${activeParticipants(a).length} people listed` },
              {
                label: 'Latest message',
                value: a.messages.length ? (
                  <MessageBadge status={a.messages[a.messages.length - 1]!.status} />
                ) : (
                  'None written; nothing has been sent'
                ),
              },
              { label: 'Notes', value: a.purpose ?? 'None' },
            ]}
          />
        </Segment>
      ),
    },
    {
      key: 'people',
      label: 'Participants',
      count: activeParticipants(a).length,
      content: (
        <Segment
          title="Participants"
          level={level}
          flush
          description="Listed when the event was scheduled (from the audience) or added by hand later. Changing the filter never changes this list; removed people stay listed."
          actions={links([
            ['add', 'Add a student'],
            ['participant', 'Record registration or attendance'],
            ['remove', 'Remove someone'],
          ])}
        >
          <RecordTable
            rows={people}
            rowKey={(p) => p.id}
            empty="No participants. Add a student by name."
            columns={[
              { key: 'name', header: 'Name', render: (p) => p.name },
              { key: 'role', header: 'As', render: (p) => humanise(p.role ?? p.kind) },
              {
                key: 'via',
                header: 'Added',
                render: (p) =>
                  `${p.addedVia === 'audience_snapshot' ? 'From audience' : 'By hand'}, ${fmtDateTime(p.addedAt)}`,
              },
              {
                key: 'reg',
                header: 'Registration',
                render: (p) =>
                  p.removedAt
                    ? `Removed ${fmtDateTime(p.removedAt)}: ${p.removedReason}`
                    : humanise(p.registrationStatus ?? 'Not recorded'),
              },
              { key: 'att', header: 'Attendance', render: (p) => humanise(p.attendance) },
            ]}
          />
        </Segment>
      ),
    },
    {
      key: 'messages',
      label: 'Messages',
      count: a.messages.length,
      content: (
        <Segment
          title="Messages"
          level={level}
          flush
          description="Nothing is sent when an event is scheduled. Write a message, preview who it can reach, then send."
          actions={links([['message', 'Preview message']])}
        >
          <RecordTable
            rows={a.messages}
            rowKey={(m) => m.id}
            empty="No messages written."
            columns={[
              { key: 'at', header: 'Written', render: (m) => fmtDateTime(m.createdAt) },
              { key: 'channel', header: 'Channel', render: (m) => humanise(m.channel) },
              {
                key: 'status',
                header: 'Status',
                render: (m) => <MessageBadge status={m.status} />,
              },
              {
                key: 'count',
                header: 'Could reach',
                render: (m) => m.recipientCount ?? 'Not counted',
              },
              { key: 'body', header: 'Message', render: (m) => m.body },
            ]}
          />
        </Segment>
      ),
    },
  ];
}

/** One event flow in its own FormModal; null when not allowed. */
export function EventActModal({
  act,
  a,
  user,
  closeHref,
  sendHref,
  messageId,
  students,
  programmes,
}: {
  act: EventAct;
  a: Detail;
  user: AuthenticatedUser;
  closeHref: string;
  /** Where the preview goes next (`{id}` = the new message id). */
  sendHref: string;
  messageId?: string;
  students: readonly Option[];
  programmes: readonly Option[];
}) {
  if (!can(user, 'ops:appointments:manage')) return null;
  const base = `/ops/api/v1/appointments/${a.id}`;
  const back = closeHref.replace(/^\/ops/, ''); // router path: Next adds the basePath (D-022)
  const people = activeParticipants(a).map((p) => ({ value: p.id, label: p.name }));
  const form = (
    title: string,
    props: Omit<Parameters<typeof ActionForm>[0], 'secondary' | 'redirectTo'> & {
      redirectTo?: string;
    },
  ) => (
    <FormModal id={`event-${act}`} title={`${title}: ${a.title}`} closeHref={closeHref}>
      <ActionForm redirectTo={back} secondary={<a href={closeHref}>Back</a>} {...props} />
    </FormModal>
  );
  const draft = a.messages.find((m) => m.id === messageId && m.status === 'draft');
  switch (act) {
    case 'edit':
      return form('Edit', {
        action: base,
        method: 'PATCH',
        submitLabel: 'Save details',
        extra: { action: 'edit' },
        fields: [
          { name: 'title', label: 'Title', defaultValue: a.title ?? '', section: 'Event' },
          {
            name: 'onlineLink',
            label: 'Online link',
            defaultValue: a.onlineLink ?? '',
            section: 'Event',
          },
          {
            name: 'location',
            label: 'Room or place',
            defaultValue: a.location ?? '',
            section: 'Event',
          },
          { name: 'capacity', label: 'Capacity', type: 'number', section: 'Event' },
          {
            name: 'purpose',
            label: 'Notes',
            type: 'textarea',
            defaultValue: a.purpose ?? '',
            section: 'Event',
          },
          ...audienceFields(
            programmes,
            'Audience filter (stored only; the participant list is not changed)',
          ),
        ],
      });
    case 'add':
      return form('Add a student', {
        action: `${base}/participants`,
        submitLabel: 'Add student',
        fields: [
          {
            name: 'studentId',
            label: 'Student',
            type: 'select',
            required: true,
            options: students,
          },
        ],
      });
    case 'participant':
      return form('Registration and attendance', {
        action: `${base}/participants`,
        method: 'PATCH',
        submitLabel: 'Save',
        extra: { action: 'update' },
        fields: [
          {
            name: 'participantId',
            label: 'Participant',
            type: 'select',
            required: true,
            options: people,
          },
          {
            name: 'registrationStatus',
            label: 'Registration',
            type: 'select',
            options: ['invited', 'registered', 'declined'].map((v) => ({
              value: v,
              label: humanise(v),
            })),
          },
          {
            name: 'attendance',
            label: 'Attendance',
            type: 'select',
            hint: 'Only once the event has started.',
            options: ['present', 'absent', 'not_recorded'].map((v) => ({
              value: v,
              label: humanise(v),
            })),
          },
        ],
      });
    case 'remove':
      return form('Remove a participant', {
        action: `${base}/participants`,
        method: 'PATCH',
        submitLabel: 'Remove',
        variant: 'danger',
        extra: { action: 'remove' },
        fields: [
          {
            name: 'participantId',
            label: 'Participant',
            type: 'select',
            required: true,
            options: people,
          },
          { name: 'reason', label: 'Reason', type: 'textarea', required: true },
        ],
      });
    case 'message':
      return form('Preview message', {
        action: `${base}/messages`,
        submitLabel: 'Preview',
        redirectTo: sendHref,
        fields: [
          {
            name: 'channel',
            label: 'Channel',
            type: 'select',
            required: true,
            options: MESSAGE_CHANNELS.map((c) => ({ value: c, label: humanise(c) })),
          },
          {
            name: 'body',
            label: 'Message',
            type: 'textarea',
            required: true,
            hint: 'Nothing is sent at this step.',
          },
        ],
      });
    case 'send':
      if (!draft) return null;
      return (
        <FormModal id="event-send" title={`Send message: ${a.title}`} closeHref={closeHref}>
          <Segment title="Preview" level={3} flush>
            <DetailTable
              rows={[
                { label: 'Channel', value: humanise(draft.channel) },
                {
                  label: 'Can reach',
                  value: `${draft.recipientCount ?? 0} contact(s) with consent on record`,
                },
                { label: 'Message', value: draft.body },
              ]}
            />
          </Segment>
          {getMessagingAdapter().connected ? null : (
            <p role="note">
              No messaging provider is connected. Sending records the message as “Simulated — not
              sent”; nobody receives it.
            </p>
          )}
          {can(user, 'ops:event_messages:send') ? (
            <ActionForm
              action={`${base}/messages/${draft.id}`}
              submitLabel="Send"
              redirectTo={back}
              secondary={<a href={closeHref}>Keep as draft</a>}
            />
          ) : (
            <p>Sending needs the permission ops:event_messages:send (operations manager).</p>
          )}
        </FormModal>
      );
  }
}
