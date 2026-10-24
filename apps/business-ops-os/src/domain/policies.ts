/**
 * Ops configuration ("policy register", OPS-022) — every value carries a decision
 * state (PLT-007) and its source, so a value that implements a `proposed` or
 * `open` policy is never shown as policy (BR-OPS-13). Defaults come from the
 * legacy extracts in data/legacy/ops/workflows.json and operations-workbook.json.
 * Pure: the server loads stored overrides and calls `resolveSettings()`.
 */
import type { z } from 'zod';
import type { DecisionState, PolicyDefinition } from './policies-base';
import { DECISION_STATES } from './policies-base';
import { ADMISSION_SETTING_DEFINITIONS, admissionSettingSchemas } from './policies-admission';
import { ASSESSMENT_SETTING_DEFINITIONS, assessmentSettingSchemas } from './policies-assessments';
import { HR_SETTING_DEFINITIONS, hrSettingSchemas } from './policies-hr';
import { PIPELINE_SETTING_DEFINITIONS, pipelineSettingSchemas } from './policies-pipeline';

export { DECISION_STATE_LABELS, DECISION_STATES, type DecisionState } from './policies-base';
export {
  EVENT_POPULATIONS,
  KYC_GUARDIAN_FIELDS,
  KYC_STUDENT_FIELDS,
  REPORT_AUDIENCES,
} from './policies-admission';
export { FEEDBACK_TEACHER_VISIBILITY, TASK_REOPENERS, WEEKDAYS } from './policies-hr';

// Spread order is the settings list order (SETTING_KEYS).
export const settingSchemas = {
  ...pipelineSettingSchemas,
  ...admissionSettingSchemas,
  ...hrSettingSchemas,
  ...assessmentSettingSchemas,
};

export type SettingKey = keyof typeof settingSchemas;
export type SettingValue<K extends SettingKey> = z.output<(typeof settingSchemas)[K]>;
export type SettingDefinition<K extends SettingKey = SettingKey> = PolicyDefinition<
  SettingValue<K>
>;

export const SETTING_DEFINITIONS: { [K in SettingKey]: SettingDefinition<K> } = {
  ...PIPELINE_SETTING_DEFINITIONS,
  ...ADMISSION_SETTING_DEFINITIONS,
  ...HR_SETTING_DEFINITIONS,
  ...ASSESSMENT_SETTING_DEFINITIONS,
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
    // A non-editable value is an owner decision in code: a stored row never overrides it.
    if (row && def.editable) {
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
