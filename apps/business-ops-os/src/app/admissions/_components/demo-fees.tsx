/**
 * Demo fee tab (brief §5): assessed, paid and balance from the demo's ledger rows only (no paid
 * checkbox). Entries go through the fee service: POST /fees (amount due, payment, waiver with a
 * reason) and POST /fees/{id} (refund linked to a payment), both ops:fees:record and audited.
 */
import { can } from '@elevate/authorization';
import { EmptyState } from '@elevate/shared-ui';
import { DEMO_FEE_LABELS } from '../../../domain/demos';
import {
  FEE_KIND_LABELS,
  FEE_METHODS,
  FEE_STATUS_LABELS,
  type FeeRecordKind,
  type FeeRecordStatus,
} from '../../../domain/fees';
import { ActionForm, type FieldSpec } from '../../../ui/action-form';
import { StatCard } from '../../../ui/charts';
import { fmtDate, fmtPaise, humanise } from '../../../ui/format';
import { RecordTable } from '../../../ui/record-table';
import { DetailTable, Segment } from '../../../ui/sections';
import { Badge, Disclosure } from './demo-bits';
import { nameOf, type DemoTabProps } from './demo-record';

const paymentFields: FieldSpec[] = [
  { name: 'amountRupees', label: 'Amount (₹)', type: 'money', required: true },
  { name: 'paymentDate', label: 'Date the money moved', type: 'date' },
  {
    name: 'method',
    label: 'Method',
    type: 'select',
    options: FEE_METHODS.map((m) => ({ value: m, label: humanise(m) })),
  },
  { name: 'receiptReference', label: 'Receipt or transaction reference' },
];

export function DemoFees({ d, user, level }: DemoTabProps) {
  const f = d.fees;
  if (!f)
    return (
      <EmptyState
        title="Fee details are restricted"
        description="Staff with fee access see the demo fee here."
      />
    );
  const record = can(user, 'ops:fees:record');
  return (
    <>
      <Segment
        title="Demo fee"
        level={level}
        meta={<Badge value={f.state} label={DEMO_FEE_LABELS[f.state]} />}
        description={f.disclaimer}
      >
        <div className="el-stack">
          <ul className="el-grid ops-kpis" aria-label="Demo fee figures">
            <li>
              <StatCard
                label="Assessed"
                value={f.balancePaise === null ? null : fmtPaise(f.assessedPaise)}
                note={f.balancePaise === null ? 'No amount due recorded' : undefined}
              />
            </li>
            <li>
              <StatCard label="Paid" value={fmtPaise(f.paidPaise)} note="Less refunds" />
            </li>
            <li>
              <StatCard
                label="Balance"
                value={f.balancePaise === null ? null : fmtPaise(f.balancePaise)}
                note={f.balancePaise === null ? 'Known once an amount due is recorded' : undefined}
              />
            </li>
          </ul>
          <DetailTable
            rows={[
              f.waivedPaise > 0 && {
                label: 'Waived or discounted',
                value: fmtPaise(f.waivedPaise),
              },
              f.refundedPaise > 0 && { label: 'Refunded', value: fmtPaise(f.refundedPaise) },
              f.unverifiedCount > 0 && {
                label: 'Not yet checked',
                value: `${f.unverifiedCount} entr${f.unverifiedCount === 1 ? 'y' : 'ies'} not checked by a second person`,
              },
              {
                label: 'Configured amount',
                value: `${fmtPaise(d.demo.feeAmountPaise)} at booking (setting “Demo fee amount”, ${humanise(d.demo.feeTermsState)}); charged only once recorded as due`,
              },
              {
                label: 'Credit toward tuition',
                value: `${d.demoCredit.value.creditTowardTuition ? 'Allowed' : 'Not given'} (setting “Demo fee credit”, ${d.demoCredit.decisionState}); never assumed`,
              },
            ]}
          />
        </div>
      </Segment>
      <Segment title="Demo fee ledger" level={level} flush>
        <RecordTable
          rows={f.records}
          rowKey={(r) => r.id}
          empty="No demo fee entries yet."
          columns={[
            {
              key: 'kind',
              header: 'Entry',
              render: (r) => FEE_KIND_LABELS[r.kind as FeeRecordKind],
            },
            {
              key: 'amount',
              header: 'Amount',
              numeric: true,
              render: (r) => fmtPaise(r.amountPaise),
            },
            {
              key: 'date',
              header: 'Date',
              render: (r) => fmtDate(r.paymentDate ?? r.dueDate),
            },
            {
              key: 'ref',
              header: 'Method and receipt',
              render: (r) =>
                [r.method && humanise(r.method), r.receiptReference].filter(Boolean).join(', ') ||
                '—',
            },
            {
              key: 'status',
              header: 'Status',
              render: (r) => FEE_STATUS_LABELS[r.status as FeeRecordStatus],
            },
            { key: 'by', header: 'Recorded by', render: (r) => nameOf(d, r.recordedBy) },
            { key: 'notes', header: 'Reason or note', render: (r) => r.notes ?? '—' },
          ]}
        />
      </Segment>
      {record ? (
        <>
          <Disclosure summary="Log a demo fee entry">
            <ActionForm
              compact
              action="/ops/api/v1/fees"
              submitLabel="Save entry"
              amountLabel="Save {amount} entry"
              extra={{ admissionId: d.demo.admissionId, chargeCategory: 'demo', demoId: d.demo.id }}
              fields={[
                {
                  name: 'kind',
                  label: 'Entry',
                  type: 'select',
                  required: true,
                  options: (['due', 'received', 'waiver'] as const).map((k) => ({
                    value: k,
                    label: k === 'waiver' ? 'Waiver (reason required)' : FEE_KIND_LABELS[k],
                  })),
                },
                ...paymentFields,
                {
                  name: 'notes',
                  label: 'Reason or note (required for a waiver)',
                  type: 'textarea',
                },
              ]}
            />
          </Disclosure>
          {f.records
            .filter((r) => r.kind === 'received' && r.status !== 'voided')
            .map((r) => (
              <Disclosure
                key={r.id}
                summary={`Refund payment of ${fmtPaise(r.amountPaise)} (${fmtDate(r.paymentDate)})`}
              >
                <ActionForm
                  compact
                  action={`/ops/api/v1/fees/${r.id}`}
                  submitLabel="Record refund"
                  amountLabel="Record {amount} refund"
                  extra={{ action: 'refund' }}
                  variant="secondary"
                  fields={[...paymentFields, { name: 'notes', label: 'Reason', type: 'textarea' }]}
                />
              </Disclosure>
            ))}
        </>
      ) : null}
    </>
  );
}
