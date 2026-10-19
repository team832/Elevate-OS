import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { ADMISSION_STATUS_LABELS, type AdmissionStatus } from '../../domain';
import { listDuplicateQueue, listLeads } from '../../server/leads';
import { formOptions } from '../../server/options';
import { fmtDateTime, statusTone } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';
import { LeadCreateForm } from '../../ui/lead-create-form';

export const dynamic = 'force-dynamic';

const FLAGS = [
  'unassigned',
  'handoff_pending',
  'overdue',
  'missing_next_action',
  'duplicate',
] as const;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:leads:read', '/ops/leads');
  const sp = await searchParams;
  const flag = FLAGS.find((f) => f === sp.flag);
  return (
    <Frame access={access} active="leads">
      <PageHeader
        title="Leads"
        description="Enquiries and the people behind them. Contacts are normalised; duplicates are flagged for review and never merged automatically."
      />
      <nav className="el-subnav" aria-label="Lead filters">
        <a href="/ops/leads" aria-current={!flag ? 'page' : undefined}>
          All
        </a>
        {FLAGS.map((f) => (
          <a key={f} href={`/ops/leads?flag=${f}`} aria-current={flag === f ? 'page' : undefined}>
            {f.replace(/_/g, ' ')}
          </a>
        ))}
      </nav>
      <Section>
        <LeadList user={access.user} q={sp.q} flag={flag} />
      </Section>
      {can(access.user, 'ops:leads:merge') ? (
        <Section label="Loading merge-review queue…">
          <DuplicateQueue user={access.user} />
        </Section>
      ) : null}
      {can(access.user, 'ops:leads:write') ? (
        <Section label="Loading form…">
          <NewLead />
        </Section>
      ) : null}
    </Frame>
  );
}

async function LeadList({ user, q, flag }: { user: AuthenticatedUser; q?: string; flag?: string }) {
  const r = await load((db) => listLeads(db, user, { q, flag }));
  if (!r.ok) return r.view;
  return (
    <DataTable
      caption={`${r.data.length} lead(s)`}
      rows={r.data}
      rowKey={(l) => l.id}
      empty={
        <EmptyState title="No leads here" description="Create one below, or change the filter." />
      }
      columns={[
        { key: 'code', header: 'Lead', render: (l) => <a href={`/ops/leads/${l.id}`}>{l.code}</a> },
        { key: 'studentName', header: 'Student' },
        { key: 'programmeCode', header: 'Interest', render: (l) => l.programmeCode ?? 'Undecided' },
        {
          key: 'status',
          header: 'Stage',
          render: (l) =>
            l.status ? (
              <StatusBadge tone={statusTone(l.status)}>
                {ADMISSION_STATUS_LABELS[l.status as AdmissionStatus]}
              </StatusBadge>
            ) : (
              '—'
            ),
        },
        {
          key: 'owner',
          header: 'Owner',
          render: (l) =>
            l.ownerName ? (
              `${l.ownerName}${l.assignment === 'handoff_pending' ? ' (not accepted)' : ''}`
            ) : (
              <StatusBadge tone="warning">Unassigned</StatusBadge>
            ),
        },
        {
          key: 'flags',
          header: 'Flags',
          render: (l) => (
            <>
              {l.flags.overdue ? <StatusBadge tone="danger">Overdue follow-up</StatusBadge> : null}
              {l.flags.missingNextAction ? (
                <StatusBadge tone="warning">No next action</StatusBadge>
              ) : null}
              {l.flags.openDuplicates ? (
                <StatusBadge tone="warning">
                  {l.flags.exactDuplicate ? 'Existing contact' : 'Possible duplicate'}
                </StatusBadge>
              ) : null}
            </>
          ),
        },
        { key: 'receivedAt', header: 'Received', render: (l) => fmtDateTime(l.receivedAt) },
      ]}
    />
  );
}

async function DuplicateQueue({ user }: { user: AuthenticatedUser }) {
  const r = await load((db) => listDuplicateQueue(db, user));
  if (!r.ok) return r.view;
  return (
    <Card
      title="Merge review"
      description="Open duplicate warnings. Open the lead to merge (audited) or dismiss."
    >
      <DataTable
        rows={r.data}
        rowKey={(f) => f.id}
        empty={<EmptyState title="No open duplicate warnings" />}
        columns={[
          {
            key: 'lead',
            header: 'New lead',
            render: (f) => (
              <a href={`/ops/leads/${f.leadId}`}>
                {f.leadCode} — {f.leadName}
              </a>
            ),
          },
          {
            key: 'matched',
            header: 'Matches',
            render: (f) => (
              <a href={`/ops/leads/${f.matchedLeadId}`}>
                {f.matchedCode} — {f.matchedName}
              </a>
            ),
          },
          {
            key: 'level',
            header: 'Level',
            render: (f) => (
              <StatusBadge tone={f.level === 'exact' ? 'danger' : 'warning'}>{f.level}</StatusBadge>
            ),
          },
          {
            key: 'signals',
            header: 'Signals',
            render: (f) => f.signals.join(', ').replace(/_/g, ' '),
          },
          { key: 'ack', header: 'Creator’s note', render: (f) => f.acknowledgement ?? '—' },
        ]}
      />
    </Card>
  );
}

async function NewLead() {
  const r = await load((db) => formOptions(db));
  if (!r.ok) return r.view;
  return (
    <Card
      title="New lead"
      description="Student name and at least one phone or email. Indian numbers are normalised to +91."
    >
      <LeadCreateForm
        fields={[
          { name: 'studentName', label: 'Student name', required: true },
          {
            name: 'studentPhone',
            label: 'Student phone',
            type: 'tel',
            hint: 'e.g. 98765 43210 or +91 98765 43210',
          },
          { name: 'studentEmail', label: 'Student email', type: 'email' },
          { name: 'guardianName', label: 'Parent / guardian name' },
          {
            name: 'guardianRelationship',
            label: 'Relationship',
            type: 'select',
            options: ['mother', 'father', 'guardian', 'other'].map((v) => ({ value: v, label: v })),
          },
          { name: 'guardianPhone', label: 'Parent phone', type: 'tel' },
          { name: 'guardianEmail', label: 'Parent email', type: 'email' },
          { name: 'previousSchool', label: 'School' },
          {
            name: 'currentStage',
            label: 'Class / stage',
            type: 'select',
            options: [
              'class_9',
              'class_10',
              'class_11',
              'class_12',
              'gap_year',
              'graduate',
              'other',
            ].map((v) => ({ value: v, label: v.replace('_', ' ') })),
          },
          {
            name: 'programmeCode',
            label: 'Programme of interest',
            type: 'select',
            options: r.data.programmes,
          },
          {
            name: 'interestMode',
            label: 'Mode',
            type: 'select',
            required: true,
            defaultValue: 'undecided',
            options: ['offline', 'online', 'undecided'].map((v) => ({ value: v, label: v })),
          },
          {
            name: 'sourceCode',
            label: 'First enquiry source',
            type: 'select',
            required: true,
            defaultValue: 'UNKNOWN',
            options: r.data.sources,
            hint: 'Unknown stays Unknown (BR-OPS-5).',
          },
          { name: 'channel', label: 'Account / channel' },
          { name: 'campaignRef', label: 'Campaign or activity ID (if identifiable)' },
          {
            name: 'ownerStaffId',
            label: 'Owner (managers only; counsellors own what they create)',
            type: 'select',
            options: r.data.staff,
          },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ]}
      />
    </Card>
  );
}
