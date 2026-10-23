/**
 * Admission applications (owner brief 21 Oct 2026 §6): the status machine, what an application
 * must contain before review and before final confirmation, who must sign, the payment gate and
 * the canonical content that decides a "material change". Pure. Algorithm: docs/ALGORITHMS.md
 * (A-APP-1 … A-APP-4, docs agent). Completing an application never admits anyone: only the
 * password-confirmed approval does (server/applications-confirm.ts).
 */
import type { ApplicationFormFields } from './admission-form';
import type { IsoDate } from './dates';

export const APPLICATION_STATUSES = [
  'draft',
  'ready_for_review',
  'form_generated',
  'signatures_confirmed',
  'admission_confirmed',
  'withdrawn',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** List wording: what each status is waiting for (brief §4 "awaiting information, signatures or approval"). */
export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  draft: 'Draft — awaiting information',
  ready_for_review: 'Ready — form to generate',
  form_generated: 'Form generated — awaiting signatures',
  signatures_confirmed: 'Signatures confirmed — awaiting approval',
  admission_confirmed: 'Admission confirmed',
  withdrawn: 'Withdrawn',
};

export type ApplicationAction =
  'save' | 'mark_ready' | 'generate_form' | 'confirm_signatures' | 'confirm_admission' | 'withdraw';

/** Statuses each action may start from (a new version from `save` always goes back to draft). */
const FROM: Record<ApplicationAction, readonly ApplicationStatus[]> = {
  save: ['draft', 'ready_for_review', 'form_generated', 'signatures_confirmed'],
  mark_ready: ['draft'],
  generate_form: ['ready_for_review', 'form_generated', 'signatures_confirmed'],
  confirm_signatures: ['form_generated'],
  confirm_admission: ['signatures_confirmed'],
  withdraw: ['draft', 'ready_for_review', 'form_generated', 'signatures_confirmed'],
};

const NEEDS: Partial<Record<ApplicationAction, string>> = {
  mark_ready: 'Only a draft can be marked ready for review.',
  generate_form: 'Mark the application ready for review before generating the form.',
  confirm_signatures: 'Generate the admission form for the current version first.',
  confirm_admission: 'Confirm the physical signatures on the current form first.',
};

/** null = allowed; otherwise why not. */
export function applicationActionBlocked(
  status: ApplicationStatus,
  action: ApplicationAction,
): string | null {
  if (FROM[action].includes(status)) return null;
  if (status === 'admission_confirmed') return 'The admission is already confirmed.';
  if (status === 'withdrawn') return 'The application was withdrawn.';
  return NEEDS[action] ?? `Not possible while the application is ${status}.`;
}

/** Status after a successful action (save without a material change keeps the status). */
export function statusAfter(
  status: ApplicationStatus,
  action: ApplicationAction,
): ApplicationStatus {
  switch (action) {
    case 'save':
      return 'draft';
    case 'mark_ready':
      return 'ready_for_review';
    case 'generate_form':
      return status === 'ready_for_review' ? 'form_generated' : status;
    case 'confirm_signatures':
      return 'signatures_confirmed';
    case 'confirm_admission':
      return 'admission_confirmed';
    case 'withdraw':
      return 'withdrawn';
  }
}

// --- content -------------------------------------------------------------------------------------

export interface SnapshotGuardian {
  id: string | null;
  fullName: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  isPrimary: boolean;
  isEmergency: boolean;
}

/** Everything the form prints. All of it is material: any change makes a new version. */
export interface ApplicationSnapshot {
  student: {
    fullName: string;
    preferredName: string | null;
    phone: string | null;
    email: string | null;
    dateOfBirth: string | null;
    currentStage: string | null;
    schoolBoard: string | null;
    previousSchool: string | null;
    city: string | null;
    address: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
  };
  guardians: SnapshotGuardian[];
  /** The bundle: one admission case per programme, primary first. */
  programmes: { admissionId: string; code: string; name: string }[];
  intendedBatchId: string | null;
  deliveryMode: string | null;
  startDate: string | null;
  academicYear: string | null;
  /** The approved annual fee agreement (an active fee plan); null = none yet. */
  feeAgreement: {
    planId: string;
    version: number;
    label: string;
    totalPaise: number;
    academicYear: string | null;
    instalments: { sequence: number; dueDate: string; amountPaise: number }[];
  } | null;
  /** Setting `fees.registration`; null = not set (no charge assumed). */
  registrationFeePaise: number | null;
  /** Setting `admissions.declarations`; null = not configured by the owner. */
  declarations: { text: string; version: string } | null;
  /** Answers held by the application itself (the owner's paper form). */
  form: ApplicationFormFields;
  counsellorName: string | null;
}

/** Stable JSON (sorted keys): the input of the content hash, so key order never fakes a change. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}

/** Plain words for a snapshot part, as staff see it in "Changed: …". */
export const SNAPSHOT_PART_LABELS: Record<keyof ApplicationSnapshot, string> = {
  student: 'student details',
  guardians: 'parents or guardians',
  programmes: 'programmes',
  intendedBatchId: 'batch',
  deliveryMode: 'delivery mode',
  startDate: 'start date',
  academicYear: 'academic year',
  feeAgreement: 'fee agreement',
  registrationFeePaise: 'registration fee',
  declarations: 'declarations',
  form: 'form answers',
  counsellorName: 'counsellor',
};
export const partLabels = (parts: readonly string[]) =>
  parts.map((p) => SNAPSHOT_PART_LABELS[p as keyof ApplicationSnapshot] ?? p).join(', ');

/** Top-level parts that differ between two versions (for the audit and the version history). */
export function changedParts(a: ApplicationSnapshot, b: ApplicationSnapshot): string[] {
  return (Object.keys(b) as (keyof ApplicationSnapshot)[]).filter(
    (k) => k !== 'counsellorName' && canonicalJson(a[k]) !== canonicalJson(b[k]),
  );
}

// --- age and signers -----------------------------------------------------------------------------

/** Whole years on `day` (IST calendar dates); null without a date of birth. */
export function ageOn(dateOfBirth: string | null, day: IsoDate): number | null {
  if (!dateOfBirth) return null;
  const [y, m, d] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = day.split('-').map(Number) as [number, number, number];
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}

export type SignerRule = { student: boolean; guardian: 'always' | 'if_under_18' | 'never' };

/** Setting `admissions.signatures.required_signers`; no date of birth ⇒ a guardian must sign. */
export function requiredSigners(rule: SignerRule, dateOfBirth: string | null, day: IsoDate) {
  const age = ageOn(dateOfBirth, day);
  return {
    student: rule.student,
    guardian:
      rule.guardian === 'always' || (rule.guardian === 'if_under_18' && (age === null || age < 18)),
  };
}

export {
  APPLICATION_TASK_LABELS,
  APPLICATION_TASKS,
  confirmationGaps,
  confirmationTasks,
  DECLARATIONS_MISSING,
  DECLARATIONS_PROPOSED,
  informationGaps,
  paymentGap,
  type ApplicationTask,
  type Gap,
  type PaymentRule,
  type SignatureRecord,
  type TaskState,
} from './applications-gaps';

/** How a programme is taught (`admissions.delivery_mode`). */
export const DELIVERY_MODE_LABELS: Record<string, string> = {
  offline: 'Offline (Sikar centre)',
  online: 'Online',
  hybrid: 'Online and offline',
};
