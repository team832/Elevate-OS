/** Activity tab: checklist (append-only, latest wins), follow-ups, counselling and the audit trail. */
import { can } from '@elevate/authorization';
import type { DemoRecord } from '../../../server/demos';
import { ActionForm } from '../../../ui/action-form';
import { fmtDate, fmtDateTime, humanise } from '../../../ui/format';
import { RecordTable } from '../../../ui/record-table';
import { Segment } from '../../../ui/sections';
import { Badge, reasonField } from './demo-bits';
import { nameOf, type DemoTabProps } from './demo-record';

type Item = DemoRecord['checklist']['items'][number];

const ACTION_TEXT: Record<string, string> = {
  'demo.booked': 'Demo booked',
  'demo.record_fee': 'Demo fee status recorded (retired checkbox)',
  'demo.outcome_set': 'Demo closed',
  'demo.kyc_updated': 'KYC updated',
  'demo.checklist_set': 'Checklist item updated',
  'demo_session.added': 'Class added',
  'demo_session.attendance': 'Attendance recorded',
  'demo_session.reschedule': 'Class rescheduled',
  'demo_session.cancel': 'Class cancelled',
  'demo_session.mock': 'Mock status updated',
  'demo_session.assign': 'Teacher or subject changed',
};

/** Where the checklist items come from, shown above the checklist (owner question, 21 Oct 2026). */
const CHECKLIST_BASIS =
  'Based on the owner’s admission brief §6 (fee and admission checklist): classes recorded, mock prepared and linked, programme and batch, fee structure, instalment terms, admission process, student and guardian feedback, next action, and the conversion decision. The first three follow the class records.';

export function ChecklistTable({ d, items }: { d: DemoRecord; items: readonly Item[] }) {
  return (
    <RecordTable
      rows={items}
      rowKey={(i) => i.key}
      columns={[
        { key: 'item', header: 'Item', render: (i) => i.label },
        {
          key: 'status',
          header: 'Status',
          render: (i) => (i.recorded ? <Badge value={i.status} /> : 'Not recorded'),
        },
        {
          key: 'by',
          header: 'Last updated',
          render: (i) =>
            i.derived
              ? 'From the class records'
              : i.entry
                ? `${nameOf(d, i.entry.actorUserId)}, ${fmtDateTime(i.entry.at)}`
                : 'Not recorded',
        },
        { key: 'reason', header: 'Reason or note', render: (i) => i.entry?.reason ?? '—' },
      ]}
    />
  );
}

/** Append a checklist entry for one of `items` (derived items are never offered). */
export const ChecklistForm = ({ d, items }: { d: DemoRecord; items: readonly Item[] }) => (
  <ActionForm
    compact
    action={`/ops/api/v1/demos/${d.demo.id}/checklist`}
    submitLabel="Save checklist item"
    variant="secondary"
    fields={[
      {
        name: 'itemKey',
        label: 'Item',
        type: 'select',
        required: true,
        options: items.filter((i) => !i.derived).map((i) => ({ value: i.key, label: i.label })),
      },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        required: true,
        options: [
          { value: 'complete', label: 'Complete' },
          { value: 'pending', label: 'Pending' },
          { value: 'waived', label: 'Waived (reason required)' },
          { value: 'not_applicable', label: 'Not applicable' },
        ],
      },
      reasonField('Reason or note (required to waive)'),
    ]}
  />
);

export function DemoActivity({ d, user, level }: DemoTabProps) {
  const write = can(user, 'ops:leads:write');
  return (
    <>
      <Segment
        title="Fee and admission checklist"
        level={level}
        flush
        meta={<span className="el-field-hint">{d.checklist.label}</span>}
        description={
          <>
            {CHECKLIST_BASIS} Discussing fees is not a payment record. Required before admission:{' '}
            {d.checklistRequired.value.requiredBeforeConversion ? 'yes' : 'no'} (
            {d.checklistRequired.decisionState} setting). {d.checklistHistory.length} entr
            {d.checklistHistory.length === 1 ? 'y' : 'ies'} kept; the latest per item is shown.
          </>
        }
      >
        <ChecklistTable d={d} items={d.checklist.items} />
      </Segment>
      {write ? (
        <Segment title="Update a checklist item" level={level}>
          <ChecklistForm d={d} items={d.checklist.items} />
        </Segment>
      ) : null}
      <Segment title="Follow-ups" level={level} flush>
        <RecordTable
          rows={d.followUps}
          rowKey={(f) => f.id}
          empty="No follow-ups on this case."
          columns={[
            { key: 'title', header: 'Follow-up', render: (f) => f.title },
            { key: 'due', header: 'Due', render: (f) => fmtDate(f.dueDate) },
            { key: 'status', header: 'Status', render: (f) => <Badge value={f.status} /> },
            { key: 'outcome', header: 'Outcome', render: (f) => f.outcome ?? '—' },
          ]}
        />
      </Segment>
      <Segment title="Counselling" level={level} flush>
        <RecordTable
          rows={d.counselling}
          rowKey={(c) => c.id}
          empty="No counselling sessions on this case."
          columns={[
            { key: 'when', header: 'When', render: (c) => fmtDateTime(c.startsAt) },
            { key: 'who', header: 'Counsellor', render: (c) => c.counsellorName ?? 'Not assigned' },
            { key: 'status', header: 'Status', render: (c) => <Badge value={c.status} /> },
            { key: 'outcome', header: 'Outcome', render: (c) => c.outcome ?? '—' },
          ]}
        />
      </Segment>
      <Segment title="Audit trail" level={level} flush description="Latest 50 entries.">
        <RecordTable
          rows={d.activity}
          rowKey={(a) => a.id}
          empty="No activity recorded."
          columns={[
            { key: 'at', header: 'When', render: (a) => fmtDateTime(a.at) },
            { key: 'by', header: 'Who', render: (a) => nameOf(d, a.actorUserId) },
            {
              key: 'what',
              header: 'What',
              render: (a) => ACTION_TEXT[a.action] ?? humanise(a.action),
            },
          ]}
        />
      </Segment>
    </>
  );
}
