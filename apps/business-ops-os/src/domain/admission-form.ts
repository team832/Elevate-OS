/**
 * The owner's paper "Student Admission & Fee Record" (21 Oct 2026), as data: the fields an
 * application holds beyond lead KYC, the section 05 document checklist, and the fee summary and
 * instalment tracker filled only from recorded ledger rows (never invented). Pure.
 */
import type { IsoDate } from './dates';
import {
  allocateInstalments,
  planTotals,
  type InstalmentLike,
  type PlanLedgerRow,
} from './fee-plans';
import { effectiveRecords } from './fees';
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

/**
 * Section 08: Registration, instalments 1..n, Other. Instalment rows reuse the Fees tab's
 * allocation (A-FEE-2 `allocateInstalments`: linked payments first, then the oldest due, net of
 * discounts/waivers/adjustments); registration and other non-agreement rows are as recorded.
 * Nothing recorded stays blank (null).
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
  return [
    {
      label: 'Registration',
      dueDate: null,
      duePaise: s.registrationFeePaise,
      ...reg,
      balancePaise:
        s.registrationFeePaise === null ? null : s.registrationFeePaise - (reg.receivedPaise ?? 0),
    },
    ...allocateInstalments(instalments, plan, today).map((a) => {
      const linked = received(live.filter((r) => r.instalmentId === a.instalment.id));
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

/** Section 07: registration + course fee − reductions (Fees tab `planTotals`); null where unknown. */
export function feeSummary(
  s: ApplicationSnapshot,
  records: readonly TrackerRecord[],
  instalments: readonly InstalmentLike[],
) {
  const planId = s.feeAgreement?.planId;
  const plan = records.filter((r) => planId && r.planId === planId);
  const hasReductions = effectiveRecords(plan).some(
    (r) => r.kind === 'discount' || r.kind === 'waiver' || r.kind === 'adjustment',
  );
  const course = s.feeAgreement?.totalPaise ?? null;
  const discountPaise =
    course !== null && hasReductions ? planTotals(course, instalments, plan).reductionsPaise : null;
  return {
    registrationPaise: s.registrationFeePaise,
    coursePaise: course,
    discountPaise,
    netPaise:
      course === null || s.registrationFeePaise === null
        ? null
        : course + s.registrationFeePaise - (discountPaise ?? 0),
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
