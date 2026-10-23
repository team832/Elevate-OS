/**
 * Application completeness (domain/applications.ts): what is missing before review and before
 * final confirmation, as gaps grouped into the confirmation task list. Pure.
 */
import {
  APPLICATION_STATUSES,
  requiredSigners,
  type ApplicationSnapshot,
  type ApplicationStatus,
  type SignerRule,
  type SnapshotGuardian,
} from './applications';
import type { IsoDate } from './dates';

type Settings = {
  studentFields: readonly string[];
  guardianFields: readonly string[];
  signerRule: SignerRule;
};

const STUDENT_FIELD: Record<string, keyof ApplicationSnapshot['student']> = {
  preferred_name: 'preferredName',
  student_phone: 'phone',
  student_email: 'email',
  date_of_birth: 'dateOfBirth',
  current_stage: 'currentStage',
  school_board: 'schoolBoard',
  previous_school: 'previousSchool',
  city: 'city',
  address: 'address',
};
const GUARDIAN_FIELD: Record<string, keyof SnapshotGuardian> = {
  full_name: 'fullName',
  relationship: 'relationship',
  phone: 'phone',
  email: 'email',
  address: 'address',
};
const LABEL: Record<string, string> = {
  preferred_name: 'preferred name',
  student_phone: 'phone',
  student_email: 'email',
  date_of_birth: 'date of birth',
  current_stage: 'class / category',
  school_board: 'school board',
  previous_school: 'school',
  city: 'city',
  address: 'address',
  full_name: 'name',
  relationship: 'relationship',
  phone: 'phone',
  email: 'email',
};

export const DECLARATIONS_MISSING =
  'Declaration text not configured — owner to supply (setting "Admission declarations"). Admissions cannot be confirmed until approved text is set.';
export const DECLARATIONS_PROPOSED =
  'Declaration text is entered but not approved — the owner must approve it (decision record) before admissions can be confirmed.';

/** The confirmation tasks, in order (GOV.UK task-list pattern; brief §6 gates). */
export const APPLICATION_TASKS = [
  'details',
  'fee_agreement',
  'documents',
  'declarations',
  'form',
  'signatures',
  'payment',
] as const;
export type ApplicationTask = (typeof APPLICATION_TASKS)[number];
export const APPLICATION_TASK_LABELS: Record<ApplicationTask, string> = {
  details: 'Student, guardian and programme details',
  fee_agreement: 'Approved annual fee agreement and fee checks',
  documents: 'Documents verified',
  declarations: 'Approved declaration text',
  form: 'Admission form printed for this version',
  signatures: 'Physical signatures confirmed',
  payment: 'Payment before admission (configured rule)',
};
/**
 * One missing item and the task it belongs to. `fix` names the record edited outside the
 * application form: the lead's contacts, or its owner (the counsellor unless the case names one).
 */
export type Gap = { task: ApplicationTask; message: string; fix?: 'contact' | 'counsellor' };
export type TaskState = 'completed' | 'incomplete' | 'cannot_start';

/**
 * Task list from the server's gaps: a task with gaps is incomplete; printing and signing cannot
 * start before the application has reached that step. Nothing is decided here that the server's
 * gap check did not return.
 */
export function confirmationTasks(
  status: ApplicationStatus,
  gaps: readonly Gap[],
  formPrinted: boolean,
) {
  const reached = (s: ApplicationStatus) =>
    APPLICATION_STATUSES.indexOf(status) >= APPLICATION_STATUSES.indexOf(s);
  return APPLICATION_TASKS.map((task) => {
    const missing = gaps.filter((g) => g.task === task);
    const blocked =
      (task === 'form' && !reached('ready_for_review')) ||
      (task === 'signatures' && !reached('form_generated'));
    const open = missing.length > 0 || (task === 'form' && !formPrinted);
    const state: TaskState = !open ? 'completed' : blocked ? 'cannot_start' : 'incomplete';
    return { task, label: APPLICATION_TASK_LABELS[task], state, missing };
  });
}

/**
 * What is missing before an application can be marked ready for review (KYC per setting
 * `admissions.kyc.required_fields`, a guardian when one must sign, programmes, academic year,
 * the approved fee agreement, a counsellor for the Academic handoff). Empty = complete.
 */
export function informationGaps(
  s: ApplicationSnapshot,
  settings: Settings,
  extra: { counsellorAssigned: boolean; today: IsoDate },
): Gap[] {
  const out: Gap[] = [];
  const gap = (message: string, fix?: Gap['fix']) =>
    out.push({ task: 'details', message, ...(fix && { fix }) });
  const guardian = s.guardians.find((g) => g.isPrimary) ?? s.guardians[0] ?? null;
  for (const key of settings.studentFields) {
    const field = STUDENT_FIELD[key];
    if (!field || s.student[field]) continue;
    // A child need not have their own phone or email when a guardian's is recorded (brief §5).
    if (key === 'student_phone' && guardian?.phone) continue;
    if (key === 'student_email' && guardian?.email) continue;
    gap(
      `Student ${LABEL[key]} is missing`,
      key === 'student_phone' || key === 'student_email' ? 'contact' : undefined,
    );
  }
  const needsGuardian =
    requiredSigners(settings.signerRule, s.student.dateOfBirth, extra.today).guardian ||
    settings.guardianFields.length > 0;
  if (needsGuardian && !guardian) gap('No guardian recorded', 'contact');
  if (guardian)
    for (const key of settings.guardianFields) {
      const field = GUARDIAN_FIELD[key];
      // A guardian with an id is on the student profile, not on the lead.
      if (field && !guardian[field])
        gap(`Guardian ${LABEL[key]} is missing`, guardian.id ? undefined : 'contact');
    }
  if (!s.programmes.length) gap('No programme chosen');
  if (!s.academicYear) gap('No academic year');
  if (!s.deliveryMode) gap('No mode (offline or online)');
  if (!s.startDate) gap('No start date');
  if (!extra.counsellorAssigned)
    gap('No counsellor assigned (Academic OS needs one)', 'counsellor');
  const fee = s.feeAgreement;
  if (!fee)
    out.push({
      task: 'fee_agreement',
      message: 'No approved annual fee agreement (an active fee plan) for this admission',
    });
  else if (s.academicYear && fee.academicYear && fee.academicYear !== s.academicYear)
    out.push({
      task: 'fee_agreement',
      message: `The fee agreement is for ${fee.academicYear}; the application is for ${s.academicYear}`,
    });
  return out;
}

export type PaymentRule = 'none' | 'registration_fee' | 'first_instalment';

/** Setting `admission.payment_gate`: only the configured rule is enforced; null = satisfied. */
export function paymentGap(
  rule: PaymentRule,
  s: ApplicationSnapshot,
  paid: { registrationPaise: number; tuitionPaise: number },
): string | null {
  if (rule === 'registration_fee') {
    if (s.registrationFeePaise === null)
      return 'The payment rule needs the registration fee, but its amount is not set (setting "Registration fee").';
    return paid.registrationPaise >= s.registrationFeePaise
      ? null
      : 'Registration fee not recorded as received';
  }
  if (rule === 'first_instalment') {
    const first = s.feeAgreement?.instalments[0];
    if (!first) return 'No first tuition instalment to check';
    return paid.tuitionPaise >= first.amountPaise
      ? null
      : 'First tuition instalment not recorded as received';
  }
  return null;
}

export interface SignatureRecord {
  version: number;
  formVersion: number;
  signedOn: string;
  signers: { role: 'student' | 'guardian' }[];
}

/**
 * Everything checked again, on the server, at final confirmation (brief §6): information gaps,
 * APPROVED declarations, mandatory identity documents verified, a live signature confirmation for
 * the current version with the required signers, the payment gate. Empty = may be confirmed.
 */
export function confirmationGaps(input: {
  snapshot: ApplicationSnapshot;
  settings: Settings & { mandatoryDocuments: readonly string[]; paymentRule: PaymentRule };
  /** Declaration text is stored but its setting is not approved. */
  declarationsProposed: boolean;
  currentVersion: number;
  signature: SignatureRecord | null;
  verifiedDocuments: readonly string[];
  paid: { registrationPaise: number; tuitionPaise: number };
  counsellorAssigned: boolean;
  today: IsoDate;
}): Gap[] {
  const { snapshot: s, settings, signature } = input;
  const gaps = informationGaps(s, settings, input);
  const add = (task: ApplicationTask, message: string) => gaps.push({ task, message });
  if (!s.declarations)
    add('declarations', input.declarationsProposed ? DECLARATIONS_PROPOSED : DECLARATIONS_MISSING);
  for (const type of settings.mandatoryDocuments)
    if (!input.verifiedDocuments.includes(type))
      add('documents', `Identity document "${type}" not verified`);
  if (!signature) add('signatures', 'Physical signatures not confirmed');
  else if (
    signature.version !== input.currentVersion ||
    signature.formVersion !== input.currentVersion
  )
    add(
      'signatures',
      `The signed form is version ${signature.version}; the application is now version ${input.currentVersion}. Generate and sign the new form.`,
    );
  else {
    const need = requiredSigners(
      settings.signerRule,
      s.student.dateOfBirth,
      signature.signedOn as IsoDate,
    );
    for (const role of ['student', 'guardian'] as const)
      if (need[role] && !signature.signers.some((x) => x.role === role))
        add('signatures', `The ${role}'s signature is required`);
  }
  const pay = paymentGap(settings.paymentRule, s, input.paid);
  if (pay) add('payment', pay);
  return gaps;
}
