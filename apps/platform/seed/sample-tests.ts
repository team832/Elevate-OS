/**
 * `platform.sample-tests` (brief 23 Oct 2026 §17–§21, §25): once the sample admissions are
 * enrolled, place them in the sample batch of their programme (Academic placement service), then
 * create the sample tests through Academic's internal assessment services with the Ops admission
 * numbers of the roster, and stage one pending score import on the in-progress test with Ops's
 * import rules. Only the platform may touch both modules (D-011.3). Skipped once sample tests exist.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { academicBatches, opsAdmissions, students, type Database } from '@elevate/database';
import { defineSeed } from '@elevate/database/seed';
import {
  getAssessmentDetail,
  PENDING_IMPORT_TEST,
  placeSampleEnrolments,
  seedSampleTests,
} from '@elevate/academic-os/seed';
import { seedSampleScoreImport } from '@elevate/business-ops-os/seed';

const OPS_MANAGER = 'operations-manager@example.test';

export async function seedPlatformSampleTests(db: Database, log: (m: string) => void = () => {}) {
  if (!(await db.$count(academicBatches, eq(academicBatches.isSample, true))))
    return log('platform.sample-tests skipped: no sample batches (run the Academic seeds)');
  const enrolled = await db
    .select({ id: opsAdmissions.id })
    .from(opsAdmissions)
    .innerJoin(students, eq(students.id, opsAdmissions.studentId))
    .where(and(eq(students.isSample, true), eq(opsAdmissions.status, 'enrolled')));
  const placed = await placeSampleEnrolments(
    db,
    enrolled.map((a) => a.id),
  );
  const admissionNumbers = (
    await db
      .select({
        coreStudentId: opsAdmissions.studentId,
        admissionNumber: opsAdmissions.admissionNumber,
      })
      .from(opsAdmissions)
      .innerJoin(students, eq(students.id, opsAdmissions.studentId))
      .where(and(eq(students.isSample, true), isNotNull(opsAdmissions.admissionNumber)))
  ).map((r) => ({ coreStudentId: r.coreStudentId!, admissionNumber: r.admissionNumber! }));
  const tests = await seedSampleTests(db, { actorEmail: OPS_MANAGER, admissionNumbers });
  if (!tests)
    return log(
      `platform.sample-tests: ${placed} placement(s); tests exist or ${OPS_MANAGER} is missing`,
    );
  const pending = tests.get(PENDING_IMPORT_TEST)!;
  const imported = await seedSampleScoreImport(
    db,
    (await getAssessmentDetail(db, pending)) as never,
    OPS_MANAGER,
  );
  log(
    `platform.sample-tests: ${placed} placement(s), ${tests.size} tests, pending import ${JSON.stringify(imported?.counts ?? null)}`,
  );
}

export const sampleTestSeed = defineSeed({
  name: 'platform.sample-tests',
  module: 'platform',
  // Academic's sample batches come from academic.students (earlier in db:seed's list); without them
  // this seed skips, so Ops-only test runs need no Academic seed.
  dependsOn: ['platform.sample-enrolments', 'ops.sample-staff'],
  description:
    'Sample admissions placed in batches; sample tests (published, in progress, awaiting publication, upcoming) and a pending score import',
  run: ({ db, log }) => seedPlatformSampleTests(db, log),
});
