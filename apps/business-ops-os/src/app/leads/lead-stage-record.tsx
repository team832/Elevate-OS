/**
 * Lead stage on the lead record (owner brief 23 Oct 2026 §11): current stage, Do not contact,
 * the confirmed admission (read-only, from Ops) and stage history; plus the call fields of the
 * "Log contact" flow. Used by ./lead-record.tsx.
 */
import type { ReactNode } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, StatusBadge } from '@elevate/shared-ui';
import { ADMISSION_STATUS_LABELS } from '../../domain';
import type { getLead } from '../../server/leads';
import type { FieldSpec } from '../../ui/action-form';
import { fmtDate, fmtDateTime, humanise } from '../../ui/format';
import { options } from '../../ui/list-controls';
import { RecordTable } from '../../ui/record-table';
import { DetailTable, Segment } from '../../ui/sections';

type LeadDetail = Awaited<ReturnType<typeof getLead>>;

export const NO_STAGES =
  'Lead stages are not set up yet. Leads keep working as before; a manager can add the stages under Lead stages.';
export const CALL_NOTE = 'Calls are made from your phone; this log is what you record.';

export const stageLabel = (stages: { key: string; label: string }[], key: string | null) =>
  key ? (stages.find((s) => s.key === key)?.label ?? humanise(key)) : 'Not staged';

/** Converted, but no admission still counts: Ops cancelled it before enrolment. */
const cancelledAfterConversion = (d: LeadDetail) =>
  d.lead.stageKey === 'converted' &&
  d.converted.length > 0 &&
  d.converted.every((a) => a.conversion === 'cancelled');

const CONVERSION_NOTE: Record<string, ReactNode> = {
  ended: <StatusBadge tone="warning">Admission later withdrawn</StatusBadge>,
  cancelled: <StatusBadge tone="danger">Cancelled before enrolment (not a conversion)</StatusBadge>,
};

/** Stage and Do-not-contact pills for the record header. */
export const StageMeta = ({ d }: { d: LeadDetail }) => (
  <>
    {cancelledAfterConversion(d) ? (
      <StatusBadge tone="danger">Admission cancelled after conversion</StatusBadge>
    ) : null}{' '}
    {d.lead.stageKey ? (
      <StatusBadge tone="info">{stageLabel(d.stages, d.lead.stageKey)}</StatusBadge>
    ) : null}{' '}
    {d.lead.doNotContact ? <StatusBadge tone="danger">Do not contact</StatusBadge> : null}
  </>
);

export function StageSegment({
  d,
  user,
  level,
  base,
  changeHref,
}: {
  d: LeadDetail;
  user: AuthenticatedUser;
  level: 2 | 3;
  base: string;
  changeHref: string;
}) {
  const cases = can(user, 'ops:admissions:read') && base === '/ops';
  const write = can(user, 'ops:leads:write') && !d.lead.mergedIntoLeadId && d.stages.length > 0;
  return (
    <Segment
      title="Lead stage"
      level={level}
      flush
      description="The marketing stage of this lead. It is separate from the admission status, which Business Operations keeps."
      actions={write ? <a href={changeHref}>Change stage</a> : undefined}
    >
      {d.lead.doNotContact ? (
        <Alert tone="warning" title="Do not contact">
          Calls and messages to this lead cannot be logged. Log an inbound call if they contact you.
        </Alert>
      ) : null}
      <DetailTable
        rows={[
          {
            label: 'Stage',
            value: d.stages.length ? stageLabel(d.stages, d.lead.stageKey) : NO_STAGES,
          },
          d.lead.stageChangedAt && { label: 'Since', value: fmtDateTime(d.lead.stageChangedAt) },
          {
            label: 'Admission',
            value: d.converted.length
              ? d.converted.map((a) => {
                  const text = `Admission ${a.admissionNumber} · ${ADMISSION_STATUS_LABELS[a.status]}`;
                  return (
                    <div key={a.admissionNumber}>
                      {cases && a.id ? <a href={`/ops/admissions/${a.id}`}>{text}</a> : text}{' '}
                      {CONVERSION_NOTE[a.conversion]}
                    </div>
                  );
                })
              : 'No confirmed admission yet (Converted needs one)',
          },
        ]}
      />
      <RecordTable
        caption="Stage history"
        rows={d.stageChanges}
        rowKey={(h) => h.id}
        empty="No stage changes yet."
        columns={[
          { key: 'changedAt', header: 'When', render: (h) => fmtDateTime(h.changedAt) },
          {
            key: 'move',
            header: 'Change',
            render: (h) =>
              `${h.fromKey ? `${stageLabel(d.stages, h.fromKey)} → ` : ''}${stageLabel(d.stages, h.toKey)}`,
          },
          { key: 'reason', header: 'Reason', render: (h) => h.reason ?? 'None given' },
          {
            key: 'lead',
            header: 'Lead',
            render: (h) => (h.leadId === d.lead.id ? 'This lead' : 'Merged-in lead'),
          },
        ]}
      />
    </Segment>
  );
}

/** "Change stage" form fields: active stages other than the current one. */
export const stageFields = (d: LeadDetail): FieldSpec[] => [
  {
    name: 'stageKey',
    label: 'New stage',
    type: 'select',
    required: true,
    options: d.stages
      .filter((s) => s.active && s.key !== d.lead.stageKey)
      .map((s) => ({
        value: s.key,
        label: `${s.label}${s.requiresReason ? ' (reason needed)' : ''}`,
      })),
    hint: 'Converted is accepted only once Business Operations has confirmed the admission.',
    section: 'Stage',
  },
  { name: 'reason', label: 'Reason', type: 'textarea', section: 'Stage' },
];

/** Extra fields of "Log contact" for calls; staff type them in. */
export const CALL_FIELDS: FieldSpec[] = [
  {
    name: 'direction',
    label: 'Direction',
    type: 'select',
    options: options(['outbound', 'inbound']),
    hint: 'Outbound: you called them. Inbound: they called you.',
    section: 'Call details',
  },
  {
    name: 'durationMinutes',
    label: 'Duration in minutes (calls only)',
    type: 'number',
    hint: 'As you noted it. Leave empty if you did not time it.',
    section: 'Call details',
  },
  { name: 'nextAction', label: 'Next action', section: 'Next step' },
  {
    name: 'nextFollowUpOn',
    label: 'Next follow-up date',
    type: 'date',
    hint: 'Creates or moves your follow-up on this lead.',
    section: 'Next step',
  },
];

/** Columns the call log adds to a contact table. */
export const callColumns = <
  T extends {
    direction: string | null;
    durationSeconds: number | null;
    nextAction: string | null;
    nextFollowUpOn: string | null;
  },
>() => [
  {
    key: 'direction',
    header: 'Direction',
    render: (a: T) => (a.direction ? humanise(a.direction) : 'Not recorded'),
  },
  {
    key: 'duration',
    header: 'Duration',
    render: (a: T) =>
      a.durationSeconds === null ? 'Not recorded' : `${Math.round(a.durationSeconds / 60)} min`,
  },
  { key: 'nextAction', header: 'Next action', render: (a: T) => a.nextAction ?? 'None' },
  {
    key: 'nextFollowUpOn',
    header: 'Next follow-up',
    render: (a: T) => (a.nextFollowUpOn ? fmtDate(a.nextFollowUpOn) : 'None'),
  },
];
