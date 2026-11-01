/**
 * Academic OS seeds, run by `npm run db:seed` after the core seeds. Idempotent
 * (upserts on codes). Legacy planning data keeps its status labels; planned
 * counts are never seeded as delivered work; people are fictional (D-016).
 *
 *   academic.ipmat-baseline            IPMAT-BASE + plan IPMAT-BASELINE-253 (locked)
 *   academic.ipmat-class12             IPMAT-C12-2027 + plans 313 (superseded) → 305 (counts locked, dates provisional)
 *   academic.ca-foundation             CAF-ACC-SEP27 + plan CAF-ACC-V0.2 (provisional)
 *   academic.online-class12-accountancy ONL-C12-ACC + plan ONL-C12-ACC-226 (provisional)
 *   academic.syllabus-drafts           draft syllabus courses CLAT/CUET/CAF/COM-C11/COM-C12 + IPMAT-BASE chapter weights
 *   academic.concept-books             6 concept-book indices (133 chapters + opening unit + aliases)
 *   academic.batches                   IPMAT-C12-APR27 (calendar, 28-slot allowance, mock-phase blackout), CAF-SEP27-REG
 *   academic.students                  6 sample batches + 31 sample students (is_sample, made-up people) — ./samples.ts
 *   academic.sample-teaching           sample teachers' classes, attendance, logs, demo attendee, reviews
 *                                      (needs the Ops seeds ops.sample-staff and ops.samples)
 *   ./owner-assignments.ts             real staff assignments: the reference seed only (scripts/release/reference-seeds.ts)
 *   ./sample-tests.ts                  sample tests, run by the platform seed platform.sample-tests
 *                                      (needs Ops admission numbers and the enrolled sample admissions)
 */
import type { SeedDefinition } from '@elevate/database/seed';
import { batchesSeed } from './batches';
import { caFoundationSeed, onlineAccountancySeed } from './ca-online';
import { conceptBooksSeed } from './concept-books';
import { ipmatBaselineSeed, ipmatClass12Seed } from './ipmat';
import { sampleTeachingSeed, studentsSeed } from './samples';
import { syllabusDraftsSeed } from './syllabus';

export { seedFillTeaching } from './fill-teaching';
export { seedFillTests } from './fill-tests';
export {
  DEMO_TEACHER_TESTS,
  getAssessmentDetail,
  PENDING_IMPORT_TEST,
  placeSampleEnrolments,
  SAMPLE_TESTS,
  seedDemoTeacherTests,
  seedSampleTests,
} from './sample-tests';

export const seeds: readonly SeedDefinition[] = [
  ipmatBaselineSeed,
  ipmatClass12Seed,
  caFoundationSeed,
  onlineAccountancySeed,
  syllabusDraftsSeed,
  conceptBooksSeed,
  batchesSeed,
  studentsSeed,
  sampleTeachingSeed,
];
