/**
 * Admission checklist (OPS-011) and the legacy confirmation checks (OPS-010, BR-OPS-6/7). Pure.
 * Algorithm documentation: docs/ALGORITHMS.md → A-04.
 *
 * Since D-040/D-041 an admission is confirmed ONLY by the password-confirmed final approval
 * (server/applications-confirm.ts), so the plain `admission_pending → admitted` transition always
 * reports `final_confirmation` and is refused. The remaining gaps are shown for information:
 * two fee verifications by two DIFFERENT people + an active fee agreement approved on its own (D-039)
 * (BR-OPS-7) and, when configured, documents: enforced again by the final confirmation
 * (server/applications.ts confirmationCheck).
 * Payment before admission is the setting `admission.payment_gate`. A demo fee is never an input.
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
  documents_verified: 'Required documents verified (checklist only; no files stored)',
  fee_verification_1: 'Fee arrangement — first verification',
  fee_verification_2: 'Fee arrangement — second verification (a different person)',
  down_payment_verified: 'Down payment verified (reference only; accounts system is the record)',
  kit_issued: 'Kit issued (box, T-shirt, bag)',
  communication_group_added: 'Added to the communication group',
  timetable_communicated: 'Timetable communicated',
  school_coordination: 'School admission coordination (if needed)',
  hostel_coordination: 'Hostel coordination (if needed)',
};

export interface CheckState {
  itemKey: AdmissionCheckItem;
  status: 'done' | 'not_done' | 'not_applicable';
  recordedBy: string;
}

export interface ConfirmationConfig {
  /** BR-OPS-6 (proposed): documents verified before confirmation. */
  requireDocuments: boolean;
}

export const DEFAULT_CONFIRMATION_CONFIG: ConfirmationConfig = { requireDocuments: true };

export type FeeApprovalState = 'none' | 'pending' | 'approved' | 'rejected' | 'withdrawn';

export type ReadinessGap =
  | 'documents_verified'
  | 'fee_verification_1'
  | 'fee_verification_2'
  | 'fee_verifiers_not_distinct'
  | 'fee_arrangement_approval'
  | 'programme_missing'
  | 'final_confirmation';

export const READINESS_GAP_LABELS: Record<ReadinessGap, string> = {
  documents_verified: 'Documents not verified',
  fee_verification_1: 'First fee verification missing',
  fee_verification_2: 'Second fee verification missing',
  fee_verifiers_not_distinct: 'Both fee verifications were recorded by the same person',
  fee_arrangement_approval: 'No active fee agreement approved by an authorised approver',
  programme_missing: 'No programme chosen for this admission',
  final_confirmation:
    'Not confirmed: use "Confirm admission" on the application (password re-check by an approver)',
};

/**
 * What is still missing before `admission_pending → admitted`. Never empty: the last gap is always
 * `final_confirmation` (only the final approval admits). Order is fixed for the UI and tests.
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
  gaps.push('final_confirmation');
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
      message: 'The two fee verifications must be recorded by two different people.',
    };
  }
  return { ok: true };
}
