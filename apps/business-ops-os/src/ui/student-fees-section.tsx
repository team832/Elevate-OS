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
import type { ReactNode } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import type { StudentIdentityId } from '@elevate/shared-types';
import { EmptyState } from '@elevate/shared-ui';
import { istToday } from '../domain';
import {
  effectiveRecords,
  FEE_BALANCE_LABELS,
  FEE_CHARGE_LABELS,
  FEE_KIND_LABELS,
  type FeeSummary,
} from '../domain/fees';
import { activeCoverFor } from '../server/approval-cover';
import { studentFeePlans } from '../server/fees';
import { receiptsOf } from '../server/receipts';
import { ActionForm, type FieldSpec } from './action-form';
import { fmtDate, fmtDateTime, fmtPaise, humanise } from './format';
import { load } from './frame';
import { ReceiptCell } from './receipt-cell';
import { RecordTable } from './record-table';
import { DetailTable, Segment } from './sections';
import { Agreement, TITLE } from './student-fees-agreement';
import {
  API,
  Correct,
  CreateAgreement,
  paymentFields,
  type Entry,
  type Level,
  type View,
} from './student-fees-forms';
import '../app/fees/fees.css';

type Receipts = Awaited<ReturnType<typeof receiptsOf>>;

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
  const r = await load(async (db) => {
    const v = await studentFeePlans(db, user, studentId);
    const ids = [...v.plans.flatMap((p) => p.ledger), ...v.otherCharges].map((e) => e.id);
    return { ...v, receipts: await receiptsOf(db, ids) };
  });
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
  // Approval cover (F4-10): a recorder covering a fee approver today posts reductions for them.
  const covered =
    record && !approver ? await load((db) => activeCoverFor(db, user.id, 'fee_approval')) : null;
  const cover =
    covered?.ok && covered.data.length ? { self: user.id, approvers: covered.data } : null;
  const today = istToday(new Date());
  const open = view.plans.some((p) => p.plan.status !== 'closed');
  return (
    <>
      {view.plans.length ? (
        // A proposed change comes after the agreement whose figures stand.
        view.plans
          .toSorted((a, b) => Number(a.proposedChange) - Number(b.proposedChange))
          .map((p) => (
            <Agreement
              key={p.plan.id}
              p={p}
              record={record}
              approver={approver}
              cover={cover}
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
      <History view={view} record={record} level={level} receipts={view.receipts} />
    </>
  );
}

/** Every ledger, newest agreement first as served, then the separate charges; versions last. */
function History({
  view,
  record,
  level,
  receipts,
}: {
  view: View;
  record: boolean;
  level: Level;
  receipts: Receipts;
}) {
  if (!view.plans.length && !view.otherCharges.length) return null;
  return (
    <Segment
      title="Payment history"
      level={level}
      description="Append-only: a wrong entry is reversed by a linked entry, never edited."
    >
      <div className="el-stack">
        {view.plans
          .filter((p) => !p.proposedChange)
          .map((p) => (
            <Ledger
              key={p.plan.id}
              caption={`Tuition, ${p.plan.academicYear ?? 'year not recorded'}`}
              rows={p.ledger}
              record={record}
              receipts={receipts}
            />
          ))}
        {view.otherCharges.length ? (
          <Ledger
            caption="Registration, demo and other entries"
            rows={view.otherCharges}
            record={record}
            receipts={receipts}
            category
          />
        ) : null}
        {view.plans
          .filter((p) => p.versions.length > 1 && !p.proposedChange)
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

/** A ledger table; live rows offer refund (payments) and reverse when the user may record. */
function Ledger({
  caption,
  rows,
  record,
  receipts,
  category,
}: {
  caption: string;
  rows: readonly Entry[];
  record: boolean;
  receipts: Receipts;
  category?: boolean;
}) {
  const live = new Set(effectiveRecords(rows).map((r) => r.id));
  const code = new Map(rows.map((r) => [r.id as string, r.code]));
  const reversedBy = new Map(
    rows.flatMap((r) => (r.reversesRecordId ? [[r.reversesRecordId as string, r.code]] : [])),
  );
  const what = (r: Entry) => {
    const kind = FEE_KIND_LABELS[r.kind];
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
                    : FEE_CHARGE_LABELS[r.chargeCategory],
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
          key: 'receiptPdf',
          header: 'Receipt',
          render: (r) => (
            <ReceiptCell
              entry={r}
              receipt={receipts.get(r.id)}
              canIssue={record && live.has(r.id)}
            />
          ),
        },
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
