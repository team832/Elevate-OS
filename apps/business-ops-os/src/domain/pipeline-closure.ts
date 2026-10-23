/** Closure reason codes of the admission pipeline (OPS-070). Pure. */
import type { AdmissionStatus, TransitionActor } from './pipeline';

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
