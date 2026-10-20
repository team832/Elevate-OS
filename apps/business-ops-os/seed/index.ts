/**
 * Business Ops OS seeds, run by `npm run db:seed` after the core seeds.
 * Idempotent; fictional people only (D-016); legacy planning data keeps its
 * status label and is never seeded as delivered or approved.
 */
import type { SeedDefinition } from '@elevate/database/seed';
import { admissionsSampleSeeds } from './admissions-samples';
import { hrLifecycleSeeds } from './hr-lifecycle';
import { hrRecordsSeeds } from './hr-records';
import { hrTimeSeeds } from './hr-time';
import { legacySeeds } from './legacy';
import { referenceSeeds } from './reference';
import { samplePlaceholderSeeds } from './sample-placeholders';
import { sampleSeeds } from './samples';

export const seeds: readonly SeedDefinition[] = [
  ...referenceSeeds,
  ...legacySeeds,
  ...sampleSeeds,
  ...admissionsSampleSeeds,
  ...hrRecordsSeeds,
  ...hrTimeSeeds,
  ...hrLifecycleSeeds,
  ...samplePlaceholderSeeds,
];
