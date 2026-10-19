import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import {
  ADMISSION_CHECK_ITEMS,
  ADMISSION_CHECK_LABELS,
  ADMISSION_STATUS_LABELS,
  type AdmissionStatus,
} from '../../../domain';
import { getAdmission } from '../../../server/admissions';
import { formOptions } from '../../../server/options';
import { ActionForm } from '../../../ui/action-form';
import { decisionTone, fmtDate, fmtDateTime, humanise, statusTone } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';

export const dynamic = 'force-dynamic';

export default async function AdmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:admissions:read', `/ops/admissions/${id}`);
  return (
    <Frame access={access} active="admissions">
      <Section>
        <Detail user={access.user} id={id} />
      </Section>
    </Frame>
  );
}

async function Detail({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load(async (db) => ({
    d: await getAdmission(db, user, id),
    options: await formOptions(db),
  }));
  if (!r.ok) return r.view;
  const { d, options } = r.data;
  const a = d.admission;
  const api = `/ops/api/v1/admissions/${a.id}`;
  const write = can(user, 'ops:admissions:write');
  const status = a.status as AdmissionStatus;
  return (
    <div className="el-stack">
      <PageHeader
        title={`${a.code} — ${d.lead?.studentName ?? ''}`}
        description={
          <>
            Lead <a href={`/ops/leads/${a.leadId}`}>{d.lead?.code}</a> · programme{' '}
            {d.programme?.code ?? 'not chosen'} · counsellor {d.counsellor?.fullName ?? 'none'}
          </>
        }
      />
      <p>
        Status:{' '}
        <StatusBadge tone={statusTone(status)}>{ADMISSION_STATUS_LABELS[status]}</StatusBadge>
        {a.statusReason ? ` — ${a.statusReason}` : ''}
      </p>
      {status === 'enrolment_requested' ? (
        <Alert tone="info" title="Awaiting Academic OS">
          Enrolment requested (attempt {a.enrolmentAttempt}) at{' '}
          {fmtDateTime(a.enrolmentRequestedAt)}. Academic delivery:{' '}
          {d.handoff?.academicDelivery
            ? `${d.handoff.academicDelivery.status} (${d.handoff.academicDelivery.attempts} attempt(s))`
            : 'not yet picked up'}
          . This is not an enrolment until Academic OS confirms.
        </Alert>
      ) : null}
      {a.handoffStatus === 'rejected' ? (
        <Alert tone="danger" title="Academic OS rejected the enrolment">
          {a.rejectionCode}: {a.rejectionReason}. Correct the admission and request enrolment again
          (attempt {a.enrolmentAttempt + 1}).
        </Alert>
      ) : null}
      {status === 'enrolled' ? (
        <Alert tone="success" title="Enrolled">
          Confirmed by Academic OS at {fmtDateTime(a.enrolledAt)}.
        </Alert>
      ) : null}
      {write && d.allowedTargets.length ? (
        <Card
          title="Move along the pipeline"
          description="Only legal transitions are offered; the server re-checks every rule. Lost, on hold, skipping the demo and reopening need a reason."
        >
          <ActionForm
            action={`${api}/transitions`}
            submitLabel="Change status"
            fields={[
              {
                name: 'to',
                label: 'New status',
                type: 'select',
                required: true,
                options: d.allowedTargets.map((t) => ({
                  value: t,
                  label: ADMISSION_STATUS_LABELS[t],
                })),
              },
              { name: 'reason', label: 'Reason' },
            ]}
          />
          <p className="el-field-hint">
            Admission without a demo:{' '}
            <StatusBadge tone={decisionTone(d.settings.demoSkip.decisionState)}>
              {d.settings.demoSkip.decisionState}
            </StatusBadge>{' '}
            {d.settings.demoSkip.value.allowed ? 'allowed with a reason' : 'switched off'}.
          </p>
        </Card>
      ) : null}
      {d.canRequestEnrolment && write ? (
        <Card
          title="Request enrolment in Academic OS"
          description="Publishes ops.admission.enrolment_requested v1 in the same transaction as the status change. Double clicks cannot create two requests."
        >
          <ActionForm action={`${api}/enrolment-request`} submitLabel="Request enrolment" />
        </Card>
      ) : null}
      <Card
        title="Confirmation readiness (BR-OPS-6/7)"
        description="Two fee verifications by different people, an authorised fee approval, documents and a verified down payment. A demo fee alone is never an admission."
      >
        {d.readiness.ready ? (
          <Alert tone="success">Ready to confirm.</Alert>
        ) : (
          <ul>
            {d.readiness.gaps.map((g) => (
              <li key={g.key}>{g.label}</li>
            ))}
          </ul>
        )}
        <p className="el-field-hint">
          Documents/down-payment requirement:{' '}
          <StatusBadge tone={decisionTone(d.settings.confirmation.decisionState)}>
            {d.settings.confirmation.decisionState}
          </StatusBadge>
          . References only — no files or amounts are stored (OD-013, OD-014).
        </p>
      </Card>
      <Card title="Checklist">
        <DataTable
          rows={ADMISSION_CHECK_ITEMS.map((k) => ({ k, c: d.checks.find((c) => c.itemKey === k) }))}
          rowKey={(x) => x.k}
          columns={[
            { key: 'item', header: 'Item', render: (x) => ADMISSION_CHECK_LABELS[x.k] },
            {
              key: 'status',
              header: 'Status',
              render: (x) =>
                x.c ? (
                  <StatusBadge tone={statusTone(x.c.status === 'done' ? 'done' : 'open')}>
                    {humanise(x.c.status)}
                  </StatusBadge>
                ) : (
                  'Not recorded'
                ),
            },
            {
              key: 'by',
              header: 'Recorded by',
              render: (x) =>
                x.c ? `${x.c.recordedByName ?? ''} · ${fmtDateTime(x.c.recordedAt)}` : '',
            },
            { key: 'ref', header: 'Reference', render: (x) => x.c?.reference ?? '' },
            {
              key: 'act',
              header: '',
              render: (x) =>
                write && !['lost', 'enrolled'].includes(status) ? (
                  <ActionForm
                    action={`${api}/checks`}
                    submitLabel="Record"
                    compact
                    extra={{ itemKey: x.k }}
                    fields={[
                      {
                        name: 'status',
                        label: 'Status',
                        type: 'select',
                        required: true,
                        options: [
                          { value: 'done', label: 'Done' },
                          { value: 'not_done', label: 'Not done' },
                          { value: 'not_applicable', label: 'Not applicable' },
                        ],
                      },
                      { name: 'reference', label: 'Reference' },
                    ]}
                  />
                ) : null,
            },
          ]}
        />
      </Card>
      <Card
        title="Fee-arrangement approval"
        description="Through the shared approval service; the requester cannot approve their own request."
      >
        <p>
          Current:{' '}
          <StatusBadge tone={statusTone(d.feeApproval.state)}>{d.feeApproval.state}</StatusBadge>
        </p>
        <DataTable
          rows={d.feeApproval.history}
          rowKey={(h) => h.id}
          empty={<EmptyState title="No approval requested yet" />}
          columns={[
            { key: 'requestedAt', header: 'Requested', render: (h) => fmtDateTime(h.requestedAt) },
            { key: 'status', header: 'Decision', render: (h) => h.status },
            { key: 'decidedAt', header: 'Decided', render: (h) => fmtDateTime(h.decidedAt) },
            { key: 'comment', header: 'Comment', render: (h) => h.comment ?? '' },
          ]}
        />
        <div className="el-grid">
          {write && d.feeApproval.state !== 'pending' ? (
            <ActionForm
              action={`${api}/fee-approval`}
              submitLabel="Request approval"
              extra={{ action: 'request' }}
              fields={[{ name: 'comment', label: 'Note' }]}
              variant="secondary"
            />
          ) : null}
          {can(user, 'ops:admissions:approve') && d.feeApproval.state === 'pending' ? (
            <>
              <ActionForm
                action={`${api}/fee-approval`}
                submitLabel="Approve"
                extra={{ action: 'approve' }}
                fields={[{ name: 'comment', label: 'Comment' }]}
              />
              <ActionForm
                action={`${api}/fee-approval`}
                submitLabel="Reject"
                extra={{ action: 'reject' }}
                fields={[{ name: 'comment', label: 'Reason', required: true }]}
                variant="danger"
              />
            </>
          ) : null}
        </div>
      </Card>
      <div className="el-grid">
        <Card title="Counselling">
          <DataTable
            rows={d.counselling}
            rowKey={(s) => s.id}
            empty={<EmptyState title="No counselling yet" />}
            columns={[
              { key: 'scheduledAt', header: 'When', render: (s) => fmtDateTime(s.scheduledAt) },
              { key: 'counsellorName', header: 'Counsellor' },
              { key: 'status', header: 'Status', render: (s) => humanise(s.status) },
              { key: 'outcome', header: 'Outcome', render: (s) => s.outcome ?? '' },
            ]}
          />
          {write ? (
            <ActionForm
              action="/ops/api/v1/counselling"
              submitLabel="Book counselling"
              extra={{ admissionId: a.id }}
              fields={[
                { name: 'scheduledAt', label: 'When (IST)', type: 'datetime', required: true },
                {
                  name: 'mode',
                  label: 'Mode',
                  type: 'select',
                  required: true,
                  options: [
                    { value: 'in_person', label: 'In person' },
                    { value: 'phone', label: 'Phone' },
                    { value: 'video', label: 'Video' },
                  ],
                },
                {
                  name: 'counsellorStaffId',
                  label: 'Counsellor',
                  type: 'select',
                  options: options.staff,
                },
              ]}
              variant="secondary"
            />
          ) : null}
        </Card>
        <Card title="Demo">
          <DataTable
            rows={d.demos}
            rowKey={(x) => x.id}
            empty={<EmptyState title="No demo booked" />}
            columns={[
              { key: 'days', header: 'Days', render: (x) => x.dayDates.map(fmtDate).join(', ') },
              { key: 'subjects', header: 'Subjects', render: (x) => x.subjects.join(', ') },
              { key: 'status', header: 'Status', render: (x) => x.status },
              {
                key: 'fee',
                header: 'Fee',
                render: (x) =>
                  `${humanise(x.feeStatus)}${x.feeAmountInr ? ` (₹${x.feeAmountInr}, ${x.feeTermsState})` : ''}`,
              },
              {
                key: 'act',
                header: '',
                render: (x) =>
                  write && x.status === 'scheduled' ? (
                    <ActionForm
                      action={`/ops/api/v1/demos/${x.id}`}
                      submitLabel="Mark attended"
                      extra={{ action: 'attended' }}
                      compact
                    />
                  ) : null,
              },
            ]}
          />
          {write ? (
            <ActionForm
              action="/ops/api/v1/demos"
              submitLabel="Book demo"
              extra={{ admissionId: a.id }}
              fields={[
                {
                  name: 'subjects',
                  label: 'Subjects (comma separated)',
                  type: 'list',
                  required: true,
                },
                {
                  name: 'dayDates',
                  label: 'Demo dates (YYYY-MM-DD, comma separated)',
                  type: 'list',
                  required: true,
                },
                {
                  name: 'teacherStaffIds',
                  label: 'Teacher staff ids (comma separated)',
                  type: 'list',
                },
              ]}
              variant="secondary"
            />
          ) : null}
        </Card>
      </div>
      <Card title="Transition history">
        <DataTable
          rows={d.transitions}
          rowKey={(t) => t.id}
          columns={[
            { key: 'at', header: 'When', render: (t) => fmtDateTime(t.at) },
            {
              key: 'move',
              header: 'Change',
              render: (t) => `${t.fromStatus ?? '—'} → ${t.toStatus}`,
            },
            {
              key: 'actor',
              header: 'By',
              render: (t) =>
                t.actorType === 'system' ? 'Academic OS reply (system)' : (t.actorName ?? 'user'),
            },
            { key: 'reason', header: 'Reason', render: (t) => t.reason ?? '' },
          ]}
        />
      </Card>
    </div>
  );
}
