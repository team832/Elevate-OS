/**
 * Student administration (OPS-073…077) — pure rules. Algorithms: docs/parts/admissions.md → A-ADM-2, A-ADM-3.
 *
 * Business Ops does NOT keep a student master: Academic OS owns
 * `academic.students`. The Ops "student" is an admission that reached
 * `admitted` (the enrolment-handoff case), linked to Academic's record by the
 * `studentId` / `enrolmentId` that Academic returns in `academic.enrolment.confirmed`.
 * Students may be minors: contact, guardian and consent fields are private
 * (`ops:student_private:read`) and are removed from every other response.
 */
import type { AdmissionStatus } from './pipeline';

export const DIRECTORY_STATES = [
  'admitted',
  'awaiting_enrolment',
  'enrolled',
  'withdrawn',
] as const;
export type DirectoryState = (typeof DIRECTORY_STATES)[number];

export const DIRECTORY_STATE_LABELS: Record<DirectoryState, string> = {
  admitted: 'Admitted (enrolment not requested)',
  awaiting_enrolment: 'Awaiting Academic OS',
  enrolled: 'Enrolled (confirmed by Academic OS)',
  withdrawn: 'Withdrawn after admission',
};

/** The admission statuses that appear in the student directory. */
export const DIRECTORY_STATUSES: readonly AdmissionStatus[] = [
  'admitted',
  'enrolment_requested',
  'enrolled',
  'lost',
];

/**
 * Directory state of an admission, or null when it is not (yet) a student:
 * admitted / enrolment_requested / enrolled, or lost AFTER having been
 * admitted (withdrawn). A case lost before admission is a lost lead, not a student.
 */
export function directoryState(input: {
  status: AdmissionStatus;
  admittedAt: Date | string | null;
}): DirectoryState | null {
  switch (input.status) {
    case 'admitted':
      return 'admitted';
    case 'enrolment_requested':
      return 'awaiting_enrolment';
    case 'enrolled':
      return 'enrolled';
    case 'lost':
      return input.admittedAt ? 'withdrawn' : null;
    case 'on_hold':
      return null;
    default:
      return null;
  }
}

export type DeliveryStatus = 'processed' | 'failed' | 'dead';

export interface HandoffInput {
  status: AdmissionStatus;
  handoffStatus: 'not_requested' | 'pending' | 'enrolled' | 'rejected' | string;
  enrolmentAttempt: number;
  /** Academic's delivery of the LAST request event (consumer academic.enrolment-intake); null = not picked up. */
  academicDelivery: {
    status: DeliveryStatus | string;
    attempts: number;
    lastError: string | null;
  } | null;
  rejectionCode?: string | null;
  rejectionReason?: string | null;
}

export type HandoffView =
  | 'not_requested'
  | 'awaiting_pickup'
  | 'academic_retrying'
  | 'failed_needs_action'
  | 'awaiting_reply'
  | 'rejected'
  | 'enrolled'
  | 'closed';

export interface HandoffViewResult {
  view: HandoffView;
  label: string;
  tone: 'neutral' | 'info' | 'warning' | 'danger' | 'success';
  detail: string | null;
}

/** What the handoff looks like to a person. "Enrolled" only after Academic confirmed. */
export function deriveHandoffView(h: HandoffInput): HandoffViewResult {
  if (h.status === 'enrolled' || h.handoffStatus === 'enrolled')
    return { view: 'enrolled', label: 'Enrolled', tone: 'success', detail: null };
  if (h.status === 'enrolment_requested') {
    const d = h.academicDelivery;
    if (!d)
      return {
        view: 'awaiting_pickup',
        label: 'Requested — waiting for Academic OS to pick it up',
        tone: 'info',
        detail: `Attempt ${h.enrolmentAttempt}.`,
      };
    if (d.status === 'failed')
      return {
        view: 'academic_retrying',
        label: 'Academic OS failed to process it and will retry',
        tone: 'warning',
        detail: `${d.attempts} failed attempt(s). Last error: ${d.lastError ?? 'not recorded'}`,
      };
    if (d.status === 'dead')
      return {
        view: 'failed_needs_action',
        label: 'Handoff failed — needs a person',
        tone: 'danger',
        detail: `Academic OS gave up after ${d.attempts} attempt(s). Last error: ${d.lastError ?? 'not recorded'}`,
      };
    return {
      view: 'awaiting_reply',
      label: 'Processed by Academic OS — reply not yet applied',
      tone: 'info',
      detail: 'Run "enrolment replies" (or wait for the scheduler) to apply the answer.',
    };
  }
  if (h.handoffStatus === 'rejected')
    return {
      view: 'rejected',
      label: 'Rejected by Academic OS',
      tone: 'danger',
      detail: `${h.rejectionCode ?? 'OTHER'}: ${h.rejectionReason ?? 'no reason given'}`,
    };
  if (h.status === 'lost')
    return { view: 'closed', label: 'Case closed', tone: 'neutral', detail: null };
  return { view: 'not_requested', label: 'Not requested', tone: 'neutral', detail: null };
}

export type RetryDecision =
  | {
      allowed: true;
      kind: 'initial' | 'after_rejection' | 'after_failure';
      via: 'request' | 'retry';
    }
  | { allowed: false; reason: string };

/**
 * May a new handoff attempt be made, and of which kind? The rule that keeps
 * Academic from enrolling twice: a NEW request event is only published when
 * the previous one can no longer create an enrolment —
 *   - Academic rejected it (handoff `rejected`, admission back at `admitted`), or
 *   - Academic's delivery of it is `dead` (every try rolled back; processEvents
 *     never picks a dead delivery up again).
 * While the delivery is `failed` Academic retries automatically, so a parallel
 * request is refused.
 */
export function retryDecision(h: HandoffInput): RetryDecision {
  if (h.status === 'admitted')
    return h.handoffStatus === 'rejected'
      ? { allowed: true, kind: 'after_rejection', via: 'request' }
      : { allowed: true, kind: 'initial', via: 'request' };
  if (h.status !== 'enrolment_requested')
    return { allowed: false, reason: `The admission is ${h.status}; there is nothing to retry.` };
  const d = h.academicDelivery;
  if (!d) return { allowed: false, reason: 'Academic OS has not picked the request up yet.' };
  if (d.status === 'failed')
    return {
      allowed: false,
      reason:
        'Academic OS is retrying this request automatically; a parallel request could enrol the student twice.',
    };
  if (d.status === 'dead') return { allowed: true, kind: 'after_failure', via: 'retry' };
  return {
    allowed: false,
    reason: 'Academic OS processed the request; apply its reply (enrolment replies job).',
  };
}

/** Browser link to the Academic OS student record (plain <a>, another zone). */
export function academicStudentPath(studentId: string | null | undefined): string | null {
  return studentId ? `/academic/students/${studentId}` : null;
}

/** Fields that only `ops:student_private:read` may see (students may be minors). */
export const PRIVATE_STUDENT_FIELDS = [
  'studentPhone',
  'studentEmail',
  'guardianName',
  'guardianRelationship',
  'guardianPhone',
  'guardianEmail',
  'city',
  'previousSchool',
  'consent',
] as const;
export type PrivateStudentField = (typeof PRIVATE_STUDENT_FIELDS)[number];

/** A record whose private fields may be absent (removed for the caller). */
export type Redacted<T> = Omit<T, PrivateStudentField> &
  Partial<Pick<T, Extract<keyof T, PrivateStudentField>>> & { privateFields: 'visible' | 'hidden' };

/**
 * Return a copy without the private fields unless `canSeePrivate`. The marker
 * `privateFields: 'hidden'` tells the UI the data exists but is restricted.
 */
export function redactStudentPrivate<T extends Record<string, unknown>>(
  record: T,
  canSeePrivate: boolean,
): Redacted<T> {
  if (canSeePrivate) return { ...record, privateFields: 'visible' as const };
  const copy: Record<string, unknown> = { ...record };
  for (const f of PRIVATE_STUDENT_FIELDS) delete copy[f];
  return { ...(copy as Redacted<T>), privateFields: 'hidden' as const };
}

const PRIVATE_KEY_SET: ReadonlySet<string> = new Set(PRIVATE_STUDENT_FIELDS);

/**
 * Deep copy of a JSON-like value with every private key removed (used for
 * audit `before`/`after` payloads shown in histories). Non-plain values are
 * returned unchanged.
 */
export function stripPrivateKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPrivateKeys);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      if (!PRIVATE_KEY_SET.has(k)) out[k] = stripPrivateKeys(v);
    return out;
  }
  return value;
}
