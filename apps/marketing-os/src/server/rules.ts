/**
 * Loads the brand rules from marketing.content_rules and runs the pure checker
 * (domain/rules.ts) for a content item's version against the accounts it is placed on.
 */
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import {
  marketingContentAssets,
  marketingContentRules,
  marketingPlacements,
  marketingSocialAccounts,
  type Database,
  type MarketingContentVersionId,
} from '@elevate/database';
import type { ContentItemId } from '@elevate/shared-types';
import {
  checkContentRules,
  parseRuleMatcher,
  type ContentRule,
  type RuleCheckResult,
} from '../domain';
import { loadPolicy } from './policy';

export async function loadContentRules(db: Database): Promise<ContentRule[]> {
  const rows = await db
    .select()
    .from(marketingContentRules)
    .where(ne(marketingContentRules.status, 'retired'))
    .orderBy(asc(marketingContentRules.code));
  return rows.map((r) => ({
    code: r.code,
    kind: r.kind,
    description: r.description,
    matcher: parseRuleMatcher(r.matcher),
    manualCheck: r.manualCheck,
    actionOnMatch: r.actionOnMatch,
    appliesTo: r.appliesTo,
    status: r.status,
  }));
}

export async function listContentRules(db: Database) {
  return db.select().from(marketingContentRules).orderBy(asc(marketingContentRules.code));
}

/** Account codes of an item's live (not cancelled) placements. */
export async function targetAccountCodes(db: Database, itemId: ContentItemId): Promise<string[]> {
  const rows = await db
    .select({ code: marketingSocialAccounts.code })
    .from(marketingPlacements)
    .innerJoin(
      marketingSocialAccounts,
      eq(marketingSocialAccounts.id, marketingPlacements.accountId),
    )
    .where(
      and(
        eq(marketingPlacements.contentItemId, itemId),
        ne(marketingPlacements.status, 'cancelled'),
      ),
    );
  return [...new Set(rows.map((r) => r.code))].sort();
}

export interface VersionForCheck {
  id: MarketingContentVersionId;
  title: string;
  body: string;
  showsStudents: boolean;
  consentReference: string | null;
}

export async function runRuleCheck(
  db: Database,
  input: {
    itemId: ContentItemId;
    format: string;
    version: VersionForCheck;
    /** Override the accounts (scheduling checks one account). */
    accountCodes?: readonly string[];
  },
): Promise<RuleCheckResult> {
  // Sequential on purpose: one connection (and PGlite) per transaction.
  const rules = await loadContentRules(db);
  const policy = await loadPolicy(db);
  const assets = await db
    .select()
    .from(marketingContentAssets)
    .where(inArray(marketingContentAssets.versionId, [input.version.id]));
  const accountCodes = input.accountCodes ?? (await targetAccountCodes(db, input.itemId));
  return checkContentRules(
    {
      title: input.version.title,
      body: input.version.body,
      format: input.format,
      accountCodes,
      showsStudents: input.version.showsStudents,
      consentReference: input.version.consentReference,
      assets: assets.map((a) => ({
        fileName: a.fileName,
        showsStudents: a.showsStudents,
        rightsState: a.rightsState,
      })),
    },
    rules,
    { consentRequiredForStudents: policy.consentRequiredForStudents },
  );
}
