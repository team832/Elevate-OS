/**
 * Lead stages (owner brief 23 Oct 2026 §11): the marketing stage of a lead, separate from the
 * admission status. Pure rules only; the service is server/lead-stages.ts.
 */
export type LeadStageKind = 'open' | 'won' | 'lost' | 'parked';

/** The 12 system stages in display order (keys match OPS_SYSTEM_LEAD_STAGES in the schema). */
export const SYSTEM_LEAD_STAGES: readonly {
  key: string;
  label: string;
  kind: LeadStageKind;
  requiresReason: boolean;
}[] = [
  { key: 'new', label: 'New', kind: 'open', requiresReason: false },
  { key: 'assigned', label: 'Assigned', kind: 'open', requiresReason: false },
  { key: 'contacted', label: 'Contacted', kind: 'open', requiresReason: false },
  { key: 'qualified', label: 'Qualified', kind: 'open', requiresReason: false },
  { key: 'demo_booked', label: 'Demo booked', kind: 'open', requiresReason: false },
  { key: 'demo_attended', label: 'Demo attended', kind: 'open', requiresReason: false },
  {
    key: 'admission_in_progress',
    label: 'Admission in progress',
    kind: 'open',
    requiresReason: false,
  },
  { key: 'converted', label: 'Converted', kind: 'won', requiresReason: false },
  { key: 'nurture', label: 'Nurture', kind: 'parked', requiresReason: false },
  { key: 'lost', label: 'Lost', kind: 'lost', requiresReason: true },
  { key: 'duplicate', label: 'Duplicate', kind: 'parked', requiresReason: true },
  { key: 'do_not_contact', label: 'Do not contact', kind: 'parked', requiresReason: true },
];

export const DNC_STAGE = 'do_not_contact';
export const DUPLICATE_STAGE = 'duplicate';

/** Numbered cases that never became an admission (PROPOSED set, owner to confirm). */
export const NOT_ADMITTED_STATUSES: readonly string[] = ['lost', 'cancelled_before_enrolment'];
/** A real admission that ended later: still a conversion for its period. */
export const ENDED_ADMISSION_STATUSES: readonly string[] = [
  'withdrawn',
  'transferred',
  'completed',
  'other_inactive',
];

/**
 * What an admission case means for lead conversion: `none` (Ops has not confirmed it: no number,
 * or a legacy number still to verify), `confirmed`, `ended` (confirmed, later left) or
 * `cancelled` (numbered but closed without admission).
 */
export function admissionConversion(a: {
  admissionNumber: string | null;
  legacyVerification: string | null;
  status: string;
}): 'none' | 'confirmed' | 'ended' | 'cancelled' {
  if (!a.admissionNumber || a.legacyVerification === 'required') return 'none';
  if (NOT_ADMITTED_STATUSES.includes(a.status)) return 'cancelled';
  return ENDED_ADMISSION_STATUSES.includes(a.status) ? 'ended' : 'confirmed';
}

/** Counts as a conversion: confirmed by Ops, including admissions that ended later. */
export const isConfirmedAdmission = (a: Parameters<typeof admissionConversion>[0]) =>
  ['confirmed', 'ended'].includes(admissionConversion(a));

/** Why a stage change is refused, or null when it is allowed. */
export function stageChangeProblem(input: {
  fromKey: string | null;
  to: { key: string; kind: LeadStageKind; requiresReason: boolean; active: boolean };
  reason: string | null;
  hasConfirmedAdmission: boolean;
}): { field: 'stageKey' | 'reason'; message: string } | null {
  const { to, reason } = input;
  if (!to.active) return { field: 'stageKey', message: 'This stage is switched off.' };
  if (input.fromKey === to.key) return { field: 'stageKey', message: 'The lead is already here.' };
  if (to.kind === 'won' && !input.hasConfirmedAdmission)
    return {
      field: 'stageKey',
      message:
        'Converted is set only after Business Operations confirms the admission (it has an admission number).',
    };
  if (to.requiresReason && !reason)
    return { field: 'reason', message: 'Give a reason for this stage.' };
  if (input.fromKey === DNC_STAGE && !reason)
    return { field: 'reason', message: 'Give a reason for contacting this lead again.' };
  return null;
}

/** Call length typed by staff, in whole minutes → stored seconds (null = not recorded). */
export const callSeconds = (minutes: number | null | undefined) =>
  minutes === null || minutes === undefined ? null : Math.round(minutes * 60);
