/**
 * Recruitment rules (OPS-040…OPS-044, D-028). Pure: no database, no framework.
 * Algorithm documentation: docs/parts/hr-lifecycle.md → HL-A1…HL-A4.
 *
 * Three explicit state machines (requisition, application stage, offer) as
 * legal-transition tables; anything not listed is illegal. Each edge names
 * the authority it needs: `manage` (ops:recruitment:manage), `decide`
 * (ops:recruitment:decide) or `conversion` (only the candidate-to-employee
 * conversion service may take it).
 */
import { addDays, type IsoDate } from '../dates';

// --- requisitions ------------------------------------------------------------------------------

export const REQUISITION_STATUSES = ['draft', 'open', 'on_hold', 'filled', 'cancelled'] as const;
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

export const REQUISITION_STATUS_LABELS: Record<RequisitionStatus, string> = {
  draft: 'Draft (awaiting approval to open)',
  open: 'Open',
  on_hold: 'On hold',
  filled: 'Filled',
  cancelled: 'Cancelled',
};

export const REQUISITION_EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'contract',
  'visiting',
] as const;
export type RequisitionEmploymentType = (typeof REQUISITION_EMPLOYMENT_TYPES)[number];

export type RecruitmentAuthority = 'manage' | 'decide' | 'conversion';

export interface RecruitmentEdge<S extends string> {
  from: S;
  to: S;
  authority: RecruitmentAuthority;
  requiresReason: boolean;
  meaning: string;
}

const edge = <S extends string>(
  from: S,
  to: S,
  authority: RecruitmentAuthority,
  meaning: string,
  requiresReason = false,
): RecruitmentEdge<S> => ({ from, to, authority, requiresReason, meaning });

export const REQUISITION_TRANSITIONS: readonly RecruitmentEdge<RequisitionStatus>[] = [
  edge(
    'draft',
    'open',
    'decide',
    'Approved to open by a recruitment decider who is not the requester.',
  ),
  edge('draft', 'cancelled', 'manage', 'Request withdrawn before approval.', true),
  edge('open', 'on_hold', 'manage', 'Hiring paused.', true),
  edge('on_hold', 'open', 'manage', 'Hiring resumed.', true),
  edge('open', 'filled', 'manage', 'All openings filled (also set automatically on conversion).'),
  edge('open', 'cancelled', 'decide', 'Requisition cancelled.', true),
  edge('on_hold', 'cancelled', 'decide', 'Requisition cancelled while on hold.', true),
];

export type RecruitmentCheck =
  | { ok: true; edge: RecruitmentEdge<string> }
  | {
      ok: false;
      code: 'NO_CHANGE' | 'ILLEGAL' | 'REASON_REQUIRED' | 'NOT_AUTHORISED' | 'SELF_APPROVAL';
      message: string;
    };

interface CheckContext {
  reason?: string | null;
  /** Holds ops:recruitment:decide. */
  canDecide: boolean;
  /** True only inside the conversion service. */
  viaConversion?: boolean;
}

function checkEdge<S extends string>(
  table: readonly RecruitmentEdge<S>[],
  labels: Record<S, string>,
  what: string,
  from: S,
  to: S,
  ctx: CheckContext,
): RecruitmentCheck {
  if (from === to)
    return { ok: false, code: 'NO_CHANGE', message: `The ${what} is already ${labels[from]}.` };
  const found = table.find((e) => e.from === from && e.to === to);
  if (!found)
    return {
      ok: false,
      code: 'ILLEGAL',
      message: `A ${what} cannot move from "${labels[from]}" to "${labels[to]}".`,
    };
  if (found.authority === 'conversion' && !ctx.viaConversion)
    return {
      ok: false,
      code: 'NOT_AUTHORISED',
      message: 'Use "Convert to employee" on an accepted offer; it records the hire.',
    };
  if (found.authority === 'decide' && !ctx.canDecide)
    return {
      ok: false,
      code: 'NOT_AUTHORISED',
      message: 'Only a recruitment decider (HR manager, director) can make this change.',
    };
  if (found.requiresReason && !ctx.reason?.trim())
    return { ok: false, code: 'REASON_REQUIRED', message: 'Give a reason for this change.' };
  return { ok: true, edge: found as RecruitmentEdge<string> };
}

/** The `from` → `to` edge of `table` needs a reason (screens show a reason field). */
export const needsReason = <S extends string>(
  table: readonly RecruitmentEdge<S>[],
  from: S,
  to: S,
): boolean => table.some((e) => e.from === from && e.to === to && e.requiresReason);

export function checkRequisitionTransition(
  from: RequisitionStatus,
  to: RequisitionStatus,
  ctx: CheckContext & { actorIsRequester: boolean },
): RecruitmentCheck {
  const result = checkEdge(
    REQUISITION_TRANSITIONS,
    REQUISITION_STATUS_LABELS,
    'requisition',
    from,
    to,
    ctx,
  );
  if (result.ok && from === 'draft' && to === 'open' && ctx.actorIsRequester)
    return {
      ok: false,
      code: 'SELF_APPROVAL',
      message: 'You requested this requisition; another decider must approve it.',
    };
  return result;
}

// --- application stages ------------------------------------------------------------------------

export const APPLICATION_STAGES = [
  'applied',
  'screening',
  'interview',
  'offer',
  'hired',
  'rejected',
  'withdrawn',
] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export const APPLICATION_STAGE_LABELS: Record<ApplicationStage, string> = {
  applied: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer (selected)',
  hired: 'Hired',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

/** The forward path (pipeline columns). */
export const APPLICATION_PIPELINE: readonly ApplicationStage[] = [
  'applied',
  'screening',
  'interview',
  'offer',
  'hired',
];

export const OPEN_APPLICATION_STAGES: readonly ApplicationStage[] = [
  'applied',
  'screening',
  'interview',
  'offer',
];

export function isOpenApplication(stage: ApplicationStage): boolean {
  return OPEN_APPLICATION_STAGES.includes(stage);
}

/** Closed without a hire. */
export function isUnsuccessful(stage: ApplicationStage): boolean {
  return stage === 'rejected' || stage === 'withdrawn';
}

export const APPLICATION_TRANSITIONS: readonly RecruitmentEdge<ApplicationStage>[] = [
  edge('applied', 'screening', 'manage', 'CV / eligibility screening started.'),
  edge('screening', 'interview', 'manage', 'Shortlisted for interview.'),
  edge('interview', 'screening', 'manage', 'Back to screening (e.g. role mismatch found).', true),
  edge('interview', 'offer', 'decide', 'Selected: an offer may be prepared (selection decision).'),
  edge('offer', 'interview', 'decide', 'Selection reversed before an offer was accepted.', true),
  edge('offer', 'hired', 'conversion', 'Converted to an employee from an accepted offer.'),
  ...OPEN_APPLICATION_STAGES.map((from) =>
    edge(from, 'rejected', 'decide', 'Rejection decision.', true),
  ),
  ...OPEN_APPLICATION_STAGES.map((from) =>
    edge(from, 'withdrawn', 'manage', 'The candidate withdrew.', true),
  ),
];

export function checkApplicationTransition(
  from: ApplicationStage,
  to: ApplicationStage,
  ctx: CheckContext,
): RecruitmentCheck {
  return checkEdge(APPLICATION_TRANSITIONS, APPLICATION_STAGE_LABELS, 'application', from, to, ctx);
}

/** Targets a person may pick from a stage (hire is excluded: conversion only). */
export function applicationTargets(from: ApplicationStage, canDecide: boolean): ApplicationStage[] {
  return APPLICATION_TRANSITIONS.filter(
    (e) =>
      e.from === from && e.authority !== 'conversion' && (e.authority === 'manage' || canDecide),
  ).map((e) => e.to);
}

// --- offers ------------------------------------------------------------------------------------

export const OFFER_STATUSES = [
  'draft',
  'approved',
  'extended',
  'accepted',
  'declined',
  'withdrawn',
  'expired',
] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  extended: 'Extended (marked by hand — nothing is sent)',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
};

/** Live = blocks a second offer on the same application. */
export function isLiveOffer(status: OfferStatus): boolean {
  return (
    status === 'draft' || status === 'approved' || status === 'extended' || status === 'accepted'
  );
}

export const OFFER_TRANSITIONS: readonly RecruitmentEdge<OfferStatus>[] = [
  edge('draft', 'approved', 'decide', 'Approved by a decider who did not prepare it.'),
  edge('draft', 'withdrawn', 'manage', 'Draft discarded.', true),
  edge(
    'approved',
    'extended',
    'manage',
    'Marked as given to the candidate (Elevate OS never sends offers).',
  ),
  edge('approved', 'withdrawn', 'decide', 'Approved offer withdrawn before it was given.', true),
  edge('extended', 'accepted', 'manage', 'The candidate accepted (recorded by hand).'),
  edge('extended', 'declined', 'manage', 'The candidate declined.', true),
  edge('extended', 'withdrawn', 'decide', 'Offer withdrawn after it was given.', true),
  edge('extended', 'expired', 'manage', 'No answer by the validity date.'),
];

export function checkOfferTransition(
  from: OfferStatus,
  to: OfferStatus,
  ctx: CheckContext & { actorIsPreparer: boolean },
): RecruitmentCheck {
  const result = checkEdge(OFFER_TRANSITIONS, OFFER_STATUS_LABELS, 'offer', from, to, ctx);
  if (result.ok && to === 'approved' && ctx.actorIsPreparer)
    return {
      ok: false,
      code: 'SELF_APPROVAL',
      message: 'You prepared this offer; a different decider must approve it.',
    };
  return result;
}

// --- interviews --------------------------------------------------------------------------------

export const INTERVIEW_MODES = ['in_person', 'video', 'phone'] as const;
export const INTERVIEW_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];
export const INTERVIEW_RECOMMENDATIONS = [
  'strong_hire',
  'hire',
  'no_hire',
  'strong_no_hire',
] as const;
export type InterviewRecommendation = (typeof INTERVIEW_RECOMMENDATIONS)[number];

export const RECOMMENDATION_LABELS: Record<InterviewRecommendation, string> = {
  strong_hire: 'Strong hire',
  hire: 'Hire',
  no_hire: 'No hire',
  strong_no_hire: 'Strong no hire',
};

/**
 * Feedback rule (HL-A3): only an assigned interviewer, only for a scheduled or
 * completed interview of an open application. Holding `all` scope does not
 * make someone an interviewer.
 */
export function feedbackAllowed(input: {
  actorStaffId: string | null;
  panelStaffIds: readonly string[];
  interviewStatus: InterviewStatus;
  applicationStage: ApplicationStage;
}): { ok: true } | { ok: false; code: 'NOT_INTERVIEWER' | 'CLOSED'; message: string } {
  if (!input.actorStaffId || !input.panelStaffIds.includes(input.actorStaffId))
    return {
      ok: false,
      code: 'NOT_INTERVIEWER',
      message: 'Only the assigned interviewers can give feedback on this interview.',
    };
  if (input.interviewStatus === 'cancelled' || input.interviewStatus === 'no_show')
    return { ok: false, code: 'CLOSED', message: 'This interview did not take place.' };
  if (!isOpenApplication(input.applicationStage))
    return { ok: false, code: 'CLOSED', message: 'The application is closed.' };
  return { ok: true };
}

export const INTERVIEW_STATUS_TRANSITIONS: Record<InterviewStatus, readonly InterviewStatus[]> = {
  scheduled: ['completed', 'cancelled', 'no_show'],
  completed: [],
  cancelled: [],
  no_show: [],
};

// --- candidates and data minimisation ----------------------------------------------------------

export const CANDIDATE_SOURCES = [
  'referral',
  'job_portal',
  'website',
  'walk_in',
  'social_media',
  'agency',
  'campus',
  'internal',
  'other',
] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

/**
 * HL-A4: a candidate may be anonymised when every application is closed
 * unsuccessfully (rejected / withdrawn), there is at least one, no offer is
 * live and they are not already anonymised. A hired candidate is an employee
 * and is never anonymised here.
 */
export function anonymisationEligibility(input: {
  status: 'active' | 'anonymised';
  stages: readonly ApplicationStage[];
  hasLiveOffer: boolean;
}): { ok: true } | { ok: false; message: string } {
  if (input.status === 'anonymised') return { ok: false, message: 'Already anonymised.' };
  if (input.stages.length === 0)
    return { ok: false, message: 'The candidate has no closed application yet.' };
  if (input.stages.some((s) => s === 'hired'))
    return { ok: false, message: 'A hired candidate is an employee; their data is HR data now.' };
  if (!input.stages.every(isUnsuccessful))
    return { ok: false, message: 'Close every application (rejected or withdrawn) first.' };
  if (input.hasLiveOffer) return { ok: false, message: 'An offer is still live.' };
  return { ok: true };
}

/**
 * Retention check for a closed unsuccessful candidate. `retainDays` null =
 * the owner has not decided a retention period (open setting): nothing is
 * ever reported due.
 */
export function retentionStatus(
  lastClosedOn: IsoDate | null,
  retainDays: number | null,
  today: IsoDate,
): 'not_decided' | 'not_closed' | 'due' | 'not_due' {
  if (retainDays === null) return 'not_decided';
  if (!lastClosedOn) return 'not_closed';
  return addDays(lastClosedOn, retainDays) <= today ? 'due' : 'not_due';
}

/** Recruitment pipeline by stage; every stage present (zero is a real count here). */
export function pipelineByStage(
  stages: readonly ApplicationStage[],
): Record<ApplicationStage, number> {
  const out = Object.fromEntries(APPLICATION_STAGES.map((s) => [s, 0])) as Record<
    ApplicationStage,
    number
  >;
  for (const s of stages) out[s] += 1;
  return out;
}
