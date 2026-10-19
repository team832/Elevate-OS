/**
 * Small vocabularies and rules for the planning registers (decisions, risks,
 * projects, milestones, incidents) and business-code formatting. Pure.
 */

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

/** Decision-log states that still need a decision (K-18 "open decisions"). */
export function isUndecided(state: DecisionLogState): boolean {
  return state === 'open' || state === 'proposed';
}

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
  return (
    category === 'refund_request' ||
    category === 'fee_waiver' ||
    category === 'special_fee' ||
    category === 'deadline_extension'
  );
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
