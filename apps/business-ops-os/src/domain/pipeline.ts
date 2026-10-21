/**
 * Admission pipeline state machine (OPS-005, BR-OPS-1). Pure.
 * Algorithm documentation: docs/ALGORITHMS.md → A-03 (legal-transition table).
 */

export const ADMISSION_STATUSES = [
  'new',
  'contacted',
  'counselling_scheduled',
  'counselled',
  'demo_scheduled',
  'demo_attended',
  'admission_pending',
  'admitted',
  'enrolment_requested',
  'enrolled',
  'lost',
  'on_hold',
  // Student lifecycle after admission (owner brief §9; docs/parts/admissions-students.md).
  'withdrawn',
  'completed',
  'transferred',
  'cancelled_before_enrolment',
  'other_inactive',
] as const;
export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];

export const ADMISSION_STATUS_LABELS: Record<AdmissionStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  counselling_scheduled: 'Counselling scheduled',
  counselled: 'Counselled',
  demo_scheduled: 'Demo scheduled',
  demo_attended: 'Demo attended',
  admission_pending: 'Admission pending',
  admitted: 'Admitted',
  enrolment_requested: 'Enrolment requested (awaiting Academic OS)',
  enrolled: 'Enrolled',
  lost: 'Lost',
  on_hold: 'On hold',
  withdrawn: 'Withdrawn early',
  completed: 'Completed',
  transferred: 'Transferred',
  cancelled_before_enrolment: 'Cancelled before enrolment',
  other_inactive: 'Other inactive',
};

/** Exit statuses of an admitted student; each is recorded with an exit record (never deleted). */
export const EXIT_STATUSES = [
  'withdrawn',
  'completed',
  'transferred',
  'cancelled_before_enrolment',
  'other_inactive',
] as const satisfies readonly AdmissionStatus[];
export type ExitStatus = (typeof EXIT_STATUSES)[number];
const isExit = (s: string): s is ExitStatus => (EXIT_STATUSES as readonly string[]).includes(s);

/** The forward path, in order (used for board columns and "reached at least" checks). */
export const PIPELINE_ORDER: readonly AdmissionStatus[] = [
  'new',
  'contacted',
  'counselling_scheduled',
  'counselled',
  'demo_scheduled',
  'demo_attended',
  'admission_pending',
  'admitted',
  'enrolment_requested',
  'enrolled',
];

/** Open = still being worked (not enrolled, not lost). `on_hold` is open. */
export function isOpenStatus(status: AdmissionStatus): boolean {
  return status !== 'enrolled' && status !== 'lost' && !isExit(status);
}

/** Statuses from which a person may mark the case lost / on hold (everything a counsellor still owns). */
const WORKABLE: readonly AdmissionStatus[] = [
  'new',
  'contacted',
  'counselling_scheduled',
  'counselled',
  'demo_scheduled',
  'demo_attended',
  'admission_pending',
  'admitted',
];

export type TransitionActor = 'user' | 'system';
export type TransitionGuard =
  | 'successful_contact'
  | 'demo_skip_policy'
  | 'admission_readiness'
  | 'enrolment_handoff'
  | 'enrolment_reply'
  | 'resume_to_held_status'
  | 'student_lifecycle'
  | 'exit_record'
  | 'reactivation';

export interface TransitionRule {
  from: AdmissionStatus;
  to: AdmissionStatus;
  actor: TransitionActor;
  requiresReason: boolean;
  guard?: TransitionGuard;
  /** Why the edge exists / what it means. Shown in docs and the UI. */
  meaning: string;
  /** True when the sources do not say this; the edge is our proposal (decision state `proposed`). */
  proposal?: boolean;
}

const rule = (
  from: AdmissionStatus,
  to: AdmissionStatus,
  meaning: string,
  extra: Partial<Omit<TransitionRule, 'from' | 'to' | 'meaning'>> = {},
): TransitionRule => ({ from, to, meaning, actor: 'user', requiresReason: false, ...extra });

/** The legal-transition table. Anything not listed is illegal. */
export const TRANSITIONS: readonly TransitionRule[] = [
  rule('new', 'contacted', 'First successful two-way contact.', {
    guard: 'successful_contact',
  }),
  rule('contacted', 'counselling_scheduled', 'Counselling appointment booked.'),
  rule('contacted', 'counselled', 'Counselled on the spot (e.g. walk-in) without an appointment.', {
    requiresReason: true,
  }),
  rule('counselling_scheduled', 'counselled', 'Counselling completed.'),
  rule('counselling_scheduled', 'contacted', 'Appointment cancelled or missed; rebook.', {
    requiresReason: true,
  }),
  rule('counselled', 'demo_scheduled', 'Demo booked (separate demo classes).'),
  rule(
    'counselled',
    'admission_pending',
    'Demo skipped: the family wants to join without a demo. Allowed only while the demo-skip setting allows it.',
    { requiresReason: true, guard: 'demo_skip_policy', proposal: true },
  ),
  rule('demo_scheduled', 'demo_attended', 'Demo attended.'),
  rule('demo_scheduled', 'counselled', 'Demo cancelled or missed; back to counselled to rebook.', {
    requiresReason: true,
  }),
  rule('demo_attended', 'admission_pending', 'Family wants to join; admission paperwork starts.'),
  rule(
    'admission_pending',
    'admitted',
    'Admission confirmed: documents, two fee verifications, authorised fee approval, verified down payment.',
    { guard: 'admission_readiness' },
  ),
  rule(
    'admitted',
    'enrolment_requested',
    'Enrolment requested from Academic OS; publishes ops.admission.enrolment_requested v1 in the same transaction.',
    { guard: 'enrolment_handoff' },
  ),
  rule(
    'enrolment_requested',
    'enrolled',
    'Academic OS confirmed the enrolment (academic.enrolment.confirmed).',
    { actor: 'system', guard: 'enrolment_reply' },
  ),
  rule(
    'enrolment_requested',
    'admitted',
    'Academic OS rejected the request (academic.enrolment.rejected); correct and re-request with attempt + 1.',
    { actor: 'system', requiresReason: true, guard: 'enrolment_reply' },
  ),
  ...WORKABLE.map((from) =>
    rule(from, 'lost', 'Lost or not interested.', { requiresReason: true }),
  ),
  ...WORKABLE.map((from) =>
    rule(from, 'on_hold', 'Paused (e.g. family asked to wait).', { requiresReason: true }),
  ),
  ...WORKABLE.map((to) =>
    rule('on_hold', to, 'Resume at the status held before the pause.', {
      requiresReason: true,
      guard: 'resume_to_held_status',
    }),
  ),
  rule('on_hold', 'lost', 'Lost while on hold.', { requiresReason: true }),
  rule('lost', 'new', 'Reopened (a reason is required).', { requiresReason: true }),
  // Student lifecycle (owner brief §9): only through the student lifecycle service.
  rule('enrolled', 'on_hold', 'Enrolled student paused (reason + review date).', {
    requiresReason: true,
    guard: 'student_lifecycle',
  }),
  rule('on_hold', 'enrolled', 'Resume the enrolled student.', {
    requiresReason: true,
    guard: 'resume_to_held_status',
  }),
  ...EXIT_STATUSES.flatMap((to) =>
    (to === 'cancelled_before_enrolment'
      ? (['admitted', 'on_hold'] as const)
      : (['enrolled', 'on_hold'] as const)
    ).map((from) =>
      rule(from, to, 'Student exit, recorded with an exit record.', {
        requiresReason: true,
        guard: 'exit_record',
        proposal: to === 'other_inactive',
      }),
    ),
  ),
  ...EXIT_STATUSES.map((from) =>
    rule(from, 'admitted', 'Reactivated by an authorised approver; enrolment is requested again.', {
      requiresReason: true,
      guard: 'reactivation',
    }),
  ),
];

export function findTransition(
  from: AdmissionStatus,
  to: AdmissionStatus,
): TransitionRule | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

/** True for the student lifecycle edges (only the lifecycle service applies them). */
export function isLifecycleRule(t: TransitionRule): boolean {
  return (
    t.guard === 'student_lifecycle' ||
    t.guard === 'exit_record' ||
    t.guard === 'reactivation' ||
    (t.from === 'on_hold' && t.to === 'enrolled')
  );
}

/** User-initiated targets reachable from a status (for action buttons). */
export function allowedUserTargets(
  from: AdmissionStatus,
  context: { heldFromStatus?: AdmissionStatus | null; demoSkipAllowed?: boolean } = {},
): AdmissionStatus[] {
  return (
    TRANSITIONS.filter((t) => t.from === from && t.actor === 'user')
      // Student lifecycle changes have their own actions (hold, resume, exit, reactivate).
      .filter((t) => !isLifecycleRule(t))
      .filter((t) => t.guard !== 'resume_to_held_status' || t.to === context.heldFromStatus)
      .filter((t) => t.guard !== 'demo_skip_policy' || context.demoSkipAllowed !== false)
      .map((t) => t.to)
  );
}

export interface TransitionContext {
  actor: TransitionActor;
  reason?: string | null;
  /** The lead has a recorded successful two-way contact (BR-OPS-4). */
  hasSuccessfulContact?: boolean;
  /** Demo-skip setting (proposal; default allowed). */
  demoSkipAllowed?: boolean;
  /** Missing confirmation items from evaluateAdmissionReadiness(); empty = ready. */
  readinessMissing?: readonly string[];
  /** Status before on_hold. */
  heldFromStatus?: AdmissionStatus | null;
  /** True only inside the enrolment-handoff service (which publishes the event). */
  viaEnrolmentHandoff?: boolean;
  /** True only inside the enrolment-reply consumer. */
  viaEnrolmentReply?: boolean;
  /** True only inside the student lifecycle service (hold / exit / reactivate). */
  viaStudentLifecycle?: boolean;
}

export type TransitionCheck =
  | { ok: true; rule: TransitionRule }
  | {
      ok: false;
      code: 'ILLEGAL' | 'REASON_REQUIRED' | 'GUARD_FAILED' | 'WRONG_ACTOR' | 'NO_CHANGE';
      message: string;
      missing?: readonly string[];
    };

/** Each guard's failure message in this context, or null when the guard passes. */
const GUARD_FAILURES: Record<
  TransitionGuard,
  (ctx: TransitionContext, to: AdmissionStatus) => string | null
> = {
  successful_contact: (ctx) =>
    ctx.hasSuccessfulContact
      ? null
      : 'Log a successful two-way contact first; unanswered calls do not count as contacted.',
  demo_skip_policy: (ctx) =>
    ctx.demoSkipAllowed === false
      ? 'Skipping the demo is switched off in the pipeline settings.'
      : null,
  admission_readiness: (ctx) =>
    ctx.readinessMissing === undefined || ctx.readinessMissing.length > 0
      ? 'The admission cannot be confirmed yet.'
      : null,
  enrolment_handoff: (ctx) =>
    ctx.viaEnrolmentHandoff
      ? null
      : 'Use "Request enrolment" so the request to Academic OS is published with the change.',
  enrolment_reply: (ctx) =>
    ctx.viaEnrolmentReply ? null : 'Only Academic OS replies can make this change.',
  resume_to_held_status: (ctx, to) =>
    // Resuming an enrolled student is a lifecycle change (its own permission and audit).
    to === 'enrolled' && !ctx.viaStudentLifecycle
      ? LIFECYCLE_ONLY
      : ctx.heldFromStatus === to
        ? null
        : `Resume to the status held before the pause (${ctx.heldFromStatus ?? 'unknown'}).`,
  student_lifecycle: (ctx) => (ctx.viaStudentLifecycle ? null : LIFECYCLE_ONLY),
  exit_record: (ctx, to) => {
    if (!ctx.viaStudentLifecycle) return LIFECYCLE_ONLY;
    // From on_hold the status held before the pause decides (enrolled, or admitted for a cancellation).
    const needed = to === 'cancelled_before_enrolment' ? 'admitted' : 'enrolled';
    return ctx.heldFromStatus && ctx.heldFromStatus !== needed
      ? `"${ADMISSION_STATUS_LABELS[to]}" applies only to a student who was ${needed}.`
      : null;
  },
  reactivation: (ctx) => (ctx.viaStudentLifecycle ? null : LIFECYCLE_ONLY),
};

const LIFECYCLE_ONLY =
  'Use the student lifecycle actions (hold, exit, reactivate) for this change.';

/** Decide whether `from → to` is allowed in this context. Pure; no side effects. */
export function checkTransition(
  from: AdmissionStatus,
  to: AdmissionStatus,
  ctx: TransitionContext,
): TransitionCheck {
  if (from === to)
    return { ok: false, code: 'NO_CHANGE', message: `The admission is already ${from}.` };
  const found = findTransition(from, to);
  if (!found) {
    return {
      ok: false,
      code: 'ILLEGAL',
      message: `An admission cannot move from "${ADMISSION_STATUS_LABELS[from]}" to "${ADMISSION_STATUS_LABELS[to]}".`,
    };
  }
  if (found.actor !== ctx.actor) {
    return {
      ok: false,
      code: 'WRONG_ACTOR',
      message:
        found.actor === 'system'
          ? 'Only Academic OS replies can make this change.'
          : 'This change must be made by a person.',
    };
  }
  if (found.requiresReason && !ctx.reason?.trim()) {
    return { ok: false, code: 'REASON_REQUIRED', message: 'Give a reason for this change.' };
  }
  const failure = found.guard ? GUARD_FAILURES[found.guard](ctx, to) : null;
  if (failure)
    return {
      ok: false,
      code: 'GUARD_FAILED',
      message: failure,
      ...(found.guard === 'admission_readiness' && {
        missing: ctx.readinessMissing ?? ['readiness not evaluated'],
      }),
    };
  return { ok: true, rule: found };
}

/** True when `status` has reached `target` on the forward path (lost/on_hold never count). */
export function hasReached(status: AdmissionStatus, target: AdmissionStatus): boolean {
  const a = PIPELINE_ORDER.indexOf(status);
  const b = PIPELINE_ORDER.indexOf(target);
  return a >= 0 && b >= 0 && a >= b;
}

// --- closure reason codes (OPS-070) ----------------------------------------------------------

/**
 * Coded reasons for closing a case (`→ lost`). The list is configuration:
 * setting `admissions.closure_reasons` (proposed) in ./policies.ts.
 * `withdrawn_after_admission` is the withdrawal of an admitted student before
 * Academic OS enrols them; after enrolment, withdrawal is Academic's record.
 * `duplicate_merged` is set by the merge service only.
 */
/** Codes only a service may set (never offered in the UI). */
export const SYSTEM_CLOSURE_REASONS: readonly string[] = ['duplicate_merged'];

export const CLOSURE_REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

export type ReasonCodeCheck = { ok: true; code: string | null } | { ok: false; message: string };

/**
 * Validate the reason code of a transition. Pure.
 * - Only `→ lost` takes a code; any other target with a code is invalid.
 * - The code must be in the configured list (`allowed`).
 * - `withdrawn_after_admission` only from `admitted` (or on hold from admitted).
 * - `requireCode` (setting, proposed; default off) makes the code mandatory.
 * - System-only codes are refused for people (`actor: 'user'`).
 */
export function checkReasonCode(input: {
  from: AdmissionStatus;
  to: AdmissionStatus;
  code: string | null | undefined;
  heldFromStatus?: AdmissionStatus | null;
  allowed: readonly string[];
  requireCode: boolean;
  actor: TransitionActor;
  /** True when the merge service closes a duplicate's case. */
  viaMerge?: boolean;
}): ReasonCodeCheck {
  const code = input.code?.trim() || null;
  if (input.to !== 'lost') {
    if (code)
      return { ok: false, message: 'A reason code is only recorded when a case is closed.' };
    return { ok: true, code: null };
  }
  if (!code) {
    if (input.requireCode && !input.viaMerge)
      return { ok: false, message: 'Choose a reason code for closing the case.' };
    return { ok: true, code: null };
  }
  if (!CLOSURE_REASON_CODE_PATTERN.test(code) || !input.allowed.includes(code))
    return { ok: false, message: `Unknown reason code "${code}".` };
  if (SYSTEM_CLOSURE_REASONS.includes(code) && !input.viaMerge)
    return { ok: false, message: `"${code}" is set by the merge service only.` };
  if (code === 'withdrawn_after_admission') {
    const effective = input.from === 'on_hold' ? input.heldFromStatus : input.from;
    if (effective !== 'admitted')
      return {
        ok: false,
        message: '"Withdrew after admission" applies only to an admitted case.',
      };
  }
  return { ok: true, code };
}

/**
 * How the brief's admissions lifecycle maps onto the A-03 state machine
 * (documented in docs/parts/admissions.md; no new states were added).
 */
export const LIFECYCLE_MAPPING: readonly {
  stage: string;
  statuses: readonly AdmissionStatus[];
  note: string;
}[] = [
  {
    stage: 'Enquiry',
    statuses: ['new', 'contacted'],
    note: 'Lead + enquiries; contacted needs a two-way contact.',
  },
  {
    stage: 'Counselling',
    statuses: ['counselling_scheduled', 'counselled'],
    note: 'Counselling sessions.',
  },
  {
    stage: 'Demo',
    statuses: ['demo_scheduled', 'demo_attended'],
    note: 'Demo classes (terms from settings).',
  },
  {
    stage: 'Application',
    statuses: ['admission_pending'],
    note: 'Admission form and documents checklist.',
  },
  { stage: 'Review', statuses: ['admission_pending'], note: 'Two fee verifications + checklist.' },
  {
    stage: 'Offer / decision',
    statuses: ['admission_pending'],
    note: 'Fee-arrangement approval (approved = offer made; rejected = revise). No separate state.',
  },
  { stage: 'Accepted', statuses: ['admitted'], note: 'Confirmation gate passed (A-04).' },
  {
    stage: 'Enrolment handoff',
    statuses: ['enrolment_requested', 'enrolled'],
    note: 'Outbox request to Academic OS; enrolled only on its confirmation.',
  },
  {
    stage: 'Withdrawn / cancelled',
    statuses: ['lost', 'on_hold'],
    note: 'Reason text + reason code.',
  },
];
