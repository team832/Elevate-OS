/**
 * Marketing OS seeds, run by `npm run db:seed` after the core seeds.
 * Only legacy planning data with its status preserved (D-016): the 10 accounts, the OD-001
 * conflict, 45 brand rules, 59 ideas (8 quarantined, OD-003), 36 placements as content
 * items + placements (2 ambiguous), the 60-post manual audit as historical snapshots, and
 * the proposed policy settings. No people, no invented metrics, no fictional "results".
 * Plus the SEO/AIO/GEO categories (reference) and the labelled sample set of ./samples.ts
 * (brief 23 Oct 2026 §25). Idempotent: re-running inserts nothing new.
 */
import { defineSeed, type SeedDefinition } from '@elevate/database/seed';
import { importLegacyMarketing } from '../src/server/legacy';
import { loadLegacyMarketingData } from '../src/server/legacy/load';
import { marketingSampleSeeds } from './samples';

export const seeds: readonly SeedDefinition[] = [
  defineSeed({
    name: 'marketing.legacy',
    module: 'marketing',
    dependsOn: ['core.users', 'core.staff_members'],
    description:
      'Marketing legacy import: accounts, OD-001 conflict, brand rules, ideas (quarantine), placements, post audit, proposed policies',
    async run({ db, log }) {
      const result = await importLegacyMarketing(db, loadLegacyMarketingData());
      log(`marketing.legacy — ${JSON.stringify(result)}`);
    },
  }),
  ...marketingSampleSeeds,
];
