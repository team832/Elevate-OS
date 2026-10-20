import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import {
  Alert,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  StatusBadge,
  type Tone,
} from '@elevate/shared-ui';
import {
  ADMISSION_CHECK_ITEMS,
  ADMISSION_CHECK_LABELS,
  ADMISSION_STATUS_LABELS,
  type AdmissionStatus,
} from '../../../domain';
import {
  downPaymentHint,
  FEE_BALANCE_LABELS,
  FEE_KIND_LABELS,
  FEE_METHODS,
  FEE_STATUS_LABELS,
  formatPaise,
  type FeeRecordKind,
  type FeeRecordStatus,
} from '../../../domain/fees';
import { getAdmission } from '../../../server/admissions';
import { listAdmissionFees } from '../../../server/fees';
import { formOptions } from '../../../server/options';
import { ActionForm } from '../../../ui/action-form';
import { decisionTone, fmtDate, fmtDateTime, humanise, statusTone } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';

export const dynamic = 'force-dynamic';

const FEE_STATUS_TONE: Record<string, Tone> = { verified: 'success', voided: 'neutral' };

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
    fees: can(user, 'ops:fees:read') ? await listAdmissionFees(db, user, id) : null,
  }));
  if (!r.ok) return r.view;
  const { d, options, fees } = r.data;
  const a = d.admission;
  const api = `/ops/api/v1/admissions/${a.id}`;
  const write = can(user, 'ops:admissions:write');
  const status = a.status as AdmissionStatus;
  const { tone } = d.handoffView;
  const handoffTone = tone === 'danger' || tone === 'warning' ? tone : 'info';
  return (
    <div className="el-stack">
      <PageHeader
        title={`${a.code} — ${d.lead?.studentName ?? ''}`}
        description={
          <>
            Lead <a href={`/ops/leads/${a.leadId}`}>{d.lead?.code}</a> · programme{' '}
            {d.programme?.code ?? 'not chosen'} · admission owner (counsellor){' '}
            {d.counsellor?.fullName ?? 'none'}
            {a.admissionDate ? ` · admitted on ${fmtDate(a.admissionDate)}` : ''}
          </>
        }
      />
      <p>
        Status:{' '}
        <StatusBadge tone={statusTone(status)}>{ADMISSION_STATUS_LABELS[status]}</StatusBadge>
        {a.statusReasonCode
          ? ` — ${d.closureReasonLabels[a.statusReasonCode] ?? a.statusReasonCode}`
          : ''}
        {a.statusReason ? ` — ${a.statusReason}` : ''}
      </p>
      {status === 'enrolment_requested' ? (
        <Alert tone={handoffTone} title={d.handoffView.label}>
          Enrolment requested (attempt {a.enrolmentAttempt}) at{' '}
          {fmtDateTime(a.enrolmentRequestedAt)}. {d.handoffView.detail ?? ''} This is not an
          enrolment until Academic OS confirms.
        </Alert>
      ) : null}
      {write && d.retry.allowed && d.retry.via === 'retry' ? (
        <Card
          title="Send a new enrolment request"
          description="Academic OS gave up on the previous request after every automatic retry, so it created no enrolment. A new attempt keeps the same admission; the old one is marked superseded."
        >
          <ActionForm
            action={`${api}/enrolment-retry`}
            submitLabel="Send a new enrolment request"
            fields={[{ name: 'reason', label: 'Why it is safe to try again', required: true }]}
          />
        </Card>
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
              {
                name: 'reasonCode',
                label: 'Reason code (when closing as lost)',
                type: 'select',
                options: d.closureReasons.map((c) => ({ value: c.code, label: c.label })),
                hint: `Used in reports; a closure without a code is counted as not coded. Code list: ${d.settings.closureReasons.decisionState}.`,
              },
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
          . The checklist stores references only; amounts live in the fee records below and do not
          decide the gate (OD-013, OD-014).
        </p>
        {d.feeSummary ? (
          <p className="el-field-hint">
            For the down-payment check: {downPaymentHint(d.feeSummary)}
          </p>
        ) : null}
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
      {fees ? (
        <section id="fees">
          <Card
            title="Fee records (manually recorded)"
            description={`${fees.disclaimer} No fee schedule is approved (${fees.settings.schedule.decisionState}); each entry quotes its own pricing reference.`}
          >
            <p>
              <strong>{FEE_BALANCE_LABELS[fees.summary.balanceState]}.</strong> Due{' '}
              {formatPaise(fees.summary.duePaise)} · credits{' '}
              {formatPaise(fees.summary.creditAdjustmentsPaise)} · received{' '}
              {formatPaise(fees.summary.netReceivedPaise)} (checked by a second person:{' '}
              {formatPaise(fees.summary.verifiedNetReceivedPaise)}) · balance{' '}
              {formatPaise(fees.summary.balancePaise)}
            </p>
            <DataTable
              rows={fees.records}
              rowKey={(f) => f.id}
              empty={
                <EmptyState
                  title="No fee entries yet"
                  description="Nothing has been recorded for this admission. The balance stays unknown until an amount due is recorded."
                />
              }
              columns={[
                { key: 'code', header: 'Entry', render: (f) => f.code },
                {
                  key: 'kind',
                  header: 'Type',
                  render: (f) =>
                    `${FEE_KIND_LABELS[f.kind as FeeRecordKind]}${f.direction ? ` (${f.direction})` : ''}`,
                },
                { key: 'amount', header: 'Amount', render: (f) => formatPaise(f.amountPaise) },
                {
                  key: 'date',
                  header: 'Date',
                  render: (f) => fmtDate(f.paymentDate ?? f.dueDate),
                },
                {
                  key: 'refs',
                  header: 'References',
                  render: (f) =>
                    [f.receiptReference, f.pricingReference, f.method ? humanise(f.method) : null]
                      .filter(Boolean)
                      .join(' · '),
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (f) => (
                    <>
                      <StatusBadge tone={FEE_STATUS_TONE[f.status] ?? 'info'}>
                        {FEE_STATUS_LABELS[f.status as FeeRecordStatus]}
                      </StatusBadge>
                      <br />
                      <span className="el-field-hint">
                        by {f.recordedByName ?? 'unknown'}
                        {f.verifiedByName ? `; checked by ${f.verifiedByName}` : ''}
                        {f.voidReason ? `; voided: ${f.voidReason}` : ''}
                      </span>
                    </>
                  ),
                },
                {
                  key: 'act',
                  header: '',
                  render: (f) =>
                    can(user, 'ops:fees:record') && f.status !== 'voided' ? (
                      <div className="el-stack">
                        {f.status === 'recorded' && f.recordedBy !== user.id ? (
                          <ActionForm
                            action={`/ops/api/v1/fees/${f.id}`}
                            submitLabel="Mark as checked"
                            extra={{ action: 'verify' }}
                            fields={[{ name: 'note', label: 'Checked against' }]}
                            compact
                            variant="secondary"
                          />
                        ) : null}
                        <ActionForm
                          action={`/ops/api/v1/fees/${f.id}`}
                          submitLabel="Void entry"
                          extra={{ action: 'void' }}
                          fields={[{ name: 'reason', label: 'Why void it', required: true }]}
                          compact
                          variant="danger"
                        />
                      </div>
                    ) : null,
                },
              ]}
            />
            {can(user, 'ops:fees:record') ? (
              <ActionForm
                action={`${api}/fees`}
                submitLabel="Save fee entry"
                variant="secondary"
                fields={[
                  {
                    name: 'kind',
                    label: 'Type',
                    type: 'select',
                    required: true,
                    options: Object.entries(FEE_KIND_LABELS).map(([value, label]) => ({
                      value,
                      label,
                    })),
                  },
                  {
                    name: 'direction',
                    label: 'Adjustment direction',
                    type: 'select',
                    options: [
                      {
                        value: 'credit',
                        label: 'Credit — lowers the balance (e.g. demo fee adjusted)',
                      },
                      { value: 'debit', label: 'Debit — raises the balance' },
                    ],
                    hint: 'Only for adjustments.',
                  },
                  {
                    name: 'amountRupees',
                    label: 'Amount in ₹',
                    required: true,
                    hint: 'Up to two decimals, e.g. 15000 or 15000.50. Stored as whole paise.',
                  },
                  {
                    name: 'paymentDate',
                    label: 'Date the money moved (received / refund)',
                    type: 'date',
                  },
                  { name: 'dueDate', label: 'Due date (amount due)', type: 'date' },
                  { name: 'receiptReference', label: 'Receipt or transaction reference' },
                  {
                    name: 'method',
                    label: 'Method',
                    type: 'select',
                    options: FEE_METHODS.map((m) => ({ value: m, label: humanise(m) })),
                  },
                  {
                    name: 'pricingReference',
                    label: 'Pricing reference (which quote or schedule)',
                  },
                  {
                    name: 'demoId',
                    label: 'Demo whose fee is adjusted',
                    type: 'select',
                    options: d.demos.map((x) => ({
                      value: x.id,
                      label: `${x.dayDates.map(fmtDate).join(', ')} (${humanise(x.feeStatus)})`,
                    })),
                    hint: 'Only for a credit adjustment of a paid demo fee.',
                  },
                  { name: 'notes', label: 'Notes', type: 'textarea' },
                ]}
              />
            ) : null}
          </Card>
        </section>
      ) : null}
      <Card
        title="Enrolment requests to Academic OS"
        description="One row per request. A new attempt never runs alongside a live one."
      >
        <DataTable
          rows={d.attempts}
          rowKey={(x) => x.id}
          empty={
            <EmptyState
              title={
                a.enrolmentAttempt > 0
                  ? 'Requested before attempts were tracked'
                  : 'Enrolment not requested yet'
              }
              description={
                a.enrolmentAttempt > 0
                  ? `Latest attempt ${a.enrolmentAttempt} at ${fmtDateTime(a.enrolmentRequestedAt)}.`
                  : 'Request enrolment once the admission is confirmed.'
              }
            />
          }
          columns={[
            { key: 'n', header: 'Attempt', render: (x) => x.attempt },
            { key: 'kind', header: 'Why', render: (x) => humanise(x.kind) },
            {
              key: 'at',
              header: 'Requested',
              render: (x) => `${fmtDateTime(x.requestedAt)} by ${x.requestedByName ?? 'unknown'}`,
            },
            { key: 'outcome', header: 'Outcome', render: (x) => humanise(x.outcome) },
            {
              key: 'detail',
              header: 'Detail',
              render: (x) =>
                [
                  x.rejectionCode ? `${x.rejectionCode}: ${x.rejectionReason}` : null,
                  x.reason,
                  x.note,
                ]
                  .filter(Boolean)
                  .join(' · '),
            },
          ]}
        />
        {['admitted', 'enrolment_requested', 'enrolled'].includes(status) ? (
          <p>
            <a href={`/ops/students/${a.id}`}>Open the student profile</a>
          </p>
        ) : null}
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
            {
              key: 'reason',
              header: 'Reason',
              render: (t) =>
                [
                  t.reasonCode ? (d.closureReasonLabels[t.reasonCode] ?? t.reasonCode) : null,
                  t.reason,
                ]
                  .filter(Boolean)
                  .join(' — '),
            },
          ]}
        />
      </Card>
    </div>
  );
}
