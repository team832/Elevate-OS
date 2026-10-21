import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, EmptyState, PageHeader, StatusBadge, type Tone } from '@elevate/shared-ui';
import {
  ADMISSION_CHECK_ITEMS,
  ADMISSION_CHECK_LABELS,
  ADMISSION_STATUS_LABELS,
} from '../../../domain';
import { APPOINTMENT_MODES } from '../../../domain/appointments';
import { DEMO_FEE_LABELS, demoFeeStatus } from '../../../domain/demos';
import { hasStudentRecord } from '../../../domain/student-lifecycle';
import {
  FEE_BALANCE_LABELS,
  FEE_KIND_LABELS,
  FEE_METHODS,
  FEE_STATUS_LABELS,
  type FeeRecordKind,
  type FeeRecordLike,
  type FeeRecordStatus,
} from '../../../domain/fees';
import { getAdmission } from '../../../server/admissions';
import { listAdmissionFees } from '../../../server/fees';
import { formOptions } from '../../../server/options';
import { ActionForm } from '../../../ui/action-form';
import { AdmissionsNav } from '../../../ui/admissions-nav';
import {
  decisionTone,
  fmtDate,
  fmtDateTime,
  fmtPaise,
  humanise,
  statusTone,
} from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { RecordTable } from '../../../ui/record-table';
import { DetailTable, Segment } from '../../../ui/sections';
import { StudentFeesSection } from '../../../ui/student-fees-section';
import { AdmissionConfirmation } from './confirmation';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admission' };

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
  const tabs = <AdmissionsNav current="demos" user={user} />;
  if (!r.ok)
    return (
      <>
        <PageHeader title="Admission" tabs={tabs} />
        {r.view}
      </>
    );
  const { d, options, fees } = r.data;
  const a = d.admission;
  const api = `/ops/api/v1/admissions/${a.id}`;
  const write = can(user, 'ops:admissions:write');
  const status = a.status;
  const profile = Boolean(a.studentId && hasStudentRecord(a));
  const { tone } = d.handoffView;
  const handoffTone = tone === 'danger' || tone === 'warning' ? tone : 'info';
  return (
    <>
      <PageHeader
        title={d.lead?.studentName ?? a.code}
        meta={
          <>
            <StatusBadge tone={statusTone(status)}>{ADMISSION_STATUS_LABELS[status]}</StatusBadge>{' '}
            {a.code}
          </>
        }
        description={<a href="/ops/admissions">Back to demo students</a>}
        tabs={tabs}
      />
      <div className="el-stack">
        <Segment title="Admission" flush>
          <DetailTable
            rows={[
              {
                label: 'Status',
                value: (
                  <>
                    <StatusBadge tone={statusTone(status)}>
                      {ADMISSION_STATUS_LABELS[status]}
                    </StatusBadge>
                    {a.statusReasonCode
                      ? ` ${d.closureReasonLabels[a.statusReasonCode] ?? a.statusReasonCode}`
                      : ''}
                    {a.statusReason ? ` · ${a.statusReason}` : ''}
                  </>
                ),
              },
              {
                label: 'Admission no.',
                value: a.admissionNumber ?? 'Not assigned (given at final confirmation)',
              },
              { label: 'Lead', value: <a href={`/ops/leads/${a.leadId}`}>{d.lead?.code}</a> },
              { label: 'Programme', value: d.programme?.name ?? 'Not chosen' },
              { label: 'Admission owner (counsellor)', value: d.counsellor?.fullName ?? 'None' },
              {
                label: 'Admitted on',
                value: a.admissionDate ? fmtDate(a.admissionDate) : 'Not admitted yet',
              },
              profile && {
                label: 'Student profile',
                value: <a href={`/ops/students/${a.studentId}`}>Open the student profile</a>,
              },
            ]}
          />
        </Segment>
        <AdmissionConfirmation user={user} admissionId={a.id} status={status} />
        {status === 'enrolment_requested' ? (
          <Alert tone={handoffTone} title={d.handoffView.label}>
            Enrolment requested (attempt {a.enrolmentAttempt}) at{' '}
            {fmtDateTime(a.enrolmentRequestedAt)}. {d.handoffView.detail ?? ''} This is not an
            enrolment until Academic OS confirms.
          </Alert>
        ) : null}
        {write && d.retry.allowed && d.retry.via === 'retry' ? (
          <Segment
            title="Send a new enrolment request"
            description="Academic OS gave up on the previous request after every automatic retry, so it created no enrolment. A new attempt keeps the same admission; the old one is marked superseded."
          >
            <ActionForm
              action={`${api}/enrolment-retry`}
              submitLabel="Send a new enrolment request"
              fields={[{ name: 'reason', label: 'Why it is safe to try again', required: true }]}
            />
          </Segment>
        ) : null}
        {a.handoffStatus === 'rejected' ? (
          <Alert tone="danger" title="Academic OS rejected the enrolment">
            {a.rejectionCode}: {a.rejectionReason}. Correct the admission and request enrolment
            again (attempt {a.enrolmentAttempt + 1}).
          </Alert>
        ) : null}
        {status === 'enrolled' ? (
          <Alert tone="success" title="Enrolled">
            Confirmed by Academic OS at {fmtDateTime(a.enrolledAt)}.
          </Alert>
        ) : null}
        {write && d.allowedTargets.length ? (
          <Segment
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
                  // "Admitted" comes only from Confirm admission on the application (D-041).
                  options: d.allowedTargets
                    .filter((t) => t !== 'admitted')
                    .map((t) => ({
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
          </Segment>
        ) : null}
        {d.canRequestEnrolment && write ? (
          <Segment
            title="Request enrolment in Academic OS"
            description="Publishes ops.admission.enrolment_requested v1 in the same transaction as the status change. Double clicks cannot create two requests."
          >
            <ActionForm action={`${api}/enrolment-request`} submitLabel="Request enrolment" />
          </Segment>
        ) : null}
        <Segment
          title="Fee arrangement checks"
          flush
          description="Two fee verifications by different people and an authorised fee approval (needed to activate the fee agreement). The admission itself is confirmed only on its application, by an approver with a password re-check. A demo fee alone is never an admission."
        >
          <DetailTable
            rows={[
              {
                label: 'Still open',
                value: (
                  <ul>
                    {d.readiness.gaps.map((g) => (
                      <li key={g.key}>{g.label}</li>
                    ))}
                  </ul>
                ),
              },
              {
                label: 'Documents item required',
                value: (
                  <>
                    <StatusBadge tone={decisionTone(d.settings.confirmation.decisionState)}>
                      {d.settings.confirmation.decisionState}
                    </StatusBadge>{' '}
                    {d.settings.confirmation.value.requireDocuments ? 'Yes' : 'No'}. Payment before
                    admission is the setting &ldquo;Payment before admission&rdquo;.
                  </>
                ),
              },
            ]}
          />
        </Segment>
        <Segment title="Checklist" flush>
          <RecordTable
            rows={ADMISSION_CHECK_ITEMS.map((k) => ({
              k,
              c: d.checks.find((c) => c.itemKey === k),
            }))}
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
        </Segment>
        <Segment title="Fee-agreement approval">
          <p>
            Each version of the annual fee agreement is approved on its own, from the student&apos;s
            Fees tab or the Approvals inbox (the requester never approves their own request).{' '}
            {profile ? (
              <a href={`/ops/students/${a.studentId}?tab=fees`}>Open the student&apos;s Fees tab</a>
            ) : a.studentId ? (
              'Create it below.'
            ) : (
              'The student record is created at conversion.'
            )}{' '}
            · <a href="/ops/operations/approvals">Approvals inbox</a>
          </p>
        </Segment>
        {a.studentId && !profile ? (
          <StudentFeesSection studentId={a.studentId} user={user} />
        ) : null}
        {fees ? (
          <Segment
            id="fees"
            title="Fee records (manually recorded)"
            description={`${fees.disclaimer} No fee schedule is approved (${fees.settings.schedule.decisionState}); each entry quotes its own pricing reference.`}
          >
            <DetailTable
              caption="Fee summary"
              rows={[
                { label: 'State', value: FEE_BALANCE_LABELS[fees.summary.balanceState] },
                { label: 'Due', value: fmtPaise(fees.summary.duePaise) },
                { label: 'Credits', value: fmtPaise(fees.summary.creditAdjustmentsPaise) },
                { label: 'Received', value: fmtPaise(fees.summary.netReceivedPaise) },
                {
                  label: 'Checked by a second person',
                  value: fmtPaise(fees.summary.verifiedNetReceivedPaise),
                },
                { label: 'Balance', value: fmtPaise(fees.summary.balancePaise) },
              ]}
            />
            <RecordTable
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
                { key: 'amount', header: 'Amount', render: (f) => fmtPaise(f.amountPaise) },
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
                    section: 'New fee entry',
                    label: 'Type',
                    type: 'select',
                    required: true,
                    // A refund names its payment: recorded in the student fee section.
                    options: Object.entries(FEE_KIND_LABELS)
                      .filter(([value]) => value !== 'refund')
                      .map(([value, label]) => ({ value, label })),
                  },
                  {
                    name: 'direction',
                    section: 'New fee entry',
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
                    section: 'New fee entry',
                    label: 'Amount in ₹',
                    required: true,
                    hint: 'Up to two decimals, e.g. 15000 or 15000.50. Stored as whole paise.',
                  },
                  {
                    name: 'paymentDate',
                    section: 'New fee entry',
                    label: 'Date the money was received',
                    type: 'date',
                  },
                  {
                    name: 'dueDate',
                    section: 'New fee entry',
                    label: 'Due date (amount due)',
                    type: 'date',
                  },
                  {
                    name: 'receiptReference',
                    section: 'References',
                    label: 'Receipt or transaction reference',
                  },
                  {
                    name: 'method',
                    section: 'References',
                    label: 'Method',
                    type: 'select',
                    options: FEE_METHODS.map((m) => ({ value: m, label: humanise(m) })),
                  },
                  {
                    name: 'pricingReference',
                    section: 'References',
                    label: 'Pricing reference (which quote or schedule)',
                  },
                  {
                    name: 'demoId',
                    section: 'References',
                    label: 'Demo whose fee is adjusted',
                    type: 'select',
                    options: d.demos.map((x) => ({
                      value: x.id,
                      label: `${x.days.map(fmtDate).join(', ')} (demo fee: ${
                        DEMO_FEE_LABELS[
                          demoFeeStatus(
                            (fees?.records.filter((f) => f.demoId === x.id) ??
                              []) as FeeRecordLike[],
                          ).state
                        ]
                      })`,
                    })),
                    hint: 'Only for a credit adjustment of a paid demo fee.',
                  },
                  { name: 'notes', section: 'References', label: 'Notes', type: 'textarea' },
                ]}
              />
            ) : null}
          </Segment>
        ) : null}
        <Segment
          title="Enrolment requests to Academic OS"
          description="One row per request. A new attempt never runs alongside a live one."
        >
          <RecordTable
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
        </Segment>
        <Segment title="Counselling">
          <RecordTable
            rows={d.counselling}
            rowKey={(s) => s.id}
            empty={<EmptyState title="No counselling yet" />}
            columns={[
              { key: 'scheduledAt', header: 'When', render: (s) => fmtDateTime(s.startsAt) },
              { key: 'counsellorName', header: 'Counsellor' },
              { key: 'status', header: 'Status', render: (s) => humanise(s.status) },
              { key: 'outcome', header: 'Outcome', render: (s) => s.outcome ?? '' },
            ]}
          />
          {can(user, 'ops:appointments:manage') ? (
            <ActionForm
              action="/ops/api/v1/appointments"
              submitLabel="Book counselling"
              extra={{ admissionId: a.id, type: 'student_counselling' }}
              fields={[
                { name: 'startsAt', label: 'When (IST)', type: 'datetime', required: true },
                {
                  name: 'mode',
                  label: 'Mode',
                  type: 'select',
                  required: true,
                  options: APPOINTMENT_MODES.map((m) => ({ value: m, label: humanise(m) })),
                },
                {
                  name: 'staffId',
                  label: 'Counsellor',
                  type: 'select',
                  required: true,
                  defaultValue: a.counsellorStaffId ?? '',
                  options: options.staff,
                },
              ]}
              variant="secondary"
            />
          ) : null}
        </Segment>
        <Segment title="Demo">
          <RecordTable
            rows={d.demos}
            rowKey={(x) => x.id}
            rowHref={(x) => `/ops/admissions?open=${x.id}`}
            empty={
              <EmptyState
                title="No demo booked"
                description="Book the demo classes from Demo students."
                action={<a href="/ops/admissions">Open demo students</a>}
              />
            }
            columns={[
              {
                key: 'demo',
                header: 'Demo',
                render: (x) => x.days.map(fmtDate).join(', '),
              },
              { key: 'subjects', header: 'Subjects', render: (x) => x.subjects.join(', ') },
              { key: 'outcome', header: 'Outcome', render: (x) => humanise(x.outcome) },
              {
                key: 'act',
                header: '',
                render: (x) =>
                  x.outcome === 'open' && can(user, 'ops:admissions:convert') ? (
                    <a href={`/ops/admissions/demos/${x.id}/convert`}>Convert to admission</a>
                  ) : null,
              },
            ]}
          />
        </Segment>
        <Segment title="Transition history">
          <RecordTable
            rows={d.transitions}
            rowKey={(t) => t.id}
            columns={[
              { key: 'at', header: 'When', render: (t) => fmtDateTime(t.at) },
              {
                key: 'move',
                header: 'Change',
                render: (t) =>
                  `${t.fromStatus ? (ADMISSION_STATUS_LABELS[t.fromStatus] ?? t.fromStatus) : '—'} → ${
                    ADMISSION_STATUS_LABELS[t.toStatus] ?? t.toStatus
                  }`,
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
        </Segment>
      </div>
    </>
  );
}
