/**
 * Business Ops OS seeds, run by `npm run db:seed` after the core seeds.
 * Idempotent; fictional people only (D-016); legacy planning data keeps its
 * status label and is never seeded as delivered or approved.
 */
import type { SeedDefinition } from '@elevate/database/seed';
import { legacySeeds } from './legacy';
import { referenceSeeds } from './reference';
import { sampleSeeds } from './samples';

export const seeds: readonly SeedDefinition[] = [...referenceSeeds, ...legacySeeds, ...sampleSeeds];
