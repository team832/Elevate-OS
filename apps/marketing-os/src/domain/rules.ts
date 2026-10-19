/**
 * Brand-rule checker and approval eligibility (MKT-011, MKT-012, MKT-022;
 * docs/ALGORITHMS.md §4). Rules are data (marketing.content_rules, seeded from
 * data/legacy/marketing/content-rules.json), so they can be added or retired without a deploy.
 */
import type { RightsState, RuleKind, RuleStatus } from './vocabulary';

export type RuleMatcher =
  | { type: 'regex'; pattern: string; flags?: string; field: RuleField }
  | { type: 'literal'; pattern: string; case_sensitive?: boolean; field: RuleField }
  | { type: 'schedule_limit'; max_per_day?: number; max_per_week?: number; field: 'date_ist' };

export type RuleField = 'text' | 'title' | 'format' | 'date_ist';

export interface ContentRule {
  code: string;
  kind: RuleKind;
  description: string;
  matcher: RuleMatcher | null;
  manualCheck: boolean;
  actionOnMatch: string | null;
  appliesTo: readonly string[];
  status: RuleStatus;
}

export interface RuleCheckInput {
  title: string;
  body: string;
  /** Format label the format-field rules read, e.g. `post` or `poll`. */
  format: string;
  /** Accounts the content will go to. Empty → every account any rule names (strictest). */
  accountCodes: readonly string[];
  showsStudents: boolean;
  consentReference: string | null;
  assets: readonly { fileName: string; showsStudents: boolean; rightsState: RightsState }[];
}

export interface RuleFlag {
  ruleCode: string;
  kind: RuleKind | 'system';
  description: string;
  severity: 'block' | 'review';
  ruleStatus: RuleStatus | 'system';
  /** Accounts (of those checked) the rule applies to. */
  accounts: string[];
  /** Up to three matched excerpts. */
  matches: string[];
  reason: string;
}

export interface ChecklistItem {
  ruleCode: string;
  kind: RuleKind;
  description: string;
  ruleStatus: RuleStatus;
  /** Why the approver must confirm it. */
  reason: 'manual_check' | 'flagged_for_review';
  accounts: string[];
}

export interface RuleCheckResult {
  accountsChecked: string[];
  /** True when the content had no target accounts, so every account's rules applied. */
  assumedAllAccounts: boolean;
  blocking: RuleFlag[];
  review: RuleFlag[];
  checklist: ChecklistItem[];
  /** Rules not evaluated here (schedule limits run at scheduling; broken patterns). */
  skipped: { ruleCode: string; reason: string }[];
}

export interface RuleCheckOptions {
  /** OD-008 (proposed default true): content showing students needs a consent reference. */
  consentRequiredForStudents?: boolean;
}

/** Codes of checks that come from the system rather than the rule table. */
export const SYSTEM_RULES = {
  consentMissing: 'SYS-CONSENT',
  rightsPending: 'SYS-RIGHTS',
} as const;

function fieldText(input: RuleCheckInput, field: RuleField): string {
  if (field === 'title') return input.title;
  if (field === 'format') return input.format;
  if (field === 'date_ist') return '';
  return `${input.title}\n${input.body}`;
}

function findMatches(matcher: RuleMatcher, text: string): string[] | { error: string } {
  if (matcher.type === 'literal') {
    const hay = matcher.case_sensitive ? text : text.toLowerCase();
    const needle = matcher.case_sensitive ? matcher.pattern : matcher.pattern.toLowerCase();
    const out: string[] = [];
    let from = 0;
    while (needle && out.length < 3) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      out.push(text.slice(at, at + needle.length));
      from = at + needle.length;
    }
    return out;
  }
  if (matcher.type === 'regex') {
    let re: RegExp;
    try {
      const flags = [...new Set(`${matcher.flags ?? ''}g`.split(''))]
        .filter((f) => 'gimsuy'.includes(f))
        .join('');
      re = new RegExp(matcher.pattern, flags);
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'invalid pattern' };
    }
    const out: string[] = [];
    for (const m of text.matchAll(re)) {
      out.push(m[0]);
      if (out.length >= 3) break;
    }
    return out;
  }
  return [];
}

/** Every account code named by any active rule (used when the content has no target yet). */
function allRuleAccounts(rules: readonly ContentRule[]): string[] {
  const set = new Set<string>();
  for (const r of rules) for (const a of r.appliesTo) set.add(a);
  return [...set].sort();
}

export function checkContentRules(
  input: RuleCheckInput,
  rules: readonly ContentRule[],
  options: RuleCheckOptions = {},
): RuleCheckResult {
  const active = rules.filter((r) => r.status !== 'retired');
  const assumedAllAccounts = input.accountCodes.length === 0;
  const accountsChecked = assumedAllAccounts
    ? allRuleAccounts(active)
    : [...new Set(input.accountCodes)].sort();
  const result: RuleCheckResult = {
    accountsChecked,
    assumedAllAccounts,
    blocking: [],
    review: [],
    checklist: [],
    skipped: [],
  };

  for (const rule of [...active].sort((a, b) => a.code.localeCompare(b.code))) {
    const accounts = rule.appliesTo.filter((a) => accountsChecked.includes(a));
    if (accounts.length === 0) continue;
    if (rule.manualCheck || !rule.matcher) {
      result.checklist.push({
        ruleCode: rule.code,
        kind: rule.kind,
        description: rule.description,
        ruleStatus: rule.status,
        reason: 'manual_check',
        accounts,
      });
      continue;
    }
    if (rule.matcher.type === 'schedule_limit') {
      result.skipped.push({
        ruleCode: rule.code,
        reason: 'Checked when scheduling (cadence limit).',
      });
      continue;
    }
    const found = findMatches(rule.matcher, fieldText(input, rule.matcher.field));
    if (!Array.isArray(found)) {
      result.skipped.push({ ruleCode: rule.code, reason: `Pattern could not run: ${found.error}` });
      continue;
    }
    const action = rule.actionOnMatch;
    const hit = action === 'flag_if_no_match' ? found.length === 0 : found.length > 0;
    if (!hit) continue;
    const severity: RuleFlag['severity'] = action === 'block' ? 'block' : 'review';
    const flag: RuleFlag = {
      ruleCode: rule.code,
      kind: rule.kind,
      description: rule.description,
      severity,
      ruleStatus: rule.status,
      accounts,
      matches: found,
      reason:
        action === 'flag_if_no_match'
          ? `Expected pattern not found in the ${rule.matcher.field}.`
          : `Matched ${found.map((m) => `"${m}"`).join(', ')} in the ${rule.matcher.field}.`,
    };
    if (severity === 'block') result.blocking.push(flag);
    else {
      result.review.push(flag);
      result.checklist.push({
        ruleCode: rule.code,
        kind: rule.kind,
        description: rule.description,
        ruleStatus: rule.status,
        reason: 'flagged_for_review',
        accounts,
      });
    }
  }

  // Students on camera (CO-001, OD-008) and third-party rights (MKT-022).
  const showsStudents = input.showsStudents || input.assets.some((a) => a.showsStudents);
  if (showsStudents && !input.consentReference?.trim()) {
    const flag: RuleFlag = {
      ruleCode: SYSTEM_RULES.consentMissing,
      kind: 'system',
      description:
        "Content shows students (mostly minors): record the student's and a parent's consent reference (CO-001).",
      severity: options.consentRequiredForStudents === false ? 'review' : 'block',
      ruleStatus: 'system',
      accounts: accountsChecked,
      matches: [],
      reason: 'Shows students but no consent reference is recorded on this version.',
    };
    if (flag.severity === 'block') result.blocking.push(flag);
    else result.review.push(flag);
  }
  const pending = input.assets.filter((a) => a.rightsState === 'third_party_pending');
  if (pending.length > 0) {
    result.blocking.push({
      ruleCode: SYSTEM_RULES.rightsPending,
      kind: 'system',
      description: 'Third-party material without cleared rights cannot be approved (MKT-022).',
      severity: 'block',
      ruleStatus: 'system',
      accounts: accountsChecked,
      matches: pending.slice(0, 3).map((a) => a.fileName),
      reason: `${pending.length} asset(s) have third-party rights pending.`,
    });
  }
  return result;
}

export interface ApprovalEligibility {
  eligible: boolean;
  blocking: string[];
  missingAcknowledgements: string[];
  /** Acknowledged codes that are not on the checklist (ignored, reported for transparency). */
  unexpectedAcknowledgements: string[];
}

/**
 * An approval may proceed only when nothing blocks and the approver has acknowledged every
 * checklist item (manual checks and flagged-for-review matches).
 */
export function evaluateApprovalEligibility(
  check: RuleCheckResult,
  acknowledgedRuleCodes: readonly string[],
): ApprovalEligibility {
  const ack = new Set(acknowledgedRuleCodes);
  const required = [...new Set(check.checklist.map((c) => c.ruleCode))];
  return {
    eligible: check.blocking.length === 0 && required.every((c) => ack.has(c)),
    blocking: [...new Set(check.blocking.map((b) => b.ruleCode))],
    missingAcknowledgements: required.filter((c) => !ack.has(c)),
    unexpectedAcknowledgements: [...ack].filter((c) => !required.includes(c)).sort(),
  };
}

/** Parse a matcher from stored JSON; null when absent or unrecognised. */
export function parseRuleMatcher(value: unknown): RuleMatcher | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const field = (typeof v.field === 'string' ? v.field : 'text') as RuleField;
  if (v.type === 'regex' && typeof v.pattern === 'string') {
    return {
      type: 'regex',
      pattern: v.pattern,
      flags: typeof v.flags === 'string' ? v.flags : '',
      field,
    };
  }
  if (v.type === 'literal' && typeof v.pattern === 'string') {
    return {
      type: 'literal',
      pattern: v.pattern,
      case_sensitive: v.case_sensitive === true,
      field,
    };
  }
  if (v.type === 'schedule_limit') {
    return {
      type: 'schedule_limit',
      max_per_day: typeof v.max_per_day === 'number' ? v.max_per_day : undefined,
      max_per_week: typeof v.max_per_week === 'number' ? v.max_per_week : undefined,
      field: 'date_ist',
    };
  }
  return null;
}
