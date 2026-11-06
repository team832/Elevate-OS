/** Shared view types for the fees section and its forms: payments, refunds, reversals, agreements. */
import { FEE_KIND_LABELS, FEE_METHODS } from '../domain/fees';
import type { studentFeePlans } from '../server/fees';
import { ActionForm, type FieldSpec } from './action-form';
import { fmtPaise } from './format';
import { options } from './list-controls';

export type View = Awaited<ReturnType<typeof studentFeePlans>>;
export type PlanView = View['plans'][number];
export type Entry = View['otherCharges'][number];
export type Level = 2 | 3;

export const API = '/ops/api/v1';
export const paymentFields: FieldSpec[] = [
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

export function Correct({ r }: { r: Entry }) {
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
export const dueDateFields = (current: readonly (string | null)[] = [null, null, null]) =>
  current.map((dueDate, n): FieldSpec => ({
    name: `dueDates.${n}`,
    label: `Instalment ${n + 1} due date`,
    type: 'date',
    required: true,
    defaultValue: dueDate ?? undefined,
  }));

/** `reduce`: may post discounts, waivers and credits (approver, not the agreement's maker; proposed O2). */
export function EntryForm({ action, p, reduce }: { action: string; p: PlanView; reduce: boolean }) {
  return (
    <details>
      <summary>
        {reduce
          ? 'Record a payment, discount, waiver or adjustment'
          : 'Record a payment or adjustment'}
      </summary>
      <p className="el-field-hint">
        Still owed on this agreement: {fmtPaise(p.totals.outstandingPaise)}. A larger payment is
        accepted and shows as credit; a larger discount, waiver or credit is refused.
      </p>
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

export function CreateAgreement({
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
