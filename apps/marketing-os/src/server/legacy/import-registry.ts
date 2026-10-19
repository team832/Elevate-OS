/**
 * Legacy import, part 1: accounts (MKT-001), the OD-001 conflict, brand rules (MKT-012).
 * Idempotent: rows are inserted when absent and never overwritten (a re-run keeps edits).
 */
import {
  marketingContentRules,
  marketingLegacyConflicts,
  marketingSocialAccounts,
  type Database,
} from '@elevate/database';
import {
  mapAccountScope,
  mapExamPrefixes,
  mapLegacyAccountStatus,
  mapPlatform,
  parseCadenceText,
  type RuleKind,
  type RuleStatus,
} from '../../domain';
import type { LegacyAccountsFile, LegacyRulesFile } from './types';

export interface ImportCount {
  inserted: number;
  existing: number;
}

const RULE_KINDS: readonly RuleKind[] = [
  'banned_phrase',
  'channel_rule',
  'requires_approval',
  'consent',
];
const RULE_STATUSES: readonly RuleStatus[] = ['approved', 'documented', 'proposed', 'retired'];

/** A rule-backed cadence limit (e.g. CH-005 for LI) wins over the parsed legacy text. */
function ruleCadence(rules: LegacyRulesFile | null, code: string) {
  const rule = rules?.records.find(
    (r) =>
      r.applies_to.includes(code) &&
      typeof r.matcher === 'object' &&
      r.matcher !== null &&
      (r.matcher as { type?: string }).type === 'schedule_limit',
  );
  if (!rule) return null;
  const m = rule.matcher as { max_per_day?: number; max_per_week?: number };
  return {
    maxPerDay: m.max_per_day ?? null,
    maxPerWeek: m.max_per_week ?? null,
    enforcement: rule.action_on_match === 'block' ? ('block' as const) : ('warn' as const),
    status: rule.status === 'approved' ? ('approved' as const) : ('proposed' as const),
    ruleId: rule.id,
  };
}

export async function importLegacyAccounts(
  db: Database,
  file: LegacyAccountsFile,
  rules: LegacyRulesFile | null,
): Promise<ImportCount & { conflicts: ImportCount }> {
  const rows = file.records.map((r) => {
    const fromRule = ruleCadence(rules, r.code);
    const parsed = parseCadenceText(r.cadence);
    return {
      code: r.code,
      platform: mapPlatform(r.platform),
      displayName: r.display_name,
      proposedDisplayName: r.proposed_display_name ?? null,
      // Never invented: only a handle the source records as confirmed live.
      handle: r.handle_status === 'confirmed_live' ? r.handle : null,
      proposedHandle: r.proposed_handle ?? null,
      handleStatus: r.handle_status,
      scope: mapAccountScope(r.code, r.exam_page),
      examPrefixes: mapExamPrefixes(r.exam_or_scope, r.exam_page),
      audience: r.audience,
      job: r.job,
      status: mapLegacyAccountStatus(r.legacy_status),
      legacyStatus: r.legacy_status,
      cadenceText: r.cadence,
      cadenceMaxPerDay: fromRule?.maxPerDay ?? parsed.maxPerDay,
      cadenceMaxPerWeek: fromRule?.maxPerWeek ?? parsed.maxPerWeek,
      cadenceEnforcement: fromRule?.enforcement ?? ('warn' as const),
      cadenceStatus: fromRule?.status ?? ('proposed' as const),
      contentRules: r.content_rules,
      publishingToolBrand: r.metricool_brand,
      integrationStatus: 'not_configured' as const,
      notes: [
        ...(r.notes ?? []),
        ...(fromRule
          ? [`Cadence limit from rule ${fromRule.ruleId}.`]
          : r.cadence
            ? ['Cadence numbers are the upper bound of the legacy text (proposed, OD-007).']
            : []),
      ],
      provenance: { importedFrom: 'data/legacy/marketing/accounts.json', source: r.source },
    };
  });
  const inserted = await db
    .insert(marketingSocialAccounts)
    .values(rows)
    .onConflictDoNothing({ target: marketingSocialAccounts.code })
    .returning({ id: marketingSocialAccounts.id });

  const conflictRows = file.conflicts.map((c) => ({
    code: c.id,
    ownerDecision: 'OD-001',
    title: 'Two social-account models disagree',
    description: c.description,
    status: 'unreconciled' as const,
    details: { accountsInOtherModel: c.accounts_in_other_model, legacyStatus: c.status },
    provenance: { importedFrom: 'data/legacy/marketing/accounts.json', source: c.source },
  }));
  const conflicts = conflictRows.length
    ? await db
        .insert(marketingLegacyConflicts)
        .values(conflictRows)
        .onConflictDoNothing({ target: marketingLegacyConflicts.code })
        .returning({ id: marketingLegacyConflicts.id })
    : [];
  return {
    inserted: inserted.length,
    existing: rows.length - inserted.length,
    conflicts: { inserted: conflicts.length, existing: conflictRows.length - conflicts.length },
  };
}

export async function importLegacyRules(db: Database, file: LegacyRulesFile): Promise<ImportCount> {
  const rows = file.records.map((r) => {
    if (!RULE_KINDS.includes(r.kind as RuleKind))
      throw new Error(`Unknown rule kind ${r.kind} (${r.id})`);
    return {
      code: r.id,
      kind: r.kind as RuleKind,
      description: r.description,
      matcher: (r.matcher ?? null) as object | null,
      manualCheck: r.manual_check,
      actionOnMatch: r.action_on_match,
      appliesTo: r.applies_to,
      status: RULE_STATUSES.includes(r.status as RuleStatus)
        ? (r.status as RuleStatus)
        : 'proposed',
      sourceText: r.source_text,
      notes: r.notes,
      provenance: { importedFrom: 'data/legacy/marketing/content-rules.json', source: r.source },
    };
  });
  const inserted = await db
    .insert(marketingContentRules)
    .values(rows)
    .onConflictDoNothing({ target: marketingContentRules.code })
    .returning({ id: marketingContentRules.id });
  return { inserted: inserted.length, existing: rows.length - inserted.length };
}
