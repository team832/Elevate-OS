import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import {
  ADMISSION_STATUS_LABELS,
  FOLLOW_UP_KIND_LABELS,
  type AdmissionStatus,
  type FollowUpKind,
} from '../../../domain';
import { getLead } from '../../../server/leads';
import { formOptions } from '../../../server/options';
import { ActionForm } from '../../../ui/action-form';
import { fmtDate, fmtDateTime, humanise, statusTone } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';

export const dynamic = 'force-dynamic';

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:leads:read', `/ops/leads/${id}`);
  return (
    <Frame access={access} active="leads">
      <Section>
        <LeadDetail user={access.user} id={id} />
      </Section>
    </Frame>
  );
}

async function LeadDetail({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load(async (db) => ({
    d: await getLead(db, user, id),
    options: await formOptions(db),
  }));
  if (!r.ok) return r.view;
  const { d, options } = r.data;
  const { lead } = d;
  const write = can(user, 'ops:leads:write');
  const api = `/ops/api/v1/leads/${lead.id}`;
  return (
    <div className="el-stack">
      <PageHeader
        title={`${lead.code} — ${lead.studentName}`}
        description={`Programme interest: ${d.programme?.code ?? 'undecided'} · mode ${lead.interestMode} · received ${fmtDateTime(lead.firstReceivedAt)}`}
      />
      {lead.mergedIntoLeadId ? (
        <Alert tone="info" title="Merged">
          This lead was merged into <a href={`/ops/leads/${lead.mergedIntoLeadId}`}>another lead</a>
          . Its history is kept.
        </Alert>
      ) : null}
      {d.duplicates
        .filter((x) => x.status === 'open')
        .map((x) => (
          <Alert
            key={x.id}
            tone="warning"
            title={x.level === 'exact' ? 'Existing contact' : 'Possible duplicate'}
          >
            Matches{' '}
            {x.otherAccessible ? (
              <a href={`/ops/leads/${x.otherLeadId}`}>{x.otherCode}</a>
            ) : (
              x.otherCode
            )}{' '}
            on {x.signals.join(', ').replace(/_/g, ' ')}. Nothing was merged.
            {can(user, 'ops:leads:merge') ? (
              <div className="el-grid">
                <ActionForm
                  action={`/ops/api/v1/leads/${x.leadId}/merge`}
                  submitLabel={`Merge ${x.leadId === lead.id ? 'this lead' : x.otherCode} into ${x.leadId === lead.id ? x.otherCode : 'this lead'}`}
                  extra={{ targetLeadId: x.matchedLeadId }}
                  fields={[{ name: 'note', label: 'Merge note', required: true }]}
                  variant="danger"
                  redirectTo={`/ops/leads/${x.matchedLeadId}`}
                />
                <ActionForm
                  action={`/ops/api/v1/leads/duplicates/${x.id}`}
                  submitLabel="Not a duplicate — dismiss"
                  extra={{ decision: 'dismissed' }}
                  fields={[{ name: 'note', label: 'Why', required: true }]}
                  variant="secondary"
                />
              </div>
            ) : null}
          </Alert>
        ))}
      <div className="el-grid">
        <Card
          title="Contact"
          description="Visible to admissions and operations roles only (OPS-028)."
        >
          <p>
            Student: {lead.studentPhone ?? '—'} · {lead.studentEmail ?? '—'}
          </p>
          <p>
            Parent/guardian: {lead.guardianName ?? '—'} ({lead.guardianRelationship ?? '—'}) ·{' '}
            {lead.guardianPhone ?? '—'} · {lead.guardianEmail ?? '—'}
          </p>
          <p>
            School: {lead.previousSchool ?? '—'} · Stage: {humanise(lead.currentStage)}
          </p>
          <p>First successful contact: {fmtDateTime(lead.firstSuccessfulContactAt)}</p>
        </Card>
        <Card
          title="Owner"
          description="A lead is handoff-pending until its owner accepts (OPS-004)."
        >
          <p>
            {d.owner?.fullName ?? 'Unassigned'} ·{' '}
            <StatusBadge tone={statusTone(d.assignment)}>{humanise(d.assignment)}</StatusBadge>
          </p>
          {d.assignment === 'handoff_pending' && write ? (
            <ActionForm action={`${api}/accept`} submitLabel="Accept handoff" compact />
          ) : null}
          {can(user, 'ops:leads:assign') ? (
            <ActionForm
              action={`${api}/assign`}
              submitLabel="Assign"
              fields={[
                {
                  name: 'ownerStaffId',
                  label: 'New owner',
                  type: 'select',
                  required: true,
                  options: options.staff,
                },
              ]}
              variant="secondary"
            />
          ) : null}
        </Card>
      </div>
      <Card title="Admission cases" description="One pipeline record per programme.">
        <DataTable
          rows={d.admissions}
          rowKey={(a) => a.id}
          empty={<EmptyState title="No admission case" />}
          columns={[
            {
              key: 'code',
              header: 'Case',
              render: (a) => <a href={`/ops/admissions/${a.id}`}>{a.code}</a>,
            },
            { key: 'programmeCode', header: 'Programme', render: (a) => a.programmeCode ?? '—' },
            {
              key: 'status',
              header: 'Status',
              render: (a) => (
                <StatusBadge tone={statusTone(a.status)}>
                  {ADMISSION_STATUS_LABELS[a.status as AdmissionStatus]}
                </StatusBadge>
              ),
            },
            { key: 'counsellorName', header: 'Counsellor', render: (a) => a.counsellorName ?? '—' },
            { key: 'reason', header: 'Last reason', render: (a) => a.statusReason ?? '—' },
          ]}
        />
      </Card>
      <Card
        title="Follow-ups"
        description="Every follow-up has an owner and an IST due date (BR-OPS-9)."
      >
        <DataTable
          rows={d.followUps}
          rowKey={(f) => f.id}
          empty={
            <EmptyState
              title="No follow-ups"
              description="An open lead without a next action is flagged."
            />
          }
          columns={[
            {
              key: 'kind',
              header: 'Kind',
              render: (f) => FOLLOW_UP_KIND_LABELS[f.kind as FollowUpKind],
            },
            { key: 'title', header: 'Title' },
            { key: 'dueDate', header: 'Due', render: (f) => fmtDate(f.dueDate) },
            { key: 'ownerName', header: 'Owner' },
            {
              key: 'status',
              header: 'Status',
              render: (f) => <StatusBadge tone={statusTone(f.status)}>{f.status}</StatusBadge>,
            },
            {
              key: 'act',
              header: '',
              render: (f) =>
                f.status === 'open' && write ? (
                  <ActionForm
                    action={`/ops/api/v1/follow-ups/${f.id}`}
                    submitLabel="Done"
                    extra={{ action: 'complete' }}
                    fields={[{ name: 'outcome', label: 'Outcome', required: true }]}
                    compact
                  />
                ) : (
                  (f.outcome ?? '')
                ),
            },
          ]}
        />
        {write ? (
          <ActionForm
            action="/ops/api/v1/follow-ups"
            submitLabel="Add follow-up"
            extra={{ leadId: lead.id }}
            fields={[
              { name: 'title', label: 'Next action' },
              { name: 'dueDate', label: 'Due date', type: 'date', required: true },
              { name: 'ownerStaffId', label: 'Owner', type: 'select', options: options.staff },
            ]}
            variant="secondary"
          />
        ) : null}
      </Card>
      <div className="el-grid">
        <Card
          title="Contact attempts"
          description="Only a successful two-way contact counts as contacted (BR-OPS-4)."
        >
          <DataTable
            rows={d.activities}
            rowKey={(a) => a.id}
            empty={<EmptyState title="No contact logged" />}
            columns={[
              { key: 'occurredAt', header: 'When', render: (a) => fmtDateTime(a.occurredAt) },
              { key: 'kind', header: 'How' },
              { key: 'outcome', header: 'Outcome', render: (a) => humanise(a.outcome) },
              { key: 'staffName', header: 'By', render: (a) => a.staffName ?? '—' },
            ]}
          />
          {write ? (
            <ActionForm
              action={`${api}/activities`}
              submitLabel="Log contact"
              fields={[
                {
                  name: 'kind',
                  label: 'Channel',
                  type: 'select',
                  required: true,
                  options: ['call', 'whatsapp', 'sms', 'email', 'visit', 'note'].map((v) => ({
                    value: v,
                    label: v,
                  })),
                },
                {
                  name: 'outcome',
                  label: 'Outcome',
                  type: 'select',
                  required: true,
                  options: [
                    'connected_two_way',
                    'replied',
                    'visited',
                    'no_answer',
                    'busy',
                    'wrong_number',
                    'message_sent',
                    'other',
                  ].map((v) => ({ value: v, label: humanise(v) })),
                },
                { name: 'note', label: 'Note' },
              ]}
              variant="secondary"
            />
          ) : null}
        </Card>
        <Card title="Enquiries" description="Each enquiry keeps its own source (BR-OPS-5).">
          <DataTable
            rows={d.enquiries}
            rowKey={(e) => e.id}
            columns={[
              { key: 'receivedAt', header: 'Received', render: (e) => fmtDateTime(e.receivedAt) },
              { key: 'sourceLabel', header: 'Source' },
              { key: 'programmeCode', header: 'Programme', render: (e) => e.programmeCode ?? '—' },
              {
                key: 'merged',
                header: '',
                render: (e) => (e.mergedFromLeadId ? 'moved by merge' : ''),
              },
            ]}
          />
          {write ? (
            <ActionForm
              action={`${api}/enquiries`}
              submitLabel="Add enquiry"
              fields={[
                {
                  name: 'sourceCode',
                  label: 'Source',
                  type: 'select',
                  required: true,
                  defaultValue: 'UNKNOWN',
                  options: options.sources,
                },
                {
                  name: 'programmeCode',
                  label: 'Programme',
                  type: 'select',
                  options: options.programmes,
                },
                { name: 'notes', label: 'Notes' },
              ]}
              variant="secondary"
            />
          ) : null}
        </Card>
      </div>
      <Card title="History" description="Append-only audit trail of this lead and linked records.">
        <DataTable
          rows={d.history}
          rowKey={(h) => h.id}
          columns={[
            { key: 'at', header: 'When', render: (h) => fmtDateTime(h.at) },
            { key: 'action', header: 'Action' },
            {
              key: 'actorType',
              header: 'Actor',
              render: (h) =>
                h.actorType === 'system' ? 'System (Academic OS reply / job)' : 'User',
            },
            {
              key: 'detail',
              header: 'Detail',
              render: (h) =>
                h.after && typeof h.after === 'object' && 'status' in h.after
                  ? `→ ${String((h.after as { status: string }).status)}`
                  : '',
            },
          ]}
        />
      </Card>
    </div>
  );
}
