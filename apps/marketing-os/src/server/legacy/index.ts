/**
 * Legacy marketing import (MKT-034, MKT-035, PLT-011). Order: policy settings → rules →
 * accounts (+ OD-001 conflict) → ideas (with quarantine) → placements/content items →
 * post audit. Every step is idempotent; run it as often as you like.
 */
import type { Database } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { seedPolicySettings } from '../policy';
import { importLegacyPostAudit } from './import-audit';
import { importLegacyAccounts, importLegacyRules } from './import-registry';
import { importLegacyIdeas, importLegacyPlacements } from './import-tracker';
import type { LegacyMarketingData } from './types';

export * from './types';
export { importLegacyAccounts, importLegacyRules } from './import-registry';
export { importLegacyIdeas, importLegacyPlacements } from './import-tracker';
export { importLegacyPostAudit, POST_AUDIT_LABEL } from './import-audit';

export async function importLegacyMarketing(db: Database, data: LegacyMarketingData) {
  return withTransaction(db, async (tx) => {
    const settings = await seedPolicySettings(tx);
    const rules = await importLegacyRules(tx, data.rules);
    const accounts = await importLegacyAccounts(tx, data.accounts, data.rules);
    const ideas = await importLegacyIdeas(tx, data.ideas);
    const placements = await importLegacyPlacements(tx, data.placements);
    const postAudit = await importLegacyPostAudit(tx, data.postAudit);
    return { settings, rules, accounts, ideas, placements, postAudit };
  });
}
