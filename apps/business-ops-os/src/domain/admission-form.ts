/**
 * The owner's paper "Student Admission & Fee Record" (21 Oct 2026), as data: the fields an
 * application holds beyond lead KYC, the section 05 document checklist, and the fee summary and
 * instalment tracker filled only from recorded ledger rows (never invented). Pure.
 */
import type { IsoDate } from './dates';
import {
  allocateInstalments,
  owedAboveInstalments,
  planTotals,
  type AllocatedInstalment,
  type InstalmentLike,
  type PlanLedgerRow,
} from './fee-plans';
import { effectiveRecords, ledgerSums } from './fees';
import type { ApplicationSnapshot } from './applications';

/** Application-owned answers on the form (kept in the version snapshot; no columns elsewhere). */
export interface ApplicationFormFields {
  gender: string | null;
  whatsapp: string | null;
  guardianOccupation: string | null;
  guardianOfficeAddress: string | null;
  guardianAlternateContact: string | null;
  qualification: string | null;
  yearOfPassing: string | null;
  percentageOrGrade: string | null;
  subjectsOrStream: string | null;
  batchTiming: string | null;
  /** T&C clause 8: not given until recorded (who and when). */
  resultPublicityConsent: { given: boolean; recordedBy: string; recordedAt: string } | null;
}

export const EMPTY_FORM_FIELDS: ApplicationFormFields = {
  gender: null,
  whatsapp: null,
  guardianOccupation: null,
  guardianOfficeAddress: null,
  guardianAlternateContact: null,
  qualification: null,
  yearOfPassing: null,
  percentageOrGrade: null,
  subjectsOrStream: null,
  batchTiming: null,
  resultPublicityConsent: null,
};

/** Section 05 "Document check": each row is met by a verified document of one of its types. */
export const FORM_DOCUMENTS = [
  {
    key: 'id_proof',
    label: 'ID proof',
    types: ['aadhaar', 'pan', 'passport', 'driving_licence', 'voter_id', 'school_id'],
  },
  { key: 'photograph', label: 'Photograph', types: ['photograph'] },
  {
    key: 'previous_marksheet',
    label: 'Previous marksheet / qualification',
    types: ['previous_marksheet'],
  },
  { key: 'address_proof', label: 'Address proof', types: ['address_proof'] },
  { key: 'other', label: 'Other', types: ['other'] },
] as const;

export type DocumentState = 'verified' | 'unverified' | 'rejected' | 'not_recorded';
export const DOCUMENT_STATE_LABELS: Record<DocumentState, string> = {
  verified: 'Verified',
  unverified: 'Recorded, not verified',
  rejected: 'Rejected',
  not_recorded: 'Not recorded',
};

/** The checklist from the student's live documents: the best state among the row's types. */
export function documentChecklist(
  docs: readonly { documentType: string; verificationStatus: string }[],
) {
  const order: DocumentState[] = ['verified', 'unverified', 'rejected'];
  return FORM_DOCUMENTS.map((row) => {
    const states = docs
      .filter((d) => (row.types as readonly string[]).includes(d.documentType))
      .map((d) => d.verificationStatus as DocumentState);
    return {
      key: row.key,
      label: row.label,
      state: order.find((s) => states.includes(s)) ?? ('not_recorded' as DocumentState),
    };
  });
}

/** A ledger row as the tracker needs it. */
export type TrackerRecord = PlanLedgerRow & {
  planId?: string | null;
  paymentDate?: string | null;
  method?: string | null;
};
export interface TrackerRow {
  label: string;
  dueDate: string | null;
  duePaise: number | null;
  receivedPaise: number | null;
  lastReceiptDate: string | null;
  mode: string | null;
  balancePaise: number | null;
}

/** Received − refunded, latest receipt date and modes of some rows; all null when none. */
function received(rows: readonly TrackerRecord[]) {
  const paid = rows.filter((r) => r.kind === 'received');
  const net = rows.reduce(
    (t, r) =>
      t + (r.kind === 'received' ? r.amountPaise : r.kind === 'refund' ? -r.amountPaise : 0),
    0,
  );
  return {
    receivedPaise: paid.length ? net : null,
    lastReceiptDate:
      paid
        .map((r) => r.paymentDate ?? '')
        .sort()
        .at(-1) || null,
    mode: [...new Set(paid.map((r) => r.method).filter(Boolean))].join(', ') || null,
  };
}

/** Discounts, waivers and credits less debits of the registration fee. */
function registrationReductions(records: readonly TrackerRecord[]) {
  const s = ledgerSums(records.filter((r) => r.chargeCategory === 'registration'));
  return s.discount + s.waiver + s.credit - s.debit;
}

/**
 * The payments behind each instalment's paid amount, in the allocation's own order (A-FEE-2): the
 * payments naming it first, then those naming none, oldest first. Only for its date and mode.
 */
function paymentsByInstalment(
  allocated: readonly AllocatedInstalment[],
  rows: readonly TrackerRecord[],
) {
  const left = new Map(
    rows
      .filter((r) => r.kind === 'received')
      .sort((a, b) => (a.paymentDate ?? '').localeCompare(b.paymentDate ?? ''))
      .map((r) => [r, r.amountPaise]),
  );
  const fill = (id: string, want: number) => {
    const rank = (r: TrackerRecord) => (r.instalmentId === id ? 0 : r.instalmentId ? 2 : 1);
    const from: TrackerRecord[] = [];
    let need = want;
    for (const r of [...left.keys()].sort((a, b) => rank(a) - rank(b))) {
      const take = Math.min(need, left.get(r)!);
      if (take <= 0) continue;
      left.set(r, left.get(r)! - take);
      need -= take;
      from.push(r);
    }
    return from;
  };
  return new Map(allocated.map((a) => [a.instalment.id, fill(a.instalment.id, a.paidPaise)]));
}

/**
 * Section 08: Registration, instalments 1..n, what a debit adds above them, money above what is
 * owed, Other. Instalment rows reuse the Fees tab's allocation (A-FEE-2 `allocateInstalments`:
 * linked payments first, then the oldest due, net of discounts/waivers/adjustments); registration
 * and other non-agreement rows are as recorded. `records` hold the agreement's rows as they count
 * for this version (versionRows). Nothing recorded stays blank (null).
 */
export function feeTracker(
  s: ApplicationSnapshot,
  records: readonly TrackerRecord[],
  instalments: readonly InstalmentLike[],
  today: IsoDate,
): TrackerRow[] {
  const live = effectiveRecords(records).filter(
    (r) => r.kind === 'received' || r.kind === 'refund',
  );
  const planId = s.feeAgreement?.planId;
  const plan = effectiveRecords(records).filter((r) => planId && r.planId === planId);
  const regRows = live.filter((r) => r.chargeCategory === 'registration');
  const reg = received(regRows);
  const ordinal = ['1st', '2nd', '3rd'];
  const allocated = allocateInstalments(instalments, plan, today);
  const behind = paymentsByInstalment(allocated, plan);
  const totals = planTotals(s.feeAgreement?.totalPaise ?? 0, instalments, plan);
  const above = s.feeAgreement ? owedAboveInstalments(totals, allocated) : 0;
  const line = (label: string, amount: Partial<TrackerRow>): TrackerRow => ({
    label,
    dueDate: null,
    duePaise: null,
    receivedPaise: null,
    lastReceiptDate: null,
    mode: null,
    balancePaise: null,
    ...amount,
  });
  return [
    {
      label: 'Registration',
      dueDate: null,
      duePaise: s.registrationFeePaise,
      ...reg,
      balancePaise:
        s.registrationFeePaise === null
          ? null
          : s.registrationFeePaise - (reg.receivedPaise ?? 0) - registrationReductions(records),
    },
    ...allocated.map((a) => {
      const linked = received(behind.get(a.instalment.id) ?? []);
      return {
        label: `${ordinal[a.instalment.sequence - 1] ?? `${a.instalment.sequence}th`} instalment`,
        dueDate: a.instalment.dueDate,
        duePaise: a.instalment.amountPaise,
        receivedPaise: a.paidPaise || null,
        lastReceiptDate: linked.lastReceiptDate,
        mode: linked.mode,
        balancePaise: a.remainingPaise,
      };
    }),
    ...(above > 0 ? [line('Debit adjustments', { duePaise: above, balancePaise: above })] : []),
    ...(s.feeAgreement && totals.creditPaise > 0
      ? [
          line('Paid above what is owed', {
            receivedPaise: totals.creditPaise,
            balancePaise: -totals.creditPaise,
          }),
        ]
      : []),
    {
      label: 'Other',
      dueDate: null,
      duePaise: null,
      ...received(
        live.filter((r) => r.chargeCategory !== 'registration' && !(planId && r.planId === planId)),
      ),
      balancePaise: null,
    },
  ];
}

/**
 * Section 07: registration + course fee − discounts + debits, on the agreement and the registration
 * fee; null where unknown. A discount prints at its real value and a debit apart: the Fees tab's
 * `reductionsPaise` is net of debits, which on a signed paper would understate the discount.
 */
export function feeSummary(
  s: ApplicationSnapshot,
  records: readonly TrackerRecord[],
) {
  const planId = s.feeAgreement?.planId;
  const sums = ledgerSums(
    records.filter((r) => (planId && r.planId === planId) || r.chargeCategory === 'registration'),
  );
  const discountPaise = sums.discount + sums.waiver + sums.credit;
  const course = s.feeAgreement?.totalPaise ?? null;
  return {
    registrationPaise: s.registrationFeePaise,
    coursePaise: course,
    discountPaise: discountPaise || null,
    debitPaise: sums.debit,
    netPaise:
      course === null || s.registrationFeePaise === null
        ? null
        : course + s.registrationFeePaise - discountPaise + sums.debit,
  };
}

/**
 * The approved declaration text split into its titled sections: a line that neither ends with
 * a full stop nor starts with a clause number is a title. Text without titles is one section.
 */
export function declarationSections(text: string) {
  const out: { title: string | null; lines: string[] }[] = [];
  for (const line of text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)) {
    const title = !/[.:]$/.test(line) && !/^\d+[.)]/.test(line);
    if (title) out.push({ title: line, lines: [] });
    else if (out.length) out.at(-1)!.lines.push(line);
    else out.push({ title: null, lines: [line] });
  }
  return out;
}
