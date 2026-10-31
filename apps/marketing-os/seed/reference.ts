/**
 * Marketing seeds a production database can use (data-packets §4). `marketing.registry` is the part
 * of the legacy import that is configuration: social accounts, the OD-001 conflict, brand rules and
 * the proposed policy settings. `marketing.legacy` adds the 59 ideas, 36 placements and the 60-post
 * audit: run by db:seed, and on production only when the owner chooses to import that history.
 */
import { marketingOptimisationCategories } from '@elevate/database';
import { defineSeed } from '@elevate/database/seed';
import { importLegacyMarketing, importLegacyRegistry } from '../src/server/legacy';
import { loadLegacyMarketingData } from '../src/server/legacy/load';

/** SEO / AIO / GEO as the brief labels them (§14); reference data, kept by db:clear-samples. */
const OPTIMISATION_CATEGORIES = [
  {
    key: 'seo',
    label: 'SEO',
    meaning:
      'Search engine optimization: work that helps a page be found and read well in ordinary search results (page title, headings, content, links, speed).',
  },
  {
    key: 'aio',
    label: 'AIO',
    meaning:
      'AI search optimization: work that helps AI answers shown by search engines find and quote the page correctly.',
  },
  {
    key: 'geo',
    label: 'GEO',
    meaning:
      'Generative engine optimization: work that helps chat assistants that write answers describe Elevate accurately and point to the right page.',
  },
] as const;

export const optimisationCategoriesSeed = defineSeed({
  name: 'marketing.optimisation-categories',
  module: 'marketing',
  description: 'SEO, AIO and GEO work categories with their meanings (reference data, not sample)',
  // Inserted only when missing: the marketing manager may relabel or switch them off.
  run: async ({ db }) => {
    await db
      .insert(marketingOptimisationCategories)
      .values([...OPTIMISATION_CATEGORIES])
      .onConflictDoNothing();
  },
});

export const marketingRegistrySeed = defineSeed({
  name: 'marketing.registry',
  module: 'marketing',
  description: 'Social accounts, OD-001 conflict, brand rules and proposed policy settings',
  async run({ db, log }) {
    const result = await importLegacyRegistry(db, loadLegacyMarketingData());
    log(`marketing.registry — ${JSON.stringify(result)}`);
  },
});

export const marketingLegacySeed = defineSeed({
  name: 'marketing.legacy',
  module: 'marketing',
  dependsOn: ['core.users', 'core.staff_members'],
  description:
    'Marketing legacy import: accounts, OD-001 conflict, brand rules, ideas (quarantine), placements, post audit, proposed policies',
  async run({ db, log }) {
    const result = await importLegacyMarketing(db, loadLegacyMarketingData());
    log(`marketing.legacy — ${JSON.stringify(result)}`);
  },
});
