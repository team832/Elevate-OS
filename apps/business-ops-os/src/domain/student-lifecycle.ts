/**
 * Students after conversion (owner brief 20 Oct 2026 §7–§9, §14–§15). Pure.
 * Algorithms: docs/parts/admissions-students.md → A-STU-2 … A-STU-6.
 */
import {
  ADMISSION_STATUS_LABELS,
  EXIT_STATUSES,
  type AdmissionStatus,
  type ExitStatus,
} from './pipeline';
import { directoryState, DIRECTORY_STATE_LABELS } from './students';

// --- populations (A-STU-2) ----------------------------------------------------------------------

export type StudentPopulation = 'active' | 'on_hold' | 'former' | 'in_admission';

/**
 * Where an admission belongs once it has a student identity:
 * - active  = admission AND enrolment satisfied (`enrolled`);
 * - on_hold = paused after enrolment (on hold, held from `enrolled`);
 * - former  = an exit status, or the legacy "lost after admission";
 * - in_admission = everything still in the admissions pipeline.
 */
export function studentPopulation(a: {
  status: AdmissionStatus;
  heldFromStatus?: string | null;
  admittedAt?: Date | string | null;
}): StudentPopulation {
  if (a.status === 'enrolled') return 'active';
  if (a.status === 'on_hold' && a.heldFromStatus === 'enrolled') return 'on_hold';
  if ((EXIT_STATUSES as readonly string[]).includes(a.status)) return 'former';
  if (a.status === 'lost' && a.admittedAt) return 'former';
  return 'in_admission';
}

export const isExitStatus = (s: string): s is ExitStatus =>
  (EXIT_STATUSES as readonly string[]).includes(s);

/**
 * Cases that keep a student active (directory status is per student, brief §3/§11): admission
 * confirmed, awaiting or in enrolment, or paused after one of those (on hold is not past).
 */
export const ACTIVE_CASE_STATUSES = ['admitted', 'enrolment_requested', 'enrolled'] as const;

/** Past-student outcomes (brief §11): `withdrawn` is the early withdrawal, `completed` the normal end. */
export const PAST_OUTCOMES = ['withdrawn_early', 'completed', 'other'] as const;
export type PastOutcome = (typeof PAST_OUTCOMES)[number];
export const PAST_OUTCOME_LABELS: Record<PastOutcome, string> = {
  withdrawn_early: 'Withdrawn early',
  completed: 'Completed',
  other: 'Other exits',
};
/** Statuses of each outcome (`lost` counts only after admission: see studentPopulation). */
export const PAST_OUTCOME_STATUSES: Record<PastOutcome, readonly AdmissionStatus[]> = {
  withdrawn_early: ['withdrawn'],
  completed: ['completed'],
  other: ['transferred', 'cancelled_before_enrolment', 'other_inactive', 'lost'],
};

/** The outcome of a closed case, or null when the case is not a former one. */
export function pastOutcomeOf(a: Parameters<typeof studentPopulation>[0]): PastOutcome | null {
  if (studentPopulation(a) !== 'former') return null;
  return PAST_OUTCOMES.find((o) => PAST_OUTCOME_STATUSES[o].includes(a.status)) ?? 'other';
}

type CaseRow = {
  status: AdmissionStatus;
  heldFromStatus: AdmissionStatus | null;
  admittedAt: Date | string | null;
};

/** A student record (profile) exists once admitted, or once the case has left the pipeline. */
export function hasStudentRecord(a: CaseRow): boolean {
  const { population, state } = caseState(a);
  return Boolean(a.admittedAt || state || population !== 'in_admission');
}

/** Status, population and directory state of an admission row. */
export function caseState(a: CaseRow) {
  const status = a.status;
  const state = directoryState({ status, admittedAt: a.admittedAt });
  return {
    status,
    statusLabel: ADMISSION_STATUS_LABELS[status],
    population: studentPopulation({ ...a, status }),
    state,
    stateLabel: state ? DIRECTORY_STATE_LABELS[state] : null,
  };
}

/**
 * Lifecycle actions a student's status allows (permissions are the caller's
 * check). Mirrors the lifecycle edges of TRANSITIONS: hold only from enrolled;
 * exits from enrolled (or admitted, for `cancelled_before_enrolment`), also
 * when on hold from that status; from any exit status: `readmit` (a new application for the
 * same student, the recommended path, brief §11) or `reactivate` (the existing approver flow).
 */
export function lifecycleOptions(a: CaseRow) {
  const { status, population } = caseState(a);
  const base = status === 'on_hold' ? a.heldFromStatus : status;
  return {
    hold: status === 'enrolled',
    resume: population === 'on_hold',
    exitStatuses: EXIT_STATUSES.filter(
      (s) => base === (s === 'cancelled_before_enrolment' ? 'admitted' : 'enrolled'),
    ),
    // A legacy "lost after admission" case is a former student too (M6).
    readmit: pastOutcomeOf(a) !== null,
    reactivate: isExitStatus(status),
  };
}

// --- privacy (A-STU-4) -------------------------------------------------------------------------------

/** `+91 •••• ••12 34` — only the last four digits are shown in lists. */
export function maskPhone(e164: string | null | undefined): string | null {
  if (!e164) return null;
  const digits = e164.replace(/\D/g, '');
  const last = digits.slice(-4);
  const country = e164.startsWith('+91') ? '+91' : '+••';
  return `${country} •••• ••${last.slice(0, 2)} ${last.slice(2)}`;
}

// --- identity linking (A-STU-6) ------------------------------------------------------------------

export type IdentityDecision =
  | { kind: 'link'; studentId: string; why: 'same_lead' | 'chosen' }
  | { kind: 'create' }
  | { kind: 'review'; candidateIds: string[] };

/**
 * Find-or-link a canonical student. Never auto-merges on contact data:
 * - an identity already held by this lead (or a lead merged into it) is the same person;
 * - otherwise a person's choice (`chosenId`, must be a candidate) links, `createNew` creates;
 * - any contact match left undecided → review (siblings share guardian phones).
 */
export function decideIdentity(input: {
  sameLeadIdentityId: string | null;
  contactCandidateIds: readonly string[];
  chosenId?: string | null;
  createNew?: boolean;
}): IdentityDecision | { kind: 'invalid'; message: string } {
  if (input.sameLeadIdentityId)
    return { kind: 'link', studentId: input.sameLeadIdentityId, why: 'same_lead' };
  const candidates = [...new Set(input.contactCandidateIds)];
  if (input.chosenId) {
    return candidates.includes(input.chosenId)
      ? { kind: 'link', studentId: input.chosenId, why: 'chosen' }
      : { kind: 'invalid', message: 'The chosen student is not one of the matching records.' };
  }
  if (candidates.length === 0 || input.createNew) return { kind: 'create' };
  return { kind: 'review', candidateIds: candidates };
}
