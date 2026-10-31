/**
 * The named list of seeds a production database may receive (structure/data-packets §4-5). A seed
 * that is not named here never runs through db/seed-reference.mjs. Everything here is idempotent.
 * Deep imports on purpose: the module `seed` barrels also export the sample set.
 */
import {
  batchesSeed,
  caFoundationSeed,
  conceptBooksSeed,
  ipmatBaselineSeed,
  ipmatClass12Seed,
  onlineAccountancySeed,
  ownerAssignmentsSeed,
  syllabusDraftsSeed,
} from '../../apps/academic-os/seed/reference';
import { leadReferenceSeeds } from '../../apps/business-ops-os/seed/lead-reference';
import { onboardingTemplateSeeds } from '../../apps/business-ops-os/seed/onboarding-templates';
import { teacherSeeds } from '../../apps/business-ops-os/seed/teachers';
import { websiteFeesSeed } from '../../apps/business-ops-os/seed/website-fees';
import {
  marketingLegacySeed,
  marketingRegistrySeed,
  optimisationCategoriesSeed,
} from '../../apps/marketing-os/seed/reference';
import { coreReferenceSeeds, type SeedDefinition } from '@elevate/database/seed';

export const REFERENCE_SEEDS: readonly SeedDefinition[] = [
  ...coreReferenceSeeds,
  ...leadReferenceSeeds,
  optimisationCategoriesSeed,
  marketingRegistrySeed,
  ipmatBaselineSeed,
  ipmatClass12Seed,
  caFoundationSeed,
  onlineAccountancySeed,
  syllabusDraftsSeed,
  conceptBooksSeed,
  batchesSeed,
  // Both need a real operations manager and say so until one exists; a later run loads them.
  ...onboardingTemplateSeeds,
  websiteFeesSeed,
];

/** Off unless named with --include: the owner has not decided these belong in a first install. */
export const OPTIONAL_SEEDS: Readonly<Record<string, readonly SeedDefinition[]>> = {
  /** Real people: 8 staff directory records (no logins, no contacts) and their assignments. */
  'owner-staff': [...teacherSeeds, ownerAssignmentsSeed],
  /** 59 ideas, 36 placements and the 60-post audit from the old trackers. */
  'marketing-history': [marketingLegacySeed],
};

/** These two only ever ordered a seed after the sample users; no reference seed reads them. */
const ORDER_ONLY = new Set(['core.users', 'core.staff_members']);

export function referenceSeedList(include: readonly string[] = []): SeedDefinition[] {
  const chosen = include.flatMap((key) => {
    const seeds = OPTIONAL_SEEDS[key];
    if (!seeds) throw new Error(`Unknown --include "${key}". Allowed: ${Object.keys(OPTIONAL_SEEDS).join(', ')}`);
    return seeds;
  });
  return [...REFERENCE_SEEDS, ...chosen].map((seed) => ({
    ...seed,
    dependsOn: seed.dependsOn?.filter((name) => !ORDER_ONLY.has(name)),
  }));
}
