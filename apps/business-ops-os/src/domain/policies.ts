/**
 * Ops configuration ("policy register", OPS-022) — every value carries a decision
 * state (PLT-007) and its source, so a value that implements a `proposed` or
 * `open` policy is never shown as policy (BR-OPS-13). Defaults come from the
 * legacy extracts in data/legacy/ops/workflows.json and operations-workbook.json.
 * Pure: the server loads stored overrides and calls `resolveSettings()`.
 */
import { z } from 'zod';

export const DECISION_STATES = [
  'proposed',
  'approved',
  'locked',
  'open',
  'pending_verification',
  'superseded',
] as const;
export type DecisionState = (typeof DECISION_STATES)[number];

export const DECISION_STATE_LABELS: Record<DecisionState, string> = {
  proposed: 'Proposed',
  approved: 'Approved',
  locked: 'Locked',
  open: 'Open — owner decision needed',
  pending_verification: 'Pending verification',
  superseded: 'Superseded',
};

const days = z.int().min(0).max(365);

export const settingSchemas = {
  /** Demo terms recorded in the legacy decision log (D-003, D-004 "Confirmed"; BR-OPS-2). */
  'demo.terms': z
    .object({
      days: z.int().min(1).max(7),
      separateFromMainBatch: z.literal(true),
      refundableIfNotJoining: z.boolean(),
      adjustedAgainstFeesOnJoining: z.boolean(),
    })
    .strict(),
  /** Demo fee amount. Recorded as Confirmed in legacy, but fee-data scope is OD-013. */
  'demo.fee': z.object({ amountInr: z.number().min(0).max(1_000_000) }).strict(),
  /** Demo limits — OPEN (legacy D-005, OD-012). Null = not decided, not enforced. */
  'demo.limits': z
    .object({
      maxConsecutiveDays: z.int().min(1).max(14).nullable(),
      subjectCap: z.int().min(1).max(20).nullable(),
      missedDayRule: z.string().max(500).nullable(),
    })
    .strict(),
  /** Whether counselled → admission_pending (demo skipped) is allowed. Our proposal. */
  'pipeline.demo_skip': z.object({ allowed: z.boolean() }).strict(),
  /** BR-OPS-6 parts of the confirmation gate (BR-OPS-7 parts are fixed). */
  'admission.confirmation': z
    .object({ requireDocuments: z.boolean(), requireDownPayment: z.boolean() })
    .strict(),
  /** Follow-up due rules (legacy OP-007 "Proposed"; service hours are OD-011). */
  'followups.due_rules': z
    .object({
      firstContactDays: days,
      afterCounsellingDays: days,
      afterDemoDays: days,
      upcomingWindowDays: days,
      closedWeekdays: z.array(z.int().min(0).max(6)).max(6),
    })
    .strict(),
  /** Escalation thresholds in calendar days (BR-OPS-10 levels are a starting model). */
  'tasks.escalation': z
    .object({
      overdueDaysL2: z.int().min(1).max(365),
      overdueDaysL3: z.int().min(1).max(365),
      overdueDaysL4: z.int().min(1).max(365),
      blockedDaysL2: z.int().min(1).max(365),
      responseDays: days,
    })
    .strict()
    .refine((v) => v.overdueDaysL2 < v.overdueDaysL3 && v.overdueDaysL3 < v.overdueDaysL4, {
      error: 'Thresholds must increase: L2 < L3 < L4',
    }),
  /** Cohort window for lead → admission conversion (BR-OPS-8: 7/14/30 days). */
  'kpi.conversion': z
    .object({ windowDays: z.union([z.literal(7), z.literal(14), z.literal(30)]) })
    .strict(),
  /** Online office hours (legacy Rules sheet "Locked"; conflict noted in data/legacy/README.md). */
  'office.online_hours': z
    .object({
      weekdays: z.string(),
      opens: z.string(),
      closes: z.string(),
      sundaySupport: z.boolean(),
    })
    .strict(),
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type SettingValue<K extends SettingKey> = z.output<(typeof settingSchemas)[K]>;

export interface SettingDefinition<K extends SettingKey = SettingKey> {
  key: K;
  label: string;
  description: string;
  defaultValue: SettingValue<K>;
  defaultState: DecisionState;
  source: string;
  ownerDecision: string | null;
  /** Can operations managers change the value here? (Changed values become `proposed`.) */
  editable: boolean;
}

export const SETTING_DEFINITIONS: { [K in SettingKey]: SettingDefinition<K> } = {
  'demo.terms': {
    key: 'demo.terms',
    label: 'Demo terms',
    description:
      'Demo length and handling: separate demo classes (never the main batch), non-refundable if the student does not join, adjusted against fees on joining.',
    defaultValue: {
      days: 2,
      separateFromMainBatch: true,
      refundableIfNotJoining: false,
      adjustedAgainstFeesOnJoining: true,
    },
    defaultState: 'approved',
    source:
      'Legacy decisions LEGACY-OPSWB-D-003 and D-004 ("Confirmed"); data/legacy/ops/workflows.json WF-DEMO; the earlier 3-day demo is superseded.',
    ownerDecision: null,
    editable: false,
  },
  'demo.fee': {
    key: 'demo.fee',
    label: 'Demo fee amount',
    description:
      'Amount recorded on each demo booking. Elevate OS records only the fee status and a reference, never accounting entries.',
    defaultValue: { amountInr: 1000 },
    defaultState: 'pending_verification',
    source:
      'Legacy D-003 and Work Inventory OP-006 record ₹1,000 as "Confirmed"; how Elevate OS handles fee data is open (OD-013), so the amount is configuration, not approved policy.',
    ownerDecision: 'OD-013',
    editable: true,
  },
  'demo.limits': {
    key: 'demo.limits',
    label: 'Demo limits',
    description: 'Consecutive days, subject cap and missed-day treatment. Not enforced while open.',
    defaultValue: { maxConsecutiveDays: null, subjectCap: null, missedDayRule: null },
    defaultState: 'open',
    source: 'Legacy decision LEGACY-OPSWB-D-005 ("Open").',
    ownerDecision: 'OD-012',
    editable: true,
  },
  'pipeline.demo_skip': {
    key: 'pipeline.demo_skip',
    label: 'Allow admission without a demo',
    description:
      'Whether a counselled lead may go straight to "admission pending" (a reason is always required). The legacy sources describe the demo step but do not say it is mandatory.',
    defaultValue: { allowed: true },
    defaultState: 'proposed',
    source:
      'Proposal by the Business Ops team: BR-OPS-1 lists the demo step; no source makes it mandatory or optional.',
    ownerDecision: null,
    editable: true,
  },
  'admission.confirmation': {
    key: 'admission.confirmation',
    label: 'Admission confirmation requirements',
    description:
      'Documents verified and down payment verified before "admitted" (BR-OPS-6). Two fee verifications by different people plus an authorised fee approval are always required (BR-OPS-7, approved) and cannot be switched off.',
    defaultValue: { requireDocuments: true, requireDownPayment: true },
    defaultState: 'proposed',
    source:
      'Marketing-Easy "Start Here" A31 (proposed definition); Work Inventory OP-008, OP-010 ("Confirmed").',
    ownerDecision: 'OD-013',
    editable: true,
  },
  'followups.due_rules': {
    key: 'followups.due_rules',
    label: 'Follow-up due rules',
    description:
      'Days after an event when the next follow-up is due (Asia/Kolkata calendar days), the "upcoming" window, and closed weekdays (0 = Sunday) that push a due date to the next open day.',
    defaultValue: {
      firstContactDays: 0,
      afterCounsellingDays: 1,
      afterDemoDays: 1,
      upcomingWindowDays: 2,
      closedWeekdays: [0],
    },
    defaultState: 'proposed',
    source:
      'Work Inventory LEGACY-OPSWB-OP-007 ("Proposed": WhatsApp next-day feedback, calls within 1–2 days); Sunday closure follows the online "no routine Sunday support" rule.',
    ownerDecision: 'OD-011',
    editable: true,
  },
  'tasks.escalation': {
    key: 'tasks.escalation',
    label: 'Task escalation thresholds',
    description:
      'Overdue by N calendar days raises L2 (manager), L3 (manager’s manager / operations lead), L4 (leadership). Blocked for N days raises L2. The owner keeps the task.',
    defaultValue: {
      overdueDaysL2: 2,
      overdueDaysL3: 5,
      overdueDaysL4: 10,
      blockedDaysL2: 3,
      responseDays: 1,
    },
    defaultState: 'proposed',
    source:
      'Escalation levels L1–L4 from SYSTEM_ARCHITECTURE.md ("starting model"); thresholds are our proposal.',
    ownerDecision: 'OD-011',
    editable: true,
  },
  'kpi.conversion': {
    key: 'kpi.conversion',
    label: 'Lead → admission conversion window',
    description:
      'Days after receipt within which a cohort lead must be admitted to count (7, 14 or 30).',
    defaultValue: { windowDays: 30 },
    defaultState: 'proposed',
    source: 'BR-OPS-8 (cohort conversion over 7, 14 and 30 days; Marketing-Easy SOP Register G14).',
    ownerDecision: 'OD-027',
    editable: true,
  },
  'office.online_hours': {
    key: 'office.online_hours',
    label: 'Online office hours',
    description: 'Routine online support hours. Sunday events need an assigned event team.',
    defaultValue: {
      weekdays: 'Monday–Saturday',
      opens: '11:00',
      closes: '18:00',
      sundaySupport: false,
    },
    defaultState: 'locked',
    source:
      'Elevate-Online-Easy Rules A5:C6 ("Locked"); note: handover Claude.md says the coordinator SOP timings still need management approval.',
    ownerDecision: null,
    editable: false,
  },
};

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

export function isSettingKey(value: string): value is SettingKey {
  return value in SETTING_DEFINITIONS;
}

export interface StoredSetting {
  key: string;
  value: unknown;
  decisionState: string;
  source: string | null;
  ownerDecision: string | null;
  updatedAt?: Date | string | null;
}

export interface ResolvedSetting<K extends SettingKey = SettingKey> {
  key: K;
  label: string;
  description: string;
  value: SettingValue<K>;
  decisionState: DecisionState;
  source: string;
  ownerDecision: string | null;
  editable: boolean;
  /** `default` = code default (nothing stored); `stored` = DB row; `invalid_stored` = DB row failed validation, default used. */
  origin: 'default' | 'stored' | 'invalid_stored';
}

export type ResolvedSettings = { [K in SettingKey]: ResolvedSetting<K> };

function isDecisionState(v: string): v is DecisionState {
  return (DECISION_STATES as readonly string[]).includes(v);
}

/** Merge stored rows over the defaults. Invalid stored values never override (fail safe). */
export function resolveSettings(stored: readonly StoredSetting[]): ResolvedSettings {
  const byKey = new Map(stored.map((s) => [s.key, s]));
  const out = {} as Record<SettingKey, ResolvedSetting>;
  for (const key of SETTING_KEYS) {
    const def = SETTING_DEFINITIONS[key] as SettingDefinition;
    const row = byKey.get(key);
    let resolved: ResolvedSetting = {
      key,
      label: def.label,
      description: def.description,
      value: def.defaultValue,
      decisionState: def.defaultState,
      source: def.source,
      ownerDecision: def.ownerDecision,
      editable: def.editable,
      origin: 'default',
    };
    if (row) {
      const parsed = (settingSchemas[key] as z.ZodType).safeParse(row.value);
      resolved =
        parsed.success && isDecisionState(row.decisionState)
          ? {
              ...resolved,
              value: parsed.data as never,
              decisionState: row.decisionState,
              source: row.source ?? def.source,
              ownerDecision: row.ownerDecision ?? def.ownerDecision,
              origin: 'stored',
            }
          : { ...resolved, origin: 'invalid_stored' };
    }
    out[key] = resolved;
  }
  return out as ResolvedSettings;
}

/**
 * Validate a requested change. Changing a value never makes it approved: the
 * result state is `proposed` (approving policies is a director decision, OPS-022).
 */
export function validateSettingChange(
  key: string,
  value: unknown,
):
  | { ok: true; key: SettingKey; value: unknown; decisionState: 'proposed' }
  | { ok: false; message: string } {
  if (!isSettingKey(key)) return { ok: false, message: `Unknown setting "${key}".` };
  const def = SETTING_DEFINITIONS[key];
  if (!def.editable)
    return {
      ok: false,
      message: `"${def.label}" records a legacy ${def.defaultState} decision and cannot be changed here.`,
    };
  const parsed = (settingSchemas[key] as z.ZodType).safeParse(value);
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid value.' };
  return { ok: true, key, value: parsed.data, decisionState: 'proposed' };
}
