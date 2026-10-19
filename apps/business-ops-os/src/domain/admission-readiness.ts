/**
 * Admission confirmation gate (OPS-010, BR-OPS-6, BR-OPS-7) and the admission
 * checklist (OPS-011). Pure. Algorithm documentation: docs/ALGORITHMS.md → A-04.
 *
 * Fixed (approved rule BR-OPS-7, legacy OP-010 "Confirmed"): two fee
 * verifications by two DIFFERENT people + an authorised fee-arrangement
 * approval. Configurable (proposed rule BR-OPS-6): documents verified, down
 * payment verified. A demo fee is never an input here — a demo fee alone is not
 * admission.
 */

export const ADMISSION_CHECK_ITEMS = [
  'admission_form',
  'documents_verified',
  'fee_verification_1',
  'fee_verification_2',
  'down_payment_verified',
  'kit_issued',
  'communication_group_added',
  'timetable_communicated',
  'school_coordination',
  'hostel_coordination',
] as const;
export type AdmissionCheckItem = (typeof ADMISSION_CHECK_ITEMS)[number];

export const ADMISSION_CHECK_LABELS: Record<AdmissionCheckItem, string> = {
  admission_form: 'Admission form received',
  documents_verified: 'Required documents verified (checklist only; no files stored, OD-014)',
  fee_verification_1: 'Fee arrangement — first verification',
  fee_verification_2: 'Fee arrangement — second verification (a different person)',
  down_payment_verified:
    'Down payment verified (reference only; accounts system is the record, OD-013)',
  kit_issued: 'Kit issued (box, T-shirt, bag)',
  communication_group_added: 'Added to the communication group',
  timetable_communicated: 'Timetable communicated',
  school_coordination: 'School admission coordination (if needed)',
  hostel_coordination: 'Hostel coordination (if needed)',
};

/** Items that are onboarding steps after confirmation (OPS-011), never part of the gate. */
export const ONBOARDING_CHECK_ITEMS: readonly AdmissionCheckItem[] = [
  'kit_issued',
  'communication_group_added',
  'timetable_communicated',
  'school_coordination',
  'hostel_coordination',
];

export interface CheckState {
  itemKey: AdmissionCheckItem;
  status: 'done' | 'not_done' | 'not_applicable';
  recordedBy: string;
}

export interface ConfirmationConfig {
  /** BR-OPS-6 (proposed): documents verified before confirmation. */
  requireDocuments: boolean;
  /** BR-OPS-6 (proposed): verified down payment before confirmation. */
  requireDownPayment: boolean;
}

export const DEFAULT_CONFIRMATION_CONFIG: ConfirmationConfig = {
  requireDocuments: true,
  requireDownPayment: true,
};

export type FeeApprovalState = 'none' | 'pending' | 'approved' | 'rejected' | 'withdrawn';

export type ReadinessGap =
  | 'admission_form'
  | 'documents_verified'
  | 'fee_verification_1'
  | 'fee_verification_2'
  | 'fee_verifiers_not_distinct'
  | 'fee_arrangement_approval'
  | 'down_payment_verified'
  | 'programme_missing';

export const READINESS_GAP_LABELS: Record<ReadinessGap, string> = {
  admission_form: 'Admission form not recorded',
  documents_verified: 'Documents not verified',
  fee_verification_1: 'First fee verification missing',
  fee_verification_2: 'Second fee verification missing',
  fee_verifiers_not_distinct: 'Both fee verifications were recorded by the same person',
  fee_arrangement_approval: 'Fee arrangement not approved by an authorised approver',
  down_payment_verified: 'Down payment not verified',
  programme_missing: 'No programme chosen for this admission',
};

/**
 * What is still missing before `admission_pending → admitted`. Empty = ready.
 * Order is fixed so the UI and tests are deterministic.
 */
export function evaluateAdmissionReadiness(input: {
  checks: readonly CheckState[];
  feeApproval: FeeApprovalState;
  hasProgramme: boolean;
  config?: ConfirmationConfig;
}): ReadinessGap[] {
  const config = input.config ?? DEFAULT_CONFIRMATION_CONFIG;
  const byKey = new Map(input.checks.map((c) => [c.itemKey, c]));
  const done = (key: AdmissionCheckItem) => byKey.get(key)?.status === 'done';
  const gaps: ReadinessGap[] = [];
  if (!input.hasProgramme) gaps.push('programme_missing');
  if (!done('admission_form')) gaps.push('admission_form');
  if (config.requireDocuments && !done('documents_verified')) gaps.push('documents_verified');
  if (!done('fee_verification_1')) gaps.push('fee_verification_1');
  if (!done('fee_verification_2')) gaps.push('fee_verification_2');
  if (
    done('fee_verification_1') &&
    done('fee_verification_2') &&
    byKey.get('fee_verification_1')?.recordedBy === byKey.get('fee_verification_2')?.recordedBy
  ) {
    gaps.push('fee_verifiers_not_distinct');
  }
  if (input.feeApproval !== 'approved') gaps.push('fee_arrangement_approval');
  if (config.requireDownPayment && !done('down_payment_verified'))
    gaps.push('down_payment_verified');
  return gaps;
}

/**
 * May `actorUserId` record `itemKey` as done? Fee verification 2 must be by a
 * different person from verification 1 (and vice versa), checked at entry time
 * as well as in the gate.
 */
export function checkVerifierSeparation(
  itemKey: AdmissionCheckItem,
  actorUserId: string,
  checks: readonly CheckState[],
): { ok: true } | { ok: false; message: string } {
  const other =
    itemKey === 'fee_verification_1'
      ? 'fee_verification_2'
      : itemKey === 'fee_verification_2'
        ? 'fee_verification_1'
        : null;
  if (!other) return { ok: true };
  const counterpart = checks.find((c) => c.itemKey === other && c.status === 'done');
  if (counterpart && counterpart.recordedBy === actorUserId) {
    return {
      ok: false,
      message: 'The two fee verifications must be recorded by two different people (BR-OPS-7).',
    };
  }
  return { ok: true };
}
