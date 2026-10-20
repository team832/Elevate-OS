/**
 * Small vocabularies and rules for the planning registers (decisions, risks,
 * projects, milestones, incidents) and business-code formatting. Pure.
 */
import { addDays, daysBetween, istToday } from './dates';

/** Business codes (D-009): `<PREFIX>-<zero-padded number>`; never reused. */
export const CODE_FORMATS = {
  lead: { prefix: 'LEAD', width: 6 },
  admission: { prefix: 'ADM', width: 6 },
  task: { prefix: 'TSK', width: 5 },
  sop: { prefix: 'SOP', width: 4 },
  decision: { prefix: 'DEC', width: 4 },
  risk: { prefix: 'RSK', width: 4 },
  project: { prefix: 'PRJ', width: 4 },
  incident: { prefix: 'INC', width: 5 },
  responsibility: { prefix: 'RESP', width: 4 },
  // HR, attendance and admissions administration (D-028)
  employee: { prefix: 'EMP', width: 4 },
  asset: { prefix: 'AST', width: 5 },
  requisition: { prefix: 'REQ', width: 4 },
  candidate: { prefix: 'CAND', width: 5 },
  lifecycleCase: { prefix: 'HRC', width: 5 },
  leaveRequest: { prefix: 'LVR', width: 6 },
  attendanceCorrection: { prefix: 'ATC', width: 6 },
  feeRecord: { prefix: 'FEE', width: 6 },
  // Operations (OPS-066): company policies and compliance obligations
  policy: { prefix: 'POL', width: 4 },
} as const;
export type CodeKind = keyof typeof CODE_FORMATS;

export function formatCode(kind: CodeKind, n: number): string {
  const { prefix, width } = CODE_FORMATS[kind];
  if (!Number.isInteger(n) || n < 1) throw new RangeError('Code numbers start at 1');
  return `${prefix}-${String(n).padStart(width, '0')}`;
}

/** Parse the number of a code of this kind; null for legacy or foreign codes. */
export function parseCodeNumber(kind: CodeKind, code: string): number | null {
  const { prefix, width } = CODE_FORMATS[kind];
  const m = new RegExp(`^${prefix}-(\\d{${width}})$`).exec(code);
  return m ? Number(m[1]) : null;
}

export const DECISION_LOG_STATES = [
  'open',
  'proposed',
  'confirmed',
  'provisional',
  'superseded',
] as const;
export type DecisionLogState = (typeof DECISION_LOG_STATES)[number];

export const RISK_KINDS = ['risk', 'issue', 'blocker'] as const;
export const RISK_STATUSES = ['open', 'mitigating', 'resolved', 'closed', 'accepted'] as const;
export const LEVELS = ['low', 'medium', 'high'] as const;
export type Level = (typeof LEVELS)[number];

/** Severity = the higher of likelihood and impact; unknown parts make it `unrated`. */
export function riskSeverity(likelihood: Level | null, impact: Level | null): Level | 'unrated' {
  if (!likelihood || !impact) return 'unrated';
  const rank = { low: 1, medium: 2, high: 3 } as const;
  return rank[likelihood] >= rank[impact] ? likelihood : impact;
}

/** OPS-023 flags: open high-severity items and items without an owner. */
export function riskFlags(r: {
  status: string;
  likelihood: Level | null;
  impact: Level | null;
  ownerStaffId: string | null;
}): ('high_severity' | 'no_owner')[] {
  const open = r.status === 'open' || r.status === 'mitigating';
  if (!open) return [];
  const flags: ('high_severity' | 'no_owner')[] = [];
  if (riskSeverity(r.likelihood, r.impact) === 'high') flags.push('high_severity');
  if (!r.ownerStaffId) flags.push('no_owner');
  return flags;
}

export const PROJECT_STATUSES = ['planned', 'active', 'on_hold', 'completed', 'cancelled'] as const;
export const MILESTONE_STATUSES = ['planned', 'done', 'missed', 'cancelled'] as const;

export const INCIDENT_KINDS = ['exception', 'incident'] as const;
export const INCIDENT_CATEGORIES = [
  'refund_request',
  'fee_waiver',
  'special_fee',
  'deadline_extension',
  'class_disruption',
  'access_problem',
  'privacy_or_security',
  'complaint',
  'other',
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

/** BR-OPS-15: refunds, waivers, special fees and extensions need authorised approval (limits: OD-013). */
export function incidentNeedsAuthorisedApproval(category: IncidentCategory): boolean {
  return ['refund_request', 'fee_waiver', 'special_fee', 'deadline_extension'].includes(category);
}

export const INCIDENT_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** open → in_progress → resolved → closed; reopen resolved → in_progress. Resolving needs a resolution. */
export function checkIncidentTransition(
  from: IncidentStatus,
  to: IncidentStatus,
  resolution: string | null | undefined,
): { ok: true } | { ok: false; message: string } {
  const allowed: Record<IncidentStatus, IncidentStatus[]> = {
    open: ['in_progress', 'resolved'],
    in_progress: ['resolved', 'open'],
    resolved: ['closed', 'in_progress'],
    closed: [],
  };
  if (!allowed[from].includes(to))
    return { ok: false, message: `Cannot move an incident from ${from} to ${to}.` };
  if (to === 'resolved' && !resolution?.trim())
    return { ok: false, message: 'Describe the resolution.' };
  return { ok: true };
}

// --- incident resolution SLA (OPS-068) -----------------------------------------------------------

export interface IncidentSlaSettings {
  lowDays: number;
  mediumDays: number;
  highDays: number;
}

export type IncidentSlaState =
  'within' | 'due_today' | 'breached' | 'resolved_within' | 'resolved_late' | 'unrated';

/**
 * Resolution-SLA flag: target = occurred date (IST) + N calendar days by
 * severity (setting `incidents.resolution_sla`, proposed). Open past the target
 * → breached; resolved after it → resolved_late. Unknown severity → unrated.
 */
export function incidentSla(
  incident: { status: string; severity: string; occurredAt: Date; resolvedAt: Date | null },
  now: Date,
  settings: IncidentSlaSettings,
): { state: IncidentSlaState; targetDate: string | null; daysOpen: number } {
  const days =
    (
      { high: settings.highDays, medium: settings.mediumDays, low: settings.lowDays } as Record<
        string,
        number
      >
    )[incident.severity] ?? null;
  const opened = istToday(incident.occurredAt);
  const endDay = istToday(incident.resolvedAt ?? now);
  const daysOpen = Math.max(0, daysBetween(opened, endDay));
  if (days === null) return { state: 'unrated', targetDate: null, daysOpen };
  const targetDate = addDays(opened, days);
  const closed = incident.status === 'resolved' || incident.status === 'closed';
  if (closed)
    return {
      state:
        incident.resolvedAt && istToday(incident.resolvedAt) > targetDate
          ? 'resolved_late'
          : 'resolved_within',
      targetDate,
      daysOpen,
    };
  const today = istToday(now);
  return {
    state: today > targetDate ? 'breached' : today === targetDate ? 'due_today' : 'within',
    targetDate,
    daysOpen,
  };
}

// --- risk mitigations (OPS-067) ------------------------------------------------------------------

export const MITIGATION_STATUSES = ['planned', 'in_progress', 'done', 'dropped'] as const;
export type MitigationStatus = (typeof MITIGATION_STATUSES)[number];

/** planned → in_progress → done; planned/in_progress → dropped (outcome required); done/dropped are final. */
export function checkMitigationTransition(
  from: MitigationStatus,
  to: MitigationStatus,
  outcome: string | null | undefined,
): { ok: true } | { ok: false; message: string } {
  const allowed: Record<MitigationStatus, MitigationStatus[]> = {
    planned: ['in_progress', 'done', 'dropped'],
    in_progress: ['done', 'dropped', 'planned'],
    done: [],
    dropped: [],
  };
  if (from === to) return { ok: false, message: `The action is already ${from}.` };
  if (!allowed[from].includes(to))
    return { ok: false, message: `Cannot move a mitigation from ${from} to ${to}.` };
  if (to === 'dropped' && !outcome?.trim())
    return { ok: false, message: 'Say why the mitigation was dropped.' };
  return { ok: true };
}

// --- blocked projects (OPS-067) ------------------------------------------------------------------

export type ProjectBlockReason =
  | 'on_hold'
  | 'missed_milestone'
  | 'milestone_waiting_on_overdue_dependency'
  | 'blocked_tasks'
  | 'open_blockers';

export const PROJECT_BLOCK_REASON_LABELS: Record<ProjectBlockReason, string> = {
  on_hold: 'Project is on hold',
  missed_milestone: 'A milestone was missed',
  milestone_waiting_on_overdue_dependency: 'A milestone waits on an overdue or missed dependency',
  blocked_tasks: 'Linked tasks are blocked',
  open_blockers: 'Open issues/blockers are linked',
};

/** Why a live (planned / active / on hold) project is blocked; empty = not blocked. */
export function projectBlockReasons(
  project: { status: string },
  milestones: readonly {
    id: string;
    status: string;
    dueDate: string | null;
    dependsOn: readonly string[];
  }[],
  counts: { blockedTasks: number; openBlockers: number },
  today: string,
): ProjectBlockReason[] {
  if (!['planned', 'active', 'on_hold'].includes(project.status)) return [];
  const reasons: ProjectBlockReason[] = [];
  if (project.status === 'on_hold') reasons.push('on_hold');
  if (milestones.some((m) => m.status === 'missed')) reasons.push('missed_milestone');
  const byId = new Map(milestones.map((m) => [m.id, m]));
  const waiting = milestones.some(
    (m) =>
      m.status === 'planned' &&
      m.dependsOn.some((d) => {
        const dep = byId.get(d);
        return (
          dep !== undefined &&
          (dep.status === 'missed' ||
            (dep.status === 'planned' && dep.dueDate !== null && dep.dueDate < today))
        );
      }),
  );
  if (waiting) reasons.push('milestone_waiting_on_overdue_dependency');
  if (counts.blockedTasks > 0) reasons.push('blocked_tasks');
  if (counts.openBlockers > 0) reasons.push('open_blockers');
  return reasons;
}

// --- policies & compliance register (OPS-066) ---------------------------------------------------

export const POLICY_AREAS = [
  'attendance',
  'working_hours',
  'shifts',
  'leave',
  'holidays',
  'compensation',
  'recruitment',
  'onboarding_offboarding',
  'employee_records',
  'data_protection',
  'document_retention',
  'admissions_students',
  'fees_refunds',
  'health_safety',
  'other',
] as const;

export const POLICY_STATUSES = ['draft', 'proposed', 'approved', 'retired'] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];
export const POLICY_VERSION_STATUSES = [
  'draft',
  'proposed',
  'approved',
  'rejected',
  'superseded',
] as const;
export type PolicyVersionStatus = (typeof POLICY_VERSION_STATUSES)[number];

export const POLICY_STATUS_LABELS: Record<PolicyStatus, string> = {
  draft: 'Draft — not policy',
  proposed: 'Proposed — awaiting approval',
  approved: 'Approved',
  retired: 'Retired',
};

export type PolicyAction = 'save_draft' | 'propose' | 'approve' | 'reject' | 'withdraw' | 'retire';

/**
 * Register status after an action. An approved entry keeps status `approved`
 * (its approved version stays in force) while a newer version is drafted or
 * proposed; approved text is never overwritten.
 */
export function nextPolicyStatus(
  current: PolicyStatus,
  action: PolicyAction,
  ctx: { hasApprovedVersion: boolean },
): { ok: true; status: PolicyStatus } | { ok: false; message: string } {
  if (current === 'retired')
    return { ok: false, message: 'A retired entry is read-only; record a new entry instead.' };
  const kept = ctx.hasApprovedVersion ? 'approved' : null;
  switch (action) {
    case 'save_draft':
      if (current === 'proposed' && !ctx.hasApprovedVersion)
        return { ok: false, message: 'The entry is awaiting approval; withdraw it first.' };
      return { ok: true, status: kept ?? 'draft' };
    case 'propose':
      return { ok: true, status: kept ?? 'proposed' };
    case 'approve':
      return { ok: true, status: 'approved' };
    case 'reject':
    case 'withdraw':
      return { ok: true, status: kept ?? 'draft' };
    case 'retire':
      return { ok: true, status: 'retired' };
  }
}

export type PolicyProposalProblem =
  | 'requirement_text_missing'
  | 'accountable_missing'
  | 'review_before_effective'
  | 'unknown_setting_key';

/** Checks before a version is proposed (and again before it is approved). */
export function policyProposalProblems(input: {
  requirementText: string;
  accountableStaffId: string | null;
  effectiveDate: string | null;
  nextReviewDate: string | null;
  linkedSettingKeys: readonly string[];
  isSettingKey: (key: string) => boolean;
}): PolicyProposalProblem[] {
  const problems: PolicyProposalProblem[] = [];
  if (!input.requirementText.trim()) problems.push('requirement_text_missing');
  if (!input.accountableStaffId) problems.push('accountable_missing');
  if (input.effectiveDate && input.nextReviewDate && input.nextReviewDate < input.effectiveDate)
    problems.push('review_before_effective');
  if (input.linkedSettingKeys.some((k) => !input.isSettingKey(k)))
    problems.push('unknown_setting_key');
  return problems;
}

export const POLICY_PROBLEM_LABELS: Record<PolicyProposalProblem, string> = {
  requirement_text_missing: 'Write the requirement text first.',
  accountable_missing: 'Name the accountable staff member first.',
  review_before_effective: 'The next review date is before the effective date.',
  unknown_setting_key: 'A linked setting key does not exist.',
};

/** The proposer can never approve their own version (no self-approval). */
export function policyApprovalProblems(input: {
  versionStatus: PolicyVersionStatus;
  proposedByUserId: string | null;
  deciderUserId: string;
}): ('version_not_proposed' | 'self_approval')[] {
  const problems: ('version_not_proposed' | 'self_approval')[] = [];
  if (input.versionStatus !== 'proposed') problems.push('version_not_proposed');
  if (input.proposedByUserId && input.proposedByUserId === input.deciderUserId)
    problems.push('self_approval');
  return problems;
}
