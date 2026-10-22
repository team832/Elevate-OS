/**
 * Student profile section: annual fee agreement, instalments and the separate registration and
 * demo fees (owner brief 2026-10-21 §9, D-039). Props: the canonical student id and the signed-in
 * user (permission checks inside).
 *
 * Finance fields only with `ops:fees:read` (own scope for counsellors; the server filters too);
 * forms only with `ops:fees:record`, never when `readOnly` (the list pop-up, the report). Order:
 * per agreement tuition, collected, outstanding, next due (and any credit), the three-segment
 * instalment bar and its table; then registration and demo fees; then the payment history.
 * Every figure is manually recorded, never a verified payment.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import type { StudentIdentityId } from '@elevate/shared-types';
import { Alert, EmptyState, StatusBadge } from '@elevate/shared-ui';
import { istToday } from '../domain';
import { INSTALMENT_STATUS_LABELS, type InstalmentStatus } from '../domain/fee-plans';
import {
  effectiveRecords,
  FEE_BALANCE_LABELS,
  FEE_CHARGE_LABELS,
  FEE_KIND_LABELS,
  FEE_METHODS,
  type FeeChargeCategory,
  type FeeRecordKind,
  type FeeRecordLike,
  type FeeSummary,
} from '../domain/fees';
import { studentFeePlans } from '../server/fees';
import { ActionForm, type FieldSpec } from './action-form';
import { StatCard } from './charts';
import { fmtDate, fmtDateTime, fmtPaise, humanise } from './format';
import { load } from './frame';
import { options } from './list-controls';
import { RecordTable } from './record-table';
import { DetailTable, Segment } from './sections';
import '../app/fees/fees.css';

type View = Awaited<ReturnType<typeof studentFeePlans>>;
type PlanView = View['plans'][number];
type Entry = View['otherCharges'][number];
type Level = 2 | 3;

const TITLE = 'Fees';
const TONE: Record<InstalmentStatus, 'success' | 'info' | 'danger' | 'warning' | 'neutral'> = {
  paid: 'success',
  waived_adjusted: 'success',
  part_paid: 'info',
  overdue: 'danger',
  unpaid: 'neutral',
};
const API = '/ops/api/v1';
const paymentFields: FieldSpec[] = [
  {
    name: 'amountRupees',
    label: 'Amount (₹)',
    type: 'money',
    required: true,
    hint: 'e.g. 25000 or 25,000.50',
  },
  { name: 'paymentDate', label: 'Date the money moved', type: 'date', required: true },
  { name: 'receiptReference', label: 'Receipt or transaction reference' },
  { name: 'method', label: 'Method', type: 'select', options: options(FEE_METHODS) },
];

/** Due date with its state in words: overdue vs not yet due; no date is never overdue. */
function dueText(dueDate: string | null, remainingPaise: number, today: string) {
  if (!dueDate) return 'No due date entered';
  if (remainingPaise <= 0) return fmtDate(dueDate);
  return dueDate < today ? `${fmtDate(dueDate)} (overdue)` : `${fmtDate(dueDate)} (not yet due)`;
}

export async function StudentFeesSection({
  studentId,
  user,
  level = 2,
  readOnly = false,
}: {
  studentId: StudentIdentityId;
  user: AuthenticatedUser;
  /** 3 inside a RecordModal. */
  level?: Level;
  /** No forms (the list pop-up, the printed report). */
  readOnly?: boolean;
}) {
  if (!can(user, 'ops:fees:read'))
    return (
      <Segment title={TITLE} level={level}>
        <p className="el-field-hint">Fee details are restricted to roles with fee access.</p>
      </Segment>
    );
  const r = await load((db) => studentFeePlans(db, user, studentId));
  if (!r.ok)
    return (
      <Segment title={TITLE} level={level}>
        {r.view}
      </Segment>
    );
  const view = r.data;
  const record = !readOnly && can(user, 'ops:fees:record');
  // Accepted agreements are changed or closed only by approvers; deciding is never by their maker.
  const approver = !readOnly && can(user, 'ops:admissions:approve') ? user.id : null;
  const requester = !readOnly && can(user, 'ops:admissions:write');
  const today = istToday(new Date());
  const open = view.plans.some((p) => p.plan.status !== 'closed');
  return (
    <>
      {view.plans.length ? (
        view.plans.map((p) => (
          <Agreement
            key={p.plan.id}
            p={p}
            record={record}
            approver={approver}
            requester={requester}
            level={level}
            today={today}
          />
        ))
      ) : (
        <Segment title={`${TITLE}: annual agreement`} level={level} description={view.disclaimer}>
          <EmptyState
            title="Fee agreement not configured"
            description={
              record
                ? 'Create the annual agreement below once the tuition is agreed.'
                : 'No fee agreement has been recorded for this student.'
            }
          />
        </Segment>
      )}
      {record && !open && view.admissions.length ? (
        <CreateAgreement studentId={studentId} admissions={view.admissions} />
      ) : null}
      <OtherCharges view={view} record={record} level={level} />
      <History view={view} record={record} level={level} />
    </>
  );
}

/** Every ledger, newest agreement first as served, then the separate charges; versions last. */
function History({ view, record, level }: { view: View; record: boolean; level: Level }) {
  if (!view.plans.length && !view.otherCharges.length) return null;
  return (
    <Segment
      title="Payment history"
      level={level}
      description="Append-only: a wrong entry is reversed by a linked entry, never edited."
    >
      <div className="el-stack">
        {view.plans.map((p) => (
          <Ledger
            key={p.plan.id}
            caption={`Tuition, ${p.plan.academicYear ?? 'year not recorded'}`}
            rows={p.ledger}
            record={record}
          />
        ))}
        {view.otherCharges.length ? (
          <Ledger
            caption="Registration, demo and other entries"
            rows={view.otherCharges}
            record={record}
            category
          />
        ) : null}
        {view.plans
          .filter((p) => p.versions.length > 1)
          .map((p) => (
            <RecordTable
              key={p.plan.id}
              caption={`Agreement versions, ${p.plan.academicYear ?? 'year not recorded'} (earlier receipts stay on their version)`}
              rows={p.versions}
              rowKey={(v) => v.id}
              columns={[
                { key: 'version', header: 'Version', numeric: true },
                {
                  key: 'total',
                  header: 'Tuition',
                  render: (v) => fmtPaise(v.totalPaise),
                  numeric: true,
                },
                {
                  key: 'reason',
                  header: 'Reason',
                  render: (v) => v.adjustmentReason ?? 'First agreement',
                },
                {
                  key: 'by',
                  header: 'Recorded by',
                  render: (v) => `${v.createdByName ?? '—'}, ${fmtDateTime(v.createdAt)}`,
                },
              ]}
            />
          ))}
      </div>
    </Segment>
  );
}

function Agreement({
  p,
  record,
  approver,
  requester,
  level,
  today,
}: {
  p: PlanView;
  record: boolean;
  /** The signed-in user's id when they may approve fee arrangements, else null. */
  approver: string | null;
  /** May ask for the fee-arrangement approval of a draft. */
  requester: boolean;
  level: Level;
  today: string;
}) {
  const { plan, totals, reconciliation, nextDue: next } = p;
  const base = `${API}/fee-plans/${plan.id}`;
  const change = record && (plan.status === 'draft' || (plan.status === 'active' && approver));
  const pending = p.pendingApproval;
  const decide =
    pending && approver && approver !== plan.createdBy && approver !== pending.requestedBy;
  return (
    <Segment
      title={`${TITLE}: annual agreement ${plan.academicYear ?? '(year not recorded)'}`}
      level={level}
      description={`${plan.label}. Manually recorded, not verified payments.`}
      meta={
        <>
          <StatusBadge tone={TONE[p.status]}>{INSTALMENT_STATUS_LABELS[p.status]}</StatusBadge>{' '}
          <StatusBadge tone={plan.status === 'active' ? 'success' : 'neutral'}>
            {plan.status === 'draft' ? 'Draft' : plan.status === 'active' ? 'Active' : 'Closed'}
          </StatusBadge>{' '}
          Version {plan.version}
        </>
      }
    >
      <div className="el-stack">
        <ul className="el-grid ops-kpis" aria-label="Fee figures">
          <li>
            <StatCard label="Annual tuition" value={fmtPaise(totals.totalPaise)} />
          </li>
          <li>
            <StatCard
              label="Collected"
              value={fmtPaise(totals.netPaidPaise)}
              note="Payments less refunds"
            />
          </li>
          <li>
            <StatCard label="Outstanding" value={fmtPaise(totals.outstandingPaise)} />
          </li>
          <li>
            <StatCard
              label="Next due"
              value={next ? fmtPaise(next.remainingPaise) : 'Nothing due'}
              note={next ? dueText(next.instalment.dueDate, next.remainingPaise, today) : undefined}
            />
          </li>
          {totals.creditPaise > 0 ? (
            <li>
              <StatCard
                label="Credit"
                value={fmtPaise(totals.creditPaise)}
                note="Recorded above what is owed; refund it or carry it over"
              />
            </li>
          ) : null}
        </ul>
        <InstalmentBar p={p} today={today} />
        {reconciliation.reconciled ? null : (
          <Alert tone="warning" title="The agreement and its ledger do not agree">
            <ul>
              {reconciliation.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </Alert>
        )}
        <RecordTable
          caption="Instalments (payments go to the instalment they name, otherwise oldest due first)"
          rows={p.instalments}
          rowKey={(i) => i.instalment.id}
          empty="No instalments on this agreement."
          columns={[
            { key: 'n', header: '#', render: (i) => i.instalment.sequence, numeric: true },
            {
              key: 'due',
              header: 'Due',
              render: (i) => dueText(i.instalment.dueDate, i.remainingPaise, today),
            },
            {
              key: 'amount',
              header: 'Amount',
              render: (i) => fmtPaise(i.instalment.amountPaise),
              numeric: true,
            },
            { key: 'paid', header: 'Paid', render: (i) => fmtPaise(i.paidPaise), numeric: true },
            {
              key: 'adjusted',
              header: 'Waived or adjusted',
              render: (i) => fmtPaise(i.adjustedPaise),
              numeric: true,
            },
            {
              key: 'remaining',
              header: 'Remaining',
              render: (i) => fmtPaise(i.remainingPaise),
              numeric: true,
            },
            {
              key: 'status',
              header: 'State',
              render: (i) => (
                <StatusBadge tone={TONE[i.status]}>
                  {INSTALMENT_STATUS_LABELS[i.status]}
                </StatusBadge>
              ),
            },
          ]}
        />
        <DetailTable
          caption="Agreement"
          rows={[
            {
              label: 'Discounts, waivers and adjustments (apart from tuition)',
              value: fmtPaise(totals.reductionsPaise),
            },
            { label: 'Refunded', value: fmtPaise(totals.refundedPaise) },
            { label: 'Pricing reference', value: plan.pricingReference ?? 'Not given' },
            {
              label: 'Approval',
              value: plan.approvedAt
                ? `Approved by ${p.approvedByName ?? 'an approver'}, ${fmtDateTime(plan.approvedAt)}`
                : 'Draft: a different approver approves this version, then it is activated',
            },
          ]}
        />
        {record && p.canActivate ? (
          <ActionForm
            action={base}
            submitLabel="Activate agreement"
            extra={{ action: 'activate' }}
            compact
          />
        ) : null}
        {plan.status === 'draft' && !pending && !p.canActivate && requester ? (
          <ActionForm
            action={`${base}/approval-request`}
            submitLabel="Request approval of this agreement"
            compact
          />
        ) : null}
        {plan.status === 'draft' && pending ? (
          <p className="el-field-hint">Approval requested; a different approver decides it.</p>
        ) : null}
        {decide ? (
          <details>
            <summary>Decide the approval request for this version</summary>
            <ActionForm
              action={`${base}/decision`}
              submitLabel="Approve"
              extra={{ decision: 'approved' }}
              compact
            />
            <ActionForm
              action={`${base}/decision`}
              submitLabel="Reject"
              variant="danger"
              extra={{ decision: 'rejected' }}
              fields={[{ name: 'comment', label: 'Reason', type: 'textarea', required: true }]}
            />
          </details>
        ) : null}
        {record && plan.status === 'active' ? (
          <EntryForm
            action={`${base}/entries`}
            p={p}
            reduce={approver !== null && approver !== plan.createdBy}
          />
        ) : null}
        {change ? (
          <>
            <details>
              <summary>Change the agreement (new version)</summary>
              <ActionForm
                action={base}
                submitLabel="Save new version"
                extra={{ action: 'adjust' }}
                fields={[
                  {
                    name: 'totalRupees',
                    label: 'Annual tuition (₹)',
                    type: 'money',
                    required: true,
                    defaultValue: String(plan.totalPaise / 100),
                  },
                  ...dueDateFields(
                    [...p.instalments]
                      .sort((a, b) => a.instalment.sequence - b.instalment.sequence)
                      .map((i) => i.instalment.dueDate),
                  ),
                  {
                    name: 'reason',
                    label: 'Reason',
                    type: 'textarea',
                    required: true,
                    hint: 'At least 10 characters. An active agreement needs the fee-approval permission; receipts are never changed.',
                  },
                ]}
              />
            </details>
            <details>
              <summary>Close this agreement</summary>
              <ActionForm
                action={base}
                submitLabel="Close agreement"
                variant="danger"
                extra={{ action: 'close' }}
                fields={[{ name: 'reason', label: 'Reason', type: 'textarea', required: true }]}
              />
            </details>
          </>
        ) : null}
      </div>
    </Segment>
  );
}

/** Three segments sized by amount, each filled by what was applied; the state is written out. */
function InstalmentBar({ p, today }: { p: PlanView; today: string }) {
  const bySequence = [...p.instalments].sort(
    (a, b) => a.instalment.sequence - b.instalment.sequence,
  );
  const total = bySequence.reduce((n, i) => n + i.instalment.amountPaise, 0);
  return (
    <ol className="ops-fees-bar" aria-label="Instalments: share, amount, due date and state">
      {bySequence.map((i) => (
        <li
          key={i.instalment.id}
          style={{ '--ops-fees-share': i.instalment.amountPaise } as CSSProperties}
        >
          <span className="el-hbar-track" aria-hidden="true">
            <span
              className="el-hbar-fill"
              style={{ width: `${(100 * i.allocatedPaise) / i.instalment.amountPaise}%` }}
            />
          </span>
          <span className="el-field-hint">
            Instalment {i.instalment.sequence}
            {total ? ` · ${Math.round((100 * i.instalment.amountPaise) / total)} %` : ''}
          </span>
          <span className="ops-fees-amount">{fmtPaise(i.instalment.amountPaise)}</span>
          <span>{dueText(i.instalment.dueDate, i.remainingPaise, today)}</span>
          <StatusBadge tone={TONE[i.status]}>{INSTALMENT_STATUS_LABELS[i.status]}</StatusBadge>
        </li>
      ))}
    </ol>
  );
}

/** A ledger table; live rows offer refund (payments) and reverse when the user may record. */
function Ledger({
  caption,
  rows,
  record,
  category,
}: {
  caption: string;
  rows: readonly Entry[];
  record: boolean;
  category?: boolean;
}) {
  const live = new Set(
    effectiveRecords(rows as unknown as (FeeRecordLike & { id: string })[]).map((r) => r.id),
  );
  const code = new Map(rows.map((r) => [r.id as string, r.code]));
  const reversedBy = new Map(
    rows.flatMap((r) => (r.reversesRecordId ? [[r.reversesRecordId as string, r.code]] : [])),
  );
  const what = (r: Entry) => {
    const kind = FEE_KIND_LABELS[r.kind as FeeRecordKind] ?? r.kind;
    const label = `${kind}${r.direction ? ` (${r.direction})` : ''}`;
    if (!r.reversesRecordId) return label;
    return `${r.kind === 'refund' ? 'Refund' : 'Reversal'} of ${code.get(r.reversesRecordId) ?? 'an entry'}`;
  };
  const state = (r: Entry) =>
    r.status === 'voided'
      ? 'Voided'
      : live.has(r.id)
        ? 'Manually recorded, not a verified payment'
        : r.reversesRecordId
          ? 'Reversal (cancels the linked entry)'
          : `Reversed by ${reversedBy.get(r.id) ?? 'a later entry'}`;
  return (
    <RecordTable
      caption={caption}
      rows={rows}
      rowKey={(r) => r.id}
      empty="Nothing recorded yet."
      columns={[
        { key: 'code', header: 'Entry' },
        ...(category
          ? [
              {
                key: 'category',
                header: 'Charge',
                render: (r: Entry) =>
                  r.chargeCategory === 'tuition'
                    ? 'Tuition (not part of an annual agreement)'
                    : FEE_CHARGE_LABELS[r.chargeCategory as FeeChargeCategory],
              },
            ]
          : []),
        { key: 'kind', header: 'What', render: what },
        {
          key: 'amount',
          header: 'Amount',
          render: (r) => fmtPaise(r.amountPaise),
          numeric: true,
        },
        { key: 'date', header: 'Date', render: (r) => fmtDate(r.paymentDate) },
        { key: 'method', header: 'Method', render: (r) => (r.method ? humanise(r.method) : '—') },
        { key: 'receipt', header: 'Receipt ref.', render: (r) => r.receiptReference ?? '—' },
        {
          key: 'by',
          header: 'Recorded by',
          render: (r) => `${r.recordedByName ?? '—'}, ${fmtDateTime(r.recordedAt)}`,
        },
        { key: 'state', header: 'Status', render: state },
        ...(record
          ? [
              {
                key: 'actions',
                header: 'Correct',
                render: (r: Entry) => (live.has(r.id) ? <Correct r={r} /> : null),
              },
            ]
          : []),
      ]}
    />
  );
}

function Correct({ r }: { r: Entry }) {
  const action = `${API}/fees/${r.id}`;
  return (
    <details>
      <summary>{r.kind === 'received' ? 'Refund or reverse' : 'Reverse'}</summary>
      {r.kind === 'received' ? (
        <ActionForm
          action={action}
          submitLabel="Record refund"
          amountLabel="Record {amount} refund"
          extra={{ action: 'refund' }}
          fields={[...paymentFields, { name: 'notes', label: 'Notes', type: 'textarea' }]}
        />
      ) : null}
      <ActionForm
        action={action}
        submitLabel="Reverse entry"
        variant="danger"
        extra={{ action: 'reverse' }}
        fields={[
          {
            name: 'reason',
            label: 'Why it was wrong',
            type: 'textarea',
            required: true,
            hint: 'The entry stays visible; a linked reversal cancels it.',
          },
        ]}
      />
    </details>
  );
}

/** One date per instalment of the 50/25/25 split (D-039), prefilled when changing an agreement. */
const dueDateFields = (current: readonly (string | null)[] = [null, null, null]) =>
  current.map((dueDate, n): FieldSpec => ({
    name: `dueDates.${n}`,
    label: `Instalment ${n + 1} due date`,
    type: 'date',
    required: true,
    defaultValue: dueDate ?? undefined,
  }));

/** `reduce`: may post discounts, waivers and credits (approver, not the agreement's maker; proposed O2). */
function EntryForm({ action, p, reduce }: { action: string; p: PlanView; reduce: boolean }) {
  return (
    <details>
      <summary>
        {reduce
          ? 'Record a payment, discount, waiver or adjustment'
          : 'Record a payment or adjustment'}
      </summary>
      <ActionForm
        action={action}
        submitLabel="Record entry"
        amountLabel="Record {amount} entry"
        fields={[
          {
            name: 'kind',
            label: 'Entry',
            type: 'select',
            required: true,
            defaultValue: 'received',
            options: (reduce
              ? (['received', 'discount', 'waiver', 'adjustment'] as const)
              : (['received', 'adjustment'] as const)
            ).map((k) => ({
              value: k,
              label: FEE_KIND_LABELS[k],
            })),
          },
          { ...paymentFields[0]! },
          {
            name: 'direction',
            label: 'Adjustment direction',
            type: 'select',
            options: [
              { value: 'credit', label: 'Credit (lowers what is owed)' },
              { value: 'debit', label: 'Debit (raises what is owed)' },
            ],
            hint: reduce
              ? 'Adjustments only.'
              : 'Adjustments only. A credit needs an approver who did not make the agreement (a demo fee credit excepted).',
          },
          {
            name: 'instalmentId',
            label: 'Instalment it pays',
            type: 'select',
            options: p.instalments.map((i) => ({
              value: i.instalment.id,
              label: `#${i.instalment.sequence}, ${fmtPaise(i.instalment.amountPaise)}`,
            })),
            hint: 'Leave empty to apply it to the oldest due instalment.',
          },
          { ...paymentFields[1]!, required: false, hint: 'Payments only.' },
          ...paymentFields.slice(2),
          {
            name: 'notes',
            label: 'Reason / notes',
            type: 'textarea',
            hint: 'Required for discounts and waivers.',
          },
        ]}
      />
    </details>
  );
}

function CreateAgreement({
  studentId,
  admissions,
}: {
  studentId: string;
  admissions: readonly { id: string; code: string }[];
}) {
  return (
    <details>
      <summary>Create the annual fee agreement</summary>
      <ActionForm
        action={`${API}/fee-plans`}
        submitLabel="Create agreement"
        extra={{ studentId }}
        fields={[
          {
            name: 'admissionId',
            label: 'Admission',
            type: 'select',
            required: true,
            options: admissions.map((a) => ({ value: a.id, label: a.code })),
            hint: 'One agreement covers every programme of the student for the year.',
          },
          { name: 'label', label: 'Agreement name', required: true, hint: 'e.g. Class 12 + CLAT' },
          { name: 'academicYear', label: 'Academic year', required: true, hint: 'e.g. 2026-27' },
          {
            name: 'totalRupees',
            label: 'Annual tuition (₹)',
            type: 'money',
            required: true,
            hint: 'Split 50 % / 25 % / 25 %; any remaining paise go to the last instalment.',
          },
          ...dueDateFields(),
          {
            name: 'pricingReference',
            label: 'Approved pricing reference',
            hint: 'No fee schedule is approved yet.',
          },
        ]}
      />
    </details>
  );
}

function chargeText(s: FeeSummary, notConfigured: boolean): ReactNode {
  if (notConfigured && s.activeCount === 0) return 'Not configured';
  if (s.activeCount === 0) return 'Nothing recorded';
  const parts = [
    `charged ${fmtPaise(s.duePaise)}`,
    `paid ${fmtPaise(s.netReceivedPaise)}`,
    s.balancePaise === null ? null : `balance ${fmtPaise(s.balancePaise)}`,
  ].filter(Boolean);
  return `${FEE_BALANCE_LABELS[s.balanceState]}: ${parts.join(', ')}`;
}

/** Registration and demo fees: separate charges, never part of the tuition split. */
function OtherCharges({ view, record, level }: { view: View; record: boolean; level: Level }) {
  const { registration } = view;
  const admission: FieldSpec = {
    name: 'admissionId',
    label: 'Admission',
    type: 'select',
    required: true,
    options: view.admissions.map((a) => ({ value: a.id, label: a.code })),
  };
  return (
    <Segment
      title="Registration and demo fees"
      level={level}
      description="Separate from the annual tuition and never part of its instalments."
    >
      <div className="el-stack">
        <DetailTable
          rows={[
            {
              label: 'Registration fee',
              value: chargeText(registration.summary, registration.configuredPaise === null),
            },
            {
              label: 'Registration fee setting',
              value:
                registration.configuredPaise === null
                  ? 'Registration fee not configured'
                  : fmtPaise(registration.configuredPaise),
            },
            { label: 'Demo fee', value: chargeText(view.demo, false) },
            view.tuitionOutsideAgreement.activeCount > 0 && {
              label: 'Tuition not part of an annual agreement',
              value: chargeText(view.tuitionOutsideAgreement, false),
            },
          ]}
        />
        {record && view.admissions.length ? (
          registration.configuredPaise === null ? (
            <p className="el-field-hint">
              Registration fee not configured: set it in Settings before charging it.
            </p>
          ) : (
            <>
              {registration.summary.duePaise > 0 ? (
                <p className="el-field-hint">The registration fee is charged (once per student).</p>
              ) : (
                <ActionForm
                  action={`${API}/fees`}
                  submitLabel={`Charge registration fee (${fmtPaise(registration.configuredPaise)})`}
                  extra={{ chargeCategory: 'registration', kind: 'due' }}
                  fields={[admission]}
                  compact
                />
              )}
              <details>
                <summary>Record a registration fee payment</summary>
                <ActionForm
                  action={`${API}/fees`}
                  submitLabel="Record payment"
                  amountLabel="Record {amount} payment"
                  extra={{ chargeCategory: 'registration', kind: 'received' }}
                  fields={[admission, ...paymentFields]}
                />
              </details>
            </>
          )
        ) : null}
      </div>
    </Segment>
  );
}
