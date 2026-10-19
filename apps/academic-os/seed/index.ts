/**
 * Academic OS seeds, run by `npm run db:seed` after the core seeds. Idempotent
 * (upserts on codes). Legacy planning data keeps its status labels; planned
 * counts are never seeded as delivered work; people are fictional (D-016).
 *
 *   academic.ipmat-baseline            IPMAT-BASE + plan IPMAT-BASELINE-253 (locked)
 *   academic.ipmat-class12             IPMAT-C12-2027 + plans 313 (superseded) → 305 (counts locked, dates provisional)
 *   academic.ca-foundation             CAF-ACC-SEP27 + plan CAF-ACC-V0.2 (provisional)
 *   academic.online-class12-accountancy ONL-C12-ACC + plan ONL-C12-ACC-226 (provisional)
 *   academic.concept-books             6 concept-book indices (133 chapters + opening unit + aliases)
 *   academic.batches                   IPMAT-C12-APR27 (calendar, 28-slot allowance, mock-phase blackout), CAF-SEP27-REG
 *   academic.students                  6 fictional students enrolled in IPMAT-C12-APR27
 */
import type { SeedDefinition } from '@elevate/database/seed';
import { batchesSeed, studentsSeed } from './batches';
import { caFoundationSeed, onlineAccountancySeed } from './ca-online';
import { conceptBooksSeed } from './concept-books';
import { ipmatBaselineSeed, ipmatClass12Seed } from './ipmat';

export const seeds: readonly SeedDefinition[] = [
  ipmatBaselineSeed,
  ipmatClass12Seed,
  caFoundationSeed,
  onlineAccountancySeed,
  conceptBooksSeed,
  batchesSeed,
  studentsSeed,
];
